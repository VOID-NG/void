// ================================
// src/validators/transactionValidator.js
// Nigerian payment and transaction validation
// ================================

const Joi = require('joi');
const { PAYMENT_METHODS, NIGERIAN_BANKS } = require('../config/paymentConfig');

/**
 * Validate transaction creation
 */
const validateCreateTransaction = Joi.object({
  listing_id: Joi.string().uuid().required()
    .messages({
      'string.uuid': 'Invalid listing ID format',
      'any.required': 'Listing ID is required'
    }),
  
  vendor_id: Joi.string().uuid().required()
    .messages({
      'string.uuid': 'Invalid vendor ID format',
      'any.required': 'Vendor ID is required'
    }),
  
  amount: Joi.number().positive().max(500000).required()
    .messages({
      'number.positive': 'Amount must be positive',
      'number.max': 'Amount cannot exceed ₦500,000',
      'any.required': 'Amount is required'
    }),
  
  payment_method: Joi.string().valid(...Object.values(PAYMENT_METHODS)).required()
    .messages({
      'any.only': 'Invalid payment method',
      'any.required': 'Payment method is required'
    }),
  
  payment_method_id: Joi.string().when('payment_method', {
    is: 'card',
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  
  shipping_address: Joi.object({
    street: Joi.string().max(255).required(),
    city: Joi.string().max(100).required(),
    state: Joi.string().max(100).required(),
    postal_code: Joi.string().max(10).optional(),
    country: Joi.string().valid('Nigeria', 'NG').default('Nigeria'),
    phone: Joi.string().pattern(/^(\+234|0)[7-9][0-1]\d{8}$/).required()
      .messages({
        'string.pattern.base': 'Invalid Nigerian phone number format'
      })
  }).required(),
  
  promotion_code: Joi.string().max(50).optional(),
  
  installments: Joi.number().integer().min(1).max(12).optional(),
  
  notes: Joi.string().max(500).optional()
});

/**
 * Validate payment processing
 */
const validateProcessPayment = Joi.object({
  payment_method_id: Joi.string().required()
    .messages({
      'any.required': 'Payment method ID is required'
    }),
  
  billing_address: Joi.object({
    street: Joi.string().max(255).required(),
    city: Joi.string().max(100).required(),
    state: Joi.string().max(100).required(),
    postal_code: Joi.string().max(10).optional(),
    country: Joi.string().valid('Nigeria', 'NG').default('Nigeria')
  }).optional(),
  
  save_payment_method: Joi.boolean().default(false),
  
  otp: Joi.string().length(6).optional()
    .messages({
      'string.length': 'OTP must be exactly 6 digits'
    }),
  
  pin: Joi.string().length(4).pattern(/^\d+$/).optional()
    .messages({
      'string.length': 'PIN must be exactly 4 digits',
      'string.pattern.base': 'PIN must contain only numbers'
    })
});

/**
 * Validate bank account for transfers
 */
const validateBankAccount = Joi.object({
  account_number: Joi.string().length(10).pattern(/^\d+$/).required()
    .messages({
      'string.length': 'Nigerian account numbers must be 10 digits',
      'string.pattern.base': 'Account number must contain only numbers',
      'any.required': 'Account number is required'
    }),
  
  bank_code: Joi.string().length(3).pattern(/^\d+$/).required()
    .messages({
      'string.length': 'Bank code must be 3 digits',
      'string.pattern.base': 'Bank code must contain only numbers',
      'any.required': 'Bank code is required'
    }),
  
  account_name: Joi.string().min(2).max(100).required()
    .messages({
      'string.min': 'Account name is too short',
      'string.max': 'Account name is too long',
      'any.required': 'Account name is required'
    })
});

/**
 * Validate mobile money payment
 */
const validateMobileMoney = Joi.object({
  phone_number: Joi.string().pattern(/^(\+234|0)[7-9][0-1]\d{8}$/).required()
    .messages({
      'string.pattern.base': 'Invalid Nigerian phone number format',
      'any.required': 'Phone number is required'
    }),
  
  network: Joi.string().valid('mtn', 'airtel', 'glo', '9mobile').required()
    .messages({
      'any.only': 'Invalid network provider',
      'any.required': 'Network provider is required'
    }),
  
  voucher_code: Joi.string().optional()
});

/**
 * Validate dispute creation
 */
const validateCreateDispute = Joi.object({
  reason: Joi.string().valid(
    'ITEM_NOT_RECEIVED',
    'ITEM_NOT_AS_DESCRIBED',
    'ITEM_DAMAGED',
    'SELLER_UNRESPONSIVE',
    'PAYMENT_ISSUE',
    'SHIPPING_ISSUE',
    'OTHER'
  ).required(),
  
  description: Joi.string().min(10).max(1000).required()
    .messages({
      'string.min': 'Description must be at least 10 characters',
      'string.max': 'Description cannot exceed 1000 characters',
      'any.required': 'Description is required'
    }),
  
  evidence_urls: Joi.array().items(Joi.string().uri()).max(10).optional(),
  
  preferred_resolution: Joi.string().valid('REFUND', 'REPLACEMENT', 'PARTIAL_REFUND', 'OTHER').optional()
});

// ================================
// src/validators/promotionValidator.js
// Promotion and discount validation
// ================================

/**
 * Validate promotion creation
 */
const validateCreatePromotion = Joi.object({
  code: Joi.string().alphanum().min(3).max(20).uppercase().required()
    .messages({
      'string.alphanum': 'Promotion code must be alphanumeric',
      'string.min': 'Promotion code must be at least 3 characters',
      'string.max': 'Promotion code cannot exceed 20 characters',
      'any.required': 'Promotion code is required'
    }),
  
  title: Joi.string().min(5).max(100).required()
    .messages({
      'string.min': 'Title must be at least 5 characters',
      'string.max': 'Title cannot exceed 100 characters',
      'any.required': 'Title is required'
    }),
  
  description: Joi.string().max(500).optional(),
  
  type: Joi.string().valid('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING', 'BUY_ONE_GET_ONE').required()
    .messages({
      'any.only': 'Invalid promotion type',
      'any.required': 'Promotion type is required'
    }),
  
  value: Joi.number().positive().when('type', {
    is: 'PERCENTAGE',
    then: Joi.max(100).required(),
    otherwise: Joi.when('type', {
      is: 'FIXED_AMOUNT',
      then: Joi.max(50000).required(),
      otherwise: Joi.optional()
    })
  }).messages({
    'number.positive': 'Value must be positive',
    'number.max': 'Percentage cannot exceed 100% or amount cannot exceed ₦50,000'
  }),
  
  min_order_amount: Joi.number().positive().optional()
    .messages({
      'number.positive': 'Minimum order amount must be positive'
    }),
  
  max_discount_amount: Joi.number().positive().optional()
    .messages({
      'number.positive': 'Maximum discount amount must be positive'
    }),
  
  usage_limit: Joi.number().integer().positive().optional()
    .messages({
      'number.integer': 'Usage limit must be a whole number',
      'number.positive': 'Usage limit must be positive'
    }),
  
  usage_limit_per_user: Joi.number().integer().positive().max(10).optional()
    .messages({
      'number.integer': 'Usage limit per user must be a whole number',
      'number.positive': 'Usage limit per user must be positive',
      'number.max': 'Usage limit per user cannot exceed 10'
    }),
  
  start_date: Joi.date().iso().required()
    .messages({
      'date.iso': 'Start date must be in ISO format',
      'any.required': 'Start date is required'
    }),
  
  end_date: Joi.date().iso().greater(Joi.ref('start_date')).required()
    .messages({
      'date.iso': 'End date must be in ISO format',
      'date.greater': 'End date must be after start date',
      'any.required': 'End date is required'
    }),
  
  applicable_categories: Joi.array().items(Joi.string()).optional(),
  
  applicable_vendors: Joi.array().items(Joi.string().uuid()).optional(),
  
  first_time_users_only: Joi.boolean().default(false),
  
  is_active: Joi.boolean().default(true)
});

/**
 * Validate promotion application
 */
const validateApplyPromotion = Joi.object({
  code: Joi.string().alphanum().min(3).max(20).uppercase().required()
    .messages({
      'string.alphanum': 'Invalid promotion code format',
      'any.required': 'Promotion code is required'
    }),
  
  order_amount: Joi.number().positive().required()
    .messages({
      'number.positive': 'Order amount must be positive',
      'any.required': 'Order amount is required'
    }),
  
  items: Joi.array().items(
    Joi.object({
      listing_id: Joi.string().uuid().required(),
      quantity: Joi.number().integer().positive().required(),
      price: Joi.number().positive().required()
    })
  ).min(1).required()
});

// ================================
// src/validators/reviewValidator.js
// Review and rating validation
// ================================

/**
 * Validate review creation
 */
const validateCreateReview = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required()
    .messages({
      'number.integer': 'Rating must be a whole number',
      'number.min': 'Rating must be at least 1 star',
      'number.max': 'Rating cannot exceed 5 stars',
      'any.required': 'Rating is required'
    }),
  
  comment: Joi.string().min(10).max(1000).required()
    .messages({
      'string.min': 'Comment must be at least 10 characters',
      'string.max': 'Comment cannot exceed 1000 characters',
      'any.required': 'Comment is required'
    }),
  
  transaction_id: Joi.string().uuid().required()
    .messages({
      'string.uuid': 'Invalid transaction ID format',
      'any.required': 'Transaction ID is required'
    }),
  
  images: Joi.array().items(Joi.string().uri()).max(5).optional()
    .messages({
      'array.max': 'Cannot upload more than 5 images'
    }),
  
  would_recommend: Joi.boolean().default(true),
  
  delivery_rating: Joi.number().integer().min(1).max(5).optional()
    .messages({
      'number.integer': 'Delivery rating must be a whole number',
      'number.min': 'Delivery rating must be at least 1 star',
      'number.max': 'Delivery rating cannot exceed 5 stars'
    }),
  
  communication_rating: Joi.number().integer().min(1).max(5).optional()
    .messages({
      'number.integer': 'Communication rating must be a whole number',
      'number.min': 'Communication rating must be at least 1 star',
      'number.max': 'Communication rating cannot exceed 5 stars'
    })
});

