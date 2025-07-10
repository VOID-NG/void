// apps/backend/src/validators/searchValidator.js
// Validation schemas for search endpoints

const Joi = require('joi');

// ================================
// COMMON SCHEMAS
// ================================

const paginationSchema = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
};

const priceFilterSchema = {
  min_price: Joi.number().min(0).max(1000000),
  max_price: Joi.number().min(0).max(1000000)
};

// ================================
// TEXT SEARCH VALIDATION
// ================================

const textSearch = {
  query: {
    q: Joi.string()
      .min(1)
      .max(100)
      .required()
      .trim()
      .messages({
        'string.min': 'Search query must be at least 1 character long',
        'string.max': 'Search query cannot exceed 100 characters',
        'any.required': 'Search query (q) is required'
      }),
    
    ...paginationSchema,
    ...priceFilterSchema,
    
    category_id: Joi.string().uuid().optional(),
    
    condition: Joi.string()
      .valid('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR')
      .optional(),
    
    location: Joi.string()
      .max(100)
      .optional()
      .trim(),
    
    sort_by: Joi.string()
      .valid('relevance', 'price_asc', 'price_desc', 'created_at', 'popularity')
      .default('relevance')
      .optional(),
    
    include_sold: Joi.boolean()
      .default(false)
      .optional()
  }
};

// ================================
// IMAGE SEARCH VALIDATION
// ================================

const imageSearch = {
  body: {
    image_url: Joi.string()
      .uri()
      .optional()
      .messages({
        'string.uri': 'image_url must be a valid URL'
      }),
    
    image_description: Joi.string()
      .min(3)
      .max(500)
      .optional()
      .trim()
      .messages({
        'string.min': 'Image description must be at least 3 characters long',
        'string.max': 'Image description cannot exceed 500 characters'
      }),
    
    limit: Joi.number()
      .integer()
      .min(1)
      .max(50)
      .default(20)
      .optional(),
    
    similarity_threshold: Joi.number()
      .min(0)
      .max(1)
      .default(0.7)
      .optional()
  }
}.refine(
  (data) => data.image_url || data.image_description,
  {
    message: 'Either image_url or image_description must be provided',
    path: ['image_url']
  }
);

// ================================
// AUTOCOMPLETE VALIDATION
// ================================

const autocomplete = {
  query: {
    q: Joi.string()
      .min(1)
      .max(50)
      .required()
      .trim()
      .messages({
        'string.min': 'Query must be at least 1 character long',
        'string.max': 'Query cannot exceed 50 characters',
        'any.required': 'Query parameter (q) is required'
      }),
    
    limit: Joi.number()
      .integer()
      .min(1)
      .max(20)
      .default(10)
      .optional(),
    
    include_categories: Joi.boolean()
      .default(true)
      .optional(),
    
    include_popular: Joi.boolean()
      .default(true)
      .optional()
  }
};

// ================================
// RECOMMENDATIONS VALIDATION
// ================================

const recommendations = {
  query: {
    type: Joi.string()
      .valid('trending', 'popular', 'recent', 'similar', 'personalized')
      .default('trending')
      .optional(),
    
    limit: Joi.number()
      .integer()
      .min(1)
      .max(50)
      .default(10)
      .optional(),
    
    category_id: Joi.string()
      .uuid()
      .optional(),
    
    exclude_listing_id: Joi.string()
      .uuid()
      .optional(),
    
    time_range: Joi.string()
      .valid('24h', '7d', '30d', 'all')
      .default('7d')
      .optional()
  }
};

// ================================
// CLICK TRACKING VALIDATION
// ================================

const trackClick = {
  body: {
    search_query: Joi.string()
      .min(1)
      .max(100)
      .required()
      .trim()
      .messages({
        'string.min': 'Search query must be at least 1 character long',
        'string.max': 'Search query cannot exceed 100 characters',
        'any.required': 'search_query is required'
      }),
    
    listing_id: Joi.string()
      .uuid()
      .required()
      .messages({
        'string.uuid': 'listing_id must be a valid UUID',
        'any.required': 'listing_id is required'
      }),
    
    search_type: Joi.string()
      .valid('text', 'image', 'similar', 'recommendation')
      .default('text')
      .optional(),
    
    result_position: Joi.number()
      .integer()
      .min(1)
      .max(1000)
      .optional(),
    
    search_session_id: Joi.string()
      .uuid()
      .optional(),
    
    additional_metadata: Joi.object()
      .optional()
  }
};

// ================================
// SIMILAR SEARCH VALIDATION
// ================================

