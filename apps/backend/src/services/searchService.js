// apps/backend/src/services/searchService.js
// AI-powered search service combining text and image search

const { prisma } = require('../config/db');
const logger = require('../utils/logger');
const { 
  fuzzyTextSearch, 
  generateAutocompleteSuggestions, 
  updateSearchSuggestion,
  logSearchAnalytics,
  processSearchQuery
} = require('../utils/fuzzySearchUtils');
const { 
  generateEmbedding, 
  findSimilarListings,
  generateListingEmbeddings 
} = require('../utils/imageEmbeddingUtils');

// ================================
// CONFIGURATION
// ================================

const SEARCH_SERVICE_CONFIG = {
  // Search types
  SEARCH_TYPES: {
    TEXT: 'text',
    IMAGE: 'image',
    COMBINED: 'combined',
    VOICE: 'voice'
  },
  
  // Result combination weights
  TEXT_WEIGHT: 0.7,
  IMAGE_WEIGHT: 0.3,
  
  // Performance settings
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  SEARCH_TIMEOUT: 10000,
  
  // Cache settings
  CACHE_TTL: 300, // 5 minutes
  POPULAR_QUERIES_LIMIT: 50,
  
  // Recommendation settings
  SIMILAR_ITEMS_LIMIT: 10,
  TRENDING_LIMIT: 20,
  
  // Search quality thresholds
  MIN_RELEVANCE_SCORE: 0.1,
  HIGH_RELEVANCE_THRESHOLD: 0.8,
  MEDIUM_RELEVANCE_THRESHOLD: 0.5
};

// ================================
// CORE SEARCH FUNCTIONS
// ================================

/**
 * Unified search function that handles multiple search types
 * @param {Object} searchParams - Search parameters
 * @param {Object} userContext - User context for personalization
 * @returns {Promise<Object>} Search results with metadata
 */
