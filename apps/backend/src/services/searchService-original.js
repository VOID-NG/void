// apps/backend/src/services/searchService.js
// Next-generation AI search using Gemini 2.5 Flash Lite with advanced capabilities

const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { prisma } = require('../config/db-original');
const logger = require('../utils/logger');
const { tryConsume } = require('../utils/rateLimiter');

// ================================
// NEXT-GEN API CONFIGURATION
// ================================

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_RPM = parseInt(process.env.GEMINI_RPM || '15', 10);

const API_CONFIG = {
  // Gemini 2.5 Flash Lite (ADVANCED CAPABILITIES)
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
    ESTIMATED_COST: 0.002, // Still 87% cheaper than OpenAI
    TIMEOUT: 45000 // Longer timeout for complex analysis
  },
  
  // HuggingFace Router (for text similarity)
  HUGGINGFACE: {
    BASE_URL: 'https://router.huggingface.co/hf-inference/models',
    AVAILABLE_MODELS: {
      PRIMARY: 'sentence-transformers/all-MiniLM-L6-v2',
      BACKUP: 'sentence-transformers/all-mpnet-base-v2'
    },
    ENDPOINT: '/pipeline/sentence-similarity',
    COST_PER_REQUEST: 0.00006
  },

  // Search configuration
  SIMILARITY_THRESHOLD: 0.65,
  MAX_RESULTS: 50,
  // Enable advanced Gemini features only if explicitly enabled and the model supports them (2.5 family)
  ENABLE_ADVANCED_FEATURES: (process.env.ENABLE_ADVANCED_SEARCH_FEATURES === 'true') && /gemini-2\.5/.test(GEMINI_MODEL)
};

// ================================
// STRUCTURED OUTPUT SCHEMAS
// ================================

const STRUCTURED_SCHEMAS = {
  PRODUCT_ANALYSIS: {
    type: "object",
    properties: {
      productInfo: {
        type: "object",
        properties: {
          category: { type: "string", description: "Product category" },
          subcategory: { type: "string", description: "Specific product type" },
          brand: { type: "string", description: "Brand name if visible" },
          model: { type: "string", description: "Model number/name if identifiable" },
          color: { type: "string", description: "Primary color" },
          condition: { 
            type: "string", 
            enum: ["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"],
            description: "Estimated condition"
          }
        },
        required: ["category", "condition"]
      },
      marketplaceData: {
        type: "object",
        properties: {
          estimatedPriceRange: {
            type: "object",
            properties: {
              min: { type: "number" },
              max: { type: "number" },
              currency: { type: "string", default: "USD" }
            }
          },
          keyFeatures: {
            type: "array",
            items: { type: "string" },
            description: "Key selling points and features"
          },
          searchKeywords: {
            type: "array",
            items: { type: "string" },
            description: "Optimal keywords for search"
          },
          marketDemand: {
            type: "string",
            enum: ["HIGH", "MEDIUM", "LOW"],
            description: "Estimated market demand"
          }
        }
      },
      searchOptimization: {
        type: "object",
        properties: {
          title: { type: "string", description: "Optimized listing title" },
          description: { type: "string", description: "SEO-optimized description" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Relevant tags for categorization"
          }
        }
      }
    },
    required: ["productInfo", "marketplaceData"]
  },

  SEARCH_ANALYSIS: {
    type: "object",
    properties: {
      searchIntent: {
        type: "object",
        properties: {
          primaryIntent: { 
            type: "string",
            enum: ["BUY", "SELL", "RESEARCH", "COMPARE"],
            description: "Main user intent"
          },
          specificProduct: { type: "boolean", description: "Looking for specific item" },
          priceRange: {
            type: "object",
            properties: {
              min: { type: "number" },
              max: { type: "number" }
            }
          },
          preferredCondition: {
            type: "array",
            items: { 
              type: "string",
              enum: ["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"]
            }
          }
        }
      },
      searchStrategy: {
        type: "object",
        properties: {
          expandedKeywords: {
            type: "array",
            items: { type: "string" },
            description: "Additional search terms to try"
          },
          filters: {
            type: "object",
            properties: {
              categories: { type: "array", items: { type: "string" } },
              priceRange: { type: "object" },
              conditions: { type: "array", items: { type: "string" } }
            }
          },
          rankingFactors: {
            type: "array",
            items: { type: "string" },
            description: "Factors to prioritize in ranking"
          }
        }
      }
    }
  }
};

// ================================
// GEMINI 2.5 INTEGRATION
// ================================

/**
 * Initialize Gemini 2.5 Flash Lite with advanced capabilities
 * @returns {GoogleGenerativeAI} Gemini AI instance
 */
