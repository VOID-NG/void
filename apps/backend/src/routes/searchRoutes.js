// apps/backend/src/routes/searchRoutes.js
// Comprehensive Search API Routes

const express = require('express');
const router = express.Router();

// Import middleware
const { authenticate, optionalAuthenticate } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validateMiddleware');
const { 
  uploadImages, 
  handleUploadError,
  validateFilesSecurity 
} = require('../middleware/uploadMiddleware');

// Import controller
const {
  searchListings,
  advancedSearch,
  searchByImage,
  searchByImageUrl,
  getAutocomplete,
  getTrendingSearches,
  analyzeSearchQuery,
  getSearchMetrics
} = require('../controllers/searchController');

// Import validators
const { searchValidators } = require('../validators/searchValidator');

// ================================
// PUBLIC SEARCH ENDPOINTS
// ================================

/**
 * @route   GET /api/v1/search
 * @desc    Intelligent text search with cost optimization
 * @access  Public (with optional authentication for personalization)
 * @example GET /search?q=iphone&category=electronics&min_price=500&max_price=1000&page=1&limit=20
 */
router.get('/',
  optionalAuthenticate, // Optional auth for personalization
  validate(searchValidators.textSearch, 'query'),
  searchListings
);

/**
 * @route   POST /api/v1/search/advanced
 * @desc    Advanced search with explicit AI enhancement options
 * @access  Public (with optional authentication)
 * @body    { query, filters, pagination, requireAI, analysisDepth }
 */
router.post('/advanced',
  optionalAuthenticate,
  validate(searchValidators.advancedSearch),
  advancedSearch
);

/**
 * @route   GET /api/v1/search/autocomplete
 * @desc    Smart autocomplete suggestions with caching
 * @access  Public
 * @example GET /search/autocomplete?q=iph&limit=10
 */
router.get('/autocomplete',
  optionalAuthenticate,
  validate(searchValidators.autocomplete, 'query'),
  getAutocomplete
);

/**
 * @route   GET /api/v1/search/trending
 * @desc    Get trending searches and popular queries
 * @access  Public
 * @example GET /search/trending?limit=10&timeframe=24h
 */
router.get('/trending',
  validate(searchValidators.trending, 'query'),
  getTrendingSearches
);

// ================================
// IMAGE SEARCH ENDPOINTS
// ================================

/**
 * @route   POST /api/v1/search/image
 * @desc    Search by uploaded image using Gemini Vision
 * @access  Public (with optional authentication)
 * @upload  Single image file (max 10MB)
 */
router.post('/image',
  optionalAuthenticate,
  uploadImages.single('image'),
  handleUploadError,
  validateFilesSecurity,
  validate(searchValidators.imageSearch),
  searchByImage
);

/**
 * @route   POST /api/v1/search/image-url
 * @desc    Search by image URL using Gemini Vision
 * @access  Public (with optional authentication)
 * @body    { image_url, category?, min_price?, max_price?, etc. }
 */
router.post('/image-url',
  optionalAuthenticate,
  validate(searchValidators.imageUrlSearch),
  searchByImageUrl
);

// ================================
// ANALYTICS & INSIGHTS ENDPOINTS
// ================================

/**
 * @route   POST /api/v1/search/analyze
 * @desc    Analyze search query strategy (for debugging/optimization)
 * @access  Private (Admin/Developer only)
 * @body    { query, context? }
 */
router.post('/analyze',
  authenticate,
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  validate(searchValidators.analyzeQuery),
  analyzeSearchQuery
);

/**
 * @route   GET /api/v1/search/metrics
 * @desc    Get comprehensive search performance metrics
 * @access  Private (Admin only)
 * @example GET /search/metrics?timeframe=24h
 */
router.get('/metrics',
  authenticate,
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  validate(searchValidators.getMetrics, 'query'),
  getSearchMetrics
);

// ================================
// SEARCH RESULT INTERACTION ENDPOINTS
// ================================

/**
 * @route   POST /api/v1/search/click
 * @desc    Track search result clicks for analytics and personalization
 * @access  Private (Authenticated users only)
 * @body    { search_id, listing_id, position }
 */
