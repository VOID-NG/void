// apps/backend/src/services/searchService-complete.js
// Complete Search Service with all missing functions implemented

const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { dbRouter } = require('../config/db');
const logger = require('../utils/logger');
const { tryConsume, trackAICost } = require('../utils/rateLimiter');

// ================================
// CONFIGURATION
// ================================

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_RPM = parseInt(process.env.GEMINI_RPM || '15', 10);

const API_CONFIG = {
  GEMINI: {
    MODEL: GEMINI_MODEL,
    CAPABILITIES: {
      structuredOutputs: true,
      functionCalling: true,
      searchGrounding: true,
      videoAnalysis: true,
      audioAnalysis: true,
      codeExecution: true,
      urlContext: true,
      thinking: true
    },
    LIMITS: {
      INPUT_TOKENS: 1000000,
      OUTPUT_TOKENS: 64000,
      SUPPORTED_TYPES: ['text', 'images', 'video', 'audio']
    },
    ESTIMATED_COST: 0.002,
    TIMEOUT: 45000
  },
  
  SIMILARITY_THRESHOLD: 0.65,
  MAX_RESULTS: 50,
  ENABLE_ADVANCED_FEATURES: (process.env.ENABLE_ADVANCED_FEATURES === 'true')
};

// ================================
// STRUCTURED SCHEMAS FOR GEMINI
// ================================

const STRUCTURED_SCHEMAS = {
  PRODUCT_ANALYSIS: {
    type: "object",
    properties: {
      productInfo: {
        type: "object",
        properties: {
          category: { type: "string" },
          brand: { type: "string" },
          model: { type: "string" },
          condition: { type: "string" },
          color: { type: "string" },
          size: { type: "string" }
        }
      },
      marketplaceData: {
        type: "object",
        properties: {
          estimatedPriceRange: {
            type: "object",
            properties: {
              min: { type: "number" },
              max: { type: "number" }
            }
          },
          keyFeatures: {
            type: "array",
            items: { type: "string" }
          },
          searchKeywords: {
            type: "array",
            items: { type: "string" }
          },
          marketDemand: { type: "string" },
          competitiveProducts: {
            type: "array",
            items: { type: "string" }
          }
        }
      },
      confidence: { type: "number" }
    }
  },

  SEARCH_ANALYSIS: {
    type: "object",
    properties: {
      searchIntent: {
        type: "object",
        properties: {
          primaryIntent: { type: "string" },
          urgency: { type: "string" },
          priceRange: { type: "string" },
          qualityPreference: { type: "string" }
        }
      },
      searchStrategy: {
        type: "object",
        properties: {
          expandedKeywords: {
            type: "array",
            items: { type: "string" }
          },
          recommendedFilters: { type: "object" },
          rankingFactors: {
            type: "array",
            items: { type: "string" }
          }
        }
      },
      confidence: { type: "number" }
    }
  }
};

// ================================
// GEMINI INITIALIZATION
// ================================

const initializeGemini = () => {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Google Gemini API key not configured');
  }
  return new GoogleGenerativeAI(apiKey);
};

// ================================
// PRODUCT ANALYSIS
// ================================

/**
 * Advanced product analysis using Gemini structured outputs
 * @param {string|Buffer} mediaInput - Image URL, video URL, or media buffer
 * @param {string} mediaType - 'image', 'video', or 'audio'
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} Structured product analysis
 */
