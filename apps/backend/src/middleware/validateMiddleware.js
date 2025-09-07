// apps/backend/src/middleware/validateMiddleware.js
// Complete validation middleware for VOID Marketplace

const Joi = require('joi');
const { ValidationError } = require('./errorMiddleware');
const { VALIDATION_PATTERNS, ALLOWED_FILE_TYPES } = require('../config/constants');
const logger = require('../utils/logger');

// ================================
// VALIDATION UTILITY FUNCTIONS
// ================================

/**
 * Create validation middleware for Joi schema
 * @param {Object} schema - Joi validation schema
 * @param {string} source - Where to get data from ('body', 'query', 'params')
 * @returns {Function} Express middleware
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      const data = req[source];
      const { error, value } = schema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
      });

      if (error) {
        const errorDetails = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }));

        logger.warn('Validation failed:', {
          source,
          errors: errorDetails,
          requestId: req.requestId
        });

        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          error_code: 'VALIDATION_ERROR',
          details: errorDetails,
          request_id: req.requestId
        });
      }

      // Replace the source data with validated/sanitized data
      req[source] = value;
      next();
    } catch (err) {
      logger.error('Validation middleware error:', err);
      next(new ValidationError('Validation processing failed'));
    }
  };
};

/**
 * Validate multiple sources (body, query, params)
 * @param {Object} schemas - Object containing schemas for different sources
 * @returns {Function} Express middleware
 */
const validateMultiple = (schemas) => {
  return (req, res, next) => {
    try {
      const errors = [];
      const validatedData = {};

      // Validate each source
      for (const [source, schema] of Object.entries(schemas)) {
        const data = req[source];
        const { error, value } = schema.validate(data, {
          abortEarly: false,
          stripUnknown: true,
          convert: true
        });

        if (error) {
          const sourceErrors = error.details.map(detail => ({
            source,
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value
          }));
          errors.push(...sourceErrors);
        } else {
          validatedData[source] = value;
        }
      }

      if (errors.length > 0) {
        logger.warn('Multi-source validation failed:', {
          errors,
          requestId: req.requestId
        });

        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          error_code: 'VALIDATION_ERROR',
          details: errors,
          request_id: req.requestId
        });
      }

      // Replace validated data
      Object.keys(validatedData).forEach(source => {
        req[source] = validatedData[source];
      });

      next();
    } catch (err) {
      logger.error('Multi-source validation error:', err);
      next(new ValidationError('Validation processing failed'));
    }
  };
};

// ================================
// COMMON VALIDATION SCHEMAS
// ================================

const commonSchemas = {
  // ID validation
  id: Joi.string().guid({ version: 'uuidv4' }).required(),
  optionalId: Joi.string().guid({ version: 'uuidv4' }).optional(),

  // Pagination
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    offset: Joi.number().integer().min(0).optional()
  }),

  // Sorting
  sorting: Joi.object({
    sort_by: Joi.string().valid(
      'created_at', 'updated_at', 'price', 'title', 'views_count', 'likes_count'
    ).default('created_at'),
    sort_order: Joi.string().valid('asc', 'desc').default('desc')
  }),

  // Date range
  dateRange: Joi.object({
    start_date: Joi.date().iso().optional(),
    end_date: Joi.date().iso().min(Joi.ref('start_date')).optional()
  }),

  // Search
  search: Joi.object({
    q: Joi.string().trim().min(1).max(255).optional(),
    category: Joi.string().guid().optional(),
    location: Joi.string().trim().max(100).optional()
  }),

  // Price range
  priceRange: Joi.object({
    min_price: Joi.number().min(0).precision(2).optional(),
    max_price: Joi.number().min(Joi.ref('min_price')).precision(2).optional()
  })
};

// ================================
// USER VALIDATION SCHEMAS
// ================================