router.post('/click',
  authenticate,
  validate(searchValidators.trackClick),
  async (req, res) => {
    try {
      const { search_id, listing_id, position } = req.body;
      const { dbRouter } = require('../config/db');
      const logger = require('../utils/logger');

      // Update search analytics with click data
      await dbRouter.searchAnalytics.updateMany({
        where: { session_id: search_id },
        data: { clicked_result_id: listing_id }
      });

      // Track user interaction
      await dbRouter.userInteraction.create({
        data: {
          user_id: req.user.id,
          listing_id: listing_id,
          interaction_type: 'SEARCH_CLICK',
          metadata: JSON.stringify({ 
            search_id, 
            position,
            timestamp: new Date().toISOString()
          })
        }
      });

      // Update listing click count
      await dbRouter.listing.update({
        where: { id: listing_id },
        data: { click_count: { increment: 1 } }
      });

      logger.info('Search click tracked', {
        userId: req.user.id,
        searchId: search_id,
        listingId: listing_id,
        position
      });

      res.json({
        success: true,
        message: 'Click tracked successfully'
      });

    } catch (error) {
      const logger = require('../utils/logger');
      logger.error('Failed to track search click', { 
        error: error.message,
        userId: req.user.id,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: 'Failed to track click',
        message: error.message
      });
    }
  }
);

/**
 * @route   POST /api/v1/search/save
 * @desc    Save search query for later (authenticated users)
 * @access  Private
 * @body    { query, filters?, name? }
 */
router.post('/save',
  authenticate,
  validate(searchValidators.saveSearch),
  async (req, res) => {
    try {
      const { query, filters = {}, name } = req.body;
      const { dbRouter } = require('../config/db');

      const savedSearch = await dbRouter.savedSearch.create({
        data: {
          user_id: req.user.id,
          query_text: query,
          filters: filters,
          name: name || `Search: ${query}`,
          is_active: true
        }
      });

      res.json({
        success: true,
        data: savedSearch,
        message: 'Search saved successfully'
      });

    } catch (error) {
      const logger = require('../utils/logger');
      logger.error('Failed to save search', { 
        error: error.message,
        userId: req.user.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to save search',
        message: error.message
      });
    }
  }
);

/**
 * @route   GET /api/v1/search/saved
 * @desc    Get user's saved searches
 * @access  Private
 */
router.get('/saved',
  authenticate,
  async (req, res) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const { dbRouter } = require('../config/db');

      const offset = (parseInt(page) - 1) * parseInt(limit);

      const [savedSearches, total] = await Promise.all([
        dbRouter.savedSearch.findMany({
          where: { 
            user_id: req.user.id,
            is_active: true
          },
          orderBy: { created_at: 'desc' },
          skip: offset,
          take: parseInt(limit)
        }),
        dbRouter.savedSearch.count({
          where: { 
            user_id: req.user.id,
            is_active: true
          }
        })
      ]);

      res.json({
        success: true,
        data: savedSearches,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });

    } catch (error) {
      const logger = require('../utils/logger');
      logger.error('Failed to get saved searches', { 
        error: error.message,
        userId: req.user.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get saved searches',
        message: error.message
      });
    }
  }
);

// ================================
// SEARCH RECOMMENDATIONS ENDPOINTS
// ================================

/**
 * @route   GET /api/v1/search/recommendations
 * @desc    Get personalized search recommendations
 * @access  Private (Authenticated users only)
 */
router.get('/recommendations',
  authenticate,
  async (req, res) => {
    try {
      const { limit = 10, type = 'all' } = req.query;
      const { getAIRecommendations } = require('../services/searchService-original');
      
      const context = {
        userId: req.user.id,
        userPreferences: req.user.search_preferences,
        recentSearches: true,
        recentInteractions: true
      };

      const recommendations = await getAIRecommendations(req.user.id, context);

      res.json({
        success: true,
        recommendations: recommendations.success ? recommendations.recommendations : [],
        aiInsights: recommendations.success ? recommendations.insights : null,
        performance: recommendations.performance || { strategy: 'fallback' }
      });

    } catch (error) {
      const logger = require('../utils/logger');
      logger.error('Failed to get search recommendations', { 
        error: error.message,
        userId: req.user.id
      });

      res.json({
        success: false,
        recommendations: [],
        error: 'Failed to get recommendations',
        message: error.message
      });
    }
  }
);