const analyzeProductAdvanced = async (mediaInput, mediaType = 'image', options = {}) => {
  try {
    const { 
      includeMarketData = true,
      includePriceEstimate = true,
      includeSearchOptimization = true 
    } = options;

    logger.debug('Starting advanced product analysis', { 
      mediaType, 
      model: API_CONFIG.GEMINI.MODEL 
    });

    // Rate limit guard
    const rl = tryConsume('gemini', GEMINI_RPM);
    if (!rl.allowed) {
      logger.warn('Gemini rate limited for product analysis', { waitMs: rl.waitMs });
      return {
        success: false,
        error: `rate_limited_wait_${rl.waitMs}`,
        fallback: await simpleProductAnalysis(mediaInput, mediaType)
      };
    }

    const genAI = initializeGemini();
    const model = genAI.getGenerativeModel({ 
      model: API_CONFIG.GEMINI.MODEL,
      ...(API_CONFIG.ENABLE_ADVANCED_FEATURES ? {
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: STRUCTURED_SCHEMAS.PRODUCT_ANALYSIS
        }
      } : {})
    });

    // Prepare media part based on input type
    let mediaPart;
    if (Buffer.isBuffer(mediaInput)) {
      const mimeType = mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
      mediaPart = {
        inlineData: {
          data: mediaInput.toString('base64'),
          mimeType: mimeType
        }
      };
    } else if (typeof mediaInput === 'string') {
      // URL input
      try {
        const response = await axios.get(mediaInput, { 
          responseType: 'arraybuffer',
          timeout: 10000,
          maxContentLength: 10 * 1024 * 1024
        });
        const imageBase64 = Buffer.from(response.data).toString('base64');
        const mimeType = response.headers['content-type'] || 'image/jpeg';
        
        mediaPart = {
          inlineData: {
            data: imageBase64,
            mimeType: mimeType
          }
        };
      } catch (error) {
        throw new Error(`Failed to fetch media from URL: ${error.message}`);
      }
    } else {
      throw new Error('Invalid media input type');
    }

    // Create comprehensive prompt
    const prompt = `Analyze this ${mediaType} and provide comprehensive product information.

Key Analysis Areas:
1. Product identification (category, brand, model, condition)
2. Market value estimation based on current trends
3. Key features and selling points
4. Search optimization recommendations
5. Market demand assessment

Use your search grounding capability to verify current market prices and trends where possible.

Provide detailed, accurate analysis optimized for marketplace listings.`;

    const result = await model.generateContent([prompt, mediaPart]);
    const analysisText = result.response.text();
    
    // Parse structured JSON response
    let analysis;
    try {
      analysis = JSON.parse(analysisText);
    } catch (parseErr) {
      logger.warn('Failed to parse structured analysis JSON, using simple fallback');
      return {
        success: false,
        error: 'parse_error',
        fallback: await simpleProductAnalysis(mediaInput, mediaType)
      };
    }

    // Track AI cost
    trackAICost('gemini', API_CONFIG.GEMINI.ESTIMATED_COST);

    logger.debug('Advanced product analysis completed', {
      category: analysis.productInfo?.category,
      brand: analysis.productInfo?.brand,
      estimatedPrice: analysis.marketplaceData?.estimatedPriceRange,
      features: analysis.marketplaceData?.keyFeatures?.length || 0
    });

    return {
      success: true,
      analysis,
      model: API_CONFIG.GEMINI.MODEL,
      capabilities: 'structured_outputs',
      estimatedCost: API_CONFIG.GEMINI.ESTIMATED_COST
    };

  } catch (error) {
    logger.error('Advanced product analysis failed:', error);
    
    return {
      success: false,
      error: error.message,
      fallback: await simpleProductAnalysis(mediaInput, mediaType)
    };
  }
};

/**
 * Simple fallback product analysis
 * @param {any} mediaInput - Media input
 * @param {string} mediaType - Media type
 * @returns {Promise<Object>} Basic analysis
 */
const simpleProductAnalysis = async (mediaInput, mediaType) => {
  try {
    // Basic analysis without AI
    return {
      success: true,
      analysis: {
        productInfo: {
          category: 'unknown',
          condition: 'GOOD'
        },
        marketplaceData: {
          estimatedPriceRange: { min: 10, max: 1000 },
          keyFeatures: ['product'],
          searchKeywords: ['item', 'product']
        },
        confidence: 0.1
      },
      fallback: true
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      fallback: true
    };
  }
};

// ================================
// SEARCH INTENT ANALYSIS
// ================================

/**
 * Intelligent search query analysis and expansion
 * @param {string} searchQuery - User's search query
 * @param {Object} context - Additional context
 * @returns {Promise<Object>} Enhanced search strategy
 */
