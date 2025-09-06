// apps/backend/src/routes/searchRoutes.js
// Complete search routes with text search, image search, autocomplete, and analytics

const express = require('express');
const multer = require('multer');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validateMiddleware');
const searchController = require('../controllers/searchController');

const router = express.Router();

// Configure multer for image uploads (image search)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Allow only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for image search'), false);
    }
  }
});

// ================================
// TEXT SEARCH ROUTES
// ================================

/**
 * @route   GET /api/v1/search
 * @desc    Main search endpoint with filters and pagination
 * @access  Public
 * @query   {
 *   q: string (required),
 *   category?: string,
 *   min_price?: number,
 *   max_price?: number,
 *   condition?: string,
 *   location?: string,
 *   vendor_id?: string,
 *   sort_by?: string,
 *   sort_order?: string,
 *   page?: number,
 *   limit?: number,
 *   include_inactive?: boolean
 * }
 */
router.get('/', searchController.searchListings);

/**
 * @route   GET /api/v1/search/autocomplete
 * @desc    Get autocomplete suggestions for search query
 * @access  Public
 * @query   { q: string, limit?: number }
 */
router.get('/autocomplete', searchController.autocompleteSearch);

/**
 * @route   GET /api/v1/search/suggestions
 * @desc    Get search suggestions and popular queries
 * @access  Public
 * @query   { category?: string, location?: string, limit?: number }
 */
router.get('/suggestions', searchController.getSearchSuggestions);

/**
 * @route   GET /api/v1/search/popular-terms
 * @desc    Get popular search terms
 * @access  Public
 * @query   { period?: string, category?: string, limit?: number }
 */
router.get('/popular-terms', searchController.getPopularSearchTerms);

// ================================
// IMAGE SEARCH ROUTES
// ================================

/**
 * @route   POST /api/v1/search/image
 * @desc    Search by uploading an image
 * @access  Public
 * @body    {
 *   image: File (required),
 *   category?: string,
 *   min_price?: number,
 *   max_price?: number,
 *   similarity_threshold?: number,
 *   limit?: number
 * }
 */
router.post('/image', upload.single('image'), searchController.searchByImage);

/**
 * @route   POST /api/v1/search/image-url
 * @desc    Search by image URL
 * @access  Public
 * @body    {
 *   image_url: string (required),
 *   category?: string,
 *   min_price?: number,
 *   max_price?: number,
 *   similarity_threshold?: number,
 *   limit?: number
 * }
 */
router.post('/image-url', searchController.searchByImageUrl);

// ================================
// ADVANCED SEARCH ROUTES
// ================================

/**
 * @route   POST /api/v1/search/advanced
 * @desc    Advanced search with multiple criteria
 * @access  Public
 * @body    {
 *   query?: string,
 *   categories?: string[],
 *   price_range?: { min: number, max: number },
 *   conditions?: string[],
 *   locations?: string[],
 *   vendors?: string[],
 *   date_range?: { start: string, end: string },
 *   has_images?: boolean,
 *   has_videos?: boolean,
 *   has_3d_models?: boolean,
 *   rating_min?: number,
 *   sort_by?: string,
 *   sort_order?: string,
 *   page?: number,
 *   limit?: number
 * }
 */
router.post('/advanced', searchController.advancedSearch);

// ================================
// SAVED SEARCHES (Authentication Required)
// ================================

/**
 * @route   POST /api/v1/search/saved
 * @desc    Save a search for later
 * @access  Private
 * @body    {
 *   name: string (required),
 *   query: string (required),
 *   filters?: object,
 *   notify_on_new_results?: boolean
 * }
 */
router.post('/saved', verifyToken, searchController.saveSearch);

/**
 * @route   GET /api/v1/search/saved
 * @desc    Get user's saved searches
 * @access  Private
 * @query   { page?: number, limit?: number }
 */
router.get('/saved', verifyToken, searchController.getSavedSearches);

/**
 * @route   GET /api/v1/search/saved/:searchId
 * @desc    Execute a saved search
 * @access  Private
 * @query   { page?: number, limit?: number }
 */
router.get('/saved/:searchId', verifyToken, searchController.executeSavedSearch);

/**
 * @route   DELETE /api/v1/search/saved/:searchId
 * @desc    Delete a saved search
 * @access  Private
 */