/**
 * @route   GET /api/v1/search/similar/:listingId
 * @desc    Find similar listings to a given listing
 * @access  Public
 */
router.get('/similar/:listingId',
  optionalAuthenticate,
  validate(searchValidators.similarListings, 'params'),
  async (req, res) => {
    try {
      const { listingId } = req.params;
      const { limit = 10 } = req.query;
      const { dbRouter } = require('../config/db');
      const { calculateBasicSimilarity } = require('../services/searchService-original');

      // Get the source listing
      const sourceListing = await dbRouter.listing.findUnique({
        where: { id: listingId },
        include: {
          category: true,
          images: true
        }
      });

      if (!sourceListing) {
        return res.status(404).json({
          success: false,
          error: 'Listing not found',
          error_code: 'LISTING_NOT_FOUND'
        });
      }

      // Find similar listings using traditional similarity
      const similarListings = await calculateBasicSimilarity(sourceListing, {
        limit: parseInt(limit),
        includeImages: true
      });

      res.json({
        success: true,
        data: similarListings.results || [],
        sourceListing: {
          id: sourceListing.id,
          title: sourceListing.title,
          category: sourceListing.category.name
        },
        performance: similarListings.performance || { strategy: 'basic_similarity' }
      });

    } catch (error) {
      const logger = require('../utils/logger');
      logger.error('Failed to find similar listings', { 
        error: error.message,
        listingId: req.params.listingId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to find similar listings',
        message: error.message
      });
    }
  }
);

// ================================
// SEARCH FILTERS & CATEGORIES
// ================================

/**
 * @route   GET /api/v1/search/filters
 * @desc    Get available search filters and categories
 * @access  Public
 */
router.get('/filters',
  async (req, res) => {
    try {
      const { dbRouter } = require('../config/db');

      const [categories, conditions, priceRanges] = await Promise.all([
        // Get all categories with listing counts
        dbRouter.category.findMany({
          include: {
            _count: {
              select: {
                listings: {
                  where: { status: 'ACTIVE' }
                }
              }
            }
          },
          orderBy: { name: 'asc' }
        }),

        // Get available conditions
        dbRouter.listing.groupBy({
          by: ['condition'],
          where: { status: 'ACTIVE' },
          _count: { condition: true }
        }),

        // Get price ranges
        dbRouter.listing.aggregate({
          where: { status: 'ACTIVE' },
          _min: { price: true },
          _max: { price: true },
          _avg: { price: true }
        })
      ]);

      // Generate suggested price ranges
      const maxPrice = parseFloat(priceRanges._max.price || 1000);
      const suggestedRanges = [
        { label: 'Under $50', min: 0, max: 50 },
        { label: '$50 - $100', min: 50, max: 100 },
        { label: '$100 - $250', min: 100, max: 250 },
        { label: '$250 - $500', min: 250, max: 500 },
        { label: '$500 - $1000', min: 500, max: 1000 },
        { label: 'Over $1000', min: 1000, max: maxPrice }
      ].filter(range => range.max <= maxPrice || range.min < maxPrice);

      res.json({
        success: true,
        filters: {
          categories: categories.map(cat => ({
            id: cat.id,
            name: cat.name,
            description: cat.description,
            listingCount: cat._count.listings,
            parentId: cat.parent_id
          })),
          conditions: conditions.map(cond => ({
            value: cond.condition,
            label: cond.condition.replace('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()),
            count: cond._count.condition
          })),
          priceRanges: {
            suggested: suggestedRanges,
            stats: {
              min: parseFloat(priceRanges._min.price || 0),
              max: parseFloat(priceRanges._max.price || 0),
              average: parseFloat(priceRanges._avg.price || 0)
            }
          }
        },
        meta: {
          timestamp: new Date().toISOString(),
          totalActiveListings: await dbRouter.listing.count({ where: { status: 'ACTIVE' } })
        }
      });

    } catch (error) {
      const logger = require('../utils/logger');
      logger.error('Failed to get search filters', { error: error.message });

      res.status(500).json({
        success: false,
        error: 'Failed to get search filters',
        message: error.message
      });
    }
  }
);

// ================================
// EXPORT ROUTER
// ================================

module.exports = router;