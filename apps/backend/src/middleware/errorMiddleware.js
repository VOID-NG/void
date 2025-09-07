// apps/backend/src/middleware/errorMiddleware.js
// Complete error handling middleware for VOID Marketplace

const logger = require('../utils/logger');
const { ERROR_CODES } = require('../config/constants');

// ================================
// CUSTOM ERROR CLASSES
// ================================

class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400, ERROR_CODES.VALIDATION_REQUIRED_FIELD);
    this.field = field;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401, ERROR_CODES.AUTH_CREDENTIALS_INVALID);
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, ERROR_CODES.VALIDATION_DUPLICATE_VALUE);
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, ERROR_CODES.RATE_LIMIT_EXCEEDED);
  }
}

class ExternalServiceError extends AppError {
  constructor(message = 'External service error', service = null) {
    super(message, 503, ERROR_CODES.EXTERNAL_API_ERROR);
    this.service = service;
  }
}

class FileUploadError extends AppError {
  constructor(message = 'File upload failed', reason = null) {
    super(message, 400, ERROR_CODES.FILE_UPLOAD_FAILED);
    this.reason = reason;
  }
}

class BusinessLogicError extends AppError {
  constructor(message, specificErrorCode = null) {
    super(message, 422, specificErrorCode || ERROR_CODES.BUSINESS_TRANSACTION_FAILED);
  }
}

// ================================
// ERROR RESPONSE FORMATTER
// ================================

const formatErrorResponse = (error, req) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  const response = {
    success: false,
    error: error.message || 'Internal server error',
    error_code: error.errorCode || 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method
  };

  // Add additional error details in development
  if (!isProduction) {
    response.stack = error.stack;
    response.details = {
      name: error.name,
      statusCode: error.statusCode
    };

    // Add field-specific validation errors
    if (error.field) {
      response.field = error.field;
    }

    // Add service-specific errors
    if (error.service) {
      response.service = error.service;
    }

    // Add reason for file upload errors
    if (error.reason) {
      response.reason = error.reason;
    }
  }

  // Add request ID for tracking
  if (req.requestId) {
    response.request_id = req.requestId;
  }

  return response;
};

// ================================
// ASYNC HANDLER WRAPPER
// ================================

const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ================================
// MAIN ERROR HANDLER MIDDLEWARE
// ================================

const errorHandler = (error, req, res, next) => {
  let err = { ...error };
  err.message = error.message;

  // Log error details
  const logData = {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
      statusCode: error.statusCode
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id,
      body: sanitizeRequestBody(req.body),
      query: req.query,
      params: req.params
    },
    timestamp: new Date().toISOString()
  };

  // Log based on error severity
  if (error.statusCode >= 500) {
    logger.error('Server Error:', logData);
  } else if (error.statusCode >= 400) {
    logger.warn('Client Error:', logData);
  } else {
    logger.info('Error handled:', logData);
  }

  // Handle specific error types
  if (error.name === 'PrismaClientKnownRequestError') {
    err = handlePrismaError(error);
  } else if (error.name === 'PrismaClientValidationError') {
    err = new ValidationError('Invalid data provided');
  } else if (error.name === 'JsonWebTokenError') {
    err = new AuthenticationError('Invalid token');
  } else if (error.name === 'TokenExpiredError') {
    err = new AuthenticationError('Token expired');
  } else if (error.name === 'MulterError') {
    err = handleMulterError(error);
  } else if (error.code === 'ECONNREFUSED') {
    err = new ExternalServiceError('Service unavailable');
  } else if (error.code === 'ENOTFOUND') {
    err = new ExternalServiceError('Service not found');
  } else if (!error.statusCode) {
    // Unknown errors default to 500
    err = new AppError('Internal server error', 500);
  }

  // Format and send error response
  const response = formatErrorResponse(err, req);
  
  res.status(err.statusCode || 500).json(response);
};

// ================================
// SPECIFIC ERROR HANDLERS
// ================================