router.delete('/saved/:searchId', verifyToken, async (req, res) => {
  try {
    const { searchId } = req.params;
    const searchService = require('../services/searchService');

    await searchService.deleteSavedSearch({
      search_id: searchId,
      user_id: req.user.id
    });

    res.json({
      success: true,
      message: 'Saved search deleted successfully'
    });

  } catch (error) {
    const logger = require('../utils/logger');
    logger.error('Delete saved search failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete saved search',
      message: error.message
    });
  }
});

/**
 * @route   PATCH /api/v1/search/saved/:searchId
 * @desc    Update a saved search
 * @access  Private
 * @body    {
 *   name?: string,
 *   query?: string,
 *   filters?: object,
 *   notify_on_new_results?: boolean
 * }
 */
router.patch('/saved/:searchId', verifyToken, async (req, res) => {
  try {
    const { searchId } = req.params;
    const updateData = req.body;
    const searchService = require('../services/searchService');

    const updatedSearch = await searchService.updateSavedSearch({
      search_id: searchId,
      user_id: req.user.id,
      updates: updateData
    });

    res.json({
      success: true,
      data: { saved_search: updatedSearch },
      message: 'Saved search updated successfully'
    });

  } catch (error) {
    const logger = require('../utils/logger');
    logger.error('Update saved search failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update saved search',
      message: error.message
    });
  }
});

// ================================
// SEARCH FILTERS & FACETS
// ================================

/**
 * @route   GET /api/v1/search/filters
 * @desc    Get available search filters
 * @access  Public
 * @query   { category?: string, query?: string }
 */
router.get('/filters', searchController.getSearchFilters);

/**
 * @route   POST /api/v1/search/facets
 * @desc    Get search facets/aggregations
 * @access  Public
 * @body    { query?: string, filters?: object }
 */
router.post('/facets', searchController.getSearchFacets);

// ================================
// SEARCH ANALYTICS (Admin Only)
// ================================

/**
 * @route   GET /api/v1/search/analytics
 * @desc    Get search analytics (Admin only)
 * @access  Private (Admin)
 * @query   {
 *   start_date?: string,
 *   end_date?: string,
 *   category?: string,
 *   limit?: number
 * }
 */
router.get('/analytics', 
  verifyToken, 
  requireRole(['ADMIN', 'SUPER_ADMIN']), 
  searchController.getSearchAnalytics
);

/**
 * @route   GET /api/v1/search/analytics/trends
 * @desc    Get search trends over time (Admin only)
 * @access  Private (Admin)
 * @query   {
 *   period?: string,
 *   groupBy?: string,
 *   category?: string
 * }
 */
router.get('/analytics/trends', 
  verifyToken, 
  requireRole(['ADMIN', 'SUPER_ADMIN']), 
  async (req, res) => {
    try {
      const {
        period = '30d',
        groupBy = 'day',
        category
      } = req.query;

      const searchService = require('../services/searchService');
      const trends = await searchService.getSearchTrends({
        period,
        groupBy,
        category
      });

      res.json({
        success: true,
        data: trends
      });

    } catch (error) {
      const logger = require('../utils/logger');
      logger.error('Get search trends failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get search trends',
        message: error.message
      });
    }
  }
);

/**
 * @route   GET /api/v1/search/analytics/performance
 * @desc    Get search performance metrics (Admin only)
 * @access  Private (Admin)
 * @query   {
 *   start_date?: string,
 *   end_date?: string
 * }
 */
router.get('/analytics/performance', 
  verifyToken, 
  requireRole(['ADMIN', 'SUPER_ADMIN']), 
  async (req, res) => {
    try {
      const {
        start_date,
        end_date
      } = req.query;

      const searchService = require('../services/searchService');
      const performance = await searchService.getSearchPerformance({
        start_date: start_date ? new Date(start_date) : undefined,
        end_date: end_date ? new Date(end_date) : undefined
      });

      res.json({
        success: true,
        data: performance
      });

    } catch (error) {
      const logger = require('../utils/logger');
      logger.error('Get search performance failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get search performance',
        message: error.message
      });
    }
  }
);

// ================================
// SEARCH HEALTH & MONITORING
// ================================

/**
 * @route   GET /api/v1/search/health
 * @desc    Check search service health
 * @access  Public
 */