const analyzeSearchIntent = async (searchQuery, context = {}) => {
  try {
    logger.debug('Analyzing search intent with Gemini 2.5', { searchQuery });

    const rl = tryConsume('gemini', GEMINI_RPM);
    if (!rl.allowed) {
      logger.warn('Gemini rate limited for search intent', { waitMs: rl.waitMs });
      return {
        success: false,
        fallback: {
          expandedKeywords: searchQuery.split(' '),
          basicStrategy: true
        }
      };
    }

    const genAI = initializeGemini();
    const model = genAI.getGenerativeModel({ 
      model: API_CONFIG.GEMINI.MODEL,
      ...(API_CONFIG.ENABLE_ADVANCED_FEATURES ? {
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: STRUCTURED_SCHEMAS.SEARCH_ANALYSIS
        }
      } : {})
    });

    const prompt = `Analyze this marketplace search query and determine the optimal search strategy.

Search Query: "${searchQuery}"
User Context: ${JSON.stringify(context)}

Analyze:
1. User's primary intent (buying, selling, researching)
2. Specific product requirements
3. Price sensitivity indicators
4. Preferred condition/quality level
5. Optimal search expansion keywords
6. Recommended filters and ranking factors

Use search grounding to understand current market trends for this product category.

Provide actionable search optimization recommendations.`;

    const result = await model.generateContent(prompt);
    const strategyText = result.response.text();
    
    let strategy;
    try {
      strategy = JSON.parse(strategyText);
    } catch (parseErr) {
      return {
        success: false,
        fallback: {
          expandedKeywords: searchQuery.split(' '),
          basicStrategy: true
        }
      };
    }

    trackAICost('gemini', API_CONFIG.GEMINI.ESTIMATED_COST);

    logger.debug('Search intent analysis completed', {
      primaryIntent: strategy.searchIntent?.primaryIntent,
      expandedKeywords: strategy.searchStrategy?.expandedKeywords?.length || 0
    });

    return {
      success: true,
      strategy,
      model: API_CONFIG.GEMINI.MODEL,
      capabilities: 'search_grounding'
    };

  } catch (error) {
    logger.error('Search intent analysis failed:', error);
    
    return {
      success: false,
      fallback: {
        expandedKeywords: searchQuery.split(' '),
        basicStrategy: true
      }
    };
  }
};

// ================================
// RECOMMENDATIONS
// ================================

/**
 * Get AI-powered recommendations for users
 * @param {string} userId - User ID
 * @param {Object} context - User context and preferences
 * @returns {Promise<Object>} Personalized recommendations
 */
const getAIRecommendations = async (userId, context = {}) => {
  try {
    logger.debug('Generating AI recommendations', { userId });

    // Get user interaction history
    const userInteractions = await dbRouter.userInteraction.findMany({
      where: { user_id: userId },
      include: { listing: { include: { category: true } } },
      orderBy: { created_at: 'desc' },
      take: 50
    });

    // Get user's recent searches
    const recentSearches = await dbRouter.searchAnalytics.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 20
    });

    // Extract user preferences
    const userPreferences = extractUserPreferences(userInteractions, recentSearches);

    // Get trending listings in user's preferred categories
    const trendingListings = await dbRouter.listing.findMany({
      where: {
        status: 'ACTIVE',
        category_id: { in: userPreferences.preferredCategories },
        created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      },
      include: { category: true, images: true },
      orderBy: [
        { views_count: 'desc' },
        { likes_count: 'desc' },
        { created_at: 'desc' }
      ],
      take: 20
    });

    // Use AI to enhance recommendations if available
    let aiEnhancedRecommendations = null;
    
    if (userPreferences.searchHistory.length > 0) {
      const rl = tryConsume('gemini', GEMINI_RPM);
      if (rl.allowed) {
        try {
          aiEnhancedRecommendations = await generateAIRecommendations(
            userPreferences,
            trendingListings
          );
          trackAICost('gemini', API_CONFIG.GEMINI.ESTIMATED_COST);
        } catch (error) {
          logger.warn('AI recommendation generation failed:', error.message);
        }
      }
    }

    // Combine and rank recommendations
    const recommendations = combineRecommendations(
      trendingListings,
      userPreferences,
      aiEnhancedRecommendations
    );

    return {
      success: true,
      recommendations: recommendations.slice(0, 10),
      insights: {
        userPreferences,
        aiEnhanced: !!aiEnhancedRecommendations,
        totalCandidates: trendingListings.length
      },
      performance: {
        strategy: aiEnhancedRecommendations ? 'ai_enhanced' : 'collaborative',
        responseTime: Date.now()
      }
    };

  } catch (error) {
    logger.error('Failed to generate recommendations:', error);
    
    // Fallback to basic trending items
    const fallbackListings = await dbRouter.listing.findMany({
      where: { status: 'ACTIVE', is_featured: true },
      include: { category: true, images: true },
      orderBy: { created_at: 'desc' },
      take: 10
    });

    return {
      success: false,
      error: error.message,
      recommendations: fallbackListings,
      fallback: true
    };
  }
};

/**
 * Extract user preferences from interaction history
 * @param {Array} interactions - User interactions
 * @param {Array} searches - Recent searches
 * @returns {Object} User preferences
 */
