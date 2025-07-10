// apps/backend/src/routes/searchRoutes.js
// Search routing with HuggingFace AI integration

const express = require('express');
const { 
  textSearch, 
  imageSearch, 
  autocomplete, 
  recommendations, 
  trendingSearches, 
  trackClick 
} = require('../controllers/searchController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validateMiddleware');
const { searchValidation } = require('../validators/searchValidator');
const logger = require('../utils/logger');

const router = express.Router();

// ================================
// MIDDLEWARE
// ================================

// Add search timing middleware
router.use((req, res, next) => {
  req.searchStartTime = Date.now();
  next();
});

// Optional authentication (user can be null)
const optionalAuth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (token) {
    // Try to authenticate, but don't fail if invalid
    authenticateToken(req, res, (err) => {
      // Continue regardless of auth result
      next();
    });
  } else {
    next();
  }
};

// ================================
// PUBLIC SEARCH ROUTES
// ================================

/**
 * @route   GET /api/v1/search
 * @desc    Text-based search with AI similarity
 * @access  Public
 * @example GET /api/v1/search?q=iphone&page=1&limit=20&category_id=1
 */
router.get('/', 
  optionalAuth,
  validateRequest(searchValidation.textSearch),
  textSearch
);

/**
 * @route   POST /api/v1/search/image
 * @desc    Image-based search using CLIP
 * @access  Public
 * @example POST /api/v1/search/image
 * Body: { "image_url": "https://...", "limit": 20 }
 */
router.post('/image',
  optionalAuth,
  validateRequest(searchValidation.imageSearch),
  imageSearch
);

/**
 * @route   GET /api/v1/search/autocomplete
 * @desc    Get search suggestions for autocomplete
 * @access  Public
 * @example GET /api/v1/search/autocomplete?q=ipho
 */
router.get('/autocomplete',
  optionalAuth,
  validateRequest(searchValidation.autocomplete),
  autocomplete
);

/**
 * @route   GET /api/v1/search/recommendations
 * @desc    Get AI-powered recommendations
 * @access  Public
 * @example GET /api/v1/search/recommendations?type=trending&limit=10
 */
router.get('/recommendations',
  optionalAuth,
  validateRequest(searchValidation.recommendations),
  recommendations
);

/**
 * @route   GET /api/v1/search/trending
 * @desc    Get trending search terms
 * @access  Public
 * @example GET /api/v1/search/trending?limit=10
 */
router.get('/trending',
  optionalAuth,
  trendingSearches
);

// ================================
// ANALYTICS ROUTES
// ================================

/**
 * @route   POST /api/v1/search/analytics/click
 * @desc    Track search result clicks for analytics
 * @access  Public (but tracked if authenticated)
 * @example POST /api/v1/search/analytics/click
 * Body: { "search_query": "iphone", "listing_id": "123", "result_position": 1 }
 */
router.post('/analytics/click',
  optionalAuth,
  validateRequest(searchValidation.trackClick),
  trackClick
);

// ================================
// ADVANCED SEARCH ROUTES
// ================================

/**
 * @route   POST /api/v1/search/similar
 * @desc    Find similar items to a specific listing
 * @access  Public
 * @example POST /api/v1/search/similar
 * Body: { "listing_id": "abc123", "limit": 10 }
 */
router.post('/similar',
  optionalAuth,
  validateRequest(searchValidation.similarSearch),
  async (req, res) => {
    try {
      const { listing_id, limit = 10 } = req.body;
      
      // Get the target listing
      const { prisma } = require('../config/db');
      const targetListing = await prisma.listing.findUnique({
        where: { id: listing_id },
        include: {
          images: { where: { is_primary: true }, take: 1 }
        }
      });

      if (!targetListing) {
        return res.status(404).json({
          success: false,
          error: 'Listing not found'
        });
      }

      // Use the listing title and description as search query
      const { searchByText } = require('../services/searchService');
      const searchQuery = `${targetListing.title} ${targetListing.description}`.substring(0, 100);
      
      const results = await searchByText(searchQuery, {
        limit: parseInt(limit) + 1, // +1 to exclude the original
        userId: req.user?.id
      });

      // Remove the original listing from results
      const similarListings = results.filter(item => item.id !== listing_id);

      res.json({
        success: true,
        data: {
          target_listing: {
            id: targetListing.id,
            title: targetListing.title
          },
          similar_listings: similarListings.slice(0, parseInt(limit)),
          search_metadata: {
            search_type: 'similar_items',
            algorithm: 'huggingface_similarity'
          }
        }
      });

    } catch (error) {
      logger.error('Similar search failed:', error);
      res.status(500).json({
        success: false,
        error: 'Similar search failed',
        message: error.message
      });
    }
  }
);