const initializeGemini = () => {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Google Gemini API key not configured');
  }
  return new GoogleGenerativeAI(apiKey);
};

/**
 * Advanced product analysis using structured outputs
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

    // Rate limit guard for Gemini calls
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

    let mediaPart;
    
    if (mediaType === 'image') {
      if (mediaInput.startsWith('http')) {
        // Download image
        const imageResponse = await axios.get(mediaInput, { 
          responseType: 'arraybuffer',
          timeout: 10000
        });
        const imageBase64 = Buffer.from(imageResponse.data).toString('base64');
        const mimeType = imageResponse.headers['content-type'] || 'image/jpeg';
        
        mediaPart = {
          inlineData: {
            data: imageBase64,
            mimeType: mimeType
          }
        };
      } else {
        // Assume it's base64 or buffer
        mediaPart = {
          inlineData: {
            data: mediaInput,
            mimeType: 'image/jpeg'
          }
        };
      }
    } else if (mediaType === 'video') {
      // Video analysis capability
      mediaPart = {
        inlineData: {
          data: mediaInput,
          mimeType: 'video/mp4'
        }
      };
    }

    const prompt = `You are an expert marketplace product analyzer. Analyze this ${mediaType} and provide comprehensive product information.

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
      // If advanced schema wasn't enforced, try to coerce a minimal structure
      logger.warn('Failed to parse structured analysis JSON, using simple fallback');
      return {
        success: false,
        error: 'parse_error',
        fallback: await simpleProductAnalysis(mediaInput, mediaType)
      };
    }

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
    
    // Fallback to simple analysis
    return {
      success: false,
      error: error.message,
      fallback: await simpleProductAnalysis(mediaInput, mediaType)
    };
  }
};

/**
 * Intelligent search query analysis and expansion
 * @param {string} searchQuery - User's search query
 * @param {Object} context - Additional context (user preferences, history)
 * @returns {Promise<Object>} Enhanced search strategy
 */
const analyzeSearchIntent = async (searchQuery, context = {}) => {
  try {
    logger.debug('Analyzing search intent with Gemini 2.5', { searchQuery });

    // Rate limit guard for Gemini calls
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
      // Fallback if JSON not strictly returned
      return {
        success: false,
        fallback: {
          expandedKeywords: searchQuery.split(' '),
          basicStrategy: true
        }
      };
    }

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
    
    // Fallback to basic keyword expansion
    return {
      success: false,
      fallback: {
        expandedKeywords: searchQuery.split(' '),
        basicStrategy: true
      }
    };
  }
};

/**
 * Function calling for real-time market data
 * @param {string} productInfo - Product information
 * @returns {Promise<Object>} Real-time market data
 */
const getMarketData = async (productInfo) => {
  try {
    if (!API_CONFIG.ENABLE_ADVANCED_FEATURES) {
      return { success: false, error: 'advanced_features_disabled' };
    }

    const rl = tryConsume('gemini', GEMINI_RPM);
    if (!rl.allowed) {
      return { success: false, error: 'rate_limited' };
    }
    const genAI = initializeGemini();
    const model = genAI.getGenerativeModel({ 
      model: API_CONFIG.GEMINI.MODEL,
      tools: [{
        function_declarations: [{
          name: "search_market_prices",
          description: "Search for current market prices and availability",
          parameters: {
            type: "object",
            properties: {
              product: { type: "string" },
              condition: { type: "string" },
              location: { type: "string" }
            }
          }
        }]
      }]
    });

    const prompt = `Get current market data for: ${productInfo}

Use the search_market_prices function to find:
1. Current market prices
2. Price trends
3. Availability
4. Popular marketplaces
5. Seasonal factors`;

    const result = await model.generateContent(prompt);
    
    // Handle function calling response
    const functionCall = result.response.functionCall();
    if (functionCall) {
      // Process function call result
      return {
        success: true,
        marketData: functionCall.args,
        realTime: true
      };
    }

    return {
      success: false,
      error: 'No function call made'
    };

  } catch (error) {
    logger.error('Market data retrieval failed:', error);
    return { success: false, error: error.message };
  }
};

// ================================
// ENHANCED SEARCH FUNCTIONS
// ================================

/**
 * Next-generation text search with AI intent analysis
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Enhanced search results
 */
