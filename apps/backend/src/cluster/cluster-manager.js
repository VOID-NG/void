// apps/backend/src/cluster/cluster-manager.js
// load balancing and clustering configuration

const cluster = require('cluster');
const os = require('os');
const logger = require('../utils/logger');
const sticky = require('sticky-session');

// ================================
// INTELLIGENT CLUSTER MANAGER
// ================================

class ClusterManager {
  constructor() {
    this.numCPUs = os.cpus().length;
    this.maxWorkers = parseInt(process.env.MAX_WORKERS) || this.numCPUs;
    this.minWorkers = parseInt(process.env.MIN_WORKERS) || Math.ceil(this.numCPUs / 2);
    
    this.workers = new Map();
    this.workerStats = new Map();
    this.loadBalancer = null;
    
    // Performance thresholds
    this.thresholds = {
      cpuThreshold: 80,      // CPU usage %
      memoryThreshold: 85,   // Memory usage %
      responseThreshold: 2000, // Response time ms
      errorThreshold: 5      // Error rate %
    };
    
    // Metrics
    this.metrics = {
      totalRequests: 0,
      totalErrors: 0,
      avgResponseTime: 0,
      workerCrashes: 0,
      lastScaleAction: null
    };
  }

  // ================================
  // CLUSTER INITIALIZATION
  // ================================

  async initialize() {
    if (process.env.NODE_ENV === 'production' && cluster.isMaster) {
      logger.info('🚀 Starting cluster manager in production mode');
      await this.setupMasterProcess();
    } else if (cluster.isMaster && process.env.ENABLE_CLUSTERING === 'true') {
      logger.info('🚀 Starting cluster manager in development mode');
      await this.setupMasterProcess();
    } else {
      // Worker process or single instance
      await this.setupWorkerProcess();
    }
  }

  async setupMasterProcess() {
    logger.info('📊 Master process starting', {
      pid: process.pid,
      cpus: this.numCPUs,
      maxWorkers: this.maxWorkers,
      minWorkers: this.minWorkers
    });

    // Set up graceful shutdown
    this.setupGracefulShutdown();
    
    // Set up worker monitoring
    this.setupWorkerMonitoring();
    
    // Set up auto-scaling
    this.setupAutoScaling();
    
    // Start initial workers
    await this.startWorkers(this.minWorkers);
    
    // Set up health checks
    this.setupHealthChecks();
    
    // Set up load balancer
    await this.setupLoadBalancer();
    
    logger.info('✅ Cluster master ready');
  }

  async setupWorkerProcess() {
    logger.info('👷 Worker process starting', {
      pid: process.pid,
      workerId: cluster.worker?.id || 'single'
    });

    // Start the application
    const { createApp } = require('../app');
    const { app, httpServer } = await createApp();
    
    const PORT = process.env.PORT || 5000;
    
    // Use sticky sessions for Socket.IO clustering
    if (cluster.isWorker && process.env.ENABLE_STICKY_SESSIONS === 'true') {
      // Let the master handle the server binding
      httpServer.listen(0, () => {
        logger.info(`🔗 Worker ${cluster.worker.id} ready on port ${httpServer.address().port}`);
      });
    } else {
      httpServer.listen(PORT, () => {
        logger.info(`🌐 Server running on port ${PORT} (PID: ${process.pid})`);
      });
    }

    // Worker-specific monitoring
    this.setupWorkerMetrics();
    
    return { app, httpServer };
  }

  // ================================
  // WORKER MANAGEMENT
  // ================================

  async startWorkers(count) {
    logger.info(`🚀 Starting ${count} workers`);
    
    for (let i = 0; i < count; i++) {
      await this.startWorker();
    }
  }

