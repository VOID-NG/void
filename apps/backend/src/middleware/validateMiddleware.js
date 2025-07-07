// apps/backend/src/middleware/validateMiddleware.js
// Request validation middleware using Joi for VOID Marketplace

const Joi = require('joi');
const { ValidationError } = require('./errorMiddleware');
const { ERROR_CODES } = require('../config/constants');
const logger = require('../utils/logger');

// ================================
// VALIDATION HELPER FUNCTIONS
// ================================

/**
 * Create validation middleware for request schemas
 * @param {Object} schemas - Validation schemas for different parts of request
 * @param {Object} schemas.body - Body validation schema
 * @param {Object} schemas.params - URL params validation schema
 * @param {Object} schemas.query - Query string validation schema
 * @param {Object} schemas.headers - Headers validation schema
 * @returns {Function} Express middleware
 */
const validate = (schemas = {}) => {
  return (req, res, next) => {
    const errors = [];

    // Validate request body
    if (schemas.body) {
      const { error, value } = schemas.body.validate(req.body, {
        abortEarly: false,
        allowUnknown: false,
        stripUnknown: true
      });

      if (error) {
        const bodyErrors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message.replace(/["]/g, ''),
          value: detail.context?.value,
          type: detail.type
        }));
        errors.push(...bodyErrors);
      } else {
        req.body = value; // Use sanitized/validated data
      }
    }

    // Validate URL parameters
    if (schemas.params) {
      const { error, value } = schemas.params.validate(req.params, {
        abortEarly: false,
        allowUnknown: false,
        stripUnknown: true
      });

      if (error) {
        const paramErrors = error.details.map(detail => ({
          field: `params.${detail.path.join('.')}`,
          message: detail.message.replace(/["]/g, ''),
          value: detail.context?.value,
          type: detail.type
        }));
        errors.push(...paramErrors);
      } else {
        req.params = value;
      }
    }

    // Validate query string
    if (schemas.query) {
      const { error, value } = schemas.query.validate(req.query, {
        abortEarly: false,
        allowUnknown: false,
        stripUnknown: true
      });

      if (error) {
        const queryErrors = error.details.map(detail => ({
          field: `query.${detail.path.join('.')}`,
          message: detail.message.replace(/["]/g, ''),
          value: detail.context?.value,
          type: detail.type
        }));
        errors.push(...queryErrors);
      } else {
        req.query = value;
      }
    }

    // Validate headers
    if (schemas.headers) {
      const { error, value } = schemas.headers.validate(req.headers, {
        abortEarly: false,
        allowUnknown: true, // Allow unknown headers
        stripUnknown: false
      });

      if (error) {
        const headerErrors = error.details.map(detail => ({
          field: `headers.${detail.path.join('.')}`,
          message: detail.message.replace(/["]/g, ''),
          value: detail.context?.value,
          type: detail.type
        }));
        errors.push(...headerErrors);
      }
    }

    // Return validation errors if any
    if (errors.length > 0) {
      logger.debug('Validation failed:', { url: req.originalUrl, errors });
      
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'The request contains invalid data',
        details: { errors }
      });
    }

    next();
  };
};

// ================================
// COMMON VALIDATION SCHEMAS
// ================================

// Common field patterns
const patterns = {
  objectId: /^[a-zA-Z0-9_-]{21,30}$/, // CUID pattern
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  phone: /^\+?[\d\s-()]{10,}$/,
  url: /^https?:\/\/.+/,
  slug: /^[a-z0-9-]+$/,
  username: /^[a-zA-Z0-9_-]{3,20}$/
};

// Common validation schemas
const commonSchemas = {
  // Basic types
  id: Joi.string().pattern(patterns.objectId).required(),
  optionalId: Joi.string().pattern(patterns.objectId).optional(),
  email: Joi.string().email().lowercase().trim(),
  password: Joi.string().min(8).max(128).pattern(patterns.password),
  username: Joi.string().min(3).max(20).pattern(patterns.username),
  phone: Joi.string().pattern(patterns.phone).optional(),
  url: Joi.string().uri().optional(),
  
  // Pagination
  pagination: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string().valid('asc', 'desc').default('desc'),
    sortBy: Joi.string().optional()
  },
  
  // Search
  search: {
    q: Joi.string().min(1).max(100).trim().optional(),
    category: Joi.string().optional(),
    minPrice: Joi.number().min(0).optional(),
    maxPrice: Joi.number().min(0).optional(),
    condition: Joi.string().valid('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR').optional(),
    location: Joi.string().max(100).optional()
  },
  
  // File validation
  file: {
    filename: Joi.string().required(),
    mimetype: Joi.string().required(),
    size: Joi.number().integer().min(1).required()
  }
};

// ================================
// SPECIALIZED VALIDATION FUNCTIONS
// ================================

/**
 * Validate pagination parameters
 */
const validatePagination = validate({
  query: Joi.object(commonSchemas.pagination)
});

/**
 * Validate search parameters
 */
const validateSearch = validate({
  query: Joi.object({
    ...commonSchemas.pagination,
    ...commonSchemas.search
  })
});

/**
 * Validate ID parameter
 */
const validateId = validate({
  params: Joi.object({
    id: commonSchemas.id
  })
});

/**
 * Validate multiple IDs in request body
 */
const validateIds = validate({
  body: Joi.object({
    ids: Joi.array().items(commonSchemas.id).min(1).max(100).required()
  })
});

// ================================
// CUSTOM VALIDATORS
// ================================

/**
 * Custom validator for decimal values (prices)
 */
const decimalValidator = (precision = 2) => {
  return Joi.number()
    .precision(precision)
    .min(0)
    .custom((value, helpers) => {
      if (value < 0) {
        return helpers.error('number.min');
      }
      
      // Check decimal places
      const decimalPlaces = (value.toString().split('.')[1] || '').length;
      if (decimalPlaces > precision) {
        return helpers.error('number.precision', { limit: precision });
      }
      
      return value;
    });
};

/**
 * Custom validator for array of tags
 */
const tagsValidator = Joi.array()
  .items(
    Joi.string()
      .trim()
      .min(1)
      .max(30)
      .pattern(/^[a-zA-Z0-9\s-]+$/)
  )
  .max(10)
  .unique()
  .default([]);

/**
 * Custom validator for coordinates
 */
const coordinatesValidator = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required()
}).optional();