const searchByText = async (query, options = {}) => {
  try {
    const {
      limit = 20,
      offset = 0,
      filters = {},
      userId = null,
      enableAI = true
    } = options;

    logger.info('Starting next-gen text search', { query, enableAI });

    let searchStrategy = { expandedKeywords: [query] };
    let aiAnalysis = null;

    // Step 1: AI-powered search intent analysis
    if (enableAI && API_CONFIG.ENABLE_ADVANCED_FEATURES) {
      const intentResult = await analyzeSearchIntent(query, { userId });
      if (intentResult.success) {
        searchStrategy = intentResult.strategy.searchStrategy;
        aiAnalysis = intentResult.strategy.searchIntent;
      }
    }

    // Step 2: Get listings from database with expanded search
    const searchTerms = searchStrategy.expandedKeywords || [query];
    const listings = await prisma.listing.findMany({
      where: {
        status: 'ACTIVE',
        OR: searchTerms.map(term => ({
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            { tags: { has: term } }
          ]
        })),
        ...filters
      },
      include: {
        vendor: {
          select: {
            id: true,
            username: true,
            business_name: true,
            avatar_url: true,
            vendor_verified: true
          }
        },
        images: {
          where: { is_primary: true },
          take: 1
        },
        category: {
          select: { id: true, name: true }
        },
        _count: {
          select: { interactions: true }
        }
      },
      take: 200
    });

    if (listings.length === 0) {
      return [];
    }

    // Step 3: HuggingFace similarity scoring
    let results;
    try {
      const listingTexts = listings.map(listing => 
        `${listing.title} ${listing.description}`.substring(0, 500)
      );

      const similarities = await calculateHFSimilarity(query, listingTexts);
      
      results = listings.map((listing, index) => ({
        ...listing,
        similarity_score: similarities[index] || 0,
        search_method: 'ai_enhanced_hf',
        ai_analysis: aiAnalysis,
        search_strategy: searchStrategy
      }));

    } catch (hfError) {
      logger.warn('HF similarity failed, using basic scoring:', hfError.message);
      
      results = listings.map(listing => ({
        ...listing,
        similarity_score: calculateBasicSimilarity(query, `${listing.title} ${listing.description}`),
        search_method: 'ai_enhanced_basic',
        ai_analysis: aiAnalysis
      }));
    }

    // Step 4: AI-powered result ranking
    if (aiAnalysis && searchStrategy.rankingFactors) {
      results = enhanceResultRanking(results, aiAnalysis, searchStrategy.rankingFactors);
    }

    // Step 5: Filter and sort results
    const filteredResults = results
      .filter(item => item.similarity_score > API_CONFIG.SIMILARITY_THRESHOLD)
      .sort((a, b) => {
        // Primary: AI-enhanced score
        if (Math.abs(a.ai_enhanced_score - b.ai_enhanced_score) > 0.05) {
          return (b.ai_enhanced_score || b.similarity_score) - (a.ai_enhanced_score || a.similarity_score);
        }
        // Secondary: Popularity
        return (b._count.interactions || 0) - (a._count.interactions || 0);
      })
      .slice(offset, offset + limit);

    // Log analytics
    if (userId) {
      await logSearchAnalytics({
        userId,
        queryText: query,
        queryType: 'text',
        resultsCount: filteredResults.length,
        searchMethod: 'gemini_25_enhanced',
        aiAnalysis: aiAnalysis
      });
    }

    logger.info('Next-gen text search completed', {
      query,
      resultsFound: filteredResults.length,
      aiEnhanced: !!aiAnalysis,
      expandedTerms: searchTerms.length
    });

    return filteredResults;

  } catch (error) {
    logger.error('Next-gen text search failed:', error);
    throw error;
  }
};

/**
 * Advanced image/video search with structured analysis
 * @param {string} mediaUrl - Image or video URL
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Search results with detailed analysis
 */
