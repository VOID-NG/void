// apps/backend/src/validators/listingValidator.js
// Validation schemas for listing endpoints

const { Joi, validate, commonSchemas, patterns, decimalValidator, tagsValidator } = require('../middleware/validateMiddleware');
const { LISTING_CONDITION, LISTING_STATUS, BUSINESS_RULES } = require('../config/constants');

// ================================
// LISTING CREATION VALIDATION
// ================================

const createListingSchema = {
  body: Joi.object({
    title: Joi.string()
      .min(5)
      .max(BUSINESS_RULES.LISTING_TITLE_MAX_LENGTH)
      .trim()
      .required()
      .messages({
        'string.min': 'Title must be at least 5 characters long',
        'string.max': `Title must not exceed ${BUSINESS_RULES.LISTING_TITLE_MAX_LENGTH} characters`
      }),
    
    description: Joi.string()
      .min(20)
      .max(BUSINESS_RULES.LISTING_DESCRIPTION_MAX_LENGTH)
      .trim()
      .required()
      .messages({
        'string.min': 'Description must be at least 20 characters long',
        'string.max': `Description must not exceed ${BUSINESS_RULES.LISTING_DESCRIPTION_MAX_LENGTH} characters`
      }),
    
    price: decimalValidator(2)
      .min(BUSINESS_RULES.MIN_LISTING_PRICE)
      .max(BUSINESS_RULES.MAX_LISTING_PRICE)
      .required()
      .messages({
        'number.min': `Price must be at least $${BUSINESS_RULES.MIN_LISTING_PRICE}`,
        'number.max': `Price must not exceed $${BUSINESS_RULES.MAX_LISTING_PRICE}`
      }),
    
    condition: Joi.string()
      .valid(...Object.values(LISTING_CONDITION))
      .required()
      .messages({
        'any.only': 'Condition must be one of: NEW, LIKE_NEW, GOOD, FAIR, POOR'
      }),
    
    category_id: commonSchemas.id.required()
      .messages({
        'string.empty': 'Category is required'
      }),
    
    quantity: Joi.number()
      .integer()
      .min(1)
      .max(10000)
      .default(1)
      .messages({
        'number.min': 'Quantity must be at least 1',
        'number.max': 'Quantity cannot exceed 10,000'
      }),
    
    sku: Joi.string()
      .max(50)
      .trim()
      .optional()
      .allow('')
      .messages({
        'string.max': 'SKU must not exceed 50 characters'
      }),
    
    tags: tagsValidator.messages({
      'array.max': `You can add up to ${BUSINESS_RULES.MAX_TAGS_PER_LISTING} tags`,
      'string.max': `Each tag must not exceed ${BUSINESS_RULES.TAG_MAX_LENGTH} characters`
    }),
    
    weight: Joi.number()
      .min(0)
      .max(10000)
      .precision(2)
      .optional()
      .messages({
        'number.min': 'Weight cannot be negative',
        'number.max': 'Weight cannot exceed 10,000 kg'
      }),
    
    dimensions: Joi.string()
      .max(200)
      .trim()
      .optional()
      .allow('')
      .pattern(/^[\d\s.,x×*-]+$/)
      .messages({
        'string.max': 'Dimensions must not exceed 200 characters',
        'string.pattern.base': 'Dimensions can only contain numbers, spaces, and separators (x, ×, *, -, .)'
      }),
    
    location: Joi.string()
      .max(100)
      .trim()
      .optional()
      .allow('')
      .messages({
        'string.max': 'Location must not exceed 100 characters'
      }),
    
    is_negotiable: Joi.boolean()
      .default(true)
      .messages({
        'boolean.base': 'Negotiable must be true or false'
      }),
    
    // Admin-only fields
    is_featured: Joi.boolean()
      .optional()
      .messages({
        'boolean.base': 'Featured must be true or false'
      }),
    
    status: Joi.string()
      .valid(...Object.values(LISTING_STATUS))
      .optional()
      .messages({
        'any.only': 'Status must be one of: DRAFT, PENDING_APPROVAL, ACTIVE, SOLD, REMOVED, REJECTED'
      })
  })
};

