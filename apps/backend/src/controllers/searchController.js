// apps/backend/src/controllers/searchController.js
// Search controller implementing HuggingFace AI search

const { 
  searchByText, 
  searchByMedia, 
  getAIRecommendations,
  logSearchAnalytics 
} = require('../services/searchService');
const logger = require('../utils/logger');
const { ValidationError } = require('../middleware/errorMiddleware');

// ================================
// TEXT SEARCH
// ================================

/**
 * @route   GET /api/v1/search
 * @desc    Text-based search with AI similarity
 * @access  Public
 */
const textSearch = async (req, res) => {
  try {
    const { 
      q: query, 
      page = 1, 
      limit = 20,
      category_id,
      min_price,
      max_price,
      condition,
      location
    } = req.query;

    // Validation
    if (!query || query.trim().length < 2) {
      throw new ValidationError('Search query must be at least 2 characters long');
    }

    if (query.length > 100) {
      throw new ValidationError('Search query too long (max 100 characters)');
    }

    // Build filters
    const filters = {};
    
    if (category_id) {
      filters.category_id = category_id;
    }
    
    if (min_price || max_price) {
      filters.price = {};
      if (min_price) filters.price.gte = parseFloat(min_price);
      if (max_price) filters.price.lte = parseFloat(max_price);
    }
    
    if (condition) {
      filters.condition = condition.toUpperCase();
    }
    
    if (location) {
      filters.location = {
        contains: location,
        mode: 'insensitive'
      };
    }

    // Search options
    const options = {
      limit: Math.min(parseInt(limit), 50),
      offset: (parseInt(page) - 1) * parseInt(limit),
      filters,
      userId: req.user?.id
    };

    logger.info('Text search request', { query, options });

    // Perform search
    const results = await searchByText(query, options);

    // Return results
    res.json({
      success: true,
      data: {
        query,
        results,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: results.length,
          hasMore: results.length === parseInt(limit)
        },
        search_metadata: {
          search_type: 'text',
          search_method: 'huggingface_ai',
          processing_time: Date.now() - req.timestamp,
          filters_applied: Object.keys(filters)
        }
      }
    });

  } catch (error) {
    logger.error('Text search failed:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message
    });
  }
};

// ================================
// IMAGE SEARCH
// ================================

/**
 * @route   POST /api/v1/search/image
 * @desc    Image-based search using AI
 * @access  Public
 */
const imageSearch = async (req, res) => {
  try {
    const { 
      image_url, 
      image_description,
      limit = 20 
    } = req.body;

    // Validation
    if (!image_url && !image_description) {
      throw new ValidationError('Either image_url or image_description is required');
    }

    // Use image URL or description as query
    const imageQuery = image_url || image_description;

    // Search options
    const options = {
      limit: Math.min(parseInt(limit), 50),
      userId: req.user?.id
    };

    logger.info('Image search request', { imageQuery, options });

    // Perform image search
    const results = await searchByMedia(imageQuery, options);

    // Return results
    res.json({
      success: true,
      data: {
        query: imageQuery,
        query_type: image_url ? 'image_url' : 'image_description',
        results,
        search_metadata: {
          search_type: 'image',
          search_method: 'gemini_25_media',
          processing_time: Date.now() - req.timestamp,
          results_count: results.length
        }
      }
    });

  } catch (error) {
    logger.error('Image search failed:', error);
    res.status(500).json({
      success: false,
      error: 'Image search failed',
      message: error.message
    });
  }
};

// ================================
// AUTOCOMPLETE
// ================================

/**
 * @route   GET /api/v1/search/autocomplete
 * @desc    Get search suggestions
 * @access  Public
 */
const autocomplete = async (req, res) => {
  try {
    const { q: query, limit = 10 } = req.query;

    if (!query || query.length < 1) {
      return res.json({
        success: true,
        data: {
          suggestions: []
        }
      });
    }

    // Get popular search terms and category matches
    const suggestions = await getSearchSuggestions(query, parseInt(limit));

    res.json({
      success: true,
      data: {
        query,
        suggestions
      }
    });

  } catch (error) {
    logger.error('Autocomplete failed:', error);
    res.status(500).json({
      success: false,
      error: 'Autocomplete failed',
      message: error.message
    });
  }
};

// ================================
// RECOMMENDATIONS
// ================================

