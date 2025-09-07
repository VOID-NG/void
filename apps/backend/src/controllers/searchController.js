// apps/backend/src/controllers/searchController.js
// Complete search controller: text search, image search, autocomplete, filters

const searchService = require('../services/searchService-original');
const logger = require('../utils/logger');
const { fuzzySearch } = require('../utils/fuzzySearchUtils');
const { generateImageEmbedding } = require('../utils/imageEmbeddingUtils');

// ================================
// TEXT SEARCH ENDPOINTS
// ================================

/**
 * Main search endpoint with filters and pagination
 */
const searchListings = async (req, res) => {
  try {
    const {
      q: query,
      category,
      min_price,
      max_price,
      condition,
      location,
      vendor_id,
      sort_by = 'relevance',
      sort_order = 'desc',
      page = 1,
      limit = 24,
      include_inactive = false
    } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters long'
      });
    }

    const searchParams = {
      query: query.trim(),
      filters: {
        category,
        min_price: min_price ? parseFloat(min_price) : undefined,
        max_price: max_price ? parseFloat(max_price) : undefined,
        condition,
        location,
        vendor_id,
        include_inactive: include_inactive === 'true'
      },
      sorting: {
        sort_by,
        sort_order
      },
      pagination: {
        page: parseInt(page),
        limit: Math.min(parseInt(limit), 100) // Max 100 results per page
      },
      user_id: req.user?.id // For personalized results
    };

    const results = await searchService.searchListings(searchParams);

    // Log search analytics
    logger.info('Search performed', {
      query: query.trim(),
      user_id: req.user?.id,
      results_count: results.data.length,
      page,
      filters: Object.keys(searchParams.filters).filter(key => 
        searchParams.filters[key] !== undefined
      )
    });

    res.json({
      success: true,
      data: results.data,
      pagination: results.pagination,
      facets: results.facets,
      search_metadata: {
        query: query.trim(),
        total_results: results.pagination.total,
        search_time: results.search_time || '< 1ms',
        suggestions: results.suggestions || []
      }
    });

  } catch (error) {
    logger.error('Search listings failed:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message
    });
  }
};

/**
 * Autocomplete search suggestions
 */
const autocompleteSearch = async (req, res) => {
  try {
    const { q: query, limit = 10 } = req.query;

    if (!query || query.trim().length < 1) {
      return res.json({
        success: true,
        data: []
      });
    }

    const suggestions = await searchService.getAutocompleteSuggestions({
      query: query.trim(),
      limit: Math.min(parseInt(limit), 20),
      user_id: req.user?.id
    });

    res.json({
      success: true,
      data: suggestions
    });

  } catch (error) {
    logger.error('Autocomplete search failed:', error);
    res.status(500).json({
      success: false,
      error: 'Autocomplete failed',
      message: error.message
    });
  }
};

/**
 * Search suggestions and popular queries
 */
const getSearchSuggestions = async (req, res) => {
  try {
    const { category, location, limit = 10 } = req.query;

    const suggestions = await searchService.getSearchSuggestions({
      category,
      location,
      limit: parseInt(limit),
      user_id: req.user?.id
    });

    res.json({
      success: true,
      data: {
        trending: suggestions.trending || [],
        popular_categories: suggestions.popular_categories || [],
        recent_searches: suggestions.recent_searches || [],
        personalized: suggestions.personalized || []
      }
    });

  } catch (error) {
    logger.error('Get search suggestions failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get suggestions',
      message: error.message
    });
  }
};

// ================================
// IMAGE SEARCH ENDPOINTS
// ================================

/**
 * Search by image upload
 */
const searchByImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Image file is required'
      });
    }

    const {
      category,
      min_price,
      max_price,
      similarity_threshold = 0.7,
      limit = 20
    } = req.body;

    // Generate image embedding
    const imageEmbedding = await generateImageEmbedding(req.file.buffer);

    const searchParams = {
      image_embedding: imageEmbedding,
      filters: {
        category,
        min_price: min_price ? parseFloat(min_price) : undefined,
        max_price: max_price ? parseFloat(max_price) : undefined
      },
      similarity_threshold: parseFloat(similarity_threshold),
      limit: Math.min(parseInt(limit), 50),
      user_id: req.user?.id
    };

    const results = await searchService.searchByImage(searchParams);

    logger.info('Image search performed', {
      user_id: req.user?.id,
      results_count: results.data.length,
      similarity_threshold,
      image_size: req.file.size
    });

    res.json({
      success: true,
      data: results.data,
      search_metadata: {
        similarity_threshold,
        total_results: results.data.length,
        search_time: results.search_time || '< 1ms'
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

/**
 * Search by image URL
 */
const searchByImageUrl = async (req, res) => {
  try {
    const {
      image_url,
      category,
      min_price,
      max_price,
      similarity_threshold = 0.7,
      limit = 20
    } = req.body;

    if (!image_url) {
      return res.status(400).json({
        success: false,
        error: 'Image URL is required'
      });
    }

    // Download and process image from URL
    const imageBuffer = await searchService.downloadImageFromUrl(image_url);
    const imageEmbedding = await generateImageEmbedding(imageBuffer);

    const searchParams = {
      image_embedding: imageEmbedding,
      filters: {
        category,
        min_price: min_price ? parseFloat(min_price) : undefined,
        max_price: max_price ? parseFloat(max_price) : undefined
      },
      similarity_threshold: parseFloat(similarity_threshold),
      limit: Math.min(parseInt(limit), 50),
      user_id: req.user?.id
    };

    const results = await searchService.searchByImage(searchParams);

    logger.info('Image URL search performed', {
      user_id: req.user?.id,
      image_url,
      results_count: results.data.length,
      similarity_threshold
    });

    res.json({
      success: true,
      data: results.data,
      search_metadata: {
        similarity_threshold,
        total_results: results.data.length,
        search_time: results.search_time || '< 1ms',
        source_image_url: image_url
      }
    });

  } catch (error) {
    logger.error('Image URL search failed:', error);
    res.status(500).json({
      success: false,
      error: 'Image URL search failed',
      message: error.message
    });
  }
};

// ================================
// ADVANCED SEARCH ENDPOINTS
// ================================

/**
 * Advanced search with multiple criteria
 */
const advancedSearch = async (req, res) => {
  try {
    const {
      query,
      categories = [],
      price_range,
      conditions = [],
      locations = [],
      vendors = [],
      date_range,
      has_images = true,
      has_videos,
      has_3d_models,
      rating_min,
      sort_by = 'relevance',
      sort_order = 'desc',
      page = 1,
      limit = 24
    } = req.body;

    const searchParams = {
      query: query?.trim(),
      filters: {
        categories: Array.isArray(categories) ? categories : [],
        price_range: price_range ? {
          min: price_range.min,
          max: price_range.max
        } : undefined,
        conditions: Array.isArray(conditions) ? conditions : [],
        locations: Array.isArray(locations) ? locations : [],
        vendors: Array.isArray(vendors) ? vendors : [],
        date_range: date_range ? {
          start: new Date(date_range.start),
          end: new Date(date_range.end)
        } : undefined,
        media_filters: {
          has_images,
          has_videos,
          has_3d_models
        },
        rating_min: rating_min ? parseFloat(rating_min) : undefined
      },
      sorting: { sort_by, sort_order },
      pagination: {
        page: parseInt(page),
        limit: Math.min(parseInt(limit), 100)
      },
      user_id: req.user?.id
    };

    const results = await searchService.advancedSearch(searchParams);

    res.json({
      success: true,
      data: results.data,
      pagination: results.pagination,
      facets: results.facets,
      search_metadata: {
        query: query?.trim(),
        total_results: results.pagination.total,
        search_time: results.search_time || '< 1ms',
        active_filters: Object.keys(searchParams.filters).filter(key => {
          const value = searchParams.filters[key];
          return value !== undefined && value !== null && 
                 (Array.isArray(value) ? value.length > 0 : true);
        })
      }
    });

  } catch (error) {
    logger.error('Advanced search failed:', error);
    res.status(500).json({
      success: false,
      error: 'Advanced search failed',
      message: error.message
    });
  }
};

/**
 * Saved search management
 */
const saveSearch = async (req, res) => {
  try {
    const {
      name,
      query,
      filters,
      notify_on_new_results = false
    } = req.body;

    if (!name || !query) {
      return res.status(400).json({
        success: false,
        error: 'Search name and query are required'
      });
    }

    const savedSearch = await searchService.saveSearch({
      user_id: req.user.id,
      name,
      query,
      filters: filters || {},
      notify_on_new_results
    });

    res.status(201).json({
      success: true,
      data: { saved_search: savedSearch },
      message: 'Search saved successfully'
    });

  } catch (error) {
    logger.error('Save search failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save search',
      message: error.message
    });
  }
};

/**
 * Get user's saved searches
 */
const getSavedSearches = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const savedSearches = await searchService.getUserSavedSearches({
      user_id: req.user.id,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 50)
    });

    res.json({
      success: true,
      data: savedSearches.data,
      pagination: savedSearches.pagination
    });

  } catch (error) {
    logger.error('Get saved searches failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get saved searches',
      message: error.message
    });
  }
};