const searchByMedia = async (mediaUrl, options = {}) => {
  try {
    const { 
      limit = 20, 
      userId = null,
      mediaType = 'image',
      enableAdvancedAnalysis = true 
    } = options;

    logger.info('Starting advanced media search', { mediaUrl, mediaType });

    let productAnalysis = null;
    let searchDescription = mediaUrl;

    // Step 1: Advanced product analysis
    if (enableAdvancedAnalysis && API_CONFIG.ENABLE_ADVANCED_FEATURES) {
      const analysisResult = await analyzeProductAdvanced(mediaUrl, mediaType);
      
      if (analysisResult.success) {
        productAnalysis = analysisResult.analysis;
        
        // Create search query from structured analysis
        const product = productAnalysis.productInfo;
        const keywords = productAnalysis.marketplaceData.searchKeywords || [];
        
        searchDescription = [
          product.category,
          product.subcategory,
          product.brand,
          product.model,
          product.color,
          ...keywords
        ].filter(Boolean).join(' ');
      }
    }

    // Step 2: Search using extracted product information
    const searchResults = await searchByText(searchDescription, {
      ...options,
      limit: limit * 2, // Get more for better filtering
      enableAI: true
    });

    // Step 3: Enhance results with product analysis
    const enhancedResults = searchResults.map(item => ({
      ...item,
      similarity_score: item.similarity_score * 0.95, // Slight penalty for conversion
      search_method: 'gemini_25_media_analysis',
      original_media_query: mediaUrl,
      media_type: mediaType,
      product_analysis: productAnalysis,
      ai_extracted_query: searchDescription
    })).slice(0, limit);

    // Log analytics
    if (userId) {
      await logSearchAnalytics({
        userId,
        queryText: mediaUrl,
        queryType: mediaType,
        resultsCount: enhancedResults.length,
        searchMethod: 'gemini_25_media',
        productAnalysis: productAnalysis
      });
    }

    logger.info('Advanced media search completed', {
      mediaUrl,
      mediaType,
      resultsFound: enhancedResults.length,
      extractedProduct: productAnalysis?.productInfo?.category || 'unknown'
    });

    return enhancedResults;

  } catch (error) {
    logger.error('Advanced media search failed:', error);
    throw error;
  }
};

/**
 * AI-powered recommendations with market insights
 * @param {string} userId - User ID
 * @param {Object} options - Recommendation options
 * @returns {Promise<Array>} AI-enhanced recommendations
 */
const getAIRecommendations = async (userId = null, options = {}) => {
  try {
    const { 
      limit = 10, 
      type = 'personalized',
      includeMarketInsights = true 
    } = options;

    logger.info('Generating AI-powered recommendations', { userId, type });

    // Get user interaction history for personalization
    let userPreferences = {};
    if (userId) {
      const userInteractions = await prisma.userInteraction.findMany({
        where: { user_id: userId },
        include: { listing: { select: { category_id: true, tags: true } } },
        orderBy: { created_at: 'desc' },
        take: 50
      });

      // Analyze user preferences
      userPreferences = analyzeUserPreferences(userInteractions);
    }

    // Get candidate listings
    const candidateListings = await prisma.listing.findMany({
      where: {
        status: 'ACTIVE',
        ...(userPreferences.preferredCategories ? {
          category_id: { in: userPreferences.preferredCategories }
        } : {})
      },
      include: {
        vendor: {
          select: {
            id: true,
            username: true,
            business_name: true,
            avatar_url: true
          }
        },
        images: {
          where: { is_primary: true },
          take: 1
        },
        _count: {
          select: { interactions: true }
        }
      },
      orderBy: [
        { interactions: { _count: 'desc' } },
        { created_at: 'desc' }
      ],
      take: limit * 3 // Get more for AI filtering
    });

    // AI-enhanced ranking and filtering
    const recommendations = candidateListings.map((item, index) => {
      const baseScore = 1.0 - (index * 0.02);
      const personalizedScore = calculatePersonalizationScore(item, userPreferences);
      const trendingScore = (item._count.interactions || 0) / 100;
      
      const finalScore = (baseScore * 0.4) + (personalizedScore * 0.4) + (trendingScore * 0.2);

      return {
        ...item,
        recommendation_score: Math.min(1.0, finalScore),
        recommendation_type: type,
        recommendation_method: 'gemini_25_ai',
        personalization_factors: userPreferences,
        market_insights: includeMarketInsights ? {
          trending: trendingScore > 0.1,
          popular_category: userPreferences.preferredCategories?.includes(item.category_id)
        } : null
      };
    });

    const finalRecommendations = recommendations
      .sort((a, b) => b.recommendation_score - a.recommendation_score)
      .slice(0, limit);

    logger.info('AI recommendations generated', {
      userId,
      recommendationsCount: finalRecommendations.length,
      avgScore: finalRecommendations.reduce((sum, r) => sum + r.recommendation_score, 0) / finalRecommendations.length
    });

    return finalRecommendations;

  } catch (error) {
    logger.error('AI recommendations failed:', error);
    throw error;
  }
};

// ================================
// UTILITY FUNCTIONS
// ================================

/**
 * Calculate HuggingFace similarity (from previous implementation)
 */