/**
 * Custom validator for date ranges
 */
const dateRangeValidator = Joi.object({
  start: Joi.date().iso().required(),
  end: Joi.date().iso().min(Joi.ref('start')).required()
});

/**
 * Custom validator for image dimensions
 */
const dimensionsValidator = Joi.object({
  width: Joi.number().integer().min(1).max(10000).required(),
  height: Joi.number().integer().min(1).max(10000).required(),
  depth: Joi.number().integer().min(1).max(10000).optional()
}).optional();

// ================================
// CONDITIONAL VALIDATION
// ================================

/**
 * Validate based on user role
 */
const validateByRole = (roleSchemas) => {
  return (req, res, next) => {
    const userRole = req.user?.role;
    const schema = roleSchemas[userRole] || roleSchemas.default;
    
    if (!schema) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        code: ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS,
        message: 'No validation schema found for your role'
      });
    }
    
    return validate(schema)(req, res, next);
  };
};

/**
 * Validate with different schemas based on request method
 */
const validateByMethod = (methodSchemas) => {
  return (req, res, next) => {
    const method = req.method.toLowerCase();
    const schema = methodSchemas[method];
    
    if (!schema) {
      return next(); // No validation needed for this method
    }
    
    return validate(schema)(req, res, next);
  };
};

// ================================
// SANITIZATION HELPERS
// ================================

/**
 * Sanitize HTML content
 */
const sanitizeHtml = (value, helpers) => {
  // Basic HTML sanitization - remove script tags, etc.
  const sanitized = value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
  
  return sanitized;
};

/**
 * Sanitize string for search
 */
const sanitizeSearch = (value, helpers) => {
  return value
    .trim()
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/\s+/g, ' '); // Normalize whitespace
};

// ================================
// ERROR FORMATTING
// ================================

/**
 * Format Joi validation errors for consistent API responses
 */
const formatValidationError = (error) => {
  const errors = error.details.map(detail => {
    const field = detail.path.join('.');
    let message = detail.message.replace(/["]/g, '');
    
    // Customize messages for better UX
    switch (detail.type) {
      case 'string.email':
        message = 'Please enter a valid email address';
        break;
      case 'string.min':
        message = `${field} must be at least ${detail.context.limit} characters long`;
        break;
      case 'string.max':
        message = `${field} must not exceed ${detail.context.limit} characters`;
        break;
      case 'number.min':
        message = `${field} must be at least ${detail.context.limit}`;
        break;
      case 'number.max':
        message = `${field} must not exceed ${detail.context.limit}`;
        break;
      case 'any.required':
        message = `${field} is required`;
        break;
      case 'string.pattern.base':
        message = `${field} format is invalid`;
        break;
    }
    
    return {
      field,
      message,
      value: detail.context?.value,
      type: detail.type
    };
  });
  
  return new ValidationError('Validation failed', { errors });
};

// ================================
// MIDDLEWARE FACTORY
// ================================

/**
 * Create validation middleware with custom options
 */
const createValidator = (schema, options = {}) => {
  const defaultOptions = {
    abortEarly: false,
    allowUnknown: false,
    stripUnknown: true,
    ...options
  };
  
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, defaultOptions);
    
    if (error) {
      const validationError = formatValidationError(error);
      return res.status(400).json({
        success: false,
        error: validationError.message,
        code: ERROR_CODES.VALIDATION_FAILED,
        details: validationError.details
      });
    }
    
    req.body = value;
    next();
  };
};

module.exports = {
  // Main validation function
  validate,
  
  // Common validators
  validatePagination,
  validateSearch,
  validateId,
  validateIds,
  
  // Conditional validators
  validateByRole,
  validateByMethod,
  
  // Custom validators
  decimalValidator,
  tagsValidator,
  coordinatesValidator,
  dateRangeValidator,
  dimensionsValidator,
  
  // Common schemas
  commonSchemas,
  patterns,
  
  // Sanitization
  sanitizeHtml,
  sanitizeSearch,
  
  // Utilities
  formatValidationError,
  createValidator,
  
  // Joi instance for external use
  Joi
};