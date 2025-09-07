// apps/backend/src/services/file-processor.js
// Enterprise-level file upload and processing optimization

const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const AWS = require('aws-sdk');
const { Worker } = require('worker_threads');
const Queue = require('bull');
const logger = require('../utils/logger');
const { getCacheManager } = require('./cache-manager');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

// ================================
// HIGH-PERFORMANCE FILE PROCESSOR
// ================================

class FileProcessor {
  constructor() {
    this.cache = getCacheManager();
    this.setupAWS();
    this.setupQueues();
    this.setupWorkerPools();
    
    // Processing limits and optimization
    this.limits = {
      maxFileSize: 100 * 1024 * 1024, // 100MB
      maxFiles: 20,
      imageMaxDimension: 4096,
      videoMaxDuration: 300, // 5 minutes
      concurrentProcessing: parseInt(process.env.FILE_PROCESSING_CONCURRENCY) || 4
    };
    
    // Performance metrics
    this.metrics = {
      uploadsProcessed: 0,
      totalProcessingTime: 0,
      avgProcessingTime: 0,
      queueSize: 0,
      errors: 0
    };
  }

  setupAWS() {
    if (process.env.AWS_ACCESS_KEY_ID) {
      this.s3 = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1',
        // Performance optimization
        maxRetries: 3,
        retryDelayOptions: {
          customBackoff: (retryCount) => Math.pow(2, retryCount) * 100
        },
        httpOptions: {
          timeout: 60000,
          agent: new require('https').Agent({
            keepAlive: true,
            maxSockets: 50
          })
        }
      });

      this.cloudfront = new AWS.CloudFront({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      });
      