/**
 * Execute saved search
 */
const executeSavedSearch = async (req, res) => {
  try {
    const { searchId } = req.params;
    const { page = 1, limit = 24 } = req.query;

    const results = await searchService.executeSavedSearch({
      search_id: searchId,
      user_id: req.user.id,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100)
    });

    res.json({
      success: true,
      data: results.data,
      pagination: results.pagination,
      saved_search: results.saved_search,
      search_metadata: {
        total_results: results.pagination.total,
        search_time: results.search_time || '< 1ms',
        last_executed: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Execute saved search failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute saved search',
      message: error.message
    });
  }
};

// ================================
// SEARCH ANALYTICS ENDPOINTS
// ================================

/**
 * Get search analytics (Admin only)
 */
const getSearchAnalytics = async (req, res) => {
  try {
    if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    const {
      start_date,
      end_date,
      category,
      limit = 100
    } = req.query;

    const analytics = await searchService.getSearchAnalytics({
      start_date: start_date ? new Date(start_date) : undefined,
      end_date: end_date ? new Date(end_date) : undefined,
      category,
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    logger.error('Get search analytics failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get search analytics',
      message: error.message
    });
  }
};

/**
 * Get popular search terms
 */
const getPopularSearchTerms = async (req, res) => {
  try {
    const {
      period = '7d', // 1d, 7d, 30d
      category,
      limit = 20
    } = req.query;

    const popularTerms = await searchService.getPopularSearchTerms({
      period,
      category,
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      data: popularTerms
    });

  } catch (error) {
    logger.error('Get popular search terms failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get popular search terms',
      message: error.message
    });
  }
};

// ================================
// SEARCH FILTERS & FACETS
// ================================

/**
 * Get available search filters
 */
const getSearchFilters = async (req, res) => {
  try {
    const { category, query } = req.query;

    const filters = await searchService.getAvailableFilters({
      category,
      query: query?.trim(),
      user_id: req.user?.id
    });

    res.json({
      success: true,
      data: filters
    });

  } catch (error) {
    logger.error('Get search filters failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get search filters',
      message: error.message
    });
  }
};

/**
 * Get search facets/aggregations
 */
const getSearchFacets = async (req, res) => {
  try {
    const { query, filters = {} } = req.body;

    const facets = await searchService.getSearchFacets({
      query: query?.trim(),
      filters,
      user_id: req.user?.id
    });

    res.json({
      success: true,
      data: facets
    });

  } catch (error) {
    logger.error('Get search facets failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get search facets',
      message: error.message
    });
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Text search
  searchListings,
  autocompleteSearch,
  getSearchSuggestions,

  // Image search
  searchByImage,
  searchByImageUrl,

  // Advanced search
  advancedSearch,

  // Saved searches
  saveSearch,
  getSavedSearches,
  executeSavedSearch,

  // Analytics
  getSearchAnalytics,
  getPopularSearchTerms,

  // Filters & facets
  getSearchFilters,
  getSearchFacets
};