router.get('/health', async (req, res) => {
  try {
    const searchService = require('../services/searchService');
    const health = await searchService.healthCheck();

    res.json({
      success: true,
      data: health
    });

  } catch (error) {
    const logger = require('../utils/logger');
    logger.error('Search health check failed:', error);
    res.status(503).json({
      success: false,
      error: 'Search service unhealthy',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/v1/search/index/rebuild
 * @desc    Rebuild search index (Admin only)
 * @access  Private (Super Admin)
 */
router.post('/index/rebuild', 
  verifyToken, 
  requireRole(['SUPER_ADMIN']), 
  async (req, res) => {
    try {
      const { full_rebuild = false } = req.body;
      const searchService = require('../services/searchService');

      // Start async rebuild process
      const rebuildResult = await searchService.rebuildSearchIndex({
        full_rebuild,
        user_id: req.user.id
      });

      res.json({
        success: true,
        data: rebuildResult,
        message: 'Search index rebuild initiated'
      });

    } catch (error) {
      const logger = require('../utils/logger');
      logger.error('Search index rebuild failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to rebuild search index',
        message: error.message
      });
    }
  }
);

// ================================
// SEARCH VALIDATION MIDDLEWARE
// ================================

/**
 * Validation middleware for search requests
 */
const validateSearchRequest = (req, res, next) => {
  const { q: query } = req.query;
  
  if (query && (query.length > 200 || query.length < 1)) {
    return res.status(400).json({
      success: false,
      error: 'Search query must be between 1 and 200 characters'
    });
  }

  // Sanitize query to prevent injection attacks
  if (query) {
    req.query.q = query.replace(/[<>\"']/g, '').trim();
  }

  next();
};

// Apply validation to search endpoints
router.use(['/'], validateSearchRequest);

// ================================
// ERROR HANDLING MIDDLEWARE
// ================================

/**
 * Search-specific error handling
 */
router.use((error, req, res, next) => {
  const logger = require('../utils/logger');
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'Image file too large',
        message: 'Maximum file size is 10MB'
      });
    }
    
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        error: 'Unexpected file field',
        message: 'Only single image upload is allowed'
      });
    }
  }

  if (error.message === 'Only image files are allowed for image search') {
    return res.status(400).json({
      success: false,
      error: 'Invalid file type',
      message: 'Only image files (PNG, JPG, GIF, WebP) are allowed for image search'
    });
  }

  logger.error('Search route error:', error);
  res.status(500).json({
    success: false,
    error: 'Search service error',
    message: 'An error occurred while processing your search request'
  });
});

// ================================
// ROUTE DOCUMENTATION
// ================================

/**
 * @route   GET /api/v1/search/docs
 * @desc    Get search API documentation
 * @access  Public
 */
router.get('/docs', (req, res) => {
  res.json({
    success: true,
    data: {
      version: '1.0.0',
      description: 'Void Marketplace Search API',
      endpoints: {
        text_search: {
          'GET /search': 'Main search with filters and pagination',
          'GET /search/autocomplete': 'Autocomplete suggestions',
          'GET /search/suggestions': 'Popular and trending searches',
          'GET /search/popular-terms': 'Most searched terms'
        },
        image_search: {
          'POST /search/image': 'Search by uploading image file',
          'POST /search/image-url': 'Search by image URL'
        },
        advanced_search: {
          'POST /search/advanced': 'Multi-criteria advanced search'
        },
        saved_searches: {
          'POST /search/saved': 'Save search for later',
          'GET /search/saved': 'Get saved searches',
          'GET /search/saved/:id': 'Execute saved search',
          'PATCH /search/saved/:id': 'Update saved search',
          'DELETE /search/saved/:id': 'Delete saved search'
        },
        filters_facets: {
          'GET /search/filters': 'Get available filters',
          'POST /search/facets': 'Get search aggregations'
        },
        analytics: {
          'GET /search/analytics': 'Search analytics (Admin)',
          'GET /search/analytics/trends': 'Search trends (Admin)',
          'GET /search/analytics/performance': 'Performance metrics (Admin)'
        },
        maintenance: {
          'GET /search/health': 'Service health check',
          'POST /search/index/rebuild': 'Rebuild search index (Super Admin)'
        }
      },
      features: [
        'Full-text search with fuzzy matching',
        'Image-based visual search',
        'Advanced filtering and faceting',
        'Real-time autocomplete',
        'Saved searches with notifications',
        'Search analytics and trends',
        'Multi-language support',
        'Geo-location search',
        'AI-powered recommendations'
      ],
      authentication: {
        required_for: [
          'Saved searches',
          'Analytics endpoints',
          'Index management'
        ],
        optional_for: [
          'Basic search',
          'Image search',
          'Autocomplete',
          'Filters and facets'
        ]
      }
    }
  });
});

module.exports = router;