const extractUserPreferences = (interactions, searches) => {
  const categoryCount = {};
  const priceRanges = [];
  const searchTerms = [];

  // Analyze interactions
  interactions.forEach(interaction => {
    if (interaction.listing?.category) {
      const categoryId = interaction.listing.category_id;
      categoryCount[categoryId] = (categoryCount[categoryId] || 0) + 1;
    }
    
    if (interaction.listing?.price) {
      priceRanges.push(parseFloat(interaction.listing.price));
    }
  });

  // Analyze searches
  searches.forEach(search => {
    if (search.query_text) {
      searchTerms.push(search.query_text);
    }
  });

  // Calculate preferences
  const preferredCategories = Object.entries(categoryCount)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([categoryId]) => categoryId);

  const avgPrice = priceRanges.length > 0 
    ? priceRanges.reduce((a, b) => a + b, 0) / priceRanges.length
    : 500;

  return {
    preferredCategories,
    priceRange: {
      min: Math.max(0, avgPrice * 0.5),
      max: avgPrice * 2
    },
    searchHistory: searchTerms.slice(0, 10),
    interactionCount: interactions.length
  };
};

/**
 * Generate AI-enhanced recommendations
 * @param {Object} userPreferences - User preferences
 * @param {Array} candidates - Candidate listings
 * @returns {Promise<Object>} AI recommendations
 */
const generateAIRecommendations = async (userPreferences, candidates) => {
  const genAI = initializeGemini();
  const model = genAI.getGenerativeModel({ model: API_CONFIG.GEMINI.MODEL });

  const prompt = `Based on this user's preferences and behavior, rank and recommend the most relevant products.

User Preferences:
- Recent searches: ${userPreferences.searchHistory.join(', ')}
- Price range: $${userPreferences.priceRange.min} - $${userPreferences.priceRange.max}
- Interaction count: ${userPreferences.interactionCount}

Available Products:
${candidates.map(listing => 
  `- ${listing.title} ($${listing.price}) - ${listing.category?.name || 'Unknown'}`
).join('\n')}

Provide personalized ranking with reasoning for top 5 recommendations.`;

  const result = await model.generateContent(prompt);
  return result.response.text();
};

/**
 * Combine different recommendation sources
 * @param {Array} listings - Base listings
 * @param {Object} preferences - User preferences  
 * @param {Object} aiRecommendations - AI recommendations
 * @returns {Array} Combined recommendations
 */
const combineRecommendations = (listings, preferences, aiRecommendations) => {
  return listings.map(listing => {
    let score = 0;
    
    // Category preference boost
    if (preferences.preferredCategories.includes(listing.category_id)) {
      score += 10;
    }
    
    // Price preference boost
    const price = parseFloat(listing.price);
    if (price >= preferences.priceRange.min && price <= preferences.priceRange.max) {
      score += 5;
    }
    
    // Popularity boost
    score += (listing.views_count || 0) * 0.01;
    score += (listing.likes_count || 0) * 0.1;
    
    // Recency boost
    const daysOld = (Date.now() - new Date(listing.created_at)) / (24 * 60 * 60 * 1000);
    score += Math.max(0, 7 - daysOld); // Boost newer items
    
    return { ...listing, recommendationScore: score };
  }).sort((a, b) => b.recommendationScore - a.recommendationScore);
};

// ================================
// SIMILARITY SEARCH
// ================================

/**
 * Calculate basic similarity between listings
 * @param {Object} sourceListing - Source listing for comparison
 * @param {Object} options - Similarity options
 * @returns {Promise<Object>} Similar listings
 */
const calculateBasicSimilarity = async (sourceListing, options = {}) => {
  try {
    const { limit = 10, includeImages = false } = options;
    
    // Find similar listings based on multiple factors
    const similarListings = await dbRouter.listing.findMany({
      where: {
        AND: [
          { id: { not: sourceListing.id } },
          { status: 'ACTIVE' },
          {
            OR: [
              // Same category
              { category_id: sourceListing.category_id },
              // Similar price range (±50%)
              {
                AND: [
                  { price: { gte: sourceListing.price * 0.5 } },
                  { price: { lte: sourceListing.price * 1.5 } }
                ]
              },
              // Similar tags
              { tags: { hasSome: sourceListing.tags || [] } }
            ]
          }
        ]
      },
      include: {
        category: true,
        vendor: { select: { username: true, is_verified: true } },
        ...(includeImages && { images: { take: 1, orderBy: { is_primary: 'desc' } } })
      },
      take: limit * 2 // Get more to apply scoring
    });

    // Calculate similarity scores
    const scoredListings = similarListings.map(listing => {
      let similarityScore = 0;

      // Category match (high weight)
      if (listing.category_id === sourceListing.category_id) {
        similarityScore += 0.4;
      }

      // Price similarity (medium weight)
      const priceDiff = Math.abs(listing.price - sourceListing.price) / sourceListing.price;
      similarityScore += Math.max(0, 0.3 * (1 - priceDiff));

      // Tag overlap (medium weight)
      const sourceTagsSet = new Set(sourceListing.tags || []);
      const listingTagsSet = new Set(listing.tags || []);
      const commonTags = [...sourceTagsSet].filter(tag => listingTagsSet.has(tag));
      const tagSimilarity = commonTags.length / Math.max(sourceTagsSet.size, listingTagsSet.size, 1);
      similarityScore += 0.2 * tagSimilarity;

      // Condition similarity (low weight)
      if (listing.condition === sourceListing.condition) {
        similarityScore += 0.1;
      }

      return { ...listing, similarityScore };
    });

    // Sort by similarity and limit results
    const results = scoredListings
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, limit);

    return {
      success: true,
      results,
      performance: {
        strategy: 'basic_similarity',
        candidatesEvaluated: similarListings.length,
        responseTime: Date.now()
      }
    };

  } catch (error) {
    logger.error('Basic similarity calculation failed:', error);
    return {
      success: false,
      error: error.message,
      results: []
    };
  }
};