const userSchemas = {
  register: Joi.object({
    email: Joi.string().email().required(),
    username: Joi.string().pattern(VALIDATION_PATTERNS.USERNAME).required(),
    password: Joi.string().pattern(VALIDATION_PATTERNS.PASSWORD).required(),
    first_name: Joi.string().trim().min(1).max(50).required(),
    last_name: Joi.string().trim().min(1).max(50).required(),
    phone: Joi.string().pattern(VALIDATION_PATTERNS.PHONE).optional(),
    role: Joi.string().valid('USER', 'VENDOR').default('USER'),
    business_name: Joi.when('role', {
      is: 'VENDOR',
      then: Joi.string().trim().min(1).max(100).required(),
      otherwise: Joi.optional()
    }),
    business_address: Joi.when('role', {
      is: 'VENDOR',
      then: Joi.string().trim().min(1).max(255).optional(),
      otherwise: Joi.optional()
    }),
    tax_id: Joi.when('role', {
      is: 'VENDOR',
      then: Joi.string().trim().min(1).max(50).optional(),
      otherwise: Joi.optional()
    }),
    terms_accepted: Joi.boolean().valid(true).required()
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    remember_me: Joi.boolean().default(false)
  }),

  updateProfile: Joi.object({
    first_name: Joi.string().trim().min(1).max(50).optional(),
    last_name: Joi.string().trim().min(1).max(50).optional(),
    phone: Joi.string().pattern(VALIDATION_PATTERNS.PHONE).optional(),
    bio: Joi.string().trim().max(500).optional(),
    location: Joi.string().trim().max(100).optional(),
    business_name: Joi.string().trim().min(1).max(100).optional(),
    business_address: Joi.string().trim().min(1).max(255).optional()
  }),

  changePassword: Joi.object({
    current_password: Joi.string().required(),
    new_password: Joi.string().pattern(VALIDATION_PATTERNS.PASSWORD).required(),
    confirm_password: Joi.string().valid(Joi.ref('new_password')).required()
  }),

  forgotPassword: Joi.object({
    email: Joi.string().email().required()
  }),

  resetPassword: Joi.object({
    token: Joi.string().required(),
    new_password: Joi.string().pattern(VALIDATION_PATTERNS.PASSWORD).required(),
    confirm_password: Joi.string().valid(Joi.ref('new_password')).required()
  }),

  verifyEmail: Joi.object({
    token: Joi.string().required()
  })
};

// ================================
// LISTING VALIDATION SCHEMAS
// ================================

const listingSchemas = {
  create: Joi.object({
    title: Joi.string().trim().min(5).max(100).required(),
    description: Joi.string().trim().min(20).max(2000).required(),
    price: Joi.number().min(0).precision(2).required(),
    condition: Joi.string().valid('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR').required(),
    category_id: Joi.string().guid().required(),
    quantity: Joi.number().integer().min(1).default(1),
    sku: Joi.string().pattern(VALIDATION_PATTERNS.SKU).optional(),
    tags: Joi.array().items(Joi.string().trim().min(1).max(30)).max(10).default([]),
    weight: Joi.number().min(0).precision(3).optional(),
    dimensions: Joi.string().max(100).optional(),
    location: Joi.string().trim().max(100).optional(),
    is_negotiable: Joi.boolean().default(true)
  }),

  update: Joi.object({
    title: Joi.string().trim().min(5).max(100).optional(),
    description: Joi.string().trim().min(20).max(2000).optional(),
    price: Joi.number().min(0).precision(2).optional(),
    condition: Joi.string().valid('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR').optional(),
    quantity: Joi.number().integer().min(1).optional(),
    tags: Joi.array().items(Joi.string().trim().min(1).max(30)).max(10).optional(),
    weight: Joi.number().min(0).precision(3).optional(),
    dimensions: Joi.string().max(100).optional(),
    location: Joi.string().trim().max(100).optional(),
    is_negotiable: Joi.boolean().optional()
  }),

  search: Joi.object({
    q: Joi.string().trim().min(1).max(255).optional(),
    category_id: Joi.string().guid().optional(),
    vendor_id: Joi.string().guid().optional(),
    condition: Joi.string().valid('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR').optional(),
    min_price: Joi.number().min(0).precision(2).optional(),
    max_price: Joi.number().min(Joi.ref('min_price')).precision(2).optional(),
    location: Joi.string().trim().max(100).optional(),
    is_featured: Joi.boolean().optional(),
    include_inactive: Joi.boolean().default(false),
    ...commonSchemas.pagination,
    ...commonSchemas.sorting
  }),

  updateStatus: Joi.object({
    status: Joi.string().valid('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SOLD', 'REMOVED', 'REJECTED').required(),
    reason: Joi.string().trim().max(255).optional()
  })
};