/**
 * Validate review response
 */
const validateReviewResponse = Joi.object({
  response: Joi.string().min(10).max(500).required()
    .messages({
      'string.min': 'Response must be at least 10 characters',
      'string.max': 'Response cannot exceed 500 characters',
      'any.required': 'Response is required'
    })
});

/**
 * Validate review update
 */
const validateUpdateReview = Joi.object({
  rating: Joi.number().integer().min(1).max(5).optional(),
  comment: Joi.string().min(10).max(1000).optional(),
  would_recommend: Joi.boolean().optional(),
  delivery_rating: Joi.number().integer().min(1).max(5).optional(),
  communication_rating: Joi.number().integer().min(1).max(5).optional()
}).min(1);

// ================================
// src/validators/searchValidator.js
// Search and filtering validation
// ================================

/**
 * Validate search query
 */
const validateSearchQuery = Joi.object({
  q: Joi.string().min(1).max(100).optional()
    .messages({
      'string.min': 'Search query cannot be empty',
      'string.max': 'Search query cannot exceed 100 characters'
    }),
  
  category: Joi.string().max(50).optional(),
  
  min_price: Joi.number().positive().optional()
    .messages({
      'number.positive': 'Minimum price must be positive'
    }),
  
  max_price: Joi.number().positive().optional()
    .messages({
      'number.positive': 'Maximum price must be positive'
    }),
  
  location: Joi.string().max(100).optional(),
  
  condition: Joi.string().valid('NEW', 'USED', 'REFURBISHED').optional(),
  
  vendor_verified: Joi.boolean().optional(),
  
  has_images: Joi.boolean().optional(),
  
  has_videos: Joi.boolean().optional(),
  
  has_3d_models: Joi.boolean().optional(),
  
  sort_by: Joi.string().valid(
    'relevance', 'price_low', 'price_high', 'newest', 'oldest', 'popular', 'rating'
  ).default('relevance'),
  
  page: Joi.number().integer().positive().max(1000).default(1)
    .messages({
      'number.integer': 'Page must be a whole number',
      'number.positive': 'Page must be positive',
      'number.max': 'Page number too high'
    }),
  
  limit: Joi.number().integer().positive().max(100).default(20)
    .messages({
      'number.integer': 'Limit must be a whole number',
      'number.positive': 'Limit must be positive',
      'number.max': 'Limit cannot exceed 100'
    })
}).custom((value, helpers) => {
  // Validate that max_price is greater than min_price
  if (value.min_price && value.max_price && value.min_price >= value.max_price) {
    return helpers.error('custom.price_range', {
      message: 'Maximum price must be greater than minimum price'
    });
  }
  return value;
});

