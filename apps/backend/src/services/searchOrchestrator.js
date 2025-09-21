// apps/backend/src/services/searchOrchestrator.js
// Intelligent Search Orchestrator mix AI and traditional search

const logger = require('../utils/logger');
const { dbRouter } = require('../config/db');
const { tryConsume } = require('../utils/rateLimiter');
const {
  analyzeProductAdvanced,
  analyzeSearchIntent,
  getAIRecommendations,
  API_CONFIG
} = require('./searchService-original');

// ================================
// COST OPTIMIZATION CONFIGURATION
// ================================

const SEARCH_CONFIG = {
  // When to use AI vs traditional search
  AI_TRIGGERS: {
    MIN_QUERY_LENGTH: 3,
    COMPLEX_KEYWORDS: ['like', 'similar', 'recommend', 'suggest', 'compare', 'best', 'cheap', 'expensive'],
    AMBIGUOUS_PATTERNS: [/what.*?/, /how.*?/, /where.*?/, /which.*?/, /show me.*?/],
    IMAGE_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
    ALWAYS_AI_CATEGORIES: ['electronics', 'fashion', 'collectibles', 'art']
  },
  
  // Cache settings to reduce AI calls
  CACHE: {
    INTENT_ANALYSIS_TTL: 3600, // 1 hour
    PRODUCT_ANALYSIS_TTL: 7200, // 2 hours  
    SEARCH_RESULTS_TTL: 900,    // 15 minutes
    AUTOCOMPLETE_TTL: 1800      // 30 minutes
  },
  
  // Performance thresholds
  PERFORMANCE: {
    MAX_AI_RESPONSE_TIME: 5000,
    MAX_TRADITIONAL_RESPONSE_TIME: 1000,
    SIMILARITY_THRESHOLD: 0.7,
    MAX_RESULTS_PER_QUERY: 50
  }
};

// ================================
// INTELLIGENT SEARCH DECISION ENGINE
// ================================

/**
 * Decides whether to use AI or traditional search based on query analysis
 * @param {string} query - Search query
 * @param {Object} context - User context and filters
 * @returns {Object} Search strategy decision
 */
const analyzeSearchStrategy = (query, context = {}) => {
  const strategy = {
    useAI: false,
    useTraditional: true,
    aiReason: null,
    traditionalReason: 'default',
    confidenceScore: 0,
    estimatedCost: 0
  };

  // Quick traditional search for simple cases
  if (!query || query.length < SEARCH_CONFIG.AI_TRIGGERS.MIN_QUERY_LENGTH) {
    strategy.traditionalReason = 'query_too_short';
    strategy.confidenceScore = 0.9;
    return strategy;
  }

  // Check for complex query patterns that benefit from AI
  const hasComplexKeywords = SEARCH_CONFIG.AI_TRIGGERS.COMPLEX_KEYWORDS.some(
    keyword => query.toLowerCase().includes(keyword)
  );
  
  const hasAmbiguousPattern = SEARCH_CONFIG.AI_TRIGGERS.AMBIGUOUS_PATTERNS.some(
    pattern => pattern.test(query.toLowerCase())
  );

  // Check if query involves categories that benefit from AI understanding
  const involvesBeneficialCategory = SEARCH_CONFIG.AI_TRIGGERS.ALWAYS_AI_CATEGORIES.some(
    category => query.toLowerCase().includes(category)
  );

  // Check for image search
  const isImageSearch = context.hasImage || SEARCH_CONFIG.AI_TRIGGERS.IMAGE_EXTENSIONS.some(
    ext => query.includes(ext)
  );

  // Decision logic
  if (isImageSearch) {
    strategy.useAI = true;
    strategy.aiReason = 'image_search_required';
    strategy.confidenceScore = 0.95;
    strategy.estimatedCost = API_CONFIG.GEMINI.ESTIMATED_COST;
  } else if (hasComplexKeywords || hasAmbiguousPattern) {
    strategy.useAI = true;
    strategy.aiReason = 'complex_query_benefits_from_ai';
    strategy.confidenceScore = 0.8;
    strategy.estimatedCost = API_CONFIG.GEMINI.ESTIMATED_COST;
  } else if (involvesBeneficialCategory) {
    strategy.useAI = true;
    strategy.aiReason = 'category_benefits_from_ai_understanding';
    strategy.confidenceScore = 0.7;
    strategy.estimatedCost = API_CONFIG.GEMINI.ESTIMATED_COST;
  } else if (context.userPreferences?.preferAI || context.isSubscribedUser) {
    strategy.useAI = true;
    strategy.aiReason = 'user_preference_or_subscription';
    strategy.confidenceScore = 0.6;
    strategy.estimatedCost = API_CONFIG.GEMINI.ESTIMATED_COST;
  }

  // Override AI if rate limited or API issues
  const rateLimitCheck = tryConsume('gemini', 15, false); // Don't consume, just check
  if (strategy.useAI && !rateLimitCheck.allowed) {
    strategy.useAI = false;
    strategy.traditionalReason = 'ai_rate_limited';
    strategy.confidenceScore = 0.8;
  }

  logger.debug('Search strategy analysis', {
    query,
    strategy,
    hasComplexKeywords,
    hasAmbiguousPattern,
    involvesBeneficialCategory,
    isImageSearch
  });

  return strategy;
};

