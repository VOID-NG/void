// apps/backend/src/controllers/searchController.js
// Advanced Search Controller

const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorMiddleware');
const {
  executeIntelligentSearch,
  executeTraditionalSearch,
  executeAIEnhancedSearch,
  executeImageSearch,
  getSmartAutocomplete,
  analyzeSearchStrategy,
  SEARCH_CONFIG
} = require('../services/searchOrchestrator');
const { dbRouter } = require('../config/db');
const { API_CONFIG } = require('../services/searchService-original');

// ================================
// TEXT SEARCH ENDPOINTS
// ================================

/**
 * @desc    Intelligent text search with cost optimization
 * @route   GET /api/v1/search
 * @access  Public
 */
const searchListings = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  
  const {
    q: query,
    category,
    min_price,
    max_price,
    condition,
    location,
    vendor_id,
    is_featured,
    page = 1,
    limit = 20,
    sort_by = 'relevance',
    sort_order = 'desc'
  } = req.query;

  // Validate pagination
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit)));

  // Build filters
  const filters = {};
  if (category) filters.category_id = category;
  if (min_price !== undefined) filters.min_price = parseFloat(min_price);
  if (max_price !== undefined) filters.max_price = parseFloat(max_price);
  if (condition) filters.condition = condition.toUpperCase();
  if (location) filters.location = location;
  if (vendor_id) filters.vendor_id = vendor_id;
  if (is_featured !== undefined) filters.is_featured = is_featured === 'true';

  // Build pagination
  const pagination = {
    page: pageNum,
    limit: limitNum,
    sort_by,
    sort_order
  };

  // Build context
  const context = {
    userId: req.user?.id,
    userPreferences: req.user?.search_preferences,
    isSubscribedUser: req.user?.subscription?.status === 'ACTIVE',
    ipAddress: req.ip,
    userAgent: req.get('User-Agent')
  };

  // Execute intelligent search
  const searchRequest = {
    query,
    filters,
    pagination,
    context
  };

  const results = await executeIntelligentSearch(searchRequest);

  // Track search interaction
  if (req.user?.id && results.success) {
    // Background task - don't await
    trackUserInteraction(req.user.id, 'SEARCH', { 
      query, 
      resultCount: results.results?.length || 0,
      strategy: results.performance?.strategy 
    });
  }

  const responseTime = Date.now() - startTime;

  res.json({
    success: results.success,
    data: results.results || [],
    pagination: results.pagination,
    performance: {
      ...results.performance,
      totalResponseTime: responseTime
    },
    aiInsights: results.aiInsights,
    searchId: results.searchId,
    meta: {
      query,
      filters,
      strategy: results.performance?.strategy,
      timestamp: results.timestamp
    }
  });

  // Log performance metrics
  logger.info('Search request completed', {
    searchId: results.searchId,
    query,
    strategy: results.performance?.strategy,
    resultCount: results.results?.length || 0,
    responseTime,
    userId: req.user?.id
  });
});

/**
 * @desc    Advanced search with explicit AI enhancement
 * @route   POST /api/v1/search/advanced
 * @access  Public
 */
const advancedSearch = asyncHandler(async (req, res) => {
  const {
    query,
    filters = {},
    pagination = {},
    requireAI = false,
    analysisDepth = 'standard' // standard, deep, market_analysis
  } = req.body;

  if (!query || query.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Search query is required',
      error_code: 'MISSING_QUERY'
    });
  }

  const context = {
    userId: req.user?.id,
    requireAI,
    analysisDepth,
    userPreferences: req.user?.search_preferences,
    isSubscribedUser: req.user?.subscription?.status === 'ACTIVE'
  };

  let results;

  if (requireAI || analysisDepth !== 'standard') {
    // Force AI-enhanced search
    results = await executeAIEnhancedSearch(query, filters, pagination, context);
  } else {
    // Use intelligent routing
    const searchRequest = { query, filters, pagination, context };
    results = await executeIntelligentSearch(searchRequest);
  }

  res.json({
    success: results.success,
    data: results.results || [],
    pagination: results.pagination,
    performance: results.performance,
    aiInsights: results.aiInsights,
    searchId: results.searchId,
    meta: {
      query,
      filters,
      requireAI,
      analysisDepth,
      timestamp: results.timestamp
    }
  });
});