  async startWorker() {
    return new Promise((resolve) => {
      const worker = cluster.fork();
      
      this.workers.set(worker.id, {
        worker,
        startTime: Date.now(),
        restarts: 0,
        status: 'starting'
      });

      this.workerStats.set(worker.id, {
        requests: 0,
        errors: 0,
        avgResponseTime: 0,
        cpuUsage: 0,
        memoryUsage: 0,
        lastHealthCheck: Date.now()
      });

      worker.on('online', () => {
        this.workers.get(worker.id).status = 'online';
        logger.info(`👷 Worker ${worker.id} online (PID: ${worker.process.pid})`);
        resolve(worker);
      });

      worker.on('message', (message) => {
        this.handleWorkerMessage(worker.id, message);
      });
    });
  }

  async stopWorker(workerId, graceful = true) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;

    const worker = workerInfo.worker;
    
    if (graceful) {
      // Send graceful shutdown signal
      worker.send({ cmd: 'shutdown' });
      
      // Wait for graceful shutdown or force kill after timeout
      setTimeout(() => {
        if (!worker.isDead()) {
          logger.warn(`⚡ Force killing worker ${workerId}`);
          worker.kill('SIGKILL');
        }
      }, 10000); // 10 second timeout
    } else {
      worker.kill('SIGTERM');
    }

