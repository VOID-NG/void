// apps/backend/src/validators/searchValidator.js
// Comprehensive Search Request Validation Schemas

const Joi = require('joi');

// ================================
// COMMON VALIDATION PATTERNS
// ================================

const commonPatterns = {
  // Search query validation
  searchQuery: Joi.string()
    .trim()
    .min(1)
    .max(500)
    .pattern(/^[a-zA-Z0-9\s\-_.,!?'"()]+$/)
    .messages({
      'string.pattern.base': 'Search query contains invalid characters',
      'string.min': 'Search query must be at least 1 character',
      'string.max': 'Search query must be less than 500 characters'
    }),

  // Category ID validation
  categoryId: Joi.string()
    .guid({ version: 'uuidv4' })
    .messages({
      'string.guid': 'Category ID must be a valid UUID'
    }),

  // Price validation
  price: Joi.number()
    .min(0)
    .max(1000000)
    .precision(2)
    .messages({
      'number.min': 'Price must be at least 0',
      'number.max': 'Price must be less than $1,000,000',
      'number.precision': 'Price can have at most 2 decimal places'
    }),

  // Condition validation
  condition: Joi.string()
    .valid('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR', 'FOR_PARTS')
    .messages({
      'any.only': 'Condition must be one of: NEW, LIKE_NEW, GOOD, FAIR, POOR, FOR_PARTS'
    }),

  // Location validation
  location: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .pattern(/^[a-zA-Z0-9\s\-.,]+$/)
    .messages({
      'string.pattern.base': 'Location contains invalid characters',
      'string.min': 'Location must be at least 2 characters',
      'string.max': 'Location must be less than 100 characters'
    }),

  // Pagination validation
  pagination: Joi.object({
    page: Joi.number().integer().min(1).max(1000).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort_by: Joi.string().valid(
      'created_at', 'updated_at', 'price', 'title', 
      'views_count', 'likes_count', 'relevance'
    ).default('relevance'),
    sort_order: Joi.string().valid('asc', 'desc').default('desc')
  }),

  // Filters validation
  filters: Joi.object({
    category_id: Joi.string().guid({ version: 'uuidv4' }).optional(),
    min_price: Joi.number().min(0).max(1000000).precision(2).optional(),
    max_price: Joi.number().min(0).max(1000000).precision(2).optional(),
    condition: Joi.string().valid('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR', 'FOR_PARTS').optional(),
    location: Joi.string().trim().min(2).max(100).optional(),
    vendor_id: Joi.string().guid({ version: 'uuidv4' }).optional(),
    is_featured: Joi.boolean().optional(),
    tags: Joi.array().items(Joi.string().trim().min(1).max(50)).max(10).optional()
  }).custom((value, helpers) => {
    // Validate price range
    if (value.min_price !== undefined && value.max_price !== undefined) {
      if (value.min_price >= value.max_price) {
        return helpers.error('custom.invalidPriceRange');
      }
    }
    return value;
  }).messages({
    'custom.invalidPriceRange': 'Minimum price must be less than maximum price'
  }),

  // Image URL validation
  imageUrl: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .max(2048)
    .pattern(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)
    .messages({
      'string.uri': 'Image URL must be a valid HTTP/HTTPS URL',
      'string.pattern.base': 'Image URL must point to a valid image file (jpg, jpeg, png, gif, webp, bmp)',
      'string.max': 'Image URL must be less than 2048 characters'
    }),

  // Time frame validation
  timeframe: Joi.string()
    .valid('1h', '24h', '7d', '30d')
    .default('24h')
    .messages({
      'any.only': 'Timeframe must be one of: 1h, 24h, 7d, 30d'
    })
};

// ================================
// SEARCH VALIDATION SCHEMAS
// ================================

const searchValidators = {
  // Text search validation
  textSearch: Joi.object({
    q: commonPatterns.searchQuery.optional(),
    category: commonPatterns.categoryId.optional(),
    min_price: commonPatterns.price.optional(),
    max_price: commonPatterns.price.optional(),
    condition: commonPatterns.condition.optional(),
    location: commonPatterns.location.optional(),
    vendor_id: Joi.string().guid({ version: 'uuidv4' }).optional(),
    is_featured: Joi.boolean().optional(),
    page: Joi.number().integer().min(1).max(1000).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort_by: Joi.string().valid(
      'created_at', 'updated_at', 'price', 'title', 
      'views_count', 'likes_count', 'relevance'
    ).default('relevance'),
    sort_order: Joi.string().valid('asc', 'desc').default('desc')
  }).custom((value, helpers) => {
    // Validate price range
    if (value.min_price !== undefined && value.max_price !== undefined) {
      if (value.min_price >= value.max_price) {
        return helpers.error('custom.invalidPriceRange');
      }
    }
    return value;
  }).messages({
    'custom.invalidPriceRange': 'Minimum price must be less than maximum price'
  }),

  // Advanced search validation
  advancedSearch: Joi.object({
    query: commonPatterns.searchQuery.required(),
    filters: commonPatterns.filters.default({}),
    pagination: commonPatterns.pagination.default({}),
    requireAI: Joi.boolean().default(false),
    analysisDepth: Joi.string()
      .valid('standard', 'deep', 'market_analysis')
      .default('standard')
      .messages({
        'any.only': 'Analysis depth must be one of: standard, deep, market_analysis'
      }),
    includeMarketData: Joi.boolean().default(false),
    includePriceEstimate: Joi.boolean().default(false),
    includeSearchOptimization: Joi.boolean().default(true)
  }),

  // Image search validation
  imageSearch: Joi.object({
    category: commonPatterns.categoryId.optional(),
    min_price: commonPatterns.price.optional(),
    max_price: commonPatterns.price.optional(),
    condition: commonPatterns.condition.optional(),
    location: commonPatterns.location.optional(),
    page: Joi.number().integer().min(1).max(1000).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    includeAnalysis: Joi.boolean().default(true),
    analysisDepth: Joi.string()
      .valid('basic', 'detailed', 'comprehensive')
      .default('detailed')
  }).custom((value, helpers) => {
    // Validate price range
    if (value.min_price !== undefined && value.max_price !== undefined) {
      if (value.min_price >= value.max_price) {
        return helpers.error('custom.invalidPriceRange');
      }
    }
    return value;
  }),

  // Image URL search validation
  imageUrlSearch: Joi.object({
    image_url: commonPatterns.imageUrl.required(),
    category: commonPatterns.categoryId.optional(),
    min_price: commonPatterns.price.optional(),
    max_price: commonPatterns.price.optional(),
    condition: commonPatterns.condition.optional(),
    location: commonPatterns.location.optional(),
    page: Joi.number().integer().min(1).max(1000).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    includeAnalysis: Joi.boolean().default(true),
    analysisDepth: Joi.string()
      .valid('basic', 'detailed', 'comprehensive')
      .default('detailed')
  }),

  // Autocomplete validation
  autocomplete: Joi.object({
    q: Joi.string()
      .trim()
      .min(1)
      .max(100)
      .required()
      .messages({
        'string.min': 'Query must be at least 1 character for autocomplete',
        'string.max': 'Query must be less than 100 characters',
        'any.required': 'Query parameter (q) is required for autocomplete'
      }),
    limit: Joi.number().integer().min(1).max(50).default(10),
    include_suggestions: Joi.boolean().default(true),
    include_products: Joi.boolean().default(true),
    include_categories: Joi.boolean().default(true)
  }),

  // Trending searches validation
  trending: Joi.object({
    limit: Joi.number().integer().min(1).max(100).default(10),
    timeframe: commonPatterns.timeframe,
    include_queries: Joi.boolean().default(true),
    include_suggestions: Joi.boolean().default(true)
  }),

  // Search click tracking validation
  trackClick: Joi.object({
    search_id: Joi.string()
      .trim()
      .min(1)
      .max(255)
      .required()
      .messages({
        'any.required': 'Search ID is required for click tracking'
      }),
    listing_id: Joi.string()
      .guid({ version: 'uuidv4' })
      .required()
      .messages({
        'any.required': 'Listing ID is required for click tracking',
        'string.guid': 'Listing ID must be a valid UUID'
      }),
    position: Joi.number()
      .integer()
      .min(1)
      .max(1000)
      .required()
      .messages({
        'any.required': 'Position is required for click tracking',
        'number.min': 'Position must be at least 1',
        'number.max': 'Position must be less than 1000'
      }),
    result_type: Joi.string()
      .valid('listing', 'suggestion', 'category')
      .default('listing'),
    query: Joi.string().trim().max(500).optional()
  }),

  // Save search validation
  saveSearch: Joi.object({
    query: commonPatterns.searchQuery.required(),
    filters: commonPatterns.filters.default({}),
    name: Joi.string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .messages({
        'string.min': 'Search name must be at least 1 character',
        'string.max': 'Search name must be less than 100 characters'
      }),
    is_active: Joi.boolean().default(true),
    notify_on_results: Joi.boolean().default(false)
  }),

  // Query analysis validation
  analyzeQuery: Joi.object({
    query: commonPatterns.searchQuery.required(),
    context: Joi.object({
      userId: Joi.string().guid({ version: 'uuidv4' }).optional(),
      userPreferences: Joi.object().optional(),
      recentSearches: Joi.array().items(Joi.string()).max(10).optional(),
      location: commonPatterns.location.optional(),
      device: Joi.string().valid('mobile', 'tablet', 'desktop').optional()
    }).default({})
  }),

  // Metrics validation
  getMetrics: Joi.object({
    timeframe: commonPatterns.timeframe,
    include_performance: Joi.boolean().default(true),
    include_queries: Joi.boolean().default(true),
    include_strategies: Joi.boolean().default(true)
  }),

  // Similar listings validation
  similarListings: Joi.object({
    listingId: Joi.string()
      .guid({ version: 'uuidv4' })
      .required()
      .messages({
        'any.required': 'Listing ID is required',
        'string.guid': 'Listing ID must be a valid UUID'
      })
  }),

  // Search preferences validation (for user settings)
  searchPreferences: Joi.object({
    preferred_categories: Joi.array()
      .items(Joi.string().guid({ version: 'uuidv4' }))
      .max(20)
      .default([]),
    preferred_price_range: Joi.object({
      min: commonPatterns.price.default(0),
      max: commonPatterns.price.default(1000000)
    }).default({ min: 0, max: 1000000 }),
    preferred_conditions: Joi.array()
      .items(commonPatterns.condition)
      .max(6)
      .default([]),
    preferred_locations: Joi.array()
      .items(commonPatterns.location)
      .max(10)
      .default([]),
    search_radius_km: Joi.number()
      .integer()
      .min(1)
      .max(1000)
      .default(50),
    enable_ai_suggestions: Joi.boolean().default(true),
    enable_image_search: Joi.boolean().default(true),
    enable_notifications: Joi.boolean().default(false),
    language_preference: Joi.string()
      .valid('en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ko')
      .default('en')
  })
};

// ================================
// BULK VALIDATION UTILITIES
// ================================

/**
 * Validate multiple search requests (for batch operations)
 */
const validateBulkSearch = Joi.object({
  searches: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().required(),
        query: commonPatterns.searchQuery.optional(),
        imageUrl: commonPatterns.imageUrl.optional(),
        filters: commonPatterns.filters.default({})
      }).or('query', 'imageUrl') // At least one of query or imageUrl is required
    )
    .min(1)
    .max(10)
    .required(),
  options: Joi.object({
    requireAI: Joi.boolean().default(false),
    maxConcurrent: Joi.number().integer().min(1).max(5).default(3),
    timeout: Joi.number().integer().min(1000).max(30000).default(10000)
  }).default({})
});