// ================================
// CHAT & MESSAGE VALIDATION SCHEMAS
// ================================

const chatSchemas = {
  create: Joi.object({
    listing_id: Joi.string().guid().required(),
    vendor_id: Joi.string().guid().required(),
    initial_message: Joi.string().trim().min(1).max(1000).optional()
  }),

  sendMessage: Joi.object({
    chat_id: Joi.string().guid().required(),
    content: Joi.string().trim().min(1).max(1000).when('type', {
      is: 'TEXT',
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    type: Joi.string().valid('TEXT', 'IMAGE', 'OFFER', 'COUNTER_OFFER', 'FILE').default('TEXT'),
    offer_amount: Joi.when('type', {
      is: Joi.string().valid('OFFER', 'COUNTER_OFFER'),
      then: Joi.number().min(0).precision(2).required(),
      otherwise: Joi.optional()
    }),
    reply_to_id: Joi.string().guid().optional(),
    metadata: Joi.object().optional()
  }),

  editMessage: Joi.object({
    content: Joi.string().trim().min(1).max(1000).required()
  }),

  getMessages: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    before_message_id: Joi.string().guid().optional()
  }),

  markRead: Joi.object({
    message_ids: Joi.array().items(Joi.string().guid()).optional()
  })
};

// ================================
// TRANSACTION VALIDATION SCHEMAS
// ================================

const transactionSchemas = {
  create: Joi.object({
    listing_id: Joi.string().guid().required(),
    vendor_id: Joi.string().guid().required(),
    quantity: Joi.number().integer().min(1).default(1),
    amount: Joi.number().min(0).precision(2).required(),
    payment_method_id: Joi.string().required(),
    shipping_address: Joi.object({
      street: Joi.string().trim().required(),
      city: Joi.string().trim().required(),
      state: Joi.string().trim().required(),
      postal_code: Joi.string().trim().required(),
      country: Joi.string().trim().required()
    }).required(),
    promotion_code: Joi.string().trim().max(50).optional()
  }),

  processPayment: Joi.object({
    payment_method_id: Joi.string().required(),
    billing_address: Joi.object({
      street: Joi.string().trim().required(),
      city: Joi.string().trim().required(),
      state: Joi.string().trim().required(),
      postal_code: Joi.string().trim().required(),
      country: Joi.string().trim().required()
    }).optional()
  }),

  updateShipping: Joi.object({
    tracking_number: Joi.string().trim().max(100).required(),
    carrier: Joi.string().trim().max(50).required(),
    estimated_delivery: Joi.date().iso().min('now').optional()
  }),

  processRefund: Joi.object({
    refund_amount: Joi.number().min(0).precision(2).optional(),
    refund_reason: Joi.string().trim().min(5).max(255).required(),
    refund_type: Joi.string().valid('full', 'partial').default('full'),
    admin_notes: Joi.string().trim().max(500).optional()
  }),

  initiateDispute: Joi.object({
    reason: Joi.string().valid(
      'item_not_received',
      'item_not_as_described',
      'damaged_item',
      'wrong_item',
      'quality_issues',
      'seller_dispute',
      'other'
    ).required(),
    description: Joi.string().trim().min(10).max(1000).required(),
    evidence_urls: Joi.array().items(Joi.string().uri()).max(10).default([])
  })
};

// ================================
// NOTIFICATION VALIDATION SCHEMAS
// ================================