// ================================
// LISTING UPDATE VALIDATION
// ================================

const updateListingSchema = {
  body: Joi.object({
    title: Joi.string()
      .min(5)
      .max(BUSINESS_RULES.LISTING_TITLE_MAX_LENGTH)
      .trim()
      .optional(),
    
    description: Joi.string()
      .min(20)
      .max(BUSINESS_RULES.LISTING_DESCRIPTION_MAX_LENGTH)
      .trim()
      .optional(),
    
    price: decimalValidator(2)
      .min(BUSINESS_RULES.MIN_LISTING_PRICE)
      .max(BUSINESS_RULES.MAX_LISTING_PRICE)
      .optional(),
    
    condition: Joi.string()
      .valid(...Object.values(LISTING_CONDITION))
      .optional(),
    
    category_id: commonSchemas.id.optional(),
    
    quantity: Joi.number()
      .integer()
      .min(1)
      .max(10000)
      .optional(),
    
    sku: Joi.string()
      .max(50)
      .trim()
      .optional()
      .allow(''),
    
    tags: tagsValidator,
    
    weight: Joi.number()
      .min(0)
      .max(10000)
      .precision(2)
      .optional(),
    
    dimensions: Joi.string()
      .max(200)
      .trim()
      .optional()
      .allow('')
      .pattern(/^[\d\s.,x×*-]+$/),
    
    location: Joi.string()
      .max(100)
      .trim()
      .optional()
      .allow(''),
    
    is_negotiable: Joi.boolean().optional(),
    
    is_featured: Joi.boolean().optional()
  }).min(1).messages({
    'object.min': 'At least one field must be provided for update'
  })
};

// ================================
// LISTING SEARCH/FILTER VALIDATION
// ================================