const handlePrismaError = (error) => {
  switch (error.code) {
    case 'P2002':
      // Unique constraint violation
      const field = error.meta?.target?.[0] || 'field';
      return new ConflictError(`${field} already exists`, field);
    
    case 'P2014':
      // Invalid ID
      return new ValidationError('Invalid ID provided');
    
    case 'P2003':
      // Foreign key constraint violation
      return new ValidationError('Referenced resource does not exist');
    
    case 'P2025':
      // Record not found
      return new NotFoundError('Record not found');
    
    case 'P2021':
      // Table does not exist
      return new AppError('Database configuration error', 500);
    
    case 'P2022':
      // Column does not exist
      return new AppError('Database schema error', 500);
    
    default:
      return new AppError('Database operation failed', 500, ERROR_CODES.DATABASE_QUERY_ERROR);
  }
};

const handleMulterError = (error) => {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return new FileUploadError('File too large', 'size_limit');
    
    case 'LIMIT_FILE_COUNT':
      return new FileUploadError('Too many files', 'count_limit');
    
    case 'LIMIT_UNEXPECTED_FILE':
      return new FileUploadError('Unexpected file field', 'unexpected_field');
    
    case 'LIMIT_FIELD_KEY':
      return new FileUploadError('Field name too long', 'field_name');
    
    case 'LIMIT_FIELD_VALUE':
      return new FileUploadError('Field value too long', 'field_value');
    
    case 'LIMIT_FIELD_COUNT':
      return new FileUploadError('Too many fields', 'field_count');
    
    case 'LIMIT_PART_COUNT':
      return new FileUploadError('Too many parts', 'part_count');
    
    default:
      return new FileUploadError('File upload failed', 'unknown');
  }
};

// ================================
// VALIDATION ERROR HANDLER
// ================================

const handleValidationError = (error) => {
  if (error.details) {
    // Joi validation error
    const message = error.details[0].message;
    const field = error.details[0].path?.[0];
    return new ValidationError(message, field);
  }
  
  return new ValidationError(error.message);
};

// ================================
// 404 HANDLER
// ================================

const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Route ${req.originalUrl} not found`);
  next(error);
};

// ================================
// UTILITY FUNCTIONS
// ================================

const sanitizeRequestBody = (body) => {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sanitized = { ...body };
  
  // Remove sensitive fields
  const sensitiveFields = ['password', 'password_hash', 'token', 'secret', 'api_key'];
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });

  return sanitized;
};

// ================================
// ERROR REPORTING
// ================================

const reportError = async (error, context = {}) => {
  try {
    // Log to external error reporting service (Sentry, Bugsnag, etc.)
    if (process.env.SENTRY_DSN && error.statusCode >= 500) {
      // Report to Sentry in production
      // Sentry.captureException(error, { extra: context });
    }

    // Store critical errors in database for analysis
    if (error.statusCode >= 500) {
      await dbRouter.errorLog.create({
        data: {
          error_type: error.name,
          error_message: error.message,
          stack_trace: error.stack,
          context: JSON.stringify(context),
          created_at: new Date()
        }
      }).catch(() => {
        // Ignore database errors in error handler
      });
    }
  } catch (reportingError) {
    logger.error('Error reporting failed:', reportingError);
  }
};

// ================================
// GRACEFUL SHUTDOWN HANDLERS
// ================================

const handleUncaughtException = (error) => {
  logger.fatal('Uncaught Exception:', error);
  
  // Report the error
  reportError(error, { type: 'uncaught_exception' });
  
  // Graceful shutdown
  process.exit(1);
};

const handleUnhandledRejection = (reason, promise) => {
  logger.fatal('Unhandled Rejection at:', promise, 'reason:', reason);
  
  // Report the error
  reportError(new Error(reason), { 
    type: 'unhandled_rejection',
    promise: promise.toString()
  });
  
  // Graceful shutdown
  process.exit(1);
};

// Set up global error handlers
process.on('uncaughtException', handleUncaughtException);
process.on('unhandledRejection', handleUnhandledRejection);

// ================================
// REQUEST ID MIDDLEWARE
// ================================

const addRequestId = (req, res, next) => {
  req.requestId = require('crypto').randomBytes(16).toString('hex');
  res.setHeader('X-Request-ID', req.requestId);
  next();
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Error classes
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ExternalServiceError,
  FileUploadError,
  BusinessLogicError,

  // Middleware functions
  errorHandler,
  notFoundHandler,
  asyncHandler,
  addRequestId,

  // Utility functions
  formatErrorResponse,
  handleValidationError,
  handlePrismaError,
  handleMulterError,
  reportError
};