/**
 * Validate image search
 */
const validateImageSearch = Joi.object({
  image_url: Joi.string().uri().optional(),
  
  image_base64: Joi.string().base64().optional(),
  
  similarity_threshold: Joi.number().min(0).max(1).default(0.8)
    .messages({
      'number.min': 'Similarity threshold must be between 0 and 1',
      'number.max': 'Similarity threshold must be between 0 and 1'
    }),
  
  max_results: Joi.number().integer().positive().max(50).default(10)
    .messages({
      'number.integer': 'Max results must be a whole number',
      'number.positive': 'Max results must be positive',
      'number.max': 'Max results cannot exceed 50'
    }),
  
  include_metadata: Joi.boolean().default(false)
}).or('image_url', 'image_base64')
  .messages({
    'object.missing': 'Either image_url or image_base64 is required'
  });

/**
 * Validate autocomplete request
 */
const validateAutocomplete = Joi.object({
  q: Joi.string().min(1).max(50).required()
    .messages({
      'string.min': 'Query cannot be empty',
      'string.max': 'Query cannot exceed 50 characters',
      'any.required': 'Query is required'
    }),
  
  limit: Joi.number().integer().positive().max(20).default(10)
    .messages({
      'number.integer': 'Limit must be a whole number',
      'number.positive': 'Limit must be positive',
      'number.max': 'Limit cannot exceed 20'
    }),
  
  include_history: Joi.boolean().default(true),
  
  include_popular: Joi.boolean().default(true)
});