      logger.info('✅ AWS services configured for file processing');
    }
  }

  setupQueues() {
    // Redis-based queues for file processing
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: 1 // Use different DB for queues
    };

    // Separate queues for different file types
    this.imageQueue = new Queue('image processing', redisConfig, {
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: 'exponential',
        delay: 1000
      }
    });

    this.videoQueue = new Queue('video processing', redisConfig, {
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 25,
        attempts: 2,
        backoff: 'exponential',
        delay: 5000
      }
    });

    this.modelQueue = new Queue('3d model processing', redisConfig, {
      defaultJobOptions: {
        removeOnComplete: 25,
        removeOnFail: 10,
        attempts: 2,
        backoff: 'exponential',
        delay: 2000
      }
    });

    this.setupQueueProcessors();
  }

  setupQueueProcessors() {
    // Image processing with concurrency control
    this.imageQueue.process('optimize', this.limits.concurrentProcessing, async (job) => {
      return await this.processImageJob(job.data);
    });

    // Video processing (single-threaded due to resource intensity)
    this.videoQueue.process('optimize', 1, async (job) => {
      return await this.processVideoJob(job.data);
    });

    // 3D model processing
    this.modelQueue.process('optimize', 2, async (job) => {
      return await this.processModelJob(job.data);
    });

    // Error handling
    [this.imageQueue, this.videoQueue, this.modelQueue].forEach(queue => {
      queue.on('failed', (job, error) => {
        logger.error(`File processing failed: ${job.queue.name}`, {
          jobId: job.id,
          error: error.message,
          data: job.data
        });
        this.metrics.errors++;
      });

      queue.on('completed', (job) => {
        logger.info(`File processing completed: ${job.queue.name}`, {
          jobId: job.id,
          processingTime: job.finishedOn - job.processedOn
        });
      });
    });
  }

  setupWorkerPools() {
    // CPU-intensive tasks worker pool
    this.workerPool = {
      available: [],
      busy: [],
      maxWorkers: require('os').cpus().length
    };

    // Initialize workers
    for (let i = 0; i < this.workerPool.maxWorkers; i++) {
      this.createWorker();
    }
  }

  createWorker() {
    const worker = new Worker(path.join(__dirname, 'workers/file-worker.js'));
    
    worker.on('message', (result) => {
      // Worker completed task
      this.workerPool.busy = this.workerPool.busy.filter(w => w !== worker);
      this.workerPool.available.push(worker);
    });

    worker.on('error', (error) => {
      logger.error('Worker error:', error);
      this.replaceWorker(worker);
    });

    this.workerPool.available.push(worker);
  }

  replaceWorker(failedWorker) {
    // Remove failed worker
    this.workerPool.available = this.workerPool.available.filter(w => w !== failedWorker);
    this.workerPool.busy = this.workerPool.busy.filter(w => w !== failedWorker);
    
    // Create replacement
    this.createWorker();
  }

  // ================================
  // OPTIMIZED MULTER CONFIGURATION
  // ================================

  createOptimizedMulter() {
    const storage = multer.memoryStorage(); // Use memory storage for performance

    return multer({
      storage: storage,
      limits: {
        fileSize: this.limits.maxFileSize,
        files: this.limits.maxFiles,
        parts: this.limits.maxFiles + 10, // Allow for form fields
        headerPairs: 2000
      },
      
      fileFilter: (req, file, cb) => {
        try {
          // Validate file type
          const isValid = this.validateFileType(file);
          if (!isValid) {
            return cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
          }

          // Check rate limiting
          if (!this.checkUploadRateLimit(req)) {
            return cb(new Error('Upload rate limit exceeded'), false);
          }

          cb(null, true);
        } catch (error) {
          cb(error, false);
        }
      }
    });
  }

  validateFileType(file) {
    const allowedTypes = {
      images: [
        'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 
        'image/gif', 'image/bmp', 'image/tiff'
      ],
      videos: [
        'video/mp4', 'video/mpeg', 'video/quicktime', 
        'video/webm', 'video/avi', 'video/mov'
      ],
      models: [
        'model/gltf-binary', 'model/gltf+json', 
        'application/octet-stream', // .glb files
        'text/plain' // .obj files
      ]
    };

    const allAllowed = [
      ...allowedTypes.images,
      ...allowedTypes.videos,
      ...allowedTypes.models
    ];

    return allAllowed.includes(file.mimetype);
  }

  checkUploadRateLimit(req) {
    // Implement token bucket for upload rate limiting
    const userId = req.user?.id || req.ip;
    const key = `upload_rate:${userId}`;
    
    // Use in-memory rate limiting for performance
    if (!this.uploadRateLimits) {
      this.uploadRateLimits = new Map();
    }

    const now = Date.now();
    const limit = this.uploadRateLimits.get(key) || { tokens: 10, lastRefill: now };
    
    // Refill tokens (1 token per 6 seconds = 10 uploads per minute max)
    const timePassed = now - limit.lastRefill;
    const tokensToAdd = Math.floor(timePassed / 6000);
    
    if (tokensToAdd > 0) {
      limit.tokens = Math.min(10, limit.tokens + tokensToAdd);
      limit.lastRefill = now;
    }

    if (limit.tokens > 0) {
      limit.tokens--;
      this.uploadRateLimits.set(key, limit);
      return true;
    }

    return false;
  }

  // ================================
  // INTELLIGENT FILE PROCESSING
  // ================================

  async processUploadedFiles(files, context = {}) {
    const startTime = Date.now();
    
    try {
      const processedFiles = {
        images: [],
        videos: [],
        models: [],
        errors: []
      };

      // Group files by type for batch processing
      const fileGroups = this.groupFilesByType(files);

      // Process each type concurrently
      const processingPromises = [];

      if (fileGroups.images.length > 0) {
        processingPromises.push(
          this.batchProcessImages(fileGroups.images, context)
            .then(results => processedFiles.images = results)
        );
      }

      if (fileGroups.videos.length > 0) {
        processingPromises.push(
          this.batchProcessVideos(fileGroups.videos, context)
            .then(results => processedFiles.videos = results)
        );
      }

      if (fileGroups.models.length > 0) {
        processingPromises.push(
          this.batchProcessModels(fileGroups.models, context)
            .then(results => processedFiles.models = results)
        );
      }

      // Wait for all processing to complete
      await Promise.allSettled(processingPromises);

      // Update metrics
      const processingTime = Date.now() - startTime;
      this.updateProcessingMetrics(files.length, processingTime);

      logger.info('File processing completed', {
        totalFiles: files.length,
        processingTime: `${processingTime}ms`,
        images: processedFiles.images.length,
        videos: processedFiles.videos.length,
        models: processedFiles.models.length
      });

      return processedFiles;

    } catch (error) {
      logger.error('File processing failed:', error);
      throw error;
    }
  }

  groupFilesByType(files) {
    const groups = { images: [], videos: [], models: [] };

    files.forEach(file => {
      if (file.mimetype.startsWith('image/')) {
        groups.images.push(file);
      } else if (file.mimetype.startsWith('video/')) {
        groups.videos.push(file);
      } else {
        groups.models.push(file);
      }
    });

    return groups;
  }

  // ================================
  // IMAGE PROCESSING OPTIMIZATION
  // ================================

  async batchProcessImages(images, context) {
    const results = [];
    
    // Process images in parallel batches
    const batchSize = 4;
    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (image) => {
        try {
          return await this.processImage(image, context);
        } catch (error) {
          logger.error('Image processing error:', error);
          return { error: error.message, filename: image.originalname };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(r => r.value || r.reason));
    }

    return results.filter(r => !r.error);
  }

  async processImage(image, context) {
    const startTime = Date.now();
    
    try {
      // Generate unique filename
      const fileId = this.generateFileId();
      const filename = `${fileId}.webp`;

      // Get image metadata
      const metadata = await sharp(image.buffer).metadata();
      
      // Validate image dimensions
      if (metadata.width > this.limits.imageMaxDimension || 
          metadata.height > this.limits.imageMaxDimension) {
        throw new Error(`Image dimensions too large: ${metadata.width}x${metadata.height}`);
      }

      // Create multiple optimized versions
      const variants = await this.createImageVariants(image.buffer, fileId);

      // Upload to S3 (or save locally)
      const uploadPromises = variants.map(variant => 
        this.uploadFile(variant.buffer, variant.key, 'image/webp')
      );

      const uploadResults = await Promise.all(uploadPromises);

      // Create response object
      const result = {
        id: fileId,
        originalName: image.originalname,
        mimeType: 'image/webp',
        size: image.size,
        variants: variants.map((variant, index) => ({
          type: variant.type,
          url: uploadResults[index].url,
          width: variant.width,
          height: variant.height,
          size: variant.buffer.length
        })),
        metadata: {
          originalWidth: metadata.width,
          originalHeight: metadata.height,
          format: metadata.format,
          processingTime: Date.now() - startTime
        }
      };

      // Add to queue for additional processing (thumbnails, etc.)
      await this.imageQueue.add('optimize', {
        fileId: fileId,
        originalBuffer: image.buffer,
        context: context
      }, {
        priority: context.priority || 0
      });

      return result;

    } catch (error) {
      logger.error('Image processing failed:', error);
      throw error;
    }
  }

  async createImageVariants(buffer, fileId) {
    const variants = [];

    // Original optimized version
    const originalBuffer = await sharp(buffer)
      .webp({ quality: 90, effort: 6 })
      .toBuffer();

    variants.push({
      type: 'original',
      buffer: originalBuffer,
      key: `images/${fileId}/original.webp`,
      width: (await sharp(originalBuffer).metadata()).width,
      height: (await sharp(originalBuffer).metadata()).height
    });

    // Large version (1200px max)
    const largeBuffer = await sharp(buffer)
      .resize(1200, 1200, { 
        fit: 'inside', 
        withoutEnlargement: true 
      })
      .webp({ quality: 85, effort: 6 })
      .toBuffer();

    const largeMetadata = await sharp(largeBuffer).metadata();
    variants.push({
      type: 'large',
      buffer: largeBuffer,
      key: `images/${fileId}/large.webp`,
      width: largeMetadata.width,
      height: largeMetadata.height
    });

    // Medium version (800px max)
    const mediumBuffer = await sharp(buffer)
      .resize(800, 800, { 
        fit: 'inside', 
        withoutEnlargement: true 
      })
      .webp({ quality: 80, effort: 6 })
      .toBuffer();

    const mediumMetadata = await sharp(mediumBuffer).metadata();
    variants.push({
      type: 'medium',
      buffer: mediumBuffer,
      key: `images/${fileId}/medium.webp`,
      width: mediumMetadata.width,
      height: mediumMetadata.height
    });

    // Thumbnail (300px max)
    const thumbBuffer = await sharp(buffer)
      .resize(300, 300, { 
        fit: 'inside', 
        withoutEnlargement: true 
      })
      .webp({ quality: 75, effort: 6 })
      .toBuffer();

    const thumbMetadata = await sharp(thumbBuffer).metadata();
    variants.push({
      type: 'thumbnail',
      buffer: thumbBuffer,
      key: `images/${fileId}/thumb.webp`,
      width: thumbMetadata.width,
      height: thumbMetadata.height
    });

    return variants;
  }

  // ================================
  // VIDEO PROCESSING OPTIMIZATION
  // ================================

  async batchProcessVideos(videos, context) {
    const results = [];
    
    // Process videos sequentially due to resource intensity
    for (const video of videos) {
      try {
        const result = await this.processVideo(video, context);
        results.push(result);
      } catch (error) {
        logger.error('Video processing error:', error);
        results.push({ error: error.message, filename: video.originalname });
      }
    }

    return results.filter(r => !r.error);
  }

  async processVideo(video, context) {
    const startTime = Date.now();
    
    try {
      const fileId = this.generateFileId();
      
      // Save temporary file for ffmpeg processing
      const tempPath = `/tmp/${fileId}_temp.${this.getFileExtension(video.originalname)}`;
      await fs.writeFile(tempPath, video.buffer);

      // Get video metadata
      const metadata = await this.getVideoMetadata(tempPath);
      
      // Validate video duration
      if (metadata.duration > this.limits.videoMaxDuration) {
        throw new Error(`Video duration too long: ${metadata.duration}s`);
      }

      // Queue for background processing
      await this.videoQueue.add('optimize', {
        fileId: fileId,
        tempPath: tempPath,
        originalName: video.originalname,
        metadata: metadata,
        context: context
      }, {
        priority: context.priority || 0
      });

      // Return immediate response
      const result = {
        id: fileId,
        originalName: video.originalname,
        mimeType: video.mimetype,
        size: video.size,
        status: 'processing',
        metadata: {
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          processingTime: Date.now() - startTime
        }
      };

      return result;

    } catch (error) {
      logger.error('Video processing failed:', error);
      throw error;
    }
  }

  async processVideoJob(jobData) {
    const { fileId, tempPath, originalName, metadata } = jobData;
    
    try {
      // Create optimized versions
      const variants = await this.createVideoVariants(tempPath, fileId, metadata);

      // Upload variants
      const uploadPromises = variants.map(async variant => 
        this.uploadFile(
          await fs.readFile(variant.path), 
          variant.key, 
          'video/mp4'
        )
      );

      const uploadResults = await Promise.all(uploadPromises);

      // Clean up temporary files
      await fs.unlink(tempPath);
      for (const variant of variants) {
        await fs.unlink(variant.path);
      }

      // Update database with processing results
      await this.updateVideoProcessingResults(fileId, {
        variants: variants.map((variant, index) => ({
          type: variant.type,
          url: uploadResults[index].url,
          width: variant.width,
          height: variant.height,
          bitrate: variant.bitrate
        })),
        status: 'completed'
      });

      return { success: true, fileId };

    } catch (error) {
      // Clean up on error
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        logger.warn('Cleanup failed:', cleanupError);
      }

      await this.updateVideoProcessingResults(fileId, { 
        status: 'failed', 
        error: error.message 
      });

      throw error;
    }
  }

  async createVideoVariants(inputPath, fileId, metadata) {
    const variants = [];

    // HD version (720p)
    if (metadata.height >= 720) {
      const hdPath = `/tmp/${fileId}_hd.mp4`;
      await this.transcodeVideo(inputPath, hdPath, {
        resolution: '1280x720',
        bitrate: '2000k',
        codec: 'libx264'
      });

      variants.push({
        type: 'hd',
        path: hdPath,
        key: `videos/${fileId}/hd.mp4`,
        width: 1280,
        height: 720,
        bitrate: '2000k'
      });
    }

    // SD version (480p)
    const sdPath = `/tmp/${fileId}_sd.mp4`;
    await this.transcodeVideo(inputPath, sdPath, {
      resolution: '854x480',
      bitrate: '1000k',
      codec: 'libx264'
    });

    variants.push({
      type: 'sd',
      path: sdPath,
      key: `videos/${fileId}/sd.mp4`,
      width: 854,
      height: 480,
      bitrate: '1000k'
    });

    // Thumbnail
    const thumbPath = `/tmp/${fileId}_thumb.jpg`;
    await this.extractVideoThumbnail(inputPath, thumbPath);

    variants.push({
      type: 'thumbnail',
      path: thumbPath,
      key: `videos/${fileId}/thumb.jpg`,
      width: metadata.width,
      height: metadata.height
    });

    return variants;
  }

  // ================================
  // 3D MODEL PROCESSING
  // ================================

  async batchProcessModels(models, context) {
    const results = [];
    
    // Process models with limited concurrency
    const concurrency = 2;
    for (let i = 0; i < models.length; i += concurrency) {
      const batch = models.slice(i, i + concurrency);
      
      const batchPromises = batch.map(async (model) => {
        try {
          return await this.processModel(model, context);
        } catch (error) {
          logger.error('Model processing error:', error);
          return { error: error.message, filename: model.originalname };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(r => r.value || r.reason));
    }

    return results.filter(r => !r.error);
  }

  async processModel(model, context) {
    const startTime = Date.now();
    
    try {
      const fileId = this.generateFileId();
      const extension = this.getFileExtension(model.originalname);
      const filename = `${fileId}.${extension}`;

      // Validate model file
      await this.validateModelFile(model.buffer, extension);

      // Upload original file
      const uploadResult = await this.uploadFile(
        model.buffer, 
        `models/${fileId}/original.${extension}`, 
        model.mimetype
      );

      // Queue for additional processing (compression, thumbnail generation)
      await this.modelQueue.add('optimize', {
        fileId: fileId,
        buffer: model.buffer,
        originalName: model.originalname,
        extension: extension,
        context: context
      });

      const result = {
        id: fileId,
        originalName: model.originalname,
        mimeType: model.mimetype,
        size: model.size,
        url: uploadResult.url,
        status: 'processing',
        metadata: {
          extension: extension,
          processingTime: Date.now() - startTime
        }
      };

      return result;

    } catch (error) {
      logger.error('Model processing failed:', error);
      throw error;
    }
  }

  // ================================
  // UPLOAD UTILITIES
  // ================================

  async uploadFile(buffer, key, contentType) {
    if (this.s3) {
      return await this.uploadToS3(buffer, key, contentType);
    } else {
      return await this.uploadLocally(buffer, key);
    }
  }

  async uploadToS3(buffer, key, contentType) {
    try {
      const params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'max-age=31536000', // 1 year
        Metadata: {
          uploadedAt: new Date().toISOString()
        }
      };

      const result = await this.s3.upload(params).promise();
      
      return {
        url: this.getCDNUrl(key),
        s3Url: result.Location,
        key: key
      };

    } catch (error) {
      logger.error('S3 upload failed:', error);
      throw error;
    }
  }

  async uploadLocally(buffer, key) {
    try {
      const uploadDir = path.join(process.cwd(), 'uploads');
      const filePath = path.join(uploadDir, key);
      const fileDir = path.dirname(filePath);

      // Ensure directory exists
      await fs.mkdir(fileDir, { recursive: true });

      // Write file
      await fs.writeFile(filePath, buffer);

      return {
        url: `/uploads/${key}`,
        localPath: filePath,
        key: key
      };

    } catch (error) {
      logger.error('Local upload failed:', error);
      throw error;
    }
  }

  // ================================
  // UTILITY METHODS
  // ================================

  generateFileId() {
    return crypto.randomBytes(16).toString('hex');
  }

  getFileExtension(filename) {
    return path.extname(filename).toLowerCase().substring(1);
  }

  getCDNUrl(key) {
    if (process.env.AWS_CLOUDFRONT_DOMAIN) {
      return `https://${process.env.AWS_CLOUDFRONT_DOMAIN}/${key}`;
    } else if (this.s3) {
      return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    } else {
      return `/uploads/${key}`;
    }
  }

  updateProcessingMetrics(fileCount, processingTime) {
    this.metrics.uploadsProcessed += fileCount;
    this.metrics.totalProcessingTime += processingTime;
    this.metrics.avgProcessingTime = this.metrics.totalProcessingTime / this.metrics.uploadsProcessed;
  }

  getProcessingMetrics() {
    return {
      ...this.metrics,
      queueSizes: {
        images: this.imageQueue.waiting,
        videos: this.videoQueue.waiting,
        models: this.modelQueue.waiting
      }
    };
  }

  async cleanup() {
    try {
      await this.imageQueue.close();
      await this.videoQueue.close();
      await this.modelQueue.close();
      
      // Terminate workers
      for (const worker of [...this.workerPool.available, ...this.workerPool.busy]) {
        await worker.terminate();
      }

      logger.info('✅ File processor cleanup completed');
    } catch (error) {
      logger.error('File processor cleanup failed:', error);
    }
  }
}

// ================================
// SINGLETON INSTANCE
// ================================

let fileProcessor = null;

const getFileProcessor = () => {
  if (!fileProcessor) {
    fileProcessor = new FileProcessor();
  }
  return fileProcessor;
};

const initializeFileProcessor = async () => {
  try {
    const processor = getFileProcessor();
    logger.info('✅ File processor initialized');
    return processor;
  } catch (error) {
    logger.error('❌ File processor initialization failed:', error);
    throw error;
  }
};

module.exports = {
  FileProcessor,
  getFileProcessor,
  initializeFileProcessor
};