    this.workers.delete(workerId);
    this.workerStats.delete(workerId);
  }

  async restartWorker(workerId) {
    logger.info(`🔄 Restarting worker ${workerId}`);
    
    const workerInfo = this.workers.get(workerId);
    if (workerInfo) {
      workerInfo.restarts++;
      
      // Check if worker is restarting too frequently
      if (workerInfo.restarts > 5) {
        logger.error(`⚠️  Worker ${workerId} restarting too frequently, delaying restart`);
        await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second delay
      }
    }

    await this.stopWorker(workerId, true);
    await this.startWorker();
  }

  // ================================
  // AUTO-SCALING SYSTEM
  // ================================

  setupAutoScaling() {
    // Check scaling conditions every 30 seconds
    setInterval(() => {
      this.checkScalingConditions();
    }, 30000);

    logger.info('⚖️  Auto-scaling system enabled');
  }

  async checkScalingConditions() {
    try {
      const currentWorkers = this.workers.size;
      const avgCpuUsage = this.getAverageCpuUsage();
      const avgMemoryUsage = this.getAverageMemoryUsage();
      const avgResponseTime = this.getAverageResponseTime();
      const errorRate = this.getErrorRate();

      // Scale UP conditions
      if (this.shouldScaleUp(currentWorkers, avgCpuUsage, avgMemoryUsage, avgResponseTime)) {
        await this.scaleUp();
      }
      // Scale DOWN conditions
      else if (this.shouldScaleDown(currentWorkers, avgCpuUsage, avgMemoryUsage, avgResponseTime)) {
        await this.scaleDown();
      }

      // Log scaling metrics
      logger.debug('📊 Scaling metrics', {
        workers: currentWorkers,
        avgCpu: `${avgCpuUsage.toFixed(2)}%`,
        avgMemory: `${avgMemoryUsage.toFixed(2)}%`,
        avgResponseTime: `${avgResponseTime.toFixed(2)}ms`,
        errorRate: `${errorRate.toFixed(2)}%`
      });

    } catch (error) {
      logger.error('Auto-scaling check failed:', error);
    }
  }

  shouldScaleUp(currentWorkers, avgCpu, avgMemory, avgResponseTime) {
    return currentWorkers < this.maxWorkers && (
      avgCpu > this.thresholds.cpuThreshold ||
      avgMemory > this.thresholds.memoryThreshold ||
      avgResponseTime > this.thresholds.responseThreshold
    );
  }

  shouldScaleDown(currentWorkers, avgCpu, avgMemory, avgResponseTime) {
    return currentWorkers > this.minWorkers && (
      avgCpu < this.thresholds.cpuThreshold * 0.5 &&
      avgMemory < this.thresholds.memoryThreshold * 0.5 &&
      avgResponseTime < this.thresholds.responseThreshold * 0.5
    );
  }

  async scaleUp() {
    const currentWorkers = this.workers.size;
    const newWorkerCount = Math.min(currentWorkers + 1, this.maxWorkers);
    
    if (newWorkerCount > currentWorkers) {
      logger.info(`📈 Scaling UP: ${currentWorkers} → ${newWorkerCount} workers`);
      await this.startWorker();
      this.metrics.lastScaleAction = { type: 'up', timestamp: Date.now() };
    }
  }

  async scaleDown() {
    const currentWorkers = this.workers.size;
    const newWorkerCount = Math.max(currentWorkers - 1, this.minWorkers);
    
    if (newWorkerCount < currentWorkers) {
      logger.info(`📉 Scaling DOWN: ${currentWorkers} → ${newWorkerCount} workers`);
      
      // Find the least utilized worker
      const leastUtilizedWorker = this.findLeastUtilizedWorker();
      if (leastUtilizedWorker) {
        await this.stopWorker(leastUtilizedWorker, true);
        this.metrics.lastScaleAction = { type: 'down', timestamp: Date.now() };
      }
    }
  }

  // ================================
  // LOAD BALANCER SETUP
  // ================================

  async setupLoadBalancer() {
    if (process.env.ENABLE_STICKY_SESSIONS === 'true') {
      // Use sticky sessions for Socket.IO
      await this.setupStickySessionLoadBalancer();
    } else {
      // Use round-robin load balancing
      await this.setupRoundRobinLoadBalancer();
    }
  }

  async setupStickySessionLoadBalancer() {
    const { createApp } = require('../app');
    
    // Create a minimal server for sticky sessions
    const server = sticky(8080, () => {
      // This function runs in each worker
      return createApp().then(({ httpServer }) => httpServer);
    });

    if (!server) {
      // Master process - sticky session balancer is handling everything
      logger.info('🔗 Sticky session load balancer configured');
    }
  }

  async setupRoundRobinLoadBalancer() {
    // Simple round-robin implementation
    let currentWorker = 0;
    const workers = Array.from(this.workers.values());

    this.loadBalancer = {
      getNextWorker: () => {
        const worker = workers[currentWorker % workers.length];
        currentWorker++;
        return worker;
      }
    };

    logger.info('🔄 Round-robin load balancer configured');
  }

  // ================================
  // HEALTH CHECKS AND MONITORING
  // ================================

  setupWorkerMonitoring() {
    // Handle worker events
    cluster.on('exit', (worker, code, signal) => {
      this.handleWorkerExit(worker, code, signal);
    });

    cluster.on('disconnect', (worker) => {
      logger.warn(`📡 Worker ${worker.id} disconnected`);
    });

    // Periodic health checks
    setInterval(() => {
      this.performWorkerHealthChecks();
    }, 15000); // Every 15 seconds

    logger.info('💊 Worker monitoring enabled');
  }

  async handleWorkerExit(worker, code, signal) {
    this.metrics.workerCrashes++;
    
    logger.error(`💥 Worker ${worker.id} died`, {
      pid: worker.process.pid,
      code,
      signal,
      restarts: this.workers.get(worker.id)?.restarts || 0
    });

    // Clean up worker references
    this.workers.delete(worker.id);
    this.workerStats.delete(worker.id);

    // Restart worker if it wasn't a graceful shutdown
    if (code !== 0 && signal !== 'SIGTERM') {
      logger.info(`🔄 Auto-restarting worker ${worker.id}`);
      await this.startWorker();
    }
  }

  async performWorkerHealthChecks() {
    for (const [workerId, workerInfo] of this.workers) {
      try {
        // Send health check ping
        workerInfo.worker.send({ cmd: 'health_check', timestamp: Date.now() });
        
        // Check if worker is responsive
        const stats = this.workerStats.get(workerId);
        const timeSinceLastCheck = Date.now() - stats.lastHealthCheck;
        
        if (timeSinceLastCheck > 60000) { // 1 minute timeout
          logger.warn(`⚠️  Worker ${workerId} appears unresponsive`);
          await this.restartWorker(workerId);
        }

      } catch (error) {
        logger.error(`Health check failed for worker ${workerId}:`, error);
      }
    }
  }

  setupHealthChecks() {
    // Master process health endpoint
    const express = require('express');
    const healthApp = express();
    
    healthApp.get('/health', (req, res) => {
      const health = this.getClusterHealth();
      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(health);
    });

    healthApp.get('/metrics', (req, res) => {
      res.json(this.getClusterMetrics());
    });

    const healthPort = parseInt(process.env.HEALTH_CHECK_PORT) || 9090;
    healthApp.listen(healthPort, () => {
      logger.info(`💊 Health check server running on port ${healthPort}`);
    });
  }

  setupWorkerMetrics() {
    // Worker process metrics reporting
    if (cluster.isWorker) {
      setInterval(() => {
        const usage = process.cpuUsage();
        const memory = process.memoryUsage();
        
        process.send({
          cmd: 'worker_metrics',
          workerId: cluster.worker.id,
          metrics: {
            cpuUsage: (usage.user + usage.system) / 1000000, // Convert to seconds
            memoryUsage: memory.heapUsed,
            uptime: process.uptime()
          }
        });
      }, 10000); // Every 10 seconds

      // Handle shutdown signals gracefully
      process.on('message', (message) => {
        if (message.cmd === 'shutdown') {
          logger.info(`👷 Worker ${cluster.worker.id} received shutdown signal`);
          this.gracefulWorkerShutdown();
        }
      });
    }
  }

  handleWorkerMessage(workerId, message) {
    switch (message.cmd) {
      case 'worker_metrics':
        this.updateWorkerStats(workerId, message.metrics);
        break;
        
      case 'health_check_response':
        this.updateWorkerHealthCheck(workerId, message.timestamp);
        break;
        
      case 'request_complete':
        this.updateRequestMetrics(workerId, message.metrics);
        break;
        
      default:
        logger.debug('Unknown worker message:', message);
    }
  }

  // ================================
  // METRICS AND MONITORING
  // ================================

  updateWorkerStats(workerId, metrics) {
    const stats = this.workerStats.get(workerId);
    if (stats) {
      Object.assign(stats, metrics);
      stats.lastHealthCheck = Date.now();
    }
  }

  updateWorkerHealthCheck(workerId, timestamp) {
    const stats = this.workerStats.get(workerId);
    if (stats) {
      stats.lastHealthCheck = timestamp;
    }
  }

  updateRequestMetrics(workerId, metrics) {
    const stats = this.workerStats.get(workerId);
    if (stats) {
      stats.requests++;
      if (metrics.error) stats.errors++;
      
      // Update average response time
      stats.avgResponseTime = (
        (stats.avgResponseTime * (stats.requests - 1)) + metrics.responseTime
      ) / stats.requests;
    }

    // Update global metrics
    this.metrics.totalRequests++;
    if (metrics.error) this.metrics.totalErrors++;
    
    this.metrics.avgResponseTime = (
      (this.metrics.avgResponseTime * (this.metrics.totalRequests - 1)) + metrics.responseTime
    ) / this.metrics.totalRequests;
  }

  getAverageCpuUsage() {
    const stats = Array.from(this.workerStats.values());
    if (stats.length === 0) return 0;
    
    const total = stats.reduce((sum, stat) => sum + stat.cpuUsage, 0);
    return total / stats.length;
  }

  getAverageMemoryUsage() {
    const stats = Array.from(this.workerStats.values());
    if (stats.length === 0) return 0;
    
    const total = stats.reduce((sum, stat) => sum + stat.memoryUsage, 0);
    const totalHeap = stats.length * 1024 * 1024 * 1024; // Assume 1GB per worker
    return (total / totalHeap) * 100;
  }

  getAverageResponseTime() {
    const stats = Array.from(this.workerStats.values());
    if (stats.length === 0) return 0;
    
    const total = stats.reduce((sum, stat) => sum + stat.avgResponseTime, 0);
    return total / stats.length;
  }

  getErrorRate() {
    if (this.metrics.totalRequests === 0) return 0;
    return (this.metrics.totalErrors / this.metrics.totalRequests) * 100;
  }

  findLeastUtilizedWorker() {
    let leastUtilized = null;
    let lowestUtilization = Infinity;

    for (const [workerId, stats] of this.workerStats) {
      const utilization = stats.cpuUsage + (stats.memoryUsage / 1024 / 1024); // Simple utilization metric
      
      if (utilization < lowestUtilization) {
        lowestUtilization = utilization;
        leastUtilized = workerId;
      }
    }

    return leastUtilized;
  }

  getClusterHealth() {
    const totalWorkers = this.workers.size;
    const healthyWorkers = Array.from(this.workerStats.values()).filter(
      stats => Date.now() - stats.lastHealthCheck < 30000
    ).length;

    const healthPercentage = totalWorkers > 0 ? (healthyWorkers / totalWorkers) * 100 : 0;
    const errorRate = this.getErrorRate();

    return {
      status: healthPercentage >= 80 && errorRate < 10 ? 'healthy' : 'unhealthy',
      workers: {
        total: totalWorkers,
        healthy: healthyWorkers,
        healthPercentage: Math.round(healthPercentage)
      },
      metrics: {
        errorRate: Math.round(errorRate * 100) / 100,
        avgResponseTime: Math.round(this.metrics.avgResponseTime),
        totalRequests: this.metrics.totalRequests,
        workerCrashes: this.metrics.workerCrashes
      },
      timestamp: new Date().toISOString()
    };
  }

  getClusterMetrics() {
    return {
      cluster: {
        workers: this.workers.size,
        maxWorkers: this.maxWorkers,
        minWorkers: this.minWorkers,
        lastScaleAction: this.metrics.lastScaleAction
      },
      performance: {
        totalRequests: this.metrics.totalRequests,
        totalErrors: this.metrics.totalErrors,
        errorRate: this.getErrorRate(),
        avgResponseTime: this.metrics.avgResponseTime,
        avgCpuUsage: this.getAverageCpuUsage(),
        avgMemoryUsage: this.getAverageMemoryUsage()
      },
      workers: Object.fromEntries(
        Array.from(this.workerStats.entries()).map(([id, stats]) => [
          id,
          {
            ...stats,
            status: this.workers.get(id)?.status || 'unknown',
            uptime: Date.now() - (this.workers.get(id)?.startTime || Date.now())
          }
        ])
      )
    };
  }

  // ================================
  // GRACEFUL SHUTDOWN
  // ================================

  setupGracefulShutdown() {
    const shutdownHandler = async (signal) => {
      logger.info(`📤 Received ${signal}, initiating graceful shutdown`);
      await this.gracefulShutdown();
      process.exit(0);
    };

    process.on('SIGTERM', shutdownHandler);
    process.on('SIGINT', shutdownHandler);
    process.on('SIGHUP', shutdownHandler);
  }

  async gracefulShutdown() {
    logger.info('🔄 Starting graceful cluster shutdown');

    // Stop accepting new workers
    cluster.removeAllListeners('exit');

    // Gracefully shutdown all workers
    const shutdownPromises = Array.from(this.workers.keys()).map(async (workerId) => {
      return this.stopWorker(workerId, true);
    });

    await Promise.all(shutdownPromises);
    
    logger.info('✅ Graceful cluster shutdown completed');
  }

  async gracefulWorkerShutdown() {
    try {
      // Close server gracefully
      const server = global.httpServer;
      if (server) {
        await new Promise((resolve) => {
          server.close(resolve);
        });
      }

      // Close database connections
      const { disconnectDatabase } = require('../config/db');
      await disconnectDatabase();

      // Close other connections
      logger.info(`✅ Worker ${cluster.worker.id} shutdown completed`);
      process.exit(0);

    } catch (error) {
      logger.error('Worker shutdown error:', error);
      process.exit(1);
    }
  }
}