// ================================
// src/validators/subscriptionValidator.js
// Vendor subscription validation
// ================================

/**
 * Validate subscription creation
 */
const validateCreateSubscription = Joi.object({
  plan: Joi.string().valid('BASIC', 'PREMIUM', 'ENTERPRISE').required()
    .messages({
      'any.only': 'Invalid subscription plan',
      'any.required': 'Subscription plan is required'
    }),
  
  billing_cycle: Joi.string().valid('MONTHLY', 'QUARTERLY', 'YEARLY').default('MONTHLY')
    .messages({
      'any.only': 'Invalid billing cycle'
    }),
  
  payment_method_id: Joi.string().required()
    .messages({
      'any.required': 'Payment method is required'
    }),
  
  auto_renew: Joi.boolean().default(true),
  
  promotional_code: Joi.string().alphanum().max(20).optional()
});

/**
 * Validate subscription update
 */
const validateUpdateSubscription = Joi.object({
  plan: Joi.string().valid('BASIC', 'PREMIUM', 'ENTERPRISE').optional(),
  
  billing_cycle: Joi.string().valid('MONTHLY', 'QUARTERLY', 'YEARLY').optional(),
  
  auto_renew: Joi.boolean().optional(),
  
  payment_method_id: Joi.string().optional()
}).min(1);

/**
 * Validate subscription cancellation
 */
const validateCancelSubscription = Joi.object({
  reason: Joi.string().valid(
    'TOO_EXPENSIVE',
    'NOT_USING',
    'SWITCHING_PROVIDER',
    'TECHNICAL_ISSUES',
    'POOR_SUPPORT',
    'OTHER'
  ).required(),
  
  feedback: Joi.string().max(500).optional(),
  
  cancel_immediately: Joi.boolean().default(false)
});

// ================================
// VALIDATION MIDDLEWARE
// ================================

/**
 * Create validation middleware
 */
const createValidationMiddleware = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
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

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errorDetails,
        message: 'Please check your input and try again'
      });
    }

    // Replace req.body with validated and sanitized data
    req.body = value;
    next();
  };
};

/**
 * Create query validation middleware
 */
const createQueryValidationMiddleware = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
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

      return res.status(400).json({
        success: false,
        error: 'Query validation failed',
        details: errorDetails
      });
    }

    req.query = value;
    next();
  };
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Transaction validators
  validateCreateTransaction: createValidationMiddleware(validateCreateTransaction),
  validateProcessPayment: createValidationMiddleware(validateProcessPayment),
  validateBankAccount: createValidationMiddleware(validateBankAccount),
  validateMobileMoney: createValidationMiddleware(validateMobileMoney),
  validateCreateDispute: createValidationMiddleware(validateCreateDispute),

  // Promotion validators
  validateCreatePromotion: createValidationMiddleware(validateCreatePromotion),
  validateApplyPromotion: createValidationMiddleware(validateApplyPromotion),

  // Review validators
  validateCreateReview: createValidationMiddleware(validateCreateReview),
  validateReviewResponse: createValidationMiddleware(validateReviewResponse),
  validateUpdateReview: createValidationMiddleware(validateUpdateReview),

  // Search validators
  validateSearchQuery: createQueryValidationMiddleware(validateSearchQuery),
  validateImageSearch: createValidationMiddleware(validateImageSearch),
  validateAutocomplete: createQueryValidationMiddleware(validateAutocomplete),

  // Subscription validators
  validateCreateSubscription: createValidationMiddleware(validateCreateSubscription),
  validateUpdateSubscription: createValidationMiddleware(validateUpdateSubscription),
  validateCancelSubscription: createValidationMiddleware(validateCancelSubscription),

  // Raw schemas for custom validation
  schemas: {
    createTransaction: validateCreateTransaction,
    processPayment: validateProcessPayment,
    bankAccount: validateBankAccount,
    mobileMoney: validateMobileMoney,
    createDispute: validateCreateDispute,
    createPromotion: validateCreatePromotion,
    applyPromotion: validateApplyPromotion,
    createReview: validateCreateReview,
    reviewResponse: validateReviewResponse,
    updateReview: validateUpdateReview,
    searchQuery: validateSearchQuery,
    imageSearch: validateImageSearch,
    autocomplete: validateAutocomplete,
    createSubscription: validateCreateSubscription,
    updateSubscription: validateUpdateSubscription,
    cancelSubscription: validateCancelSubscription
  }
};