const notificationSchemas = {
  getNotifications: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    type: Joi.string().optional(),
    status: Joi.string().valid('all', 'read', 'unread').default('all'),
    category: Joi.string().valid('transactions', 'listings', 'chats', 'system').optional()
  }),

  markAllRead: Joi.object({
    category: Joi.string().valid('transactions', 'listings', 'chats', 'system').optional(),
    type: Joi.string().optional()
  }),

  deleteAll: Joi.object({
    category: Joi.string().valid('transactions', 'listings', 'chats', 'system').optional(),
    type: Joi.string().optional(),
    older_than_days: Joi.number().integer().min(1).max(365).optional()
  }),

  updatePreferences: Joi.object({
    email_notifications: Joi.object({
      enabled: Joi.boolean().default(true),
      categories: Joi.object({
        transactions: Joi.boolean().default(true),
        listings: Joi.boolean().default(true),
        chats: Joi.boolean().default(true),
        system: Joi.boolean().default(true)
      }).optional()
    }).optional(),
    push_notifications: Joi.object({
      enabled: Joi.boolean().default(true),
      categories: Joi.object({
        transactions: Joi.boolean().default(true),
        listings: Joi.boolean().default(true),
        chats: Joi.boolean().default(true),
        system: Joi.boolean().default(false)
      }).optional()
    }).optional(),
    sms_notifications: Joi.object({
      enabled: Joi.boolean().default(false),
      categories: Joi.object({
        transactions: Joi.boolean().default(true),
        listings: Joi.boolean().default(false),
        chats: Joi.boolean().default(false),
        system: Joi.boolean().default(false)
      }).optional()
    }).optional(),
    quiet_hours: Joi.object({
      enabled: Joi.boolean().default(false),
      start_time: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).default('22:00'),
      end_time: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).default('08:00'),
      timezone: Joi.string().default('UTC')
    }).optional()
  })
};

// ================================
// SEARCH VALIDATION SCHEMAS
// ================================

const searchSchemas = {
  textSearch: Joi.object({
    q: Joi.string().trim().min(2).max(255).required(),
    category: Joi.string().guid().optional(),
    min_price: Joi.number().min(0).precision(2).optional(),
    max_price: Joi.number().min(Joi.ref('min_price')).precision(2).optional(),
    condition: Joi.string().valid('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR').optional(),
    location: Joi.string().trim().max(100).optional(),
    vendor_id: Joi.string().guid().optional(),
    sort_by: Joi.string().valid('relevance', 'price', 'created_at', 'views_count').default('relevance'),
    sort_order: Joi.string().valid('asc', 'desc').default('desc'),
    include_inactive: Joi.boolean().default(false),
    ...commonSchemas.pagination
  }),

  imageSearch: Joi.object({
    category: Joi.string().guid().optional(),
    min_price: Joi.number().min(0).precision(2).optional(),
    max_price: Joi.number().min(Joi.ref('min_price')).precision(2).optional(),
    similarity_threshold: Joi.number().min(0).max(1).default(0.7),
    limit: Joi.number().integer().min(1).max(50).default(20)
  }),

  imageUrlSearch: Joi.object({
    image_url: Joi.string().uri().required(),
    category: Joi.string().guid().optional(),
    min_price: Joi.number().min(0).precision(2).optional(),
    max_price: Joi.number().min(Joi.ref('min_price')).precision(2).optional(),
    similarity_threshold: Joi.number().min(0).max(1).default(0.7),
    limit: Joi.number().integer().min(1).max(50).default(20)
  }),

  autocomplete: Joi.object({
    q: Joi.string().trim().min(1).max(100).required(),
    limit: Joi.number().integer().min(1).max(20).default(10)
  }),

  saveSearch: Joi.object({
    name: Joi.string().trim().min(1).max(100).required(),
    query: Joi.string().trim().min(1).max(255).required(),
    filters: Joi.object().optional(),
    notify_on_new_results: Joi.boolean().default(false)
  })
};

// ================================
// ADMIN VALIDATION SCHEMAS
// ================================

