// apps/backend/src/services/monitoring-system.js
// monitoring and performance tracking system

const logger = require('../utils/logger');
const EventEmitter = require('events');
const os = require('os');
const v8 = require('v8');

// ================================
// COMPREHENSIVE MONITORING SYSTEM
// ================================

class MonitoringSystem extends EventEmitter {
  constructor() {
    super();
    
    this.metrics = {
      // Application metrics
      requests: {
        total: 0,
        errors: 0,
        responseTime: {
          min: Infinity,
          max: 0,
          avg: 0,
          p95: 0,
          p99: 0,
          samples: []
        }
      },
      
      // Database metrics
      database: {
        queries: 0,
        slowQueries: 0,
        errors: 0,
        connectionPool: {
          active: 0,
          idle: 0,
          waiting: 0
        },
        avgQueryTime: 0
      },
      
      // Cache metrics
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0,
        avgAccessTime: 0
      },
      
      // Real-time metrics
      realtime: {
        connections: 0,
        messagesPerSecond: 0,
        roomCount: 0
      },
      
      // System metrics
      system: {
        cpu: 0,
        memory: {
          used: 0,
          total: 0,
          percentage: 0
        },
        heap: {
          used: 0,
          total: 0,
          percentage: 0
        },
        eventLoop: {
          delay: 0,
          utilization: 0
        }
      },
      
      // Business metrics
      business: {
        activeUsers: 0,
        transactions: 0,
        revenue: 0,
        listings: 0
      }
    };
    
    this.alerts = {
      rules: new Map(),
      history: [],
      acknowledged: new Set()
    };
    
    this.performanceHistory = [];
    this.errorHistory = [];
    