// ================================
// NGINX CONFIGURATION GENERATOR
// ================================

class NginxConfigGenerator {
  static generateConfig(options = {}) {
    const {
      upstreams = ['127.0.0.1:5000', '127.0.0.1:5001', '127.0.0.1:5002'],
      serverName = 'api.voidmarketplace.com',
      sslCert = '/path/to/ssl/cert.pem',
      sslKey = '/path/to/ssl/private.key',
      enableRateLimit = true,
      enableGzip = true
    } = options;

    return `
# VOID Marketplace - High Performance Nginx Configuration
# Generated automatically for optimal load balancing

# Rate limiting zones
${enableRateLimit ? `
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/m;
limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=upload_limit:10m rate=5r/m;
` : ''}

# Upstream configuration with health checks
upstream void_marketplace_backend {
    ${upstreams.map(upstream => `server ${upstream} max_fails=3 fail_timeout=30s;`).join('\n    ')}
    
    # Load balancing method
    least_conn;
    
    # Keep alive connections
    keepalive 32;
}

# Main server configuration
server {
    listen 80;
    server_name ${serverName};
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${serverName};
    
    # SSL Configuration
    ssl_certificate ${sslCert};
    ssl_certificate_key ${sslKey};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
    
    # Gzip compression
    ${enableGzip ? `
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml;
    ` : ''}
    
    # Client settings
    client_max_body_size 100M;
    client_body_timeout 60s;
    client_header_timeout 60s;
    
    # Proxy settings
    proxy_connect_timeout 30s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    proxy_buffering on;
    proxy_buffer_size 8k;
    proxy_buffers 16 8k;
    
    # API routes with rate limiting
    location /api/v1/auth/ {
        ${enableRateLimit ? 'limit_req zone=auth_limit burst=5 nodelay;' : ''}
        proxy_pass http://void_marketplace_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    location /api/v1/upload/ {
        ${enableRateLimit ? 'limit_req zone=upload_limit burst=2 nodelay;' : ''}
        proxy_pass http://void_marketplace_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Longer timeout for file uploads
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
    
    # Socket.IO with sticky sessions
    location /socket.io/ {
        proxy_pass http://void_marketplace_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Sticky sessions based on IP
        ip_hash;
    }
    
    # General API routes
    location /api/ {
        ${enableRateLimit ? 'limit_req zone=api_limit burst=20 nodelay;' : ''}
        proxy_pass http://void_marketplace_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Health check endpoint (no rate limiting)
    location /health {
        proxy_pass http://void_marketplace_backend;
        proxy_set_header Host $host;
        access_log off;
    }
    
    # Static files (if served by nginx)
    location /uploads/ {
        alias /var/www/void-marketplace/uploads/;
        expires 1y;
        add_header Cache-Control "public, immutable";
        
        # Security for uploaded files
        location ~* \\.(php|jsp|asp|sh|cgi)$ {
            deny all;
        }
    }
    
    # Error pages
    error_page 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
    }
}
`;
  }
}

// ================================
// SINGLETON INSTANCE
// ================================

let clusterManager = null;

const getClusterManager = () => {
  if (!clusterManager) {
    clusterManager = new ClusterManager();
  }
  return clusterManager;
};

const initializeCluster = async () => {
  try {
    const manager = getClusterManager();
    await manager.initialize();
    logger.info('✅ Cluster manager ready');
    return manager;
  } catch (error) {
    logger.error('❌ Cluster initialization failed:', error);
    throw error;
  }
};

module.exports = {
  ClusterManager,
  NginxConfigGenerator,
  getClusterManager,
  initializeCluster
};