// ================================
// CUSTOM VALIDATION HELPERS
// ================================

/**
 * Validate file upload for image search
 */
const validateImageUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'Image file is required',
      error_code: 'MISSING_IMAGE_FILE'
    });
  }

  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (!allowedTypes.includes(req.file.mimetype)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image format. Allowed: JPEG, PNG, GIF, WebP',
      error_code: 'INVALID_IMAGE_FORMAT',
      allowedFormats: allowedTypes
    });
  }

  if (req.file.size > maxSize) {
    return res.status(400).json({
      success: false,
      error: 'Image file too large. Maximum size: 10MB',
      error_code: 'IMAGE_TOO_LARGE',
      maxSize: '10MB',
      receivedSize: `${Math.round(req.file.size / 1024 / 1024 * 100) / 100}MB`
    });
  }

  next();
};

/**
 * Validate search rate limits
 */
const validateSearchRateLimit = (req, res, next) => {
  const { tryConsume } = require('../utils/rateLimiter');
  
  // Different rate limits for different types of searches
  const limits = {
    text: { rpm: 60, burst: 10 },
    image: { rpm: 20, burst: 3 },
    ai: { rpm: 10, burst: 2 }
  };

  const searchType = req.route.path.includes('image') ? 'image' :
                     req.body?.requireAI ? 'ai' : 'text';
  
  const limit = limits[searchType];
  const identifier = req.user?.id || req.ip;
  
  const rateLimitResult = tryConsume(`search_${searchType}_${identifier}`, limit.rpm);
  
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      success: false,
      error: 'Search rate limit exceeded',
      error_code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(rateLimitResult.waitMs / 1000),
      limits: {
        type: searchType,
        requestsPerMinute: limit.rpm,
        burstAllowed: limit.burst
      }
    });
  }

  // Add rate limit info to response headers
  res.set({
    'X-RateLimit-Type': searchType,
    'X-RateLimit-Limit': limit.rpm,
    'X-RateLimit-Remaining': limit.rpm - rateLimitResult.requestCount,
    'X-RateLimit-Reset': new Date(Date.now() + 60000).toISOString()
  });

  next();
};

// ================================
// EXPORTS
// ================================

module.exports = {
  searchValidators,
  validateBulkSearch,
  validateImageUpload,
  validateSearchRateLimit,
  commonPatterns
};