const similarSearch = {
  body: {
    listing_id: Joi.string()
      .uuid()
      .required()
      .messages({
        'string.uuid': 'listing_id must be a valid UUID',
        'any.required': 'listing_id is required'
      }),
    
    limit: Joi.number()
      .integer()
      .min(1)
      .max(50)
      .default(10)
      .optional(),
    
    similarity_method: Joi.string()
      .valid('text', 'image', 'combined')
      .default('text')
      .optional(),
    
    include_same_vendor: Joi.boolean()
      .default(false)
      .optional(),
    
    category_only: Joi.boolean()
      .default(false)
      .optional()
  }
};

// ================================
// ADVANCED SEARCH VALIDATION
// ================================

const advancedSearch = {
  body: {
    text_query: Joi.string()
      .max(100)
      .optional()
      .trim(),
    
    image_query: Joi.object({
      url: Joi.string().uri().optional(),
      description: Joi.string().max(200).optional()
    }).optional(),
    
    filters: Joi.object({
      category_ids: Joi.array()
        .items(Joi.string().uuid())
        .max(10)
        .optional(),
      
      price_range: Joi.object({
        min: Joi.number().min(0),
        max: Joi.number().min(0)
      }).optional(),
      
      conditions: Joi.array()
        .items(Joi.string().valid('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR'))
        .max(5)
        .optional(),
      
      locations: Joi.array()
        .items(Joi.string().max(100))
        .max(10)
        .optional(),
      
      vendor_verified: Joi.boolean().optional(),
      
      has_images: Joi.boolean().optional(),
      
      has_videos: Joi.boolean().optional(),
      
      has_3d_models: Joi.boolean().optional(),
      
      created_after: Joi.date().iso().optional(),
      
      created_before: Joi.date().iso().optional()
    }).optional(),
    
    sort: Joi.object({
      field: Joi.string()
        .valid('relevance', 'price', 'created_at', 'popularity', 'distance')
        .default('relevance'),
      
      direction: Joi.string()
        .valid('asc', 'desc')
        .default('desc')
    }).optional(),
    
    ...paginationSchema,
    
    search_mode: Joi.string()
      .valid('any', 'all', 'phrase')
      .default('any')
      .optional()
  }
};

// ================================
// SEARCH ANALYTICS VALIDATION
// ================================

const searchAnalytics = {
  query: {
    start_date: Joi.date()
      .iso()
      .optional(),
    
    end_date: Joi.date()
      .iso()
      .min(Joi.ref('start_date'))
      .optional(),
    
    user_id: Joi.string()
      .uuid()
      .optional(),
    
    query_type: Joi.string()
      .valid('text', 'image', 'similar', 'recommendation')
      .optional(),
    
    group_by: Joi.string()
      .valid('day', 'week', 'month', 'query', 'user')
      .default('day')
      .optional(),
    
    ...paginationSchema
  }
};

// ================================
// SEARCH PREFERENCES VALIDATION
// ================================

const searchPreferences = {
  body: {
    default_sort: Joi.string()
      .valid('relevance', 'price_asc', 'price_desc', 'created_at', 'popularity')
      .default('relevance')
      .optional(),
    
    default_limit: Joi.number()
      .integer()
      .min(5)
      .max(50)
      .default(20)
      .optional(),
    
    preferred_categories: Joi.array()
      .items(Joi.string().uuid())
      .max(20)
      .optional(),
    
    price_alerts: Joi.object({
      enabled: Joi.boolean().default(false),
      max_price: Joi.number().min(0).optional()
    }).optional(),
    
    search_history_enabled: Joi.boolean()
      .default(true)
      .optional(),
    
    personalized_recommendations: Joi.boolean()
      .default(true)
      .optional(),
    
    notification_preferences: Joi.object({
      new_similar_items: Joi.boolean().default(false),
      price_drops: Joi.boolean().default(false),
      trending_in_categories: Joi.boolean().default(false)
    }).optional()
  }
};

// ================================
// CUSTOM VALIDATORS
// ================================

/**
 * Validate search query complexity
 */
const validateSearchComplexity = (value, helpers) => {
  const query = value.toString().trim();
  
  // Check for basic patterns that might cause issues
  if (query.length > 100) {
    return helpers.error('string.max');
  }
  
  // Check for too many special characters
  const specialCharCount = (query.match(/[^\w\s]/g) || []).length;
  if (specialCharCount > query.length * 0.3) {
    return helpers.message('Query contains too many special characters');
  }
  
  return value;
};

/**
 * Validate price range
 */
const validatePriceRange = (value, helpers) => {
  if (value.min_price && value.max_price && value.min_price > value.max_price) {
    return helpers.message('min_price cannot be greater than max_price');
  }
  
  return value;
};

// ================================
// EXPORTS
// ================================

module.exports = {
  textSearch,
  imageSearch,
  autocomplete,
  recommendations,
  trackClick,
  similarSearch,
  advancedSearch,
  searchAnalytics,
  searchPreferences,
  
  // Custom validators
  validateSearchComplexity,
  validatePriceRange
};