// ================================
// SEARCH HISTORY (AUTHENTICATED)
// ================================

/**
 * @route   GET /api/v1/search/history
 * @desc    Get user's search history
 * @access  Private
 */
router.get('/history',
  authenticateToken,
  async (req, res) => {
    try {
      const { limit = 20 } = req.query;
      const { prisma } = require('../config/db');

      const searchHistory = await prisma.searchAnalytics.findMany({
        where: {
          user_id: req.user.id,
          query_text: { not: null }
        },
        select: {
          query_text: true,
          query_type: true,
          results_count: true,
          created_at: true
        },
        orderBy: {
          created_at: 'desc'
        },
        take: parseInt(limit),
        distinct: ['query_text']
      });

      res.json({
        success: true,
        data: {
          search_history: searchHistory
        }
      });

    } catch (error) {
      logger.error('Search history failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get search history',
        message: error.message
      });
    }
  }
);

/**
 * @route   DELETE /api/v1/search/history
 * @desc    Clear user's search history
 * @access  Private
 */
router.delete('/history',
  authenticateToken,
  async (req, res) => {
    try {
      const { prisma } = require('../config/db');

      await prisma.searchAnalytics.deleteMany({
        where: {
          user_id: req.user.id
        }
      });

      res.json({
        success: true,
        message: 'Search history cleared successfully'
      });

    } catch (error) {
      logger.error('Clear search history failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear search history',
        message: error.message
      });
    }
  }
);

// ================================
// SEARCH FILTERS
// ================================

/**
 * @route   GET /api/v1/search/filters
 * @desc    Get available search filters (categories, price ranges, etc.)
 * @access  Public
 */
router.get('/filters',
  async (req, res) => {
    try {
      const { prisma } = require('../config/db');

      // Get categories
      const categories = await prisma.category.findMany({
        select: {
          id: true,
          name: true,
          _count: {
            select: {
              listings: {
                where: { status: 'ACTIVE' }
              }
            }
          }
        },
        orderBy: {
          name: 'asc'
        }
      });

      // Get price ranges
      const priceRanges = await prisma.listing.aggregate({
        where: { status: 'ACTIVE' },
        _min: { price: true },
        _max: { price: true }
      });

      // Get available conditions
      const conditions = await prisma.listing.groupBy({
        by: ['condition'],
        where: { status: 'ACTIVE' },
        _count: { condition: true }
      });

      res.json({
        success: true,
        data: {
          categories: categories.map(cat => ({
            id: cat.id,
            name: cat.name,
            listing_count: cat._count.listings
          })),
          price_range: {
            min: priceRanges._min.price || 0,
            max: priceRanges._max.price || 1000000
          },
          conditions: conditions.map(cond => ({
            value: cond.condition,
            count: cond._count.condition
          }))
        }
      });

    } catch (error) {
      logger.error('Get search filters failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get search filters',
        message: error.message
      });
    }
  }
);

// ================================
// ERROR HANDLING
// ================================

// Handle 404 for unmatched search routes
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Search endpoint not found',
    message: `The search endpoint ${req.method} ${req.originalUrl} does not exist`,
    available_endpoints: [
      'GET /search - Text search',
      'POST /search/image - Image search',
      'GET /search/autocomplete - Search suggestions',
      'GET /search/recommendations - AI recommendations',
      'GET /search/trending - Trending searches',
      'POST /search/similar - Similar items',
      'GET /search/history - Search history (auth required)',
      'GET /search/filters - Available filters'
    ]
  });
});

module.exports = router;