// ================================
// TEXT SEARCH
// ================================

/**
 * Execute text-based search with ranking
 * @param {string} query - Search query
 * @param {Object} filters - Search filters
 * @param {Object} options - Search options
 * @returns {Promise<Object>} Search results
 */
const searchByText = async (query, filters = {}, options = {}) => {
  try {
    const { page = 1, limit = 20, includeAnalytics = true } = options;
    
    // Use the orchestrator for intelligent search
    const { executeIntelligentSearch } = require('./searchOrchestrator');
    
    const searchRequest = {
      query,
      filters,
      pagination: { page, limit },
      context: options.context || {}
    };

    const result = await executeIntelligentSearch(searchRequest);
    
    if (includeAnalytics && result.success) {
      // Log search analytics
      await logSearchAnalytics({
        query,
        resultCount: result.results?.length || 0,
        strategy: result.performance?.strategy,
        userId: options.context?.userId
      });
    }

    return result;

  } catch (error) {
    logger.error('Text search failed:', error);
    return {
      success: false,
      error: error.message,
      results: []
    };
  }
};

/**
 * Execute media-based search
 * @param {Buffer} mediaBuffer - Media buffer
 * @param {string} mediaType - Media type
 * @param {Object} filters - Search filters
 * @param {Object} options - Search options
 * @returns {Promise<Object>} Search results
 */
const searchByMedia = async (mediaBuffer, mediaType, filters = {}, options = {}) => {
  try {
    // Use the orchestrator for image search
    const { executeImageSearch } = require('./searchOrchestrator');
    
    const result = await executeImageSearch(
      mediaBuffer,
      mediaType === 'image' ? 'image/jpeg' : 'video/mp4',
      filters,
      options.pagination || {}
    );

    return result;

  } catch (error) {
    logger.error('Media search failed:', error);
    return {
      success: false,
      error: error.message,
      results: []
    };
  }
};

// ================================
// ANALYTICS
// ================================

/**
 * Log search analytics
 * @param {Object} analyticsData - Analytics data
 * @returns {Promise<void>}
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
        session_id: analyticsData.searchId || null,
        response_time_ms: analyticsData.responseTime || 0
      }
    });

    // Update search suggestions
    if (analyticsData.query && analyticsData.resultCount > 0) {
      await dbRouter.searchSuggestion.upsert({
        where: { suggestion_text: analyticsData.query.toLowerCase() },
        update: { 
          search_count: { increment: 1 },
          updated_at: new Date()
        },
        create: {
          suggestion_text: analyticsData.query.toLowerCase(),
          search_count: 1,
          is_trending: false
        }
      });
    }

  } catch (error) {
    logger.error('Failed to log search analytics:', error);
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Product analysis
  analyzeProductAdvanced,
  simpleProductAnalysis,
  
  // Search intent
  analyzeSearchIntent,
  
  // Recommendations
  getAIRecommendations,
  extractUserPreferences,
  generateAIRecommendations,
  combineRecommendations,
  
  // Similarity
  calculateBasicSimilarity,
  
  // Search functions
  searchByText,
  searchByMedia,
  
  // Analytics
  logSearchAnalytics,
  
  // Utilities
  initializeGemini,
  
  // Configuration
  API_CONFIG,
  STRUCTURED_SCHEMAS,
  GEMINI_MODEL,
  GEMINI_RPM
};