const adminSchemas = {
  userManagement: Joi.object({
    action: Joi.string().valid('block', 'unblock', 'verify', 'promote', 'demote').required(),
    reason: Joi.string().trim().min(5).max(255).when('action', {
      is: Joi.string().valid('block', 'demote'),
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    new_role: Joi.when('action', {
      is: Joi.string().valid('promote', 'demote'),
      then: Joi.string().valid('USER', 'VENDOR', 'MODERATOR', 'ADMIN').required(),
      otherwise: Joi.optional()
    })
  }),

  listingApproval: Joi.object({
    action: Joi.string().valid('approve', 'reject', 'feature', 'unfeature').required(),
    reason: Joi.string().trim().min(5).max(255).when('action', {
      is: 'reject',
      then: Joi.required(),
      otherwise: Joi.optional()
    })
  }),

  systemSettings: Joi.object({
    platform_fee_percentage: Joi.number().min(0).max(0.2).precision(4).optional(),
    escrow_release_days: Joi.number().integer().min(1).max(30).optional(),
    max_listings_per_user: Joi.number().integer().min(1).max(1000).optional(),
    maintenance_mode: Joi.boolean().optional(),
    registration_enabled: Joi.boolean().optional()
  })
};

// ================================
// FILE UPLOAD VALIDATION
// ================================

const fileValidationSchemas = {
  imageUpload: Joi.object({
    fieldname: Joi.string().valid('image', 'images', 'avatar').required(),
    mimetype: Joi.string().valid(...ALLOWED_FILE_TYPES.IMAGES).required(),
    size: Joi.number().max(10 * 1024 * 1024).required() // 10MB
  }),

  videoUpload: Joi.object({
    fieldname: Joi.string().valid('video', 'videos').required(),
    mimetype: Joi.string().valid(...ALLOWED_FILE_TYPES.VIDEOS).required(),
    size: Joi.number().max(100 * 1024 * 1024).required() // 100MB
  }),

  modelUpload: Joi.object({
    fieldname: Joi.string().valid('model', 'models_3d').required(),
    mimetype: Joi.string().valid(...ALLOWED_FILE_TYPES.MODELS_3D).required(),
    size: Joi.number().max(50 * 1024 * 1024).required() // 50MB
  })
};

// ================================
// SPECIALIZED VALIDATION FUNCTIONS
// ================================

/**
 * Validate file uploads
 * @param {Array} allowedTypes - Allowed file types
 * @param {number} maxSize - Maximum file size in bytes
 * @param {number} maxCount - Maximum number of files
 * @returns {Function} Validation middleware
 */
const validateFileUploads = (allowedTypes = [], maxSize = 10 * 1024 * 1024, maxCount = 1) => {
  return (req, res, next) => {
    try {
      const files = req.files || (req.file ? [req.file] : []);
      
      if (files.length === 0) {
        return next();
      }

      if (files.length > maxCount) {
        return res.status(400).json({
          success: false,
          error: `Too many files. Maximum ${maxCount} allowed`,
          error_code: 'FILE_COUNT_EXCEEDED'
        });
      }

      for (const file of files) {
        // Check file type
        if (allowedTypes.length > 0 && !allowedTypes.includes(file.mimetype)) {
          return res.status(400).json({
            success: false,
            error: `File type ${file.mimetype} not allowed`,
            error_code: 'INVALID_FILE_TYPE',
            allowed_types: allowedTypes
          });
        }

        // Check file size
        if (file.size > maxSize) {
          return res.status(400).json({
            success: false,
            error: `File too large. Maximum ${Math.round(maxSize / 1024 / 1024)}MB allowed`,
            error_code: 'FILE_TOO_LARGE',
            max_size_mb: Math.round(maxSize / 1024 / 1024)
          });
        }
      }

      next();
    } catch (error) {
      logger.error('File validation failed:', error);
      next(new ValidationError('File validation failed'));
    }
  };
};

/**
 * Validate request contains required role
 * @param {Array} requiredRoles - Required user roles
 * @returns {Function} Validation middleware
 */
const validateUserRole = (requiredRoles = []) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          error_code: 'AUTH_REQUIRED'
        });
      }

      if (requiredRoles.length > 0 && !requiredRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          error_code: 'INSUFFICIENT_PERMISSIONS',
          required_roles: requiredRoles,
          user_role: req.user.role
        });
      }

      next();
    } catch (error) {
      logger.error('Role validation failed:', error);
      next(new ValidationError('Role validation failed'));
    }
  };
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Core validation functions
  validate,
  validateMultiple,
  
  // Common schemas
  commonSchemas,
  
  // Feature-specific schemas
  userSchemas,
  listingSchemas,
  chatSchemas,
  transactionSchemas,
  notificationSchemas,
  searchSchemas,
  adminSchemas,
  fileValidationSchemas,
  
  // Specialized validators
  validateFileUploads,
  validateUserRole,
  
  // Pre-built validation middlewares
  validatePagination: validate(commonSchemas.pagination, 'query'),
  validateSorting: validate(commonSchemas.sorting, 'query'),
  validateDateRange: validate(commonSchemas.dateRange, 'query'),
  validatePriceRange: validate(commonSchemas.priceRange, 'query'),
  validateSearch: validate(commonSchemas.search, 'query'),
  
  // User validations
  validateUserRegister: validate(userSchemas.register),
  validateUserLogin: validate(userSchemas.login),
  validateUpdateProfile: validate(userSchemas.updateProfile),
  validateChangePassword: validate(userSchemas.changePassword),
  validateForgotPassword: validate(userSchemas.forgotPassword),
  validateResetPassword: validate(userSchemas.resetPassword),
  validateVerifyEmail: validate(userSchemas.verifyEmail),
  
  // Listing validations
  validateCreateListing: validate(listingSchemas.create),
  validateUpdateListing: validate(listingSchemas.update),
  validateListingSearch: validate(listingSchemas.search, 'query'),
  validateUpdateListingStatus: validate(listingSchemas.updateStatus),
  
  // Chat validations
  validateCreateChat: validate(chatSchemas.create),
  validateSendMessage: validate(chatSchemas.sendMessage),
  validateEditMessage: validate(chatSchemas.editMessage),
  validateGetMessages: validate(chatSchemas.getMessages, 'query'),
  validateMarkRead: validate(chatSchemas.markRead),
  
  // Transaction validations
  validateCreateTransaction: validate(transactionSchemas.create),
  validateProcessPayment: validate(transactionSchemas.processPayment),
  validateUpdateShipping: validate(transactionSchemas.updateShipping),
  validateProcessRefund: validate(transactionSchemas.processRefund),
  validateInitiateDispute: validate(transactionSchemas.initiateDispute),
  
  // Search validations
  validateTextSearch: validate(searchSchemas.textSearch, 'query'),
  validateImageSearch: validate(searchSchemas.imageSearch),
  validateImageUrlSearch: validate(searchSchemas.imageUrlSearch),
  validateAutocomplete: validate(searchSchemas.autocomplete, 'query'),
  validateSaveSearch: validate(searchSchemas.saveSearch),
  
  // Notification validations
  validateGetNotifications: validate(notificationSchemas.getNotifications, 'query'),
  validateMarkAllRead: validate(notificationSchemas.markAllRead),
  validateDeleteAllNotifications: validate(notificationSchemas.deleteAll),
  validateUpdateNotificationPreferences: validate(notificationSchemas.updatePreferences),
  
  // Admin validations
  validateUserManagement: validate(adminSchemas.userManagement),
  validateListingApproval: validate(adminSchemas.listingApproval),
  validateSystemSettings: validate(adminSchemas.systemSettings),
  
  // File upload validations
  validateImages: validateFileUploads(ALLOWED_FILE_TYPES.IMAGES, 10 * 1024 * 1024, 10),
  validateVideos: validateFileUploads(ALLOWED_FILE_TYPES.VIDEOS, 100 * 1024 * 1024, 1),
  validateModels: validateFileUploads(ALLOWED_FILE_TYPES.MODELS_3D, 50 * 1024 * 1024, 3),
  validateAvatar: validateFileUploads(ALLOWED_FILE_TYPES.IMAGES, 5 * 1024 * 1024, 1)
};