// ================================
// TRADITIONAL POSTGRESQL SEARCH
// ================================

/**
 * High-performance traditional search using PostgreSQL
 * @param {string} query - Search query
 * @param {Object} filters - Search filters
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} Search results
 */
const executeTraditionalSearch = async (query, filters = {}, pagination = {}) => {
  const startTime = Date.now();
  
  try {
    const {
      category_id,
      min_price,
      max_price,
      condition,
      location,
      vendor_id,
      is_featured
    } = filters;

    const {
      page = 1,
      limit = 20,
      sort_by = 'created_at',
      sort_order = 'desc'
    } = pagination;

    const offset = (page - 1) * limit;

    // Build dynamic WHERE clause
    const whereConditions = ['l.status = $1']; // Only active listings
    const queryParams = ['ACTIVE'];
    let paramIndex = 2;

    // Text search using PostgreSQL's full-text search
    if (query && query.trim()) {
      whereConditions.push(`(
        to_tsvector('english', l.title || ' ' || l.description) @@ plainto_tsquery('english', $${paramIndex})
        OR l.title ILIKE $${paramIndex + 1}
        OR l.description ILIKE $${paramIndex + 2}
        OR $${paramIndex + 3} = ANY(l.tags)
      )`);
      queryParams.push(
        query,
        `%${query}%`,
        `%${query}%`,
        query.toLowerCase()
      );
      paramIndex += 4;
    }

    // Apply filters
    if (category_id) {
      whereConditions.push(`l.category_id = $${paramIndex}`);
      queryParams.push(category_id);
      paramIndex++;
    }

    if (min_price !== undefined) {
      whereConditions.push(`l.price >= $${paramIndex}`);
      queryParams.push(min_price);
      paramIndex++;
    }

    if (max_price !== undefined) {
      whereConditions.push(`l.price <= $${paramIndex}`);
      queryParams.push(max_price);
      paramIndex++;
    }

    if (condition) {
      whereConditions.push(`l.condition = $${paramIndex}`);
      queryParams.push(condition);
      paramIndex++;
    }

    if (location) {
      whereConditions.push(`l.location ILIKE $${paramIndex}`);
      queryParams.push(`%${location}%`);
      paramIndex++;
    }

    if (vendor_id) {
      whereConditions.push(`l.vendor_id = $${paramIndex}`);
      queryParams.push(vendor_id);
      paramIndex++;
    }

    if (is_featured !== undefined) {
      whereConditions.push(`l.is_featured = $${paramIndex}`);
      queryParams.push(is_featured);
      paramIndex++;
    }

    // Build ORDER BY clause
    const sortMapping = {
      'created_at': 'l.created_at',
      'updated_at': 'l.updated_at',
      'price': 'l.price',
      'title': 'l.title',
      'views_count': 'l.views_count',
      'likes_count': 'l.likes_count',
      'relevance': query ? 'ts_rank(to_tsvector(\'english\', l.title || \' \' || l.description), plainto_tsquery(\'english\', $2))' : 'l.created_at'
    };

    const orderBy = sortMapping[sort_by] || sortMapping['created_at'];
    const direction = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Main query
    const searchQuery = `
      SELECT 
        l.id,
        l.title,
        l.description,
        l.price,
        l.condition,
        l.category_id,
        l.vendor_id,
        l.is_featured,
        l.views_count,
        l.likes_count,
        l.created_at,
        l.updated_at,
        c.name as category_name,
        u.username as vendor_username,
        u.display_name as vendor_display_name,
        u.is_verified as vendor_verified,
        (
          SELECT json_agg(
            json_build_object(
              'id', li.id,
              'url', li.url,
              'is_primary', li.is_primary
            )
          )
          FROM listing_images li 
          WHERE li.listing_id = l.id 
          ORDER BY li.is_primary DESC, li.order_pos ASC
          LIMIT 3
        ) as images,
        ${query ? `ts_rank(to_tsvector('english', l.title || ' ' || l.description), plainto_tsquery('english', $2)) as relevance_score` : '0 as relevance_score'}
      FROM listings l
      LEFT JOIN categories c ON l.category_id = c.id
      LEFT JOIN users u ON l.vendor_id = u.id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY ${orderBy} ${direction}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, offset);

    // Execute search with count
    const [results, countResult] = await Promise.all([
      dbRouter.$queryRawUnsafe(searchQuery, ...queryParams),
      dbRouter.$queryRawUnsafe(
        `SELECT COUNT(*) as total FROM listings l 
         LEFT JOIN categories c ON l.category_id = c.id
         WHERE ${whereConditions.join(' AND ')}`,
        ...queryParams.slice(0, -2) // Remove limit and offset
      )
    ]);

    const total = parseInt(countResult[0].total, 10);
    const totalPages = Math.ceil(total / limit);
    const responseTime = Date.now() - startTime;

    logger.info('Traditional search executed', {
      query,
      resultCount: results.length,
      total,
      responseTime,
      strategy: 'traditional'
    });

    return {
      success: true,
      results,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      performance: {
        responseTime,
        strategy: 'traditional',
        source: 'postgresql'
      },
      filters: filters,
      query: query
    };

  } catch (error) {
    logger.error('Traditional search failed', {
      error: error.message,
      query,
      filters
    });

    return {
      success: false,
      error: error.message,
      results: [],
      performance: {
        responseTime: Date.now() - startTime,
        strategy: 'traditional',
        failed: true
      }
    };
  }
};

// ================================
// AI-ENHANCED SEARCH
// ================================

/**
 * AI-enhanced search using Gemini for complex queries
 * @param {string} query - Search query
 * @param {Object} filters - Search filters
 * @param {Object} pagination - Pagination options
 * @param {Object} context - User context
 * @returns {Promise<Object>} Enhanced search results
 */
const executeAIEnhancedSearch = async (query, filters = {}, pagination = {}, context = {}) => {
  const startTime = Date.now();
  
  try {
    logger.debug('Starting AI-enhanced search', { query, filters });

    // Step 1: Analyze search intent with Gemini
    const intentAnalysis = await analyzeSearchIntent(query, context);
    
    let enhancedQuery = query;
    let enhancedFilters = { ...filters };
    
    if (intentAnalysis.success && intentAnalysis.strategy) {
      // Use AI insights to enhance search
      const strategy = intentAnalysis.strategy;
      
      if (strategy.searchStrategy?.expandedKeywords) {
        enhancedQuery = strategy.searchStrategy.expandedKeywords.join(' ');
      }
      
      if (strategy.searchStrategy?.recommendedFilters) {
        enhancedFilters = { ...enhancedFilters, ...strategy.searchStrategy.recommendedFilters };
      }
      
      logger.debug('AI intent analysis completed', {
        originalQuery: query,
        enhancedQuery,
        primaryIntent: strategy.searchIntent?.primaryIntent,
        expandedKeywords: strategy.searchStrategy?.expandedKeywords?.length
      });
    }

    // Step 2: Execute enhanced traditional search with AI insights
    const searchResults = await executeTraditionalSearch(enhancedQuery, enhancedFilters, pagination);
    
    if (!searchResults.success) {
      return searchResults;
    }

    // Step 3: AI-powered result re-ranking (for complex queries)
    if (intentAnalysis.success && searchResults.results.length > 0) {
      searchResults.results = await reRankResultsWithAI(searchResults.results, query, intentAnalysis);
    }

    const responseTime = Date.now() - startTime;
    
    logger.info('AI-enhanced search completed', {
      query,
      enhancedQuery,
      resultCount: searchResults.results.length,
      responseTime,
      aiUsed: intentAnalysis.success
    });

    return {
      ...searchResults,
      performance: {
        ...searchResults.performance,
        responseTime,
        strategy: 'ai_enhanced',
        aiAnalysis: intentAnalysis.success,
        source: 'gemini_postgresql'
      },
      aiInsights: intentAnalysis.success ? {
        primaryIntent: intentAnalysis.strategy?.searchIntent?.primaryIntent,
        expandedKeywords: intentAnalysis.strategy?.searchStrategy?.expandedKeywords,
        confidence: intentAnalysis.strategy?.confidence || 0
      } : null
    };

  } catch (error) {
    logger.error('AI-enhanced search failed, falling back to traditional', {
      error: error.message,
      query,
      filters
    });

    // Fallback to traditional search
    const fallbackResults = await executeTraditionalSearch(query, filters, pagination);
    return {
      ...fallbackResults,
      performance: {
        ...fallbackResults.performance,
        strategy: 'fallback_traditional',
        aiError: error.message
      }
    };
  }
};

// ================================
// IMAGE SEARCH WITH GEMINI VISION
// ================================

/**
 * Image-based search using Gemini Vision
 * @param {Buffer} imageBuffer - Image buffer
 * @param {string} mimeType - Image MIME type
 * @param {Object} filters - Additional filters
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} Image search results
 */
const executeImageSearch = async (imageBuffer, mimeType, filters = {}, pagination = {}) => {
  const startTime = Date.now();
  
  try {
    logger.debug('Starting image search with Gemini Vision');

    // Step 1: Analyze image with Gemini
    const imageAnalysis = await analyzeProductAdvanced(imageBuffer, 'image', {
      includeMarketData: true,
      includePriceEstimate: true,
      includeSearchOptimization: true
    });

    if (!imageAnalysis.success) {
      throw new Error(`Image analysis failed: ${imageAnalysis.error}`);
    }

    const analysis = imageAnalysis.analysis;
    
    // Step 2: Convert AI analysis to search terms and filters
    const searchTerms = [];
    const aiEnhancedFilters = { ...filters };

    if (analysis.productInfo) {
      if (analysis.productInfo.category) {
        // Find category ID by name
        const category = await dbRouter.category.findFirst({
          where: { name: { contains: analysis.productInfo.category, mode: 'insensitive' } }
        });
        if (category) {
          aiEnhancedFilters.category_id = category.id;
        }
      }

      if (analysis.productInfo.brand) {
        searchTerms.push(analysis.productInfo.brand);
      }

      if (analysis.productInfo.model) {
        searchTerms.push(analysis.productInfo.model);
      }

      if (analysis.productInfo.condition) {
        aiEnhancedFilters.condition = analysis.productInfo.condition.toUpperCase();
      }
    }

    if (analysis.marketplaceData?.keyFeatures) {
      searchTerms.push(...analysis.marketplaceData.keyFeatures);
    }

    if (analysis.marketplaceData?.estimatedPriceRange) {
      const priceRange = analysis.marketplaceData.estimatedPriceRange;
      if (priceRange.min && !aiEnhancedFilters.min_price) {
        aiEnhancedFilters.min_price = Math.max(0, priceRange.min * 0.7); // 30% below estimated
      }
      if (priceRange.max && !aiEnhancedFilters.max_price) {
        aiEnhancedFilters.max_price = priceRange.max * 1.3; // 30% above estimated
      }
    }

    // Step 3: Execute search with AI-extracted terms
    const searchQuery = searchTerms.join(' ');
    const searchResults = await executeTraditionalSearch(searchQuery, aiEnhancedFilters, pagination);

    const responseTime = Date.now() - startTime;

    logger.info('Image search completed', {
      searchTerms,
      resultCount: searchResults.results?.length || 0,
      responseTime,
      aiAnalysis: !!analysis
    });

    return {
      ...searchResults,
      imageAnalysis: analysis,
      extractedSearchTerms: searchTerms,
      performance: {
        responseTime,
        strategy: 'image_search',
        source: 'gemini_vision_postgresql'
      }
    };

  } catch (error) {
    logger.error('Image search failed', {
      error: error.message,
      mimeType
    });

    return {
      success: false,
      error: error.message,
      results: [],
      performance: {
        responseTime: Date.now() - startTime,
        strategy: 'image_search',
        failed: true
      }
    };
  }
};

// ================================
// SMART AUTOCOMPLETE
// ================================

/**
 * Smart autocomplete with caching and AI enhancement
 * @param {string} partialQuery - Partial search query
 * @param {Object} context - User context
 * @returns {Promise<Object>} Autocomplete suggestions
 */
const getSmartAutocomplete = async (partialQuery, context = {}) => {
  if (!partialQuery || partialQuery.length < 2) {
    return { success: true, suggestions: [] };
  }

  try {
    // Check cache first
    const cacheKey = `autocomplete:${partialQuery.toLowerCase()}`;
    // Note: Implement Redis caching here in production

    // Get suggestions from multiple sources
    const [searchSuggestions, productTitles, categories] = await Promise.all([
      // Popular search suggestions
      dbRouter.searchSuggestion.findMany({
        where: {
          suggestion_text: {
            contains: partialQuery,
            mode: 'insensitive'
          }
        },
        orderBy: { search_count: 'desc' },
        take: 5
      }),

      // Product titles
      dbRouter.listing.findMany({
        where: {
          AND: [
            { status: 'ACTIVE' },
            {
              OR: [
                { title: { contains: partialQuery, mode: 'insensitive' } },
                { tags: { hasSome: [partialQuery.toLowerCase()] } }
              ]
            }
          ]
        },
        select: { title: true },
        orderBy: { views_count: 'desc' },
        take: 5
      }),

      // Categories
      dbRouter.category.findMany({
        where: {
          name: { contains: partialQuery, mode: 'insensitive' }
        },
        take: 3
      })
    ]);

    const suggestions = [
      ...searchSuggestions.map(s => ({ 
        text: s.suggestion_text, 
        type: 'suggestion',
        popularity: s.search_count 
      })),
      ...productTitles.map(p => ({ 
        text: p.title, 
        type: 'product' 
      })),
      ...categories.map(c => ({ 
        text: c.name, 
        type: 'category' 
      }))
    ];

    return {
      success: true,
      suggestions: suggestions.slice(0, 10),
      query: partialQuery
    };

  } catch (error) {
    logger.error('Autocomplete failed', { error: error.message, partialQuery });
    return {
      success: false,
      error: error.message,
      suggestions: []
    };
  }
};

// ================================
// AI RESULT RE-RANKING
// ================================

/**
 * Re-rank search results using AI insights
 * @param {Array} results - Search results
 * @param {string} originalQuery - Original search query
 * @param {Object} intentAnalysis - AI intent analysis
 * @returns {Promise<Array>} Re-ranked results
 */
const reRankResultsWithAI = async (results, originalQuery, intentAnalysis) => {
  try {
    if (!intentAnalysis.strategy?.searchStrategy?.rankingFactors) {
      return results; // No AI ranking guidance
    }

    const rankingFactors = intentAnalysis.strategy.searchStrategy.rankingFactors;
    
    // Apply AI-suggested ranking modifications
    return results.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;

      rankingFactors.forEach(factor => {
        switch (factor) {
          case 'price_low_to_high':
            scoreA += parseFloat(a.price);
            scoreB += parseFloat(b.price);
            break;
          case 'price_high_to_low':
            scoreA -= parseFloat(a.price);
            scoreB -= parseFloat(b.price);
            break;
          case 'popularity':
            scoreA -= (a.views_count + a.likes_count);
            scoreB -= (b.views_count + b.likes_count);
            break;
          case 'recency':
            scoreA -= new Date(a.created_at).getTime();
            scoreB -= new Date(b.created_at).getTime();
            break;
          case 'relevance':
            scoreA -= (a.relevance_score || 0);
            scoreB -= (b.relevance_score || 0);
            break;
        }
      });

      return scoreA - scoreB;
    });

  } catch (error) {
    logger.error('AI re-ranking failed', { error: error.message });
    return results; // Return original order if re-ranking fails
  }
};

// ================================
// MASTER SEARCH ORCHESTRATOR
// ================================

/**
 * Master search function that intelligently routes to the best search strategy
 * @param {Object} searchRequest - Complete search request
 * @returns {Promise<Object>} Optimized search results
 */
const executeIntelligentSearch = async (searchRequest) => {
  const {
    query,
    imageBuffer,
    imageMimeType,
    filters = {},
    pagination = {},
    context = {}
  } = searchRequest;

  const searchId = `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  logger.info('Starting intelligent search', { 
    searchId, 
    query, 
    hasImage: !!imageBuffer,
    filters 
  });

  try {
    let results;

    // Route to appropriate search method
    if (imageBuffer) {
      // Image search always uses AI
      results = await executeImageSearch(imageBuffer, imageMimeType, filters, pagination);
    } else if (query) {
      // Analyze strategy for text search
      const strategy = analyzeSearchStrategy(query, context);
      
      if (strategy.useAI) {
        results = await executeAIEnhancedSearch(query, filters, pagination, context);
      } else {
        results = await executeTraditionalSearch(query, filters, pagination);
      }
    } else {
      // No query or image - return featured/recent listings
      results = await executeTraditionalSearch('', { is_featured: true }, pagination);
    }

    // Log search analytics
    await logSearchAnalytics({
      searchId,
      query,
      hasImage: !!imageBuffer,
      strategy: results.performance?.strategy,
      resultCount: results.results?.length || 0,
      responseTime: results.performance?.responseTime,
      userId: context.userId,
      filters
    });

    return {
      ...results,
      searchId,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    logger.error('Intelligent search failed', {
      searchId,
      error: error.message,
      query,
      hasImage: !!imageBuffer
    });

    return {
      success: false,
      error: error.message,
      searchId,
      results: [],
      timestamp: new Date().toISOString()
    };
  }
};

// ================================
// SEARCH ANALYTICS LOGGING
// ================================

/**
 * Log search analytics for optimization
 * @param {Object} analyticsData - Search analytics data
 */
const logSearchAnalytics = async (analyticsData) => {
  try {
    await dbRouter.searchAnalytics.create({
      data: {
        user_id: analyticsData.userId || null,
        query_text: analyticsData.query || null,
        query_type: analyticsData.hasImage ? 'image' : 'text',
        filters_applied: analyticsData.filters || {},
        results_count: analyticsData.resultCount || 0,
        session_id: analyticsData.searchId,
        response_time_ms: analyticsData.responseTime || 0
      }
    });

    // Update search suggestions if it's a text query with results
    if (analyticsData.query && analyticsData.resultCount > 0) {
      await dbRouter.searchSuggestion.upsert({
        where: { suggestion_text: analyticsData.query.toLowerCase() },
        update: { search_count: { increment: 1 } },
        create: {
          suggestion_text: analyticsData.query.toLowerCase(),
          search_count: 1
        }
      });
    }

  } catch (error) {
    logger.error('Failed to log search analytics', { error: error.message, analyticsData });
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Main search functions
  executeIntelligentSearch,
  executeTraditionalSearch,
  executeAIEnhancedSearch,
  executeImageSearch,
  getSmartAutocomplete,
  
  // Utility functions
  analyzeSearchStrategy,
  reRankResultsWithAI,
  logSearchAnalytics,
  
  // Configuration
  SEARCH_CONFIG
};