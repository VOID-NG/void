// apps/backend/src/services/job-processor.js
// Enterprise-level background job processing system

const Queue = require('bull');
const Redis = require('ioredis');
const { Worker } = require('worker_threads');
const cron = require('node-cron');
const logger = require('../utils/logger');
const { getCacheManager } = require('./cache-manager');
const path = require('path');
const os = require('os');

// ================================
// HIGH-PERFORMANCE JOB PROCESSOR
// ================================

class JobProcessor {
  constructor() {
    this.cache = getCacheManager();
    this.setupRedis();
    this.setupQueues();
    this.setupWorkerPools();
    this.setupCronJobs();
    
    // Performance metrics
    this.metrics = {
      jobsProcessed: 0,
      jobsFailed: 0,
      avgProcessingTime: 0,
      queueSizes: {},
      workerUtilization: 0
    };
    
    // Job priorities
    this.priorities = {
      CRITICAL: 10,    // Payment processing, security alerts
      HIGH: 7,         // User notifications, order confirmations
      NORMAL: 5,       // Email sending, image processing
      LOW: 3,          // Analytics, cleanup tasks
      BULK: 1          // Batch operations, reports
    };
    
    this.setupMonitoring();
  }

  setupRedis() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      db: 2, // Use separate DB for jobs
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false
    });
    
    logger.info('✅ Job processor Redis configured');
  }

  setupQueues() {
    const redisConfig = {
      host: this.redis.options.host,
      port: this.redis.options.port,
      db: 2
    };

    // Critical priority queue (payments, security)
    this.criticalQueue = new Queue('critical jobs', redisConfig, {
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 25,
        attempts: 3,
        backoff: 'exponential',
        delay: 0
      }
    });

    // High priority queue (notifications, confirmations)
    this.highQueue = new Queue('high priority jobs', redisConfig, {
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: 'exponential',
        delay: 1000
      }
    });

    // Normal priority queue (emails, processing)
    this.normalQueue = new Queue('normal jobs', redisConfig, {
      defaultJobOptions: {
        removeOnComplete: 200,
        removeOnFail: 100,
        attempts: 2,
        backoff: 'exponential',
        delay: 2000
      }
    });

    // Low priority queue (analytics, cleanup)
    this.lowQueue = new Queue('low priority jobs', redisConfig, {
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 1,
        delay: 5000
      }
    });

    // Bulk operations queue
    this.bulkQueue = new Queue('bulk jobs', redisConfig, {
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 25,
        attempts: 1,
        delay: 10000
      }
    });

    this.setupQueueProcessors();
    this.setupQueueEventHandlers();
  }

  setupQueueProcessors() {
    // Critical queue - maximum concurrency
    this.criticalQueue.process('*', os.cpus().length, async (job) => {
      return await this.processJob(job, 'critical');
    });

    // High priority queue
    this.highQueue.process('*', Math.max(2, os.cpus().length - 2), async (job) => {
      return await this.processJob(job, 'high');
    });

    // Normal priority queue
    this.normalQueue.process('*', Math.max(1, os.cpus().length - 3), async (job) => {
      return await this.processJob(job, 'normal');
    });

    // Low priority queue - limited concurrency
    this.lowQueue.process('*', 2, async (job) => {
      return await this.processJob(job, 'low');
    });

    // Bulk queue - single worker to prevent resource competition
    this.bulkQueue.process('*', 1, async (job) => {
      return await this.processJob(job, 'bulk');
    });
  }

  setupQueueEventHandlers() {
    const queues = [
      { queue: this.criticalQueue, name: 'critical' },
      { queue: this.highQueue, name: 'high' },
      { queue: this.normalQueue, name: 'normal' },
      { queue: this.lowQueue, name: 'low' },
      { queue: this.bulkQueue, name: 'bulk' }
    ];

    queues.forEach(({ queue, name }) => {
      queue.on('completed', (job, result) => {
        this.onJobCompleted(job, result, name);
      });

      queue.on('failed', (job, error) => {
        this.onJobFailed(job, error, name);
      });

      queue.on('stalled', (job) => {
        logger.warn('Job stalled', { 
          queue: name, 
          jobId: job.id, 
          jobType: job.name 
        });
      });
    });
  }

  // ================================
  // JOB PROCESSING ENGINE
  // ================================

  async processJob(job, queueType) {
    const startTime = Date.now();
    
    try {
      logger.info('Processing job', {
        jobId: job.id,
        jobType: job.name,
        queue: queueType,
        priority: job.opts.priority
      });

      const result = await this.executeJobHandler(job);
      
      const processingTime = Date.now() - startTime;
      this.updateJobMetrics(true, processingTime);
      
      logger.info('Job completed', {
        jobId: job.id,
        jobType: job.name,
        processingTime: `${processingTime}ms`
      });

      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateJobMetrics(false, processingTime);
      
      logger.error('Job failed', {
        jobId: job.id,
        jobType: job.name,
        error: error.message,
        processingTime: `${processingTime}ms`
      });

      throw error;
    }
  }

  async executeJobHandler(job) {
    const { name, data } = job;

    switch (name) {
      // ================================
      // EMAIL JOBS
      // ================================
      case 'send_email':
        return await this.handleSendEmail(data);
        
      case 'send_bulk_email':
        return await this.handleSendBulkEmail(data);

      // ================================
      // NOTIFICATION JOBS
      // ================================
      case 'send_notification':
        return await this.handleSendNotification(data);
        
      case 'send_push_notification':
        return await this.handleSendPushNotification(data);

      // ================================
      // FILE PROCESSING JOBS
      // ================================
      case 'process_image':
        return await this.handleProcessImage(data);
        
      case 'process_video':
        return await this.handleProcessVideo(data);
        
      case 'process_3d_model':
        return await this.handleProcess3DModel(data);

      // ================================
      // PAYMENT JOBS
      // ================================
      case 'process_payment':
        return await this.handleProcessPayment(data);
        
      case 'release_escrow':
        return await this.handleReleaseEscrow(data);
        
      case 'process_refund':
        return await this.handleProcessRefund(data);

      // ================================
      // ANALYTICS JOBS
      // ================================
      case 'update_analytics':
        return await this.handleUpdateAnalytics(data);
        
      case 'generate_report':
        return await this.handleGenerateReport(data);

      // ================================
      // MAINTENANCE JOBS
      // ================================
      case 'cleanup_files':
        return await this.handleCleanupFiles(data);
        
      case 'backup_database':
        return await this.handleBackupDatabase(data);
        
      case 'optimize_database':
        return await this.handleOptimizeDatabase(data);

      // ================================
      // AI/SEARCH JOBS
      // ================================
      case 'generate_embeddings':
        return await this.handleGenerateEmbeddings(data);
        
      case 'update_search_index':
        return await this.handleUpdateSearchIndex(data);

      default:
        throw new Error(`Unknown job type: ${name}`);
    }
  }

  // ================================
  // JOB HANDLERS - EMAIL
  // ================================

  async handleSendEmail(data) {
    const { to, subject, template, templateData, attachments } = data;
    
    try {
      const emailService = require('./email-service');
      
      const result = await emailService.sendTemplateEmail({
        to,
        subject,
        template,
        data: templateData,
        attachments
      });

      return { success: true, messageId: result.messageId };

    } catch (error) {
      // Retry logic for failed emails
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        throw error; // Will trigger retry
      }
      
      // Don't retry for invalid email addresses
      if (error.message.includes('invalid email')) {
        return { success: false, error: 'Invalid email address' };
      }

      throw error;
    }
  }

  async handleSendBulkEmail(data) {
    const { recipients, subject, template, templateData, batchSize = 100 } = data;
    
    const results = {
      sent: 0,
      failed: 0,
      errors: []
    };

    // Process in batches to avoid overwhelming email service
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (recipient) => {
        try {
          await this.addJob('send_email', {
            to: recipient.email,
            subject,
            template,
            templateData: { ...templateData, ...recipient.data }
          }, 'normal');
          
          results.sent++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            email: recipient.email,
            error: error.message
          });
        }
      });

      await Promise.allSettled(batchPromises);
      
      // Add delay between batches
      if (i + batchSize < recipients.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  // ================================
  // JOB HANDLERS - FILE PROCESSING
  // ================================

  async handleProcessImage(data) {
    const { fileId, buffer, options = {} } = data;
    
    try {
      const { getFileProcessor } = require('./file-processor');
      const processor = getFileProcessor();
      
      const result = await processor.processImage({
        buffer,
        originalname: `processed_${fileId}.jpg`,
        mimetype: 'image/jpeg'
      }, options);

      // Cache processed image info
      await this.cache.set(`processed_image:${fileId}`, result, 3600);

      return result;

    } catch (error) {
      logger.error('Image processing failed:', error);
      throw error;
    }
  }

  async handleProcessVideo(data) {
    const { fileId, filePath, metadata } = data;
    
    try {
      const { getFileProcessor } = require('./file-processor');
      const processor = getFileProcessor();
      
      const result = await processor.processVideoJob({
        fileId,
        tempPath: filePath,
        metadata
      });

      return result;

    } catch (error) {
      logger.error('Video processing failed:', error);
      throw error;
    }
  }

  // ================================
  // JOB HANDLERS - PAYMENTS
  // ================================

  async handleProcessPayment(data) {
    const { transactionId, paymentMethodId, amount } = data;
    
    try {
      const transactionService = require('./transactionService');
      
      const result = await transactionService.processPayment(transactionId, {
        payment_method_id: paymentMethodId,
        amount
      });

      // Send confirmation notification
      if (result.success) {
        await this.addJob('send_notification', {
          userId: result.transaction.buyer_id,
          type: 'payment_confirmed',
          data: {
            transactionId,
            amount
          }
        }, 'high');
      }

      return result;

    } catch (error) {
      // Schedule retry for transient errors
      if (error.code === 'card_declined' || error.code === 'insufficient_funds') {
        // Don't retry payment failures
        return { success: false, error: error.message };
      }

      throw error; // Will trigger retry for network errors, etc.
    }
  }

  async handleReleaseEscrow(data) {
    const { transactionId } = data;
    
    try {
      const transactionService = require('./transactionService');
      
      const result = await transactionService.releaseEscrow(transactionId);

      // Notify both parties
      if (result.success) {
        await Promise.all([
          this.addJob('send_notification', {
            userId: result.transaction.buyer_id,
            type: 'escrow_released',
            data: { transactionId }
          }, 'high'),
          
          this.addJob('send_notification', {
            userId: result.transaction.vendor_id,
            type: 'payment_received',
            data: { 
              transactionId,
              amount: result.transaction.vendor_amount 
            }
          }, 'high')
        ]);
      }

      return result;

    } catch (error) {
      logger.error('Escrow release failed:', error);
      throw error;
    }
  }

  // ================================
  // JOB HANDLERS - ANALYTICS
  // ================================

  async handleUpdateAnalytics(data) {
    const { userId, event, metadata } = data;
    
    try {
      const { dbRouter } = require('../config/db');
      const client = dbRouter.getWriteClient();

      // Record user interaction
      await client.user_interactions.create({
        data: {
          user_id: userId,
          interaction_type: event,
          metadata: metadata,
          created_at: new Date()
        }
      });

      // Update cached analytics
      const cacheKey = `analytics:${userId}:${event}`;
      const current = await this.cache.get(cacheKey) || 0;
      await this.cache.set(cacheKey, current + 1, 86400); // 24 hour cache

      return { success: true };

    } catch (error) {
      logger.error('Analytics update failed:', error);
      throw error;
    }
  }

  // ================================
  // JOB SCHEDULING INTERFACE
  // ================================

  async addJob(jobType, data, priority = 'normal', options = {}) {
    const queue = this.getQueueByPriority(priority);
    const jobOptions = {
      priority: this.priorities[priority.toUpperCase()] || this.priorities.NORMAL,
      ...options
    };

    try {
      const job = await queue.add(jobType, data, jobOptions);
      
      logger.debug('Job scheduled', {
        jobId: job.id,
        jobType,
        priority,
        queue: queue.name
      });

      return job;

    } catch (error) {
      logger.error('Job scheduling failed:', error);
      throw error;
    }
  }

  async addDelayedJob(jobType, data, delay, priority = 'normal') {
    return await this.addJob(jobType, data, priority, { delay });
  }

  async addRepeatingJob(jobType, data, cronExpression, priority = 'low') {
    const queue = this.getQueueByPriority(priority);
    
    try {
      const job = await queue.add(jobType, data, {
        repeat: { cron: cronExpression },
        priority: this.priorities[priority.toUpperCase()]
      });

      logger.info('Repeating job scheduled', {
        jobType,
        cronExpression,
        priority
      });

      return job;

    } catch (error) {
      logger.error('Repeating job scheduling failed:', error);
      throw error;
    }
  }

  // ================================
  // CRON JOBS SETUP
  // ================================

  setupCronJobs() {
    // Auto-release escrow (runs every hour)
    cron.schedule('0 * * * *', async () => {
      await this.addJob('auto_release_escrow', {}, 'high');
    });

    // Daily analytics aggregation
    cron.schedule('0 2 * * *', async () => {
      await this.addJob('generate_report', { 
        type: 'daily_analytics',
        date: new Date().toISOString().split('T')[0]
      }, 'low');
    });

    // Weekly database optimization
    cron.schedule('0 3 * * 0', async () => {
      await this.addJob('optimize_database', {}, 'low');
    });

    // Hourly cleanup of temporary files
    cron.schedule('0 * * * *', async () => {
      await this.addJob('cleanup_files', { 
        type: 'temporary',
        olderThan: 24 * 60 * 60 * 1000 // 24 hours
      }, 'low');
    });

    // Daily backup (if enabled)
    if (process.env.ENABLE_AUTOMATED_BACKUPS === 'true') {
      cron.schedule('0 2 * * *', async () => {
        await this.addJob('backup_database', {
          type: 'full',
          retention: 30 // days
        }, 'low');
      });
    }

    logger.info('✅ Cron jobs scheduled');
  }

  // ================================
  // WORKER POOL MANAGEMENT
  // ================================

  setupWorkerPools() {
    this.workerPools = {
      cpu: [],      // CPU-intensive tasks
      io: [],       // I/O intensive tasks
      network: []   // Network requests
    };

    const cpuWorkers = Math.max(1, os.cpus().length - 1);
    const ioWorkers = 4;
    const networkWorkers = 8;

    // Initialize CPU workers
    for (let i = 0; i < cpuWorkers; i++) {
      this.createWorker('cpu', path.join(__dirname, 'workers/cpu-worker.js'));
    }

    // Initialize I/O workers
    for (let i = 0; i < ioWorkers; i++) {
      this.createWorker('io', path.join(__dirname, 'workers/io-worker.js'));
    }

    // Initialize network workers
    for (let i = 0; i < networkWorkers; i++) {
      this.createWorker('network', path.join(__dirname, 'workers/network-worker.js'));
    }

    logger.info('✅ Worker pools initialized', {
      cpu: cpuWorkers,
      io: ioWorkers,
      network: networkWorkers
    });
  }

  createWorker(type, workerScript) {
    const worker = new Worker(workerScript);
    
    worker.on('message', (result) => {
      // Handle worker completion
      this.onWorkerComplete(worker, result, type);
    });

    worker.on('error', (error) => {
      logger.error('Worker error:', { type, error: error.message });
      this.replaceWorker(worker, type, workerScript);
    });

    this.workerPools[type].push({
      worker,
      busy: false,
      lastUsed: Date.now()
    });
  }

  replaceWorker(failedWorker, type, workerScript) {
    // Remove failed worker
    this.workerPools[type] = this.workerPools[type].filter(
      w => w.worker !== failedWorker
    );
    
    // Create replacement
    this.createWorker(type, workerScript);
  }

  // ================================
  // MONITORING AND METRICS
  // ================================

  setupMonitoring() {
    setInterval(() => {
      this.updateQueueMetrics();
    }, 30000); // Every 30 seconds

    setInterval(() => {
      this.reportJobMetrics();
    }, 300000); // Every 5 minutes
  }

  updateQueueMetrics() {
    const queues = [
      { queue: this.criticalQueue, name: 'critical' },
      { queue: this.highQueue, name: 'high' },
      { queue: this.normalQueue, name: 'normal' },
      { queue: this.lowQueue, name: 'low' },
      { queue: this.bulkQueue, name: 'bulk' }
    ];

    queues.forEach(async ({ queue, name }) => {
      try {
        const waiting = await queue.waiting();
        const active = await queue.active();
        const completed = await queue.completed();
        const failed = await queue.failed();

        this.metrics.queueSizes[name] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length
        };
      } catch (error) {
        logger.warn('Queue metrics update failed:', { queue: name, error: error.message });
      }
    });
  }

  updateJobMetrics(success, processingTime) {
    if (success) {
      this.metrics.jobsProcessed++;
    } else {
      this.metrics.jobsFailed++;
    }

    // Update average processing time
    this.metrics.avgProcessingTime = (
      (this.metrics.avgProcessingTime * (this.metrics.jobsProcessed - 1)) + processingTime
    ) / this.metrics.jobsProcessed;
  }

  reportJobMetrics() {
    const totalJobs = this.metrics.jobsProcessed + this.metrics.jobsFailed;
    const successRate = totalJobs > 0 ? (this.metrics.jobsProcessed / totalJobs) * 100 : 0;

    logger.info('📊 Job Processing Metrics', {
      jobsProcessed: this.metrics.jobsProcessed,
      jobsFailed: this.metrics.jobsFailed,
      successRate: `${successRate.toFixed(2)}%`,
      avgProcessingTime: `${this.metrics.avgProcessingTime.toFixed(2)}ms`,
      queueSizes: this.metrics.queueSizes
    });
  }

  // ================================
  // UTILITY METHODS
  // ================================

  getQueueByPriority(priority) {
    switch (priority.toLowerCase()) {
      case 'critical': return this.criticalQueue;
      case 'high': return this.highQueue;
      case 'normal': return this.normalQueue;
      case 'low': return this.lowQueue;
      case 'bulk': return this.bulkQueue;
      default: return this.normalQueue;
    }
  }

  onJobCompleted(job, result, queueType) {
    logger.debug('Job completed', {
      jobId: job.id,
      jobType: job.name,
      queue: queueType,
      result: typeof result === 'object' ? 'object' : result
    });
  }

  onJobFailed(job, error, queueType) {
    logger.error('Job failed', {
      jobId: job.id,
      jobType: job.name,
      queue: queueType,
      error: error.message,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts
    });
  }

  async getJobStatus(jobId, queueType = 'normal') {
    try {
      const queue = this.getQueueByPriority(queueType);
      const job = await queue.getJob(jobId);
      
      if (!job) {
        return { status: 'not_found' };
      }

      const state = await job.getState();
      
      return {
        id: job.id,
        name: job.name,
        status: state,
        progress: job.progress(),
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts,
        created: job.timestamp,
        processed: job.processedOn,
        finished: job.finishedOn,
        data: job.data
      };

    } catch (error) {
      logger.error('Get job status failed:', error);
      return { status: 'error', error: error.message };
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      workerPools: Object.keys(this.workerPools).reduce((acc, type) => {
        acc[type] = {
          total: this.workerPools[type].length,
          busy: this.workerPools[type].filter(w => w.busy).length,
          available: this.workerPools[type].filter(w => !w.busy).length
        };
        return acc;
      }, {})
    };
  }

  async cleanup() {
    try {
      // Close all queues
      await Promise.all([
        this.criticalQueue.close(),
        this.highQueue.close(),
        this.normalQueue.close(),
        this.lowQueue.close(),
        this.bulkQueue.close()
      ]);

      // Terminate all workers
      for (const type of Object.keys(this.workerPools)) {
        for (const workerInfo of this.workerPools[type]) {
          await workerInfo.worker.terminate();
        }
      }

      logger.info('✅ Job processor cleanup completed');

    } catch (error) {
      logger.error('Job processor cleanup failed:', error);
    }
  }
}

// ================================
// SINGLETON INSTANCE
// ================================

let jobProcessor = null;

const getJobProcessor = () => {
  if (!jobProcessor) {
    jobProcessor = new JobProcessor();
  }
  return jobProcessor;
};

const initializeJobProcessor = async () => {
  try {
    const processor = getJobProcessor();
    logger.info('✅ Job processor initialized');
    return processor;
  } catch (error) {
    logger.error('❌ Job processor initialization failed:', error);
    throw error;
  }
};

module.exports = {
  JobProcessor,
  getJobProcessor,
  initializeJobProcessor
};