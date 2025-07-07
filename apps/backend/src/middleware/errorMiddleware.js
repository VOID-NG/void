// apps/backend/src/middleware/errorMiddleware.js
// Centralized error handling middleware for VOID Marketplace

const { ERROR_CODES } = require('../config/constants');
const logger = require('../utils/logger');

// ================================
// CUSTOM ERROR CLASSES
// ================================

class AppError extends Error {
  constructor(message, statusCode, code = null, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, ERROR_CODES.VALIDATION_FAILED, details);
  }
}

class AuthenticationError extends AppError {
  constructor(message, code = ERROR_CODES.AUTH_INVALID_CREDENTIALS) {
    super(message, 401, code);
  }
}

class AuthorizationError extends AppError {
  constructor(message, code = ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS) {
    super(message, 403, code);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found', resource = null) {
    super(message, 404, ERROR_CODES.RESOURCE_NOT_FOUND, { resource });
  }
}

class ConflictError extends AppError {
  constructor(message, details = null) {
    super(message, 409, ERROR_CODES.RESOURCE_CONFLICT, details);
  }
}

class BusinessLogicError extends AppError {
  constructor(message, code, details = null) {
    super(message, 400, code, details);
  }
}

// ================================
// ERROR RESPONSE FORMATTER
// ================================

const formatErrorResponse = (error, req) => {
  const response = {
    success: false,
    error: error.message || 'Internal server error',
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method
  };

  // Add error code if available
  if (error.code) {
    response.code = error.code;
  }

  // Add details if available
  if (error.details) {
    response.details = error.details;
  }

  // Add request ID for tracking (if available)
  if (req.requestId) {
    response.requestId = req.requestId;
  }

  return response;
};

// ================================
// PRISMA ERROR HANDLER
// ================================

const handlePrismaError = (error) => {
  switch (error.code) {
    case 'P2002':
      // Unique constraint violation
      const field = error.meta?.target?.[0] || 'field';
      return new ConflictError(
        `A record with this ${field} already exists`,
        { field, constraint: 'unique' }
      );

    case 'P2025':
      // Record not found
      return new NotFoundError('Record not found');

    case 'P2003':
      // Foreign key constraint violation
      return new ValidationError(
        'Invalid reference to related record',
        { constraint: 'foreign_key' }
      );

    case 'P2014':
      // Required relation violation
      return new ValidationError(
        'Required relation is missing',
        { constraint: 'required_relation' }
      );

    case 'P2021':
      // Table does not exist
      return new AppError('Database configuration error', 500, 'DATABASE_ERROR');

    case 'P2022':
      // Column does not exist
      return new AppError('Database schema error', 500, 'DATABASE_ERROR');

    default:
      // Generic Prisma error
      logger.error('Unhandled Prisma error:', error);
      return new AppError('Database operation failed', 500, 'DATABASE_ERROR');
  }
};

// ================================
// MONGOOSE ERROR HANDLER (if using MongoDB)
// ================================

const handleMongoError = (error) => {
  if (error.code === 11000) {
    // Duplicate key error
    const field = Object.keys(error.keyPattern || {})[0] || 'field';
    return new ConflictError(
      `A record with this ${field} already exists`,
      { field, constraint: 'unique' }
    );
  }

  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => ({
      field: err.path,
      message: err.message
    }));
    return new ValidationError('Validation failed', { errors });
  }

  if (error.name === 'CastError') {
    return new ValidationError(
      `Invalid ${error.path}: ${error.value}`,
      { field: error.path, value: error.value }
    );
  }

  return new AppError('Database operation failed', 500, 'DATABASE_ERROR');
};

// ================================
// VALIDATION ERROR HANDLER
// ================================