const calculateHFSimilarity = async (sourceText, targetTexts) => {
  try {
    const token = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY;
    
    if (!token) {
      throw new Error('HuggingFace API token not configured');
    }

    const model = API_CONFIG.HUGGINGFACE.AVAILABLE_MODELS.PRIMARY;
    const url = `${API_CONFIG.HUGGINGFACE.BASE_URL}/${model}${API_CONFIG.HUGGINGFACE.ENDPOINT}`;
    
    const response = await axios.post(url, {
      inputs: {
        source_sentence: sourceText,
        sentences: targetTexts
      }
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    return response.data;

  } catch (error) {
    throw error;
  }
};

/**
 * Basic similarity calculation (fallback)
 */
const calculateBasicSimilarity = (query, text) => {
  const queryWords = query.toLowerCase().split(/\s+/);
  const textWords = text.toLowerCase().split(/\s+/);
  
  let matches = 0;
  queryWords.forEach(queryWord => {
    if (textWords.some(textWord => 
      textWord.includes(queryWord) || 
      queryWord.includes(textWord)
    )) {
      matches++;
    }
  });
  
  return matches / queryWords.length;
};

/**
 * Enhance result ranking with AI analysis
 */
const enhanceResultRanking = (results, aiAnalysis, rankingFactors) => {
  return results.map(item => {
    let enhancedScore = item.similarity_score;
    
    // Apply AI-determined ranking factors
    if (rankingFactors.includes('condition') && aiAnalysis.preferredCondition) {
      if (aiAnalysis.preferredCondition.includes(item.condition)) {
        enhancedScore *= 1.2;
      }
    }
    
    if (rankingFactors.includes('price') && aiAnalysis.priceRange) {
      if (item.price >= aiAnalysis.priceRange.min && item.price <= aiAnalysis.priceRange.max) {
        enhancedScore *= 1.15;
      }
    }
    
    if (rankingFactors.includes('popularity')) {
      const interactionBoost = Math.min(0.2, (item._count.interactions || 0) * 0.01);
      enhancedScore += interactionBoost;
    }

    return {
      ...item,
      ai_enhanced_score: Math.min(1.0, enhancedScore)
    };
  });
};

/**
 * Analyze user preferences from interaction history
 */
const analyzeUserPreferences = (interactions) => {
  const categoryCount = {};
  const tagCount = {};
  
  interactions.forEach(interaction => {
    if (interaction.listing.category_id) {
      categoryCount[interaction.listing.category_id] = (categoryCount[interaction.listing.category_id] || 0) + 1;
    }
    
    if (interaction.listing.tags) {
      interaction.listing.tags.forEach(tag => {
        tagCount[tag] = (tagCount[tag] || 0) + 1;
      });
    }
  });
  
  return {
    preferredCategories: Object.keys(categoryCount).sort((a, b) => categoryCount[b] - categoryCount[a]).slice(0, 3),
    preferredTags: Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a]).slice(0, 5),
    interactionCount: interactions.length
  };
};

/**
 * Calculate personalization score
 */
const calculatePersonalizationScore = (item, userPreferences) => {
  let score = 0.5; // Base score
  
  if (userPreferences.preferredCategories?.includes(item.category_id)) {
    score += 0.3;
  }
  
  if (item.tags && userPreferences.preferredTags) {
    const tagMatches = item.tags.filter(tag => userPreferences.preferredTags.includes(tag)).length;
    score += (tagMatches / userPreferences.preferredTags.length) * 0.2;
  }
  
  return Math.min(1.0, score);
};

/**
 * Simple product analysis fallback
 */
const simpleProductAnalysis = async (mediaInput, mediaType) => {
  // Fallback to basic description
  return {
    productInfo: {
      category: 'unknown',
      condition: 'GOOD'
    },
    marketplaceData: {
      keyFeatures: [],
      searchKeywords: []
    }
  };
};

/**
 * Log search analytics with AI data
 */
const logSearchAnalytics = async (analytics) => {
  try {
    await prisma.searchAnalytics.create({
      data: {
        user_id: analytics.userId,
        query_text: analytics.queryText,
        query_type: analytics.queryType,
        results_count: analytics.resultsCount,
        search_method: analytics.searchMethod || 'gemini_25_enhanced',
        ai_analysis: JSON.stringify(analytics.aiAnalysis || {}),
        product_analysis: JSON.stringify(analytics.productAnalysis || {}),
        created_at: new Date()
      }
    });
  } catch (error) {
    logger.warn('Failed to log search analytics:', error);
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Next-gen search functions
  searchByText,
  searchByMedia,
  getAIRecommendations,
  
  // Advanced analysis functions
  analyzeProductAdvanced,
  analyzeSearchIntent,
  getMarketData,
  
  // Utility functions
  calculateBasicSimilarity,
  logSearchAnalytics,
  
  // Configuration
  API_CONFIG,
  STRUCTURED_SCHEMAS
};