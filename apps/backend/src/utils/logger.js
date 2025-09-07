// apps/backend/src/utils/logger.js
// Complete logging utility for VOID Marketplace

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// ================================
// LOG LEVEL CONFIGURATION
// ================================

const logLevels = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5
};

const logColors = {
  fatal: 'magenta',
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
  trace: 'gray'
};

// ================================
// FORMATTER FUNCTIONS
// ================================

const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    // Base log object
    const logObject = {
      timestamp,
      level,
      message,
      ...meta
    };

    // Add stack trace for errors
    if (stack) {
      logObject.stack = stack;
    }

    // Add environment info
    logObject.env = process.env.NODE_ENV || 'development';
    logObject.service = 'void-marketplace-api';

    return JSON.stringify(logObject);
  })
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let logMessage = `${timestamp} [${level}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      logMessage += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    // Add stack trace for errors
    if (stack) {
      logMessage += `\n${stack}`;
    }
    
    return logMessage;
  })
);

// ================================
// TRANSPORT CONFIGURATION
// ================================

const transports = [];

// Console transport (always enabled)
transports.push(
  new winston.transports.Console({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    format: consoleFormat,
    handleExceptions: true,
    handleRejections: true
  })
);

// File transports (production and development)
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_FILE_LOGGING === 'true') {
  const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
  
  // Ensure log directory exists
  const fs = require('fs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Error logs
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      format: customFormat,
      maxSize: '20m',
      maxFiles: '14d',
      handleExceptions: true,
      handleRejections: true
    })
  );

  // Combined logs
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      format: customFormat,
      maxSize: '20m',
      maxFiles: '7d'
    })
  );

  // Audit logs for security events
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'audit-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'info',
      format: customFormat,
      maxSize: '20m',
      maxFiles: '30d'
    })
  );
}

// ================================
// LOGGER INSTANCE
// ================================

const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: customFormat,
  transports,
  exitOnError: false,
  silent: process.env.NODE_ENV === 'test' && process.env.ENABLE_TEST_LOGGING !== 'true'
});

// Add colors
winston.addColors(logColors);

// ================================
// ENHANCED LOGGING METHODS
// ================================

/**
 * Log database queries (if enabled)
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @param {number} duration - Query duration in ms
 */
logger.db = (query, params = [], duration = 0) => {
  if (process.env.LOG_DB_QUERIES === 'true') {
    logger.debug('Database Query', {
      query: query.replace(/\s+/g, ' ').trim(),
      params: params.length > 0 ? params : undefined,
      duration_ms: duration,
      category: 'database'
    });
  }
};

/**
 * Log API requests
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} duration - Request duration in ms
 */
logger.request = (req, res, duration = 0) => {
  const logData = {
    method: req.method,
    url: req.originalUrl,
    status: res.statusCode,
    duration_ms: duration,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    requestId: req.requestId,
    category: 'api_request'
  };

  if (res.statusCode >= 400) {
    logger.warn('API Request Error', logData);
  } else {
    logger.info('API Request', logData);
  }
};

/**
 * Log authentication events
 * @param {string} event - Event type (login, logout, failed_login, etc.)
 * @param {Object} data - Event data
 */
logger.auth = (event, data = {}) => {
  logger.info('Authentication Event', {
    event,
    ...data,
    category: 'authentication'
  });
};

/**
 * Log security events
 * @param {string} event - Security event type
 * @param {Object} data - Event data
 */
logger.security = (event, data = {}) => {
  logger.warn('Security Event', {
    event,
    ...data,
    category: 'security',
    severity: 'high'
  });
};

/**
 * Log business events
 * @param {string} event - Business event type
 * @param {Object} data - Event data
 */
logger.business = (event, data = {}) => {
  logger.info('Business Event', {
    event,
    ...data,
    category: 'business'
  });
};

/**
 * Log performance metrics
 * @param {string} metric - Metric name
 * @param {number} value - Metric value
 * @param {Object} tags - Additional tags
 */
logger.metric = (metric, value, tags = {}) => {
  logger.info('Performance Metric', {
    metric,
    value,
    ...tags,
    category: 'performance'
  });
};

/**
 * Log user actions for analytics
 * @param {string} action - User action
 * @param {Object} data - Action data
 */
logger.userAction = (action, data = {}) => {
  logger.info('User Action', {
    action,
    ...data,
    category: 'user_analytics'
  });
};

/**
 * Log errors with enhanced context
 * @param {string} message - Error message
 * @param {Error|Object} error - Error object or additional data
 * @param {Object} context - Additional context
 */
logger.errorWithContext = (message, error = {}, context = {}) => {
  const errorData = {
    message,
    ...context,
    category: 'application_error'
  };

  if (error instanceof Error) {
    errorData.error_name = error.name;
    errorData.error_message = error.message;
    errorData.stack = error.stack;
  } else if (typeof error === 'object') {
    Object.assign(errorData, error);
  }

  logger.error(errorData);
};

// ================================
// SPECIALIZED LOGGERS
// ================================

/**
 * Create a child logger with additional context
 * @param {Object} defaultMeta - Default metadata to include
 * @returns {Object} Child logger
 */
logger.child = (defaultMeta = {}) => {
  return logger.child(defaultMeta);
};

/**
 * Payment logger for financial transactions
 */
logger.payment = {
  transaction: (event, data) => {
    logger.info('Payment Transaction', {
      event,
      ...data,
      category: 'payment',
      sensitive: true
    });
  },
  
  error: (event, error, data = {}) => {
    logger.error('Payment Error', {
      event,
      error: error.message,
      ...data,
      category: 'payment_error',
      sensitive: true
    });
  }
};

/**
 * Chat logger for messaging events
 */
logger.chat = {
  message: (event, data) => {
    logger.info('Chat Event', {
      event,
      ...data,
      category: 'chat'
    });
  },
  
  moderation: (event, data) => {
    logger.warn('Chat Moderation', {
      event,
      ...data,
      category: 'chat_moderation'
    });
  }
};

// ================================
// LOG SAMPLING (for high-volume logs)
// ================================

let requestLogSampleRate = parseFloat(process.env.REQUEST_LOG_SAMPLE_RATE || '1.0');

/**
 * Sample-based logging for high-volume events
 * @param {Function} logFunction - Logger function to call
 * @param {Array} args - Arguments to pass to logger
 * @param {number} sampleRate - Sampling rate (0-1)
 */
logger.sample = (logFunction, args, sampleRate = requestLogSampleRate) => {
  if (Math.random() < sampleRate) {
    logFunction.apply(logger, args);
  }
};

// ================================
// LOG CONTEXT MANAGEMENT
// ================================

/**
 * Set correlation ID for request tracking
 * @param {string} correlationId - Correlation ID
 * @returns {Object} Logger with correlation ID
 */
logger.withCorrelation = (correlationId) => {
  return logger.child({ correlationId });
};

/**
 * Set user context for logging
 * @param {Object} user - User object
 * @returns {Object} Logger with user context
 */
logger.withUser = (user) => {
  return logger.child({
    userId: user.id,
    userRole: user.role,
    userEmail: user.email
  });
};

// ================================
// STRUCTURED LOGGING HELPERS
// ================================

/**
 * Log with structured data
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} data - Structured data
 */
logger.structured = (level, message, data = {}) => {
  logger[level](message, {
    ...data,
    structured: true,
    timestamp: new Date().toISOString()
  });
};

// ================================
// ERROR TRACKING INTEGRATION
// ================================

/**
 * Send critical errors to external monitoring
 * @param {Error} error - Error object
 * @param {Object} context - Error context
 */
logger.reportError = async (error, context = {}) => {
  // Log locally first
  logger.errorWithContext('Critical Error Reported', error, context);
  
  try {
    // Send to external error tracking service (Sentry, Bugsnag, etc.)
    if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
      // Example: Sentry.captureException(error, { extra: context });
    }
    
    // Send to alerting system for critical errors
    if (context.severity === 'critical') {
      // Example: Send to Slack, PagerDuty, etc.
    }
  } catch (reportingError) {
    logger.error('Failed to report error to external service', {
      originalError: error.message,
      reportingError: reportingError.message
    });
  }
};

// ================================
// LOG ROTATION AND CLEANUP
// ================================

/**
 * Clean up old log files
 * @param {number} maxDays - Maximum days to keep logs
 */
logger.cleanupLogs = async (maxDays = 30) => {
  const fs = require('fs').promises;
  const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
  
  try {
    const files = await fs.readdir(logDir);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxDays);
    
    for (const file of files) {
      const filePath = path.join(logDir, file);
      const stats = await fs.stat(filePath);
      
      if (stats.mtime < cutoffDate) {
        await fs.unlink(filePath);
        logger.info('Cleaned up old log file', { file });
      }
    }
  } catch (error) {
    logger.error('Log cleanup failed', { error: error.message });
  }
};

// ================================
// STARTUP LOGGING
// ================================

logger.startup = (message, data = {}) => {
  logger.info(`🚀 ${message}`, {
    ...data,
    category: 'startup',
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform
  });
};

// ================================
// GRACEFUL SHUTDOWN LOGGING
// ================================

logger.shutdown = (message, data = {}) => {
  logger.info(`🛑 ${message}`, {
    ...data,
    category: 'shutdown',
    pid: process.pid
  });
};

// ================================
// EXPORT CONFIGURATION
// ================================

// Handle uncaught exceptions and unhandled rejections
logger.exceptions.handle(
  new winston.transports.File({ 
    filename: path.join(process.env.LOG_DIR || 'logs', 'exceptions.log'),
    format: customFormat
  })
);

logger.rejections.handle(
  new winston.transports.File({ 
    filename: path.join(process.env.LOG_DIR || 'logs', 'rejections.log'),
    format: customFormat
  })
);

// Add timestamp to console logs in development
if (process.env.NODE_ENV === 'development') {
  logger.startup('Logger initialized in development mode');
}

module.exports = logger;