const handleValidationError = (error) => {
  if (error.isJoi) {
    // Joi validation error
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message.replace(/["]/g, '')
    }));
    
    return new ValidationError('Validation failed', { errors });
  }

  if (error.errors && Array.isArray(error.errors)) {
    // Express-validator errors
    const errors = error.errors.map(err => ({
      field: err.param || err.path,
      message: err.msg,
      value: err.value
    }));
    
    return new ValidationError('Validation failed', { errors });
  }

  return new ValidationError(error.message);
};

// ================================
// JWT ERROR HANDLER
// ================================

const handleJWTError = (error) => {
  if (error.name === 'TokenExpiredError') {
    return new AuthenticationError('Token has expired', ERROR_CODES.AUTH_TOKEN_EXPIRED);
  }

  if (error.name === 'JsonWebTokenError') {
    return new AuthenticationError('Invalid token', ERROR_CODES.AUTH_TOKEN_INVALID);
  }

  if (error.name === 'NotBeforeError') {
    return new AuthenticationError('Token not active yet', ERROR_CODES.AUTH_TOKEN_INVALID);
  }

  return new AuthenticationError('Authentication failed');
};

// ================================
// MULTER ERROR HANDLER
// ================================

const handleMulterError = (error) => {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return new ValidationError(
      'File too large',
      { 
        maxSize: error.limit,
        code: ERROR_CODES.UPLOAD_FILE_TOO_LARGE
      }
    );
  }

  if (error.code === 'LIMIT_FILE_COUNT') {
    return new ValidationError(
      'Too many files',
      { 
        maxCount: error.limit,
        code: ERROR_CODES.UPLOAD_FILE_TOO_LARGE
      }
    );
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return new ValidationError(
      'Unexpected file field',
      { 
        fieldName: error.field,
        code: ERROR_CODES.UPLOAD_INVALID_TYPE
      }
    );
  }

  return new ValidationError('File upload failed', { code: ERROR_CODES.UPLOAD_FAILED });
};

// ================================
// MAIN ERROR HANDLER MIDDLEWARE
// ================================

const errorHandler = (error, req, res, next) => {
  let appError = error;

  // Log error details
  logger.error('Error occurred:', {
    message: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    user: req.user?.id || 'anonymous',
    body: req.method !== 'GET' ? req.body : undefined
  });

  // Convert known errors to AppError instances
  if (!(error instanceof AppError)) {
    // Prisma errors
    if (error.code && error.code.startsWith('P')) {
      appError = handlePrismaError(error);
    }
    // Mongoose errors
    else if (error.name && ['MongoError', 'ValidationError', 'CastError'].includes(error.name)) {
      appError = handleMongoError(error);
    }
    // Joi validation errors
    else if (error.isJoi || (error.errors && Array.isArray(error.errors))) {
      appError = handleValidationError(error);
    }
    // JWT errors
    else if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) {
      appError = handleJWTError(error);
    }
    // Multer errors
    else if (error.code && error.code.startsWith('LIMIT_')) {
      appError = handleMulterError(error);
    }
    // Syntax errors
    else if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      appError = new ValidationError('Invalid JSON syntax');
    }
    // Generic errors
    else {
      appError = new AppError(
        process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
        500
      );
    }
  }

  // Don't leak sensitive information in production
  if (process.env.NODE_ENV === 'production' && appError.statusCode === 500) {
    appError.message = 'Internal server error';
    delete appError.details;
  }

  // Format error response
  const errorResponse = formatErrorResponse(appError, req);

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = error.stack;
  }

  res.status(appError.statusCode || 500).json(errorResponse);
};

// ================================
// ASYNC ERROR WRAPPER
// ================================

const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ================================
// NOT FOUND HANDLER
// ================================

const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(
    `Route ${req.method} ${req.originalUrl} not found`
  );
  next(error);
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
  BusinessLogicError,
  
  // Middleware
  errorHandler,
  asyncHandler,
  notFoundHandler,
  
  // Utility functions
  formatErrorResponse,
  handlePrismaError,
  handleValidationError,
  handleJWTError,
  handleMulterError
};