// ================================
// IMAGE SEARCH ENDPOINTS
// ================================

/**
 * @desc    Search by uploaded image
 * @route   POST /api/v1/search/image
 * @access  Public
 */
const searchByImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'Image file is required',
      error_code: 'MISSING_IMAGE'
    });
  }

  const {
    category,
    min_price,
    max_price,
    condition,
    location,
    page = 1,
    limit = 20
  } = req.body;

  // Build filters
  const filters = {};
  if (category) filters.category_id = category;
  if (min_price !== undefined) filters.min_price = parseFloat(min_price);
  if (max_price !== undefined) filters.max_price = parseFloat(max_price);
  if (condition) filters.condition = condition.toUpperCase();
  if (location) filters.location = location;

  const pagination = {
    page: Math.max(1, parseInt(page)),
    limit: Math.min(50, Math.max(1, parseInt(limit)))
  };

  try {
    const results = await executeImageSearch(
      req.file.buffer,
      req.file.mimetype,
      filters,
      pagination
    );

    // Track image search interaction
    if (req.user?.id && results.success) {
      trackUserInteraction(req.user.id, 'IMAGE_SEARCH', {
        imageAnalysis: results.imageAnalysis?.productInfo,
        resultCount: results.results?.length || 0
      });
    }

    res.json({
      success: results.success,
      data: results.results || [],
      pagination: results.pagination,
      imageAnalysis: results.imageAnalysis,
      extractedSearchTerms: results.extractedSearchTerms,
      performance: results.performance,
      meta: {
        originalFileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Image search failed', {
      error: error.message,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      userId: req.user?.id
    });

    res.status(500).json({
      success: false,
      error: 'Image search failed',
      message: error.message,
      error_code: 'IMAGE_SEARCH_ERROR'
    });
  }
});

/**
 * @desc    Search by image URL
 * @route   POST /api/v1/search/image-url
 * @access  Public
 */
const searchByImageUrl = asyncHandler(async (req, res) => {
  const { image_url, ...searchParams } = req.body;

  if (!image_url) {
    return res.status(400).json({
      success: false,
      error: 'Image URL is required',
      error_code: 'MISSING_IMAGE_URL'
    });
  }

  try {
    // Download image from URL
    const axios = require('axios');
    const imageResponse = await axios.get(image_url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxContentLength: 10 * 1024 * 1024 // 10MB limit
    });

    const imageBuffer = Buffer.from(imageResponse.data);
    const mimeType = imageResponse.headers['content-type'] || 'image/jpeg';

    // Build filters and pagination from searchParams
    const { category, min_price, max_price, condition, location, page = 1, limit = 20 } = searchParams;
    
    const filters = {};
    if (category) filters.category_id = category;
    if (min_price !== undefined) filters.min_price = parseFloat(min_price);
    if (max_price !== undefined) filters.max_price = parseFloat(max_price);
    if (condition) filters.condition = condition.toUpperCase();
    if (location) filters.location = location;

    const pagination = {
      page: Math.max(1, parseInt(page)),
      limit: Math.min(50, Math.max(1, parseInt(limit)))
    };

    const results = await executeImageSearch(imageBuffer, mimeType, filters, pagination);

    res.json({
      success: results.success,
      data: results.results || [],
      pagination: results.pagination,
      imageAnalysis: results.imageAnalysis,
      extractedSearchTerms: results.extractedSearchTerms,
      performance: results.performance,
      meta: {
        imageUrl: image_url,
        mimeType,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Image URL search failed', {
      error: error.message,
      imageUrl: image_url,
      userId: req.user?.id
    });

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return res.status(400).json({
        success: false,
        error: 'Unable to access image URL',
        error_code: 'INVALID_IMAGE_URL'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Image URL search failed',
      message: error.message,
      error_code: 'IMAGE_URL_SEARCH_ERROR'
    });
  }
});

// ================================
// AUTOCOMPLETE & SUGGESTIONS
// ================================

/**
 * @desc    Smart autocomplete suggestions
 * @route   GET /api/v1/search/autocomplete
 * @access  Public
 */