const searchListingsSchema = {
  query: Joi.object({
    // Pagination
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().valid(
      'created_at', 'updated_at', 'price', 'title', 'views_count', 'likes_count'
    ).default('created_at'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    
    // Search filters
    search: Joi.string().min(2).max(100).trim().optional(),
    category: commonSchemas.optionalId,
    vendor: commonSchemas.optionalId,
    condition: Joi.string().valid(...Object.values(LISTING_CONDITION)).optional(),
    
    // Price filters
    minPrice: Joi.number().min(0).precision(2).optional(),
    maxPrice: Joi.number().min(0).precision(2).optional(),
    
    // Other filters
    location: Joi.string().max(100).trim().optional(),
    negotiable: Joi.boolean().optional(),
    featured: Joi.boolean().optional(),
    tags: Joi.alternatives().try(
      Joi.string().trim(),
      Joi.array().items(Joi.string().trim()).max(10)
    ).optional(),
    
    // Status filter (admin only)
    status: Joi.string().valid(...Object.values(LISTING_STATUS)).optional()
  }).custom((value, helpers) => {
    // Validate price range
    if (value.minPrice && value.maxPrice && value.minPrice > value.maxPrice) {
      return helpers.error('custom.invalidPriceRange');
    }
    return value;
  }).messages({
    'custom.invalidPriceRange': 'Minimum price cannot be greater than maximum price'
  })
};

// ================================
// LISTING STATUS UPDATE VALIDATION (Admin)
// ================================

const updateListingStatusSchema = {
  body: Joi.object({
    status: Joi.string()
      .valid(...Object.values(LISTING_STATUS))
      .required()
      .messages({
        'any.only': 'Status must be one of: DRAFT, PENDING_APPROVAL, ACTIVE, SOLD, REMOVED, REJECTED',
        'string.empty': 'Status is required'
      }),
    
    reason: Joi.string()
      .max(500)
      .trim()
      .optional()
      .messages({
        'string.max': 'Reason must not exceed 500 characters'
      })
  })
};

// ================================
// MEDIA UPLOAD VALIDATION
// ================================

const addMediaSchema = {
  body: Joi.object({
    // Optional metadata for media uploads
    alt_text: Joi.string().max(200).trim().optional(),
    caption: Joi.string().max(500).trim().optional()
  })
};

const removeMediaSchema = {
  params: Joi.object({
    id: commonSchemas.id,
    mediaId: commonSchemas.id
  }),
  query: Joi.object({
    type: Joi.string().valid('image', 'video', 'model').required()
  })
};

// ================================
// LISTING INTERACTION VALIDATION
// ================================

const shareListingSchema = {
  body: Joi.object({
    platform: Joi.string()
      .valid('facebook', 'twitter', 'instagram', 'whatsapp', 'email', 'copy_link', 'other')
      .default('copy_link'),
    
    method: Joi.string()
      .valid('social_share', 'direct_link', 'email', 'qr_code')
      .default('direct_link')
  })
};

// ================================
// BULK OPERATIONS VALIDATION
// ================================

const bulkUpdateListingsSchema = {
  body: Joi.object({
    listing_ids: Joi.array()
      .items(commonSchemas.id)
      .min(1)
      .max(50)
      .unique()
      .required()
      .messages({
        'array.min': 'At least one listing ID is required',
        'array.max': 'Cannot update more than 50 listings at once',
        'array.unique': 'Duplicate listing IDs are not allowed'
      }),
    
    action: Joi.string()
      .valid('activate', 'deactivate', 'feature', 'unfeature', 'delete')
      .required(),
    
    reason: Joi.string()
      .max(500)
      .trim()
      .optional()
  })
};

// ================================
// ANALYTICS VALIDATION
// ================================

const analyticsQuerySchema = {
  query: Joi.object({
    period: Joi.string()
      .valid('7d', '30d', '90d', '1y', 'all')
      .default('30d'),
    
    metrics: Joi.alternatives().try(
      Joi.string().valid('views', 'likes', 'shares', 'chats', 'all'),
      Joi.array().items(Joi.string().valid('views', 'likes', 'shares', 'chats')).unique()
    ).default('all'),
    
    groupBy: Joi.string()
      .valid('day', 'week', 'month')
      .default('day')
  })
};

// ================================
// CATEGORY VALIDATION
// ================================

const categoryFilterSchema = {
  query: Joi.object({
    include_count: Joi.boolean().default(false),
    parent_only: Joi.boolean().default(false)
  })
};

// ================================
// VALIDATION MIDDLEWARE EXPORTS
// ================================

module.exports = {
  // Main CRUD validations
  validateCreateListing: validate(createListingSchema),
  validateUpdateListing: validate(updateListingSchema),
  validateSearchListings: validate(searchListingsSchema),
  
  // Admin validations
  validateUpdateListingStatus: validate(updateListingStatusSchema),
  validateBulkUpdateListings: validate(bulkUpdateListingsSchema),
  
  // Media validations
  validateAddMedia: validate(addMediaSchema),
  validateRemoveMedia: validate(removeMediaSchema),
  
  // Interaction validations
  validateShareListing: validate(shareListingSchema),
  
  // Analytics validations
  validateAnalyticsQuery: validate(analyticsQuerySchema),
  
  // Category validations
  validateCategoryFilter: validate(categoryFilterSchema),
  
  // Common validations
  validateListingId: validate({
    params: Joi.object({
      id: commonSchemas.id
    })
  }),
  
  validatePagination: validate({
    query: Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20)
    })
  }),
  
  // Raw schemas for external use
  schemas: {
    createListing: createListingSchema,
    updateListing: updateListingSchema,
    searchListings: searchListingsSchema,
    updateListingStatus: updateListingStatusSchema,
    addMedia: addMediaSchema,
    removeMedia: removeMediaSchema,
    shareListing: shareListingSchema,
    bulkUpdateListings: bulkUpdateListingsSchema,
    analyticsQuery: analyticsQuerySchema,
    categoryFilter: categoryFilterSchema
  }
};