const unifiedSearch = async (searchParams, userContext = {}) => {
  const startTime = Date.now();
  
  try {
    const {
      query,
      searchType = SEARCH_SERVICE_CONFIG.SEARCH_TYPES.TEXT,
      imageFile = null,
      filters = {},
      sort = 'relevance',
      limit = SEARCH_SERVICE_CONFIG.DEFAULT_LIMIT,
      offset = 0,
      includeRecommendations = true,
      includeFacets = true
    } = searchParams;

    const {
      userId = null,
      sessionId = null,
      ipAddress = null,
      userAgent = null,
      preferences = {}
    } = userContext;

    logger.info('Starting unified search', {
      searchType,
      query: query?.substring(0, 100),
      hasImage: !!imageFile,
      userId,
      filters
    });

    let results = [];
    let searchMetadata = {
      query,
      searchType,
      totalResults: 0,
      processingTime: 0,
      searchId: `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      appliedFilters: filters,
      recommendations: [],
      facets: {},
      suggestions: []
    };

    // Route to appropriate search method
    switch (searchType) {
      case SEARCH_SERVICE_CONFIG.SEARCH_TYPES.TEXT:
        results = await performTextSearch(query, filters, { limit, offset, sort });
        break;
        
      case SEARCH_SERVICE_CONFIG.SEARCH_TYPES.IMAGE:
        results = await performImageSearch(imageFile, filters, { limit, offset });
        break;
        
      case SEARCH_SERVICE_CONFIG.SEARCH_TYPES.COMBINED:
        results = await performCombinedSearch(query, imageFile, filters, { limit, offset, sort });
        break;
        
      case SEARCH_SERVICE_CONFIG.SEARCH_TYPES.VOICE:
        results = await performVoiceSearch(query, filters, { limit, offset, sort });
        break;
        
      default:
        throw new Error(`Unsupported search type: ${searchType}`);
    }

    // Apply user preferences and personalization
    if (userId && preferences) {
      results = await applyPersonalization(results, userId, preferences);
    }

    // Apply sorting
    results = applySorting(results, sort);

    // Generate recommendations
    if (includeRecommendations && results.length > 0) {
      searchMetadata.recommendations = await generateSearchRecommendations(
        results[0].id, 
        query, 
        userId
      );
    }

    // Generate facets for filtering
    if (includeFacets) {
      searchMetadata.facets = await generateSearchFacets(query, filters);
    }

    // Generate query suggestions
    if (query) {
      searchMetadata.suggestions = await generateAutocompleteSuggestions(query, {
        limit: 5,
        categoryId: filters.categoryId
      });
    }

    // Update search analytics
    const processingTime = Date.now() - startTime;
    searchMetadata.processingTime = processingTime;
    searchMetadata.totalResults = results.length;

    // Log analytics (async, don't wait)
    logSearchAnalytics({
      userId,
      queryText: query,
      queryType: searchType,
      filtersApplied: filters,
      resultsCount: results.length,
      sessionId,
      ipAddress,
      userAgent,
      responseTimeMs: processingTime
    }).catch(error => {
      logger.error('Failed to log search analytics:', error);
    });

    // Update search suggestions (async, don't wait)
    if (query) {
      updateSearchSuggestion(query, filters.categoryId).catch(error => {
        logger.error('Failed to update search suggestion:', error);
      });
    }

    logger.info('Unified search completed', {
      searchId: searchMetadata.searchId,
      resultsCount: results.length,
      processingTime
    });

    return {
      results: results.slice(0, limit),
      metadata: searchMetadata,
      pagination: {
        limit,
        offset,
        total: results.length,
        hasMore: results.length > (offset + limit)
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    logger.error('Unified search failed:', {
      error: error.message,
      searchParams,
      processingTime
    });

    // Return empty results with error info
    return {
      results: [],
      metadata: {
        query: searchParams.query,
        searchType: searchParams.searchType,
        totalResults: 0,
        processingTime,
        error: error.message,
        searchId: `error_${Date.now()}`
      },
      pagination: {
        limit: searchParams.limit || SEARCH_SERVICE_CONFIG.DEFAULT_LIMIT,
        offset: searchParams.offset || 0,
        total: 0,
        hasMore: false
      }
    };
  }
};

/**
 * Perform text-based search
 * @param {string} query - Search query
 * @param {Object} filters - Search filters
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Search results
 */
const performTextSearch = async (query, filters = {}, options = {}) => {
  try {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const searchOptions = {
      ...options,
      categoryId: filters.categoryId,
      vendorId: filters.vendorId,
      filters: {
        minPrice: filters.minPrice,
        maxPrice: filters.maxPrice,
        condition: filters.condition,
        location: filters.location,
        isNegotiable: filters.isNegotiable
      }
    };

    const results = await fuzzyTextSearch(query, searchOptions);
    
    return results.map(result => ({
      ...result,
      search_type: 'text',
      relevance_score: result.total_score || 0,
      match_details: result.similarity_details || {}
    }));

  } catch (error) {
    logger.error('Text search failed:', error);
    throw error;
  }
};

/**
 * Perform image-based search
 * @param {Object} imageFile - Image file data
 * @param {Object} filters - Search filters
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Search results
 */
const performImageSearch = async (imageFile, filters = {}, options = {}) => {
  try {
    if (!imageFile) {
      throw new Error('No image provided for image search');
    }

    logger.info('Performing image search', {
      filename: imageFile.filename,
      size: imageFile.size
    });

    // Generate embedding for the uploaded image
    const queryEmbedding = await generateEmbedding(imageFile.path, 'image');

    // Find similar listings using vector similarity
    const similarListings = await findSimilarListings(queryEmbedding, {
      limit: options.limit || SEARCH_SERVICE_CONFIG.DEFAULT_LIMIT,
      threshold: 0.6,
      embeddingType: 'image'
    });

    // Enhance results with listing details
    const enhancedResults = await Promise.all(
      similarListings.map(async (item) => {
        const listing = await prisma.listing.findUnique({
          where: { id: item.listing_id },
          include: {
            images: {
              where: { is_primary: true },
              take: 1
            },
            vendor: {
              select: {
                id: true,
                username: true,
                business_name: true,
                vendor_verified: true
              }
            },
            category: {
              select: {
                id: true,
                name: true
              }
            }
          }
        });

        if (!listing) return null;

        return {
          ...listing,
          search_type: 'image',
          relevance_score: item.similarity_score || 0,
          similarity_distance: item.similarity_distance,
          match_details: {
            image_similarity: item.similarity_score,
            confidence: item.confidence_score || 0.8
          }
        };
      })
    );

    return enhancedResults.filter(result => result !== null);

  } catch (error) {
    logger.error('Image search failed:', error);
    throw error;
  }
};

/**
 * Perform combined text and image search
 * @param {string} query - Search query
 * @param {Object} imageFile - Image file data
 * @param {Object} filters - Search filters
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Combined search results
 */
const performCombinedSearch = async (query, imageFile, filters = {}, options = {}) => {
  try {
    logger.info('Performing combined search', { hasQuery: !!query, hasImage: !!imageFile });

    const promises = [];
    
    // Perform text search if query provided
    if (query && query.trim().length > 0) {
      promises.push(
        performTextSearch(query, filters, options)
          .then(results => results.map(r => ({ ...r, source: 'text' })))
      );
    }

    // Perform image search if image provided
    if (imageFile) {
      promises.push(
        performImageSearch(imageFile, filters, options)
          .then(results => results.map(r => ({ ...r, source: 'image' })))
      );
    }

    if (promises.length === 0) {
      return [];
    }

    const searchResults = await Promise.all(promises);
    
    // Combine and deduplicate results
    const combinedResults = new Map();
    
    searchResults.forEach((results, index) => {
      const weight = index === 0 ? SEARCH_SERVICE_CONFIG.TEXT_WEIGHT : SEARCH_SERVICE_CONFIG.IMAGE_WEIGHT;
      
      results.forEach(result => {
        const existingResult = combinedResults.get(result.id);
        
        if (existingResult) {
          // Combine scores from multiple sources
          existingResult.relevance_score = Math.max(
            existingResult.relevance_score,
            result.relevance_score * weight
          );
          existingResult.search_sources = [...existingResult.search_sources, result.source];
          existingResult.match_details = {
            ...existingResult.match_details,
            ...result.match_details
          };
        } else {
          combinedResults.set(result.id, {
            ...result,
            search_type: 'combined',
            relevance_score: result.relevance_score * weight,
            search_sources: [result.source]
          });
        }
      });
    });

    // Convert to array and sort by combined score
    const finalResults = Array.from(combinedResults.values())
      .sort((a, b) => b.relevance_score - a.relevance_score);

    return finalResults;

  } catch (error) {
    logger.error('Combined search failed:', error);
    throw error;
  }
};

/**
 * Perform voice search (converts speech to text then searches)
 * @param {string} transcribedQuery - Already transcribed voice query
 * @param {Object} filters - Search filters
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Search results
 */
const performVoiceSearch = async (transcribedQuery, filters = {}, options = {}) => {
  try {
    // For now, voice search is just text search with the transcribed query
    // In the future, this could include voice-specific optimizations
    const results = await performTextSearch(transcribedQuery, filters, options);
    
    return results.map(result => ({
      ...result,
      search_type: 'voice'
    }));

  } catch (error) {
    logger.error('Voice search failed:', error);
    throw error;
  }
};

// ================================
// PERSONALIZATION & RECOMMENDATIONS
// ================================

/**
 * Apply personalization to search results
 * @param {Array} results - Search results
 * @param {string} userId - User ID
 * @param {Object} preferences - User preferences
 * @returns {Promise<Array>} Personalized results
 */
const applyPersonalization = async (results, userId, preferences) => {
  try {
    if (!userId || results.length === 0) {
      return results;
    }

    // Get user's search and interaction history
    const userHistory = await getUserSearchHistory(userId, 30); // Last 30 days
    const userInteractions = await getUserInteractions(userId, 100); // Last 100 interactions

    // Apply preference-based boosting
    const personalizedResults = results.map(result => {
      let boostScore = 0;

      // Category preference boost
      if (preferences.preferredCategories?.includes(result.category_id)) {
        boostScore += 0.1;
      }

      // Price range preference
      if (preferences.preferredPriceRange) {
        const { min, max } = preferences.preferredPriceRange;
        if (result.price >= min && result.price <= max) {
          boostScore += 0.05;
        }
      }

      // Location preference
      if (preferences.preferredLocations?.some(loc => 
        result.location?.toLowerCase().includes(loc.toLowerCase())
      )) {
        boostScore += 0.05;
      }

      // Previous interaction boost
      const hasInteracted = userInteractions.some(interaction => 
        interaction.listing_id === result.id
      );
      if (hasInteracted) {
        boostScore += 0.03;
      }

      // Vendor preference (if user has bought from this vendor before)
      const hasBoughtFromVendor = userInteractions.some(interaction => 
        interaction.vendor_id === result.vendor_id && interaction.interaction_type === 'purchase'
      );
      if (hasBoughtFromVendor) {
        boostScore += 0.02;
      }

      return {
        ...result,
        relevance_score: result.relevance_score + boostScore,
        personalization_boost: boostScore
      };
    });

    // Re-sort by personalized score
    personalizedResults.sort((a, b) => b.relevance_score - a.relevance_score);

    return personalizedResults;

  } catch (error) {
    logger.error('Personalization failed:', error);
    return results; // Return original results if personalization fails
  }
};

/**
 * Generate search-based recommendations
 * @param {string} listingId - Primary result listing ID
 * @param {string} query - Original query
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Recommendation list
 */
const generateSearchRecommendations = async (listingId, query, userId = null) => {
  try {
    const recommendations = [];

    // Similar items based on current result
    if (listingId) {
      const similarItems = await findSimilarListings(null, {
        excludeListingId: listingId,
        limit: SEARCH_SERVICE_CONFIG.SIMILAR_ITEMS_LIMIT,
        embeddingType: 'text'
      });

      recommendations.push({
        type: 'similar_items',
        title: 'Similar Items',
        items: similarItems.slice(0, 5)
      });
    }

    // Popular in category
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { category_id: true }
    });

    if (listing?.category_id) {
      const popularInCategory = await getPopularInCategory(
        listing.category_id,
        { limit: 5, excludeListingId: listingId }
      );

      recommendations.push({
        type: 'popular_in_category',
        title: 'Popular in Category',
        items: popularInCategory
      });
    }

    // Trending searches
    const trendingSearches = await getTrendingSearches({ limit: 5 });
    if (trendingSearches.length > 0) {
      recommendations.push({
        type: 'trending_searches',
        title: 'Trending Searches',
        items: trendingSearches
      });
    }

    return recommendations;

  } catch (error) {
    logger.error('Recommendation generation failed:', error);
    return [];
  }
};

// ================================
// UTILITY FUNCTIONS
// ================================

/**
 * Apply sorting to search results
 * @param {Array} results - Search results
 * @param {string} sortBy - Sort criteria
 * @returns {Array} Sorted results
 */
const applySorting = (results, sortBy) => {
  switch (sortBy) {
    case 'price_low':
      return results.sort((a, b) => a.price - b.price);
    case 'price_high':
      return results.sort((a, b) => b.price - a.price);
    case 'newest':
      return results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    case 'oldest':
      return results.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    case 'relevance':
    default:
      return results.sort((a, b) => b.relevance_score - a.relevance_score);
  }
};

/**
 * Generate search facets for filtering
 * @param {string} query - Search query
 * @param {Object} currentFilters - Current filters
 * @returns {Promise<Object>} Facets object
 */
const generateSearchFacets = async (query, currentFilters = {}) => {
  try {
    // Get base results without filters for facet generation
    const baseResults = query ? await fuzzyTextSearch(query, { limit: 1000 }) : [];
    
    const facets = {
      categories: await getCategoryFacets(baseResults),
      priceRanges: getPriceRangeFacets(baseResults),
      conditions: getConditionFacets(baseResults),
      vendors: await getVendorFacets(baseResults)
    };

    return facets;

  } catch (error) {
    logger.error('Facet generation failed:', error);
    return {};
  }
};

/**
 * Get user's search history
 * @param {string} userId - User ID
 * @param {number} days - Number of days to look back
 * @returns {Promise<Array>} Search history
 */
const getUserSearchHistory = async (userId, days = 30) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return await prisma.searchAnalytics.findMany({
      where: {
        user_id: userId,
        created_at: {
          gte: cutoffDate
        }
      },
      orderBy: {
        created_at: 'desc'
      },
      take: 100
    });

  } catch (error) {
    logger.error('Failed to get user search history:', error);
    return [];
  }
};

/**
 * Get user interactions
 * @param {string} userId - User ID
 * @param {number} limit - Limit results
 * @returns {Promise<Array>} User interactions
 */
const getUserInteractions = async (userId, limit = 100) => {
  try {
    return await prisma.userInteraction.findMany({
      where: {
        user_id: userId
      },
      orderBy: {
        created_at: 'desc'
      },
      take: limit
    });

  } catch (error) {
    logger.error('Failed to get user interactions:', error);
    return [];
  }
};

/**
 * Get popular items in category
 * @param {string} categoryId - Category ID
 * @param {Object} options - Options
 * @returns {Promise<Array>} Popular items
 */
const getPopularInCategory = async (categoryId, options = {}) => {
  try {
    const { limit = 10, excludeListingId = null } = options;

    return await prisma.listing.findMany({
      where: {
        category_id: categoryId,
        status: 'ACTIVE',
        ...(excludeListingId ? { id: { not: excludeListingId } } : {})
      },
      include: {
        vendor: {
          select: {
            username: true,
            business_name: true
          }
        }
      },
      orderBy: [
        { is_featured: 'desc' },
        { view_count: 'desc' },
        { created_at: 'desc' }
      ],
      take: limit
    });

  } catch (error) {
    logger.error('Failed to get popular items in category:', error);
    return [];
  }
};

/**
 * Get trending searches
 * @param {Object} options - Options
 * @returns {Promise<Array>} Trending searches
 */
const getTrendingSearches = async (options = {}) => {
  try {
    const { limit = 10 } = options;

    return await prisma.searchSuggestion.findMany({
      where: {
        is_trending: true
      },
      orderBy: {
        search_count: 'desc'
      },
      take: limit
    });

  } catch (error) {
    logger.error('Failed to get trending searches:', error);
    return [];
  }
};

/**
 * Generate category facets
 * @param {Array} results - Search results
 * @returns {Promise<Array>} Category facets
 */
const getCategoryFacets = async (results) => {
  try {
    const categoryIds = [...new Set(results.map(r => r.category_id).filter(Boolean))];
    
    if (categoryIds.length === 0) return [];

    const categories = await prisma.category.findMany({
      where: {
        id: { in: categoryIds }
      },
      select: {
        id: true,
        name: true
      }
    });

    return categories.map(category => ({
      id: category.id,
      name: category.name,
      count: results.filter(r => r.category_id === category.id).length
    }));

  } catch (error) {
    logger.error('Failed to generate category facets:', error);
    return [];
  }
};

/**
 * Generate price range facets
 * @param {Array} results - Search results
 * @returns {Array} Price range facets
 */
const getPriceRangeFacets = (results) => {
  const priceRanges = [
    { min: 0, max: 50, label: 'Under $50' },
    { min: 50, max: 100, label: '$50 - $100' },
    { min: 100, max: 250, label: '$100 - $250' },
    { min: 250, max: 500, label: '$250 - $500' },
    { min: 500, max: 1000, label: '$500 - $1,000' },
    { min: 1000, max: Infinity, label: 'Over $1,000' }
  ];

  return priceRanges.map(range => ({
    ...range,
    count: results.filter(r => 
      r.price >= range.min && r.price < range.max
    ).length
  })).filter(range => range.count > 0);
};

/**
 * Generate condition facets
 * @param {Array} results - Search results
 * @returns {Array} Condition facets
 */
const getConditionFacets = (results) => {
  const conditions = {};
  
  results.forEach(result => {
    if (result.condition) {
      conditions[result.condition] = (conditions[result.condition] || 0) + 1;
    }
  });

  return Object.entries(conditions).map(([condition, count]) => ({
    value: condition,
    label: condition.charAt(0).toUpperCase() + condition.slice(1),
    count
  }));
};

/**
 * Generate vendor facets
 * @param {Array} results - Search results
 * @returns {Promise<Array>} Vendor facets
 */
const getVendorFacets = async (results) => {
  try {
    const vendorIds = [...new Set(results.map(r => r.vendor_id).filter(Boolean))];
    
    if (vendorIds.length === 0) return [];

    const vendors = await prisma.user.findMany({
      where: {
        id: { in: vendorIds }
      },
      select: {
        id: true,
        username: true,
        business_name: true,
        vendor_verified: true
      }
    });

    return vendors.map(vendor => ({
      id: vendor.id,
      name: vendor.business_name || vendor.username,
      verified: vendor.vendor_verified,
      count: results.filter(r => r.vendor_id === vendor.id).length
    }));

  } catch (error) {
    logger.error('Failed to generate vendor facets:', error);
    return [];
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Main search function
  unifiedSearch,
  
  // Specific search types
  performTextSearch,
  performImageSearch,
  performCombinedSearch,
  performVoiceSearch,
  
  // Utility functions
  applyPersonalization,
  generateSearchRecommendations,
  generateSearchFacets,
  applySorting,
  
  // Helper functions
  getUserSearchHistory,
  getUserInteractions,
  getPopularInCategory,
  getTrendingSearches,
  
  // Configuration
  SEARCH_SERVICE_CONFIG
};