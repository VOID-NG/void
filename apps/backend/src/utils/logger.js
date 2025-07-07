// apps/backend/src/utils/logger.js
// Structured logging system using Winston for VOID Marketplace

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// ================================
// LOG LEVELS & COLORS
// ================================

const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

// Add colors to winston
winston.addColors(logColors);

// ================================
// LOG FORMAT CONFIGURATIONS
// ================================

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = `\n${JSON.stringify(meta, null, 2)}`;
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// File format for production logs
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// ================================
// TRANSPORT CONFIGURATIONS
// ================================

const createFileTransport = (filename, level = 'info') => {
  return new DailyRotateFile({
    filename: path.join('logs', `${filename}-%DATE%.log`),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    level,
    format: fileFormat,
    handleExceptions: level === 'error',
    handleRejections: level === 'error'
  });
};

// ================================
// LOGGER INSTANCE
// ================================

const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: fileFormat,
  defaultMeta: {
    service: 'void-marketplace-api',
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0'
  },
  transports: [
    // Error logs
    createFileTransport('error', 'error'),
    
    // Combined logs
    createFileTransport('combined', 'info'),
    
    // HTTP request logs
    createFileTransport('http', 'http'),
    
    // Debug logs (only in development)
    ...(process.env.NODE_ENV !== 'production' ? [createFileTransport('debug', 'debug')] : [])
  ],
  
  // Handle uncaught exceptions and unhandled rejections
  exceptionHandlers: [
    createFileTransport('exceptions', 'error')
  ],
  
  rejectionHandlers: [
    createFileTransport('rejections', 'error')
  ]
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
    level: 'debug'
  }));
}

// ================================
// SECURITY LOGGING
// ================================

const securityLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'void-marketplace-security',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    createFileTransport('security', 'info')
  ]
});

// ================================
// AUDIT LOGGING
// ================================

const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'void-marketplace-audit',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    createFileTransport('audit', 'info')
  ]
});

// ================================
// PERFORMANCE LOGGING
// ================================

const performanceLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'void-marketplace-performance',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    createFileTransport('performance', 'info')
  ]
});

// ================================
// CUSTOM LOGGING METHODS
// ================================

const logError = (message, error = null, context = {}) => {
  const logData = {
    message,
    error: error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code
    } : null,
    ...context
  };
  
  logger.error(logData);
};

const logSecurity = (event, details = {}) => {
  securityLogger.info({
    event,
    timestamp: new Date().toISOString(),
    ...details
  });
};

const logAudit = (action, userId, resource = null, details = {}) => {
  auditLogger.info({
    action,
    userId,
    resource,
    timestamp: new Date().toISOString(),
    ...details
  });
};

const logPerformance = (operation, duration, details = {}) => {
  performanceLogger.info({
    operation,
    duration,
    timestamp: new Date().toISOString(),
    ...details
  });
};

const logAPIRequest = (req, res, duration) => {
  const logData = {
    method: req.method,
    url: req.originalUrl,
    statusCode: res.statusCode,
    duration,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id || null,
    requestId: req.requestId || null
  };

  if (res.statusCode >= 400) {
    logger.warn('API Request Failed', logData);
  } else {
    logger.http('API Request', logData);
  }
};

const logDatabaseQuery = (query, duration, params = null) => {
  if (process.env.NODE_ENV === 'development' && process.env.LOG_DB_QUERIES === 'true') {
    logger.debug('Database Query', {
      query,
      duration,
      params
    });
  }
};

// ================================
// REQUEST ID MIDDLEWARE
// ================================

const addRequestId = (req, res, next) => {
  req.requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  res.setHeader('X-Request-ID', req.requestId);
  next();
};

// ================================
// REQUEST LOGGING MIDDLEWARE
// ================================

const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logAPIRequest(req, res, duration);
  });
  
  next();
};

// ================================
// UTILITY FUNCTIONS
// ================================

const createChildLogger = (module, additionalMeta = {}) => {
  return logger.child({
    module,
    ...additionalMeta
  });
};

const sanitizeLogData = (data) => {
  const sensitive = ['password', 'token', 'secret', 'key', 'authorization'];
  const sanitized = { ...data };
  
  const sanitizeObject = (obj, path = '') => {
    for (const key in obj) {
      const currentPath = path ? `${path}.${key}` : key;
      
      if (sensitive.some(term => key.toLowerCase().includes(term))) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key], currentPath);
      }
    }
  };
  
  sanitizeObject(sanitized);
  return sanitized;
};

// ================================
// PERFORMANCE TIMING DECORATOR
// ================================

const withTiming = (operation) => {
  return async (fn, ...args) => {
    const start = Date.now();
    try {
      const result = await fn(...args);
      const duration = Date.now() - start;
      
      logPerformance(operation, duration, { success: true });
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      
      logPerformance(operation, duration, { 
        success: false, 
        error: error.message 
      });
      throw error;
    }
  };
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Main logger
  logger,
  
  // Specialized loggers
  securityLogger,
  auditLogger,
  performanceLogger,
  
  // Custom logging methods
  logError,
  logSecurity,
  logAudit,
  logPerformance,
  logAPIRequest,
  logDatabaseQuery,
  
  // Middleware
  addRequestId,
  requestLogger,
  
  // Utility functions
  createChildLogger,
  sanitizeLogData,
  withTiming,
  
  // Default export (for backward compatibility)
  info: logger.info.bind(logger),
  warn: logger.warn.bind(logger),
  error: logger.error.bind(logger),
  debug: logger.debug.bind(logger),
  http: logger.http.bind(logger)
};