const getAutocomplete = asyncHandler(async (req, res) => {
  const { q: query, limit = 10 } = req.query;

  if (!query || query.length < 2) {
    return res.json({
      success: true,
      suggestions: [],
      query: query || ''
    });
  }

  const context = {
    userId: req.user?.id,
    userPreferences: req.user?.search_preferences
  };

  const results = await getSmartAutocomplete(query, context);

  res.json({
    success: results.success,
    suggestions: results.suggestions.slice(0, parseInt(limit)),
    query: results.query,
    performance: {
      strategy: 'autocomplete',
      cached: false // Add caching logic
    }
  });
});

/**
 * @desc    Get trending searches
 * @route   GET /api/v1/search/trending
 * @access  Public
 */
const getTrendingSearches = asyncHandler(async (req, res) => {
  const { limit = 10, timeframe = '24h' } = req.query;

  try {
    // Calculate time range
    const timeRanges = {
      '1h': 1,
      '24h': 24,
      '7d': 24 * 7,
      '30d': 24 * 30
    };

    const hoursBack = timeRanges[timeframe] || 24;
    const cutoffTime = new Date(Date.now() - (hoursBack * 60 * 60 * 1000));

    // Get trending searches from analytics
    const trendingQueries = await dbRouter.searchAnalytics.groupBy({
      by: ['query_text'],
      where: {
        query_text: { not: null },
        created_at: { gte: cutoffTime }
      },
      _count: { query_text: true },
      orderBy: { _count: { query_text: 'desc' } },
      take: parseInt(limit)
    });

    // Get trending suggestions
    const trendingSuggestions = await dbRouter.searchSuggestion.findMany({
      where: { is_trending: true },
      orderBy: { search_count: 'desc' },
      take: parseInt(limit)
    });

    res.json({
      success: true,
      trending: {
        queries: trendingQueries.map(t => ({
          query: t.query_text,
          count: t._count.query_text
        })),
        suggestions: trendingSuggestions.map(s => ({
          text: s.suggestion_text,
          count: s.search_count
        }))
      },
      timeframe,
      meta: {
        cutoffTime,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to get trending searches', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get trending searches',
      trending: { queries: [], suggestions: [] }
    });
  }
});

// ================================
// SEARCH ANALYTICS & INSIGHTS
// ================================

/**
 * @desc    Get search strategy analysis (for debugging/optimization)
 * @route   POST /api/v1/search/analyze
 * @access  Private (Admin or Developer)
 */
const analyzeSearchQuery = asyncHandler(async (req, res) => {
  const { query, context = {} } = req.body;

  if (!query) {
    return res.status(400).json({
      success: false,
      error: 'Query is required for analysis',
      error_code: 'MISSING_QUERY'
    });
  }

  try {
    const strategy = analyzeSearchStrategy(query, context);

    // Get search performance stats for this type of query
    const similar_searches = await dbRouter.searchAnalytics.findMany({
      where: {
        query_text: { contains: query, mode: 'insensitive' }
      },
      take: 10,
      orderBy: { created_at: 'desc' }
    });

    res.json({
      success: true,
      analysis: {
        strategy,
        queryComplexity: getQueryComplexity(query),
        estimatedCost: strategy.estimatedCost,
        recommendedApproach: strategy.useAI ? 'ai_enhanced' : 'traditional',
        confidence: strategy.confidenceScore
      },
      historicalData: {
        similarSearches: similar_searches.length,
        averageResults: similar_searches.reduce((acc, s) => acc + s.results_count, 0) / (similar_searches.length || 1),
        averageResponseTime: similar_searches.reduce((acc, s) => acc + (s.response_time_ms || 0), 0) / (similar_searches.length || 1)
      },
      meta: {
        query,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Search analysis failed', { error: error.message, query });
    res.status(500).json({
      success: false,
      error: 'Search analysis failed',
      message: error.message
    });
  }
});

/**
 * @desc    Get search performance metrics
 * @route   GET /api/v1/search/metrics
 * @access  Private (Admin only)
 */
const getSearchMetrics = asyncHandler(async (req, res) => {
  const { timeframe = '24h' } = req.query;

  try {
    const hoursBack = {
      '1h': 1,
      '24h': 24,
      '7d': 24 * 7,
      '30d': 24 * 30
    }[timeframe] || 24;

    const cutoffTime = new Date(Date.now() - (hoursBack * 60 * 60 * 1000));

    // Get comprehensive search metrics
    const [
      totalSearches,
      averageResponseTime,
      queryTypeBreakdown,
      topQueries,
      performanceByStrategy
    ] = await Promise.all([
      // Total searches
      dbRouter.searchAnalytics.count({
        where: { created_at: { gte: cutoffTime } }
      }),

      // Average response time
      dbRouter.searchAnalytics.aggregate({
        where: { created_at: { gte: cutoffTime } },
        _avg: { response_time_ms: true }
      }),

      // Query type breakdown
      dbRouter.searchAnalytics.groupBy({
        by: ['query_type'],
        where: { created_at: { gte: cutoffTime } },
        _count: { query_type: true }
      }),

      // Top queries
      dbRouter.searchAnalytics.groupBy({
        by: ['query_text'],
        where: {
          query_text: { not: null },
          created_at: { gte: cutoffTime }
        },
        _count: { query_text: true },
        orderBy: { _count: { query_text: 'desc' } },
        take: 10
      }),

      // Performance by strategy (if you track this)
      dbRouter.searchAnalytics.findMany({
        where: { created_at: { gte: cutoffTime } },
        select: {
          response_time_ms: true,
          results_count: true,
          query_type: true
        }
      })
    ]);

    res.json({
      success: true,
      metrics: {
        totalSearches,
        averageResponseTime: averageResponseTime._avg.response_time_ms || 0,
        queryTypes: queryTypeBreakdown,
        topQueries: topQueries.map(q => ({
          query: q.query_text,
          count: q._count.query_text
        })),
        performance: {
          averageResultCount: performanceByStrategy.reduce((acc, s) => acc + s.results_count, 0) / (performanceByStrategy.length || 1),
          medianResponseTime: calculateMedian(performanceByStrategy.map(s => s.response_time_ms || 0))
        }
      },
      timeframe,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get search metrics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get search metrics',
      message: error.message
    });
  }
});

// ================================
// UTILITY FUNCTIONS
// ================================

/**
 * Track user interaction for personalization
 * @param {string} userId - User ID
 * @param {string} interactionType - Type of interaction
 * @param {Object} metadata - Additional metadata
 */
const trackUserInteraction = async (userId, interactionType, metadata = {}) => {
  try {
    await dbRouter.userInteraction.create({
      data: {
        user_id: userId,
        listing_id: metadata.listingId || null,
        interaction_type: interactionType,
        metadata: JSON.stringify(metadata)
      }
    });
  } catch (error) {
    logger.error('Failed to track user interaction', { error: error.message, userId, interactionType });
  }
};

/**
 * Calculate query complexity score
 * @param {string} query - Search query
 * @returns {Object} Complexity analysis
 */
const getQueryComplexity = (query) => {
  if (!query) return { score: 0, level: 'none' };

  const words = query.split(/\s+/);
  const hasQuotes = query.includes('"');
  const hasOperators = /\band\b|\bor\b|\bnot\b/i.test(query);
  const hasSpecialChars = /[+\-*"()~]/.test(query);
  
  let score = words.length;
  if (hasQuotes) score += 2;
  if (hasOperators) score += 3;
  if (hasSpecialChars) score += 1;

  const level = score <= 2 ? 'simple' : score <= 5 ? 'moderate' : 'complex';

  return { score, level, factors: { words: words.length, hasQuotes, hasOperators, hasSpecialChars } };
};

/**
 * Calculate median value from array
 * @param {Array} numbers - Array of numbers
 * @returns {number} Median value
 */
const calculateMedian = (numbers) => {
  if (numbers.length === 0) return 0;
  const sorted = numbers.sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Main search endpoints
  searchListings,
  advancedSearch,
  searchByImage,
  searchByImageUrl,
  
  // Autocomplete and suggestions
  getAutocomplete,
  getTrendingSearches,
  
  // Analytics and insights
  analyzeSearchQuery,
  getSearchMetrics,
  
  // Utility functions (for testing)
  trackUserInteraction,
  getQueryComplexity,
  calculateMedian
};