    this.setupMonitoring();
    this.setupAlerts();
  }

  // ================================
  // CORE MONITORING SETUP
  // ================================

  setupMonitoring() {
    // System metrics collection
    setInterval(() => {
      this.collectSystemMetrics();
    }, 10000); // Every 10 seconds

    // Performance metrics aggregation
    setInterval(() => {
      this.aggregatePerformanceMetrics();
    }, 60000); // Every minute

    // Health check monitoring
    setInterval(() => {
      this.performHealthChecks();
    }, 30000); // Every 30 seconds

    // Cleanup old metrics
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 300000); // Every 5 minutes

    logger.info('✅ Monitoring system initialized');
  }

  // ================================
  // REQUEST PERFORMANCE TRACKING
  // ================================

  createPerformanceMiddleware() {
    return (req, res, next) => {
      const startTime = process.hrtime.bigint();
      const startMemory = process.memoryUsage();
      
      // Track request start
      req.monitoringData = {
        startTime,
        startMemory,
        endpoint: `${req.method} ${req.route?.path || req.path}`,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        userId: null
      };

      // Override res.end to capture completion metrics
      const originalEnd = res.end.bind(res);
      res.end = (...args) => {
        this.recordRequestCompletion(req, res, startTime, startMemory);
        return originalEnd(...args);
      };

      // Track authentication
      const originalUser = req.user;
      Object.defineProperty(req, 'user', {
        get: () => originalUser,
        set: (user) => {
          originalUser = user;
          if (req.monitoringData && user) {
            req.monitoringData.userId = user.id;
          }
        }
      });

      next();
    };
  }

  recordRequestCompletion(req, res, startTime, startMemory) {
    try {
      const endTime = process.hrtime.bigint();
      const endMemory = process.memoryUsage();
      
      const responseTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
      const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;
      
      const metrics = {
        endpoint: req.monitoringData?.endpoint || 'unknown',
        method: req.method,
        statusCode: res.statusCode,
        responseTime,
        memoryDelta,
        userAgent: req.monitoringData?.userAgent,
        ip: req.monitoringData?.ip,
        userId: req.monitoringData?.userId,
        timestamp: new Date(),
        contentLength: res.get('Content-Length') || 0
      };

      // Update request metrics
      this.updateRequestMetrics(metrics);
      
      // Check for performance issues
      this.checkPerformanceThresholds(metrics);
      
      // Log slow requests
      if (responseTime > 1000) {
        logger.warn('Slow request detected', {
          endpoint: metrics.endpoint,
          responseTime: `${responseTime.toFixed(2)}ms`,
          statusCode: metrics.statusCode,
          memoryDelta: `${Math.round(memoryDelta / 1024)}KB`
        });
      }
      
      // Log errors
      if (res.statusCode >= 400) {
        this.recordError(metrics);
      }

    } catch (error) {
      logger.error('Error recording request metrics:', error);
    }
  }

  updateRequestMetrics(metrics) {
    const requests = this.metrics.requests;
    
    requests.total++;
    
    if (metrics.statusCode >= 400) {
      requests.errors++;
    }
    
    // Update response time statistics
    const rt = requests.responseTime;
    rt.min = Math.min(rt.min, metrics.responseTime);
    rt.max = Math.max(rt.max, metrics.responseTime);
    
    // Add to samples for percentile calculation
    rt.samples.push(metrics.responseTime);
    
    // Keep only recent samples (last 1000)
    if (rt.samples.length > 1000) {
      rt.samples = rt.samples.slice(-500);
    }
    
    // Calculate average
    rt.avg = rt.samples.reduce((sum, time) => sum + time, 0) / rt.samples.length;
    
    // Calculate percentiles
    if (rt.samples.length > 10) {
      const sorted = [...rt.samples].sort((a, b) => a - b);
      rt.p95 = sorted[Math.floor(sorted.length * 0.95)];
      rt.p99 = sorted[Math.floor(sorted.length * 0.99)];
    }
  }

  // ================================
  // DATABASE MONITORING
  // ================================

  createDatabaseMonitor() {
    return {
      // Monitor query execution
      onQuery: (query, duration, error = null) => {
        this.recordDatabaseQuery(query, duration, error);
      },
      
      // Monitor connection pool
      onConnectionPoolUpdate: (stats) => {
        this.updateConnectionPoolMetrics(stats);
      }
    };
  }

  recordDatabaseQuery(query, duration, error) {
    const db = this.metrics.database;
    
    db.queries++;
    
    if (error) {
      db.errors++;
      this.recordError({
        type: 'database_error',
        query: query.substring(0, 100) + '...',
        error: error.message,
        duration
      });
    }
    
    if (duration > 1000) { // Slow query threshold
      db.slowQueries++;
      logger.warn('Slow database query', {
        duration: `${duration}ms`,
        query: query.substring(0, 200) + '...'
      });
    }
    
    // Update average query time
    db.avgQueryTime = (db.avgQueryTime * 0.9) + (duration * 0.1);
  }

  updateConnectionPoolMetrics(stats) {
    this.metrics.database.connectionPool = { ...stats };
  }

  // ================================
  // SYSTEM METRICS COLLECTION
  // ================================

  collectSystemMetrics() {
    try {
      // CPU usage
      const cpus = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;
      
      cpus.forEach(cpu => {
        for (let type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      });
      
      const idle = totalIdle / cpus.length;
      const total = totalTick / cpus.length;
      const usage = 100 - ~~(100 * idle / total);
      
      this.metrics.system.cpu = usage;
      
      // Memory usage
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      
      this.metrics.system.memory = {
        used: usedMem,
        total: totalMem,
        percentage: (usedMem / totalMem) * 100
      };
      
      // Heap usage
      const heapStats = v8.getHeapStatistics();
      this.metrics.system.heap = {
        used: heapStats.used_heap_size,
        total: heapStats.total_heap_size,
        percentage: (heapStats.used_heap_size / heapStats.total_heap_size) * 100
      };
      
      // Event loop metrics
      this.collectEventLoopMetrics();
      
    } catch (error) {
      logger.error('Error collecting system metrics:', error);
    }
  }

  collectEventLoopMetrics() {
    const start = process.hrtime.bigint();
    
    setImmediate(() => {
      const delay = Number(process.hrtime.bigint() - start) / 1000000; // Convert to ms
      this.metrics.system.eventLoop.delay = delay;
      
      // Event loop utilization (Node.js 14+)
      if (typeof process.cpuUsage === 'function') {
        const usage = process.cpuUsage();
        const utilization = (usage.user + usage.system) / 1000; // Convert to ms
        this.metrics.system.eventLoop.utilization = utilization;
      }
    });
  }

  // ================================
  // BUSINESS METRICS TRACKING
  // ================================

  updateBusinessMetrics(type, value, metadata = {}) {
    switch (type) {
      case 'active_users':
        this.metrics.business.activeUsers = value;
        break;
      case 'new_transaction':
        this.metrics.business.transactions++;
        if (metadata.amount) {
          this.metrics.business.revenue += metadata.amount;
        }
        break;
      case 'new_listing':
        this.metrics.business.listings++;
        break;
      case 'user_signup':
        this.emit('business_event', { type: 'user_signup', metadata });
        break;
    }
  }

  // ================================
  // ERROR TRACKING AND ANALYSIS
  // ================================

  recordError(errorData) {
    const error = {
      ...errorData,
      timestamp: new Date(),
      id: this.generateErrorId()
    };
    
    this.errorHistory.push(error);
    
    // Keep only recent errors (last 1000)
    if (this.errorHistory.length > 1000) {
      this.errorHistory = this.errorHistory.slice(-500);
    }
    
    // Emit error event for real-time processing
    this.emit('error_recorded', error);
    
    // Check for error patterns
    this.analyzeErrorPatterns(error);
    
    logger.error('Application error recorded', {
      errorId: error.id,
      type: error.type || 'unknown',
      endpoint: error.endpoint,
      statusCode: error.statusCode
    });
  }

  analyzeErrorPatterns(newError) {
    const recentErrors = this.errorHistory.filter(
      error => Date.now() - error.timestamp.getTime() < 300000 // Last 5 minutes
    );
    
    // Check for error spikes
    if (recentErrors.length > 50) {
      this.triggerAlert('error_spike', {
        count: recentErrors.length,
        timeWindow: '5 minutes'
      });
    }
    
    // Check for repeated errors from same endpoint
    const sameEndpointErrors = recentErrors.filter(
      error => error.endpoint === newError.endpoint
    );
    
    if (sameEndpointErrors.length > 10) {
      this.triggerAlert('endpoint_error_pattern', {
        endpoint: newError.endpoint,
        count: sameEndpointErrors.length
      });
    }
  }

  // ================================
  // HEALTH CHECK SYSTEM
  // ================================

  async performHealthChecks() {
    const checks = {
      database: await this.checkDatabaseHealth(),
      cache: await this.checkCacheHealth(),
      storage: await this.checkStorageHealth(),
      external: await this.checkExternalServicesHealth()
    };
    
    const overallHealth = Object.values(checks).every(check => check.status === 'healthy');
    
    const healthReport = {
      status: overallHealth ? 'healthy' : 'unhealthy',
      timestamp: new Date(),
      checks
    };
    
    if (!overallHealth) {
      this.triggerAlert('health_check_failed', healthReport);
    }
    
    return healthReport;
  }

  async checkDatabaseHealth() {
    try {
      const { dbRouter } = require('../config/db');
      const startTime = Date.now();
      
      await dbRouter.getReadClient().$queryRaw`SELECT 1`;
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: responseTime < 1000 ? 'healthy' : 'degraded',
        responseTime,
        message: `Database responding in ${responseTime}ms`
      };
      
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        message: 'Database connection failed'
      };
    }
  }

  async checkCacheHealth() {
    try {
      const { getCacheManager } = require('./cache-manager');
      const cache = getCacheManager();
      
      const startTime = Date.now();
      const testKey = 'health_check_' + Date.now();
      
      await cache.set(testKey, 'test_value', 10);
      const value = await cache.get(testKey);
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: value === 'test_value' ? 'healthy' : 'unhealthy',
        responseTime,
        message: `Cache responding in ${responseTime}ms`
      };
      
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        message: 'Cache health check failed'
      };
    }
  }

  async checkStorageHealth() {
    // Check file system or S3 health
    try {
      const fs = require('fs').promises;
      await fs.access('./uploads', fs.constants.F_OK);
      
      return {
        status: 'healthy',
        message: 'Storage accessible'
      };
      
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        message: 'Storage not accessible'
      };
    }
  }

  async checkExternalServicesHealth() {
    const services = {};
    
    // Check Stripe
    if (process.env.STRIPE_SECRET_KEY) {
      try {
        // Simple Stripe API health check would go here
        services.stripe = { status: 'healthy' };
      } catch (error) {
        services.stripe = { status: 'unhealthy', error: error.message };
      }
    }
    
    // Check OpenAI
    if (process.env.OPENAI_API_KEY) {
      try {
        // OpenAI health check would go here
        services.openai = { status: 'healthy' };
      } catch (error) {
        services.openai = { status: 'unhealthy', error: error.message };
      }
    }
    
    const allHealthy = Object.values(services).every(s => s.status === 'healthy');
    
    return {
      status: allHealthy ? 'healthy' : 'degraded',
      services
    };
  }

  // ================================
  // ALERT MANAGEMENT
  // ================================

  setupAlerts() {
    // Define alert rules
    this.alerts.rules.set('high_response_time', {
      condition: () => this.metrics.requests.responseTime.avg > 2000,
      message: 'Average response time exceeds 2 seconds',
      severity: 'warning',
      cooldown: 300000 // 5 minutes
    });
    
    this.alerts.rules.set('high_error_rate', {
      condition: () => {
        const total = this.metrics.requests.total;
        const errors = this.metrics.requests.errors;
        return total > 100 && (errors / total) > 0.05; // 5% error rate
      },
      message: 'Error rate exceeds 5%',
      severity: 'critical',
      cooldown: 180000 // 3 minutes
    });
    
    this.alerts.rules.set('high_memory_usage', {
      condition: () => this.metrics.system.memory.percentage > 90,
      message: 'Memory usage exceeds 90%',
      severity: 'critical',
      cooldown: 300000
    });
    
    this.alerts.rules.set('high_cpu_usage', {
      condition: () => this.metrics.system.cpu > 80,
      message: 'CPU usage exceeds 80%',
      severity: 'warning',
      cooldown: 300000
    });

    // Check alerts periodically
    setInterval(() => {
      this.checkAlerts();
    }, 30000); // Every 30 seconds
  }

  checkAlerts() {
    for (const [alertId, rule] of this.alerts.rules) {
      try {
        if (rule.condition()) {
          this.triggerAlert(alertId, {
            rule: rule.message,
            severity: rule.severity,
            metrics: this.getCurrentMetricsSummary()
          });
        }
      } catch (error) {
        logger.error('Alert check failed:', { alertId, error: error.message });
      }
    }
  }

  triggerAlert(alertId, data) {
    const rule = this.alerts.rules.get(alertId);
    if (!rule) return;
    
    // Check cooldown
    const now = Date.now();
    const lastAlert = this.alerts.history.find(a => a.alertId === alertId);
    
    if (lastAlert && (now - lastAlert.timestamp.getTime()) < rule.cooldown) {
      return; // Still in cooldown
    }
    
    const alert = {
      alertId,
      severity: rule.severity,
      message: rule.message,
      data,
      timestamp: new Date(),
      acknowledged: false
    };
    
    this.alerts.history.push(alert);
    
    // Keep only recent alerts
    if (this.alerts.history.length > 100) {
      this.alerts.history = this.alerts.history.slice(-50);
    }
    
    // Emit alert event
    this.emit('alert', alert);
    
    // Log alert
    logger.warn('🚨 Alert triggered', {
      alertId,
      severity: alert.severity,
      message: alert.message
    });
    
    // Send notification (if configured)
    this.sendAlertNotification(alert);
  }

  async sendAlertNotification(alert) {
    try {
      // Integration with notification services would go here
      // For now, just log
      
      if (alert.severity === 'critical') {
        // Send immediate notification (email, Slack, PagerDuty, etc.)
        logger.error('🚨 CRITICAL ALERT', alert);
      }
      
    } catch (error) {
      logger.error('Failed to send alert notification:', error);
    }
  }

  // ================================
  // METRICS AGGREGATION
  // ================================

  aggregatePerformanceMetrics() {
    const summary = {
      timestamp: new Date(),
      requests: { ...this.metrics.requests },
      database: { ...this.metrics.database },
      cache: { ...this.metrics.cache },
      system: { ...this.metrics.system },
      business: { ...this.metrics.business }
    };
    
    this.performanceHistory.push(summary);
    
    // Keep only last 24 hours of data (1440 minutes)
    if (this.performanceHistory.length > 1440) {
      this.performanceHistory = this.performanceHistory.slice(-720);
    }
    
    // Emit metrics event
    this.emit('metrics_aggregated', summary);
  }

  // ================================
  // REPORTING AND EXPORT
  // ================================

  getCurrentMetricsSummary() {
    return {
      requests: {
        total: this.metrics.requests.total,
        errors: this.metrics.requests.errors,
        errorRate: this.metrics.requests.total > 0 ? 
          (this.metrics.requests.errors / this.metrics.requests.total) * 100 : 0,
        avgResponseTime: this.metrics.requests.responseTime.avg,
        p95ResponseTime: this.metrics.requests.responseTime.p95
      },
      system: {
        cpu: this.metrics.system.cpu,
        memoryPercentage: this.metrics.system.memory.percentage,
        heapPercentage: this.metrics.system.heap.percentage,
        eventLoopDelay: this.metrics.system.eventLoop.delay
      },
      database: {
        queries: this.metrics.database.queries,
        slowQueries: this.metrics.database.slowQueries,
        errors: this.metrics.database.errors,
        avgQueryTime: this.metrics.database.avgQueryTime
      },
      uptime: process.uptime()
    };
  }

  getPerformanceReport(hours = 24) {
    const cutoff = new Date(Date.now() - (hours * 60 * 60 * 1000));
    const recentData = this.performanceHistory.filter(
      entry => entry.timestamp >= cutoff
    );
    
    if (recentData.length === 0) {
      return { message: 'No data available for the specified period' };
    }
    
    // Calculate aggregated statistics
    const report = {
      period: `${hours} hours`,
      dataPoints: recentData.length,
      summary: {
        requests: {
          total: recentData.reduce((sum, entry) => sum + entry.requests.total, 0),
          errors: recentData.reduce((sum, entry) => sum + entry.requests.errors, 0),
          avgResponseTime: recentData.reduce((sum, entry) => 
            sum + entry.requests.responseTime.avg, 0) / recentData.length
        },
        system: {
          avgCpu: recentData.reduce((sum, entry) => sum + entry.system.cpu, 0) / recentData.length,
          avgMemory: recentData.reduce((sum, entry) => 
            sum + entry.system.memory.percentage, 0) / recentData.length,
          maxMemory: Math.max(...recentData.map(entry => entry.system.memory.percentage))
        }
      }
    };
    
    return report;
  }

  // ================================
  // UTILITY METHODS
  // ================================

  generateErrorId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  cleanupOldMetrics() {
    // Reset counters periodically to prevent overflow
    if (this.metrics.requests.total > 1000000) {
      this.metrics.requests.total = Math.floor(this.metrics.requests.total * 0.8);
      this.metrics.requests.errors = Math.floor(this.metrics.requests.errors * 0.8);
    }
    
    // Cleanup old response time samples
    if (this.metrics.requests.responseTime.samples.length > 1000) {
      this.metrics.requests.responseTime.samples = 
        this.metrics.requests.responseTime.samples.slice(-500);
    }
  }

  // Get all metrics for dashboard
  getAllMetrics() {
    return {
      current: this.metrics,
      alerts: {
        active: this.alerts.history.filter(a => !a.acknowledged),
        recent: this.alerts.history.slice(-10)
      },
      recentErrors: this.errorHistory.slice(-10),
      performance: this.performanceHistory.slice(-60) // Last hour
    };
  }
}

// ================================
// SINGLETON INSTANCE
// ================================

let monitoringSystem = null;

const getMonitoringSystem = () => {
  if (!monitoringSystem) {
    monitoringSystem = new MonitoringSystem();
  }
  return monitoringSystem;
};

const initializeMonitoring = () => {
  try {
    const monitoring = getMonitoringSystem();
    logger.info('✅ Monitoring system ready');
    return monitoring;
  } catch (error) {
    logger.error('❌ Monitoring initialization failed:', error);
    throw error;
  }
};

module.exports = {
  MonitoringSystem,
  getMonitoringSystem,
  initializeMonitoring
};