/**
 * @route   GET /api/v1/search/recommendations
 * @desc    Get AI-powered recommendations
 * @access  Public
 */
const recommendations = async (req, res) => {
  try {
    const { 
      type = 'trending',
      limit = 10,
      category_id 
    } = req.query;

    // Get recommendations
    const options = {
      limit: Math.min(parseInt(limit), 20),
      type,
      categoryId: category_id
    };

    logger.info('Recommendations request', { options, userId: req.user?.id });

    const results = await getAIRecommendations(req.user?.id, options);

    res.json({
      success: true,
      data: {
        recommendations: results,
        recommendation_type: type,
        metadata: {
          generated_at: new Date().toISOString(),
          user_id: req.user?.id || 'anonymous',
          algorithm: 'gemini_25_ai'
        }
      }
    });

  } catch (error) {
    logger.error('Recommendations failed:', error);
    res.status(500).json({
      success: false,
      error: 'Recommendations failed',
      message: error.message
    });
  }
};

// ================================
// TRENDING SEARCHES
// ================================

/**
 * @route   GET /api/v1/search/trending
 * @desc    Get trending search terms
 * @access  Public
 */
const trendingSearches = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    // Get trending searches from analytics
    const trending = await getTrendingSearches(parseInt(limit));

    res.json({
      success: true,
      data: {
        trending_searches: trending,
        generated_at: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Trending searches failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get trending searches',
      message: error.message
    });
  }
};

// ================================
// SEARCH ANALYTICS
// ================================

/**
 * @route   POST /api/v1/search/analytics/click
 * @desc    Track search result clicks
 * @access  Public
 */
const trackClick = async (req, res) => {
  try {
    const {
      search_query,
      listing_id,
      search_type = 'text',
      result_position
    } = req.body;

    // Log the click event
    await logSearchAnalytics({
      userId: req.user?.id,
      queryText: search_query,
      queryType: search_type,
      clickedResultId: listing_id,
      resultPosition: result_position,
      event: 'click'
    });

    res.json({
      success: true,
      message: 'Click tracked successfully'
    });

  } catch (error) {
    logger.error('Click tracking failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track click',
      message: error.message
    });
  }
};

// ================================
// HELPER FUNCTIONS
// ================================

/**
 * Get search suggestions for autocomplete
 * @param {string} query - Partial query
 * @param {number} limit - Number of suggestions
 * @returns {Promise<Array>} Suggestions
 */
const getSearchSuggestions = async (query, limit) => {
  try {
    const { prisma } = require('../config/db');

    // Get matching categories
    const categories = await prisma.category.findMany({
      where: {
        name: {
          contains: query,
          mode: 'insensitive'
        }
      },
      select: {
        name: true
      },
      take: Math.ceil(limit / 2)
    });

    // Get popular search terms
    const popularSearches = await prisma.searchAnalytics.groupBy({
      by: ['query_text'],
      where: {
        query_text: {
          contains: query,
          mode: 'insensitive'
        },
        created_at: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      },
      _count: {
        query_text: true
      },
      orderBy: {
        _count: {
          query_text: 'desc'
        }
      },
      take: Math.floor(limit / 2)
    });

    // Combine suggestions
    const suggestions = [
      ...categories.map(cat => ({
        text: cat.name,
        type: 'category'
      })),
      ...popularSearches.map(search => ({
        text: search.query_text,
        type: 'popular_search',
        count: search._count.query_text
      }))
    ];

    return suggestions.slice(0, limit);

  } catch (error) {
    logger.error('Get suggestions failed:', error);
    return [];
  }
};

/**
 * Get trending search terms
 * @param {number} limit - Number of trends
 * @returns {Promise<Array>} Trending searches
 */
const getTrendingSearches = async (limit) => {
  try {
    const { prisma } = require('../config/db');

    const trending = await prisma.searchAnalytics.groupBy({
      by: ['query_text'],
      where: {
        created_at: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        },
        query_text: {
          not: null
        }
      },
      _count: {
        query_text: true
      },
      orderBy: {
        _count: {
          query_text: 'desc'
        }
      },
      take: limit
    });

    return trending.map(item => ({
      query: item.query_text,
      search_count: item._count.query_text
    }));

  } catch (error) {
    logger.error('Get trending searches failed:', error);
    return [];
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  textSearch,
  imageSearch,
  autocomplete,
  recommendations,
  trendingSearches,
  trackClick
};