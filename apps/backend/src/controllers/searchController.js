// apps/backend/src/controllers/searchController.js
// AI-powered search controller for VOID Marketplace

const { 
    unifiedSearch,
    performTextSearch,
    performImageSearch,
    performCombinedSearch,
    generateSearchRecommendations,
    SEARCH_SERVICE_CONFIG
  } = require('../services/searchService');
  const { 
    generateAutocompleteSuggestions, 
    logSearchAnalytics,
    updateSearchSuggestion
  } = require('../utils/fuzzySearchUtils');
  const { 
    generateListingEmbeddings,
    batchProcessEmbeddings,
    EMBEDDING_CONFIG
  } = require('../utils/imageEmbeddingUtils');
  const { prisma } = require('../config/db');
  const logger = require('../utils/logger');
  const multer = require('multer');
  const path = require('path');
  
  // ================================
  // FILE UPLOAD CONFIGURATION
  // ================================
  
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/search-images/');
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, `search-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
  });
  
  const uploadSearchImage = multer({
    storage: storage,
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB limit
      files: 1
    },
    fileFilter: (req, file, cb) => {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
      }
    }
  });
  
  // ================================
  // SEARCH ENDPOINTS
  // ================================
  
  /**
   * @route   GET /api/v1/search
   * @desc    Universal search endpoint (text, image, or combined)
   * @access  Public
   */
  const universalSearch = async (req, res) => {
    try {
      const startTime = Date.now();
      
      const {
        q: query,
        type = 'text',
        sort = 'relevance',
        limit = 20,
        offset = 0,
        category,
        vendor,
        min_price,
        max_price,
        condition,
        location,
        negotiable,
        featured,
        include_recommendations = 'true',
        include_facets = 'true'
      } = req.query;
  
      // Validate search type
      const validTypes = Object.values(SEARCH_SERVICE_CONFIG.SEARCH_TYPES);
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid search type',
          message: `Search type must be one of: ${validTypes.join(', ')}`
        });
      }
  
      // Build filters object
      const filters = {};
      if (category) filters.categoryId = category;
      if (vendor) filters.vendorId = vendor;
      if (min_price) filters.minPrice = parseFloat(min_price);
      if (max_price) filters.maxPrice = parseFloat(max_price);
      if (condition) filters.condition = condition;
      if (location) filters.location = location;
      if (negotiable !== undefined) filters.isNegotiable = negotiable === 'true';
      if (featured !== undefined) filters.isFeatured = featured === 'true';
  
      // Build search parameters
      const searchParams = {
        query,
        searchType: type,
        filters,
        sort,
        limit: Math.min(parseInt(limit), 100), // Cap at 100
        offset: parseInt(offset),
        includeRecommendations: include_recommendations === 'true',
        includeFacets: include_facets === 'true'
      };
  
      // Build user context
      const userContext = {
        userId: req.user?.id,
        sessionId: req.sessionId || req.headers['x-session-id'],
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        preferences: req.user?.search_preferences || {}
      };
  
      // Perform search
      const searchResult = await unifiedSearch(searchParams, userContext);
  
      const responseTime = Date.now() - startTime;
  
      logger.info('Universal search completed', {
        query: query?.substring(0, 100),
        type,
        resultsCount: searchResult.results.length,
        responseTime,
        userId: req.user?.id
      });
  
      res.json({
        success: true,
        data: searchResult.results,
        metadata: {
          ...searchResult.metadata,
          response_time_ms: responseTime
        },
        pagination: searchResult.pagination
      });
  
    } catch (error) {
      logger.error('Universal search failed:', error);
      res.status(500).json({
        success: false,
        error: 'Search failed',
        message: error.message
      });
    }
  };
  
  /**
   * @route   POST /api/v1/search/image
   * @desc    Image-based search with file upload
   * @access  Public
   */
  const imageSearch = [
    uploadSearchImage.single('image'),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'No image provided',
            message: 'Please upload an image for search'
          });
        }
  
        const {
          limit = 20,
          category,
          min_price,
          max_price,
          condition
        } = req.body;
  
        // Build filters
        const filters = {};
        if (category) filters.categoryId = category;
        if (min_price) filters.minPrice = parseFloat(min_price);
        if (max_price) filters.maxPrice = parseFloat(max_price);
        if (condition) filters.condition = condition;
  
        // Perform image search
        const results = await performImageSearch(req.file, filters, {
          limit: Math.min(parseInt(limit), 50) // Cap at 50 for image search
        });
  
        // Clean up uploaded file
        const fs = require('fs');
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
  
        logger.info('Image search completed', {
          filename: req.file.filename,
          resultsCount: results.length,
          userId: req.user?.id
        });
  
        res.json({
          success: true,
          data: results,
          metadata: {
            search_type: 'image',
            image_processed: true,
            results_count: results.length
          }
        });
  
      } catch (error) {
        logger.error('Image search failed:', error);
        
        // Clean up uploaded file on error
        if (req.file && req.file.path) {
          const fs = require('fs');
          if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
        }
  
        res.status(500).json({
          success: false,
          error: 'Image search failed',
          message: error.message
        });
      }
    }
  ];
  
  /**
   * @route   GET /api/v1/search/autocomplete
   * @desc    Get search suggestions for autocomplete
   * @access  Public
   */
  const autocomplete = async (req, res) => {
    try {
      const { q: query, category, limit = 10 } = req.query;
  
      if (!query || query.length < 2) {
        return res.json({
          success: true,
          data: []
        });
      }
  
      const suggestions = await generateAutocompleteSuggestions(query, {
        limit: Math.min(parseInt(limit), 20),
        categoryId: category,
        includePopular: true,
        includeTrending: true
      });
  
      res.json({
        success: true,
        data: suggestions
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
  
  /**
   * @route   GET /api/v1/search/trending
   * @desc    Get trending search terms
   * @access  Public
   */
  const getTrendingSearches = async (req, res) => {
    try {
      const { limit = 10, category } = req.query;
  
      const trending = await prisma.searchSuggestion.findMany({
        where: {
          is_trending: true,
          ...(category ? { category_id: category } : {})
        },
        orderBy: [
          { search_count: 'desc' },
          { updated_at: 'desc' }
        ],
        take: Math.min(parseInt(limit), 50),
        select: {
          suggestion_text: true,
          search_count: true,
          category: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });
  
      res.json({
        success: true,
        data: trending.map(item => ({
          text: item.suggestion_text,
          count: item.search_count,
          category: item.category
        }))
      });
  
    } catch (error) {
      logger.error('Get trending searches failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch trending searches',
        message: error.message
      });
    }
  };
  
  /**
   * @route   GET /api/v1/search/popular
   * @desc    Get popular search terms
   * @access  Public
   */
  const getPopularSearches = async (req, res) => {
    try {
      const { limit = 20, days = 7, category } = req.query;
  
      // Get popular searches from the last N days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
  
      const popular = await prisma.searchAnalytics.groupBy({
        by: ['query_text'],
        where: {
          query_text: {
            not: null
          },
          created_at: {
            gte: cutoffDate
          },
          results_count: {
            gt: 0
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
        take: Math.min(parseInt(limit), 50)
      });
  
      res.json({
        success: true,
        data: popular.map(item => ({
          text: item.query_text,
          search_count: item._count.query_text
        }))
      });
  
    } catch (error) {
      logger.error('Get popular searches failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch popular searches',
        message: error.message
      });
    }
  };
  
  /**
   * @route   GET /api/v1/search/recommendations/:listingId
   * @desc    Get search-based recommendations for a listing
   * @access  Public
   */
  const getSearchRecommendations = async (req, res) => {
    try {
      const { listingId } = req.params;
      const { limit = 10 } = req.query;
  
      const recommendations = await generateSearchRecommendations(
        listingId,
        null, // No query context
        req.user?.id
      );
  
      res.json({
        success: true,
        data: recommendations
      });
  
    } catch (error) {
      logger.error('Get search recommendations failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch recommendations',
        message: error.message
      });
    }
  };
  
  /**
   * @route   POST /api/v1/search/analytics/click
   * @desc    Track search result clicks for analytics
   * @access  Public
   */
  const trackSearchClick = async (req, res) => {
    try {
      const { 
        search_id, 
        listing_id, 
        query, 
        search_type = 'text',
        result_position 
      } = req.body;
  
      // Log the click event
      await logSearchAnalytics({
        userId: req.user?.id,
        queryText: query,
        queryType: search_type,
        clickedResultId: listing_id,
        sessionId: req.sessionId || req.headers['x-session-id'],
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        metadata: {
          search_id,
          result_position,
          click_timestamp: new Date().toISOString()
        }
      });
  
      // Increment click count for the listing (optional)
      if (listing_id) {
        await prisma.listing.update({
          where: { id: listing_id },
          data: {
            click_count: {
              increment: 1
            }
          }
        }).catch(error => {
          logger.warn('Failed to increment listing click count:', error);
        });
      }
  
      res.json({
        success: true,
        message: 'Click tracked successfully'
      });
  
    } catch (error) {
      logger.error('Track search click failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to track click',
        message: error.message
      });
    }
  };
  
  // ================================
  // ADMIN SEARCH MANAGEMENT
  // ================================
  
  /**
   * @route   GET /api/v1/search/admin/analytics
   * @desc    Get search analytics for admin dashboard
   * @access  Private (Admin+)
   */
  const getSearchAnalytics = async (req, res) => {
    try {
      const { 
        days = 7,
        search_type,
        limit = 100 
      } = req.query;
  
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
  
      // Get search volume over time
      const searchVolume = await prisma.searchAnalytics.groupBy({
        by: ['query_type'],
        where: {
          created_at: {
            gte: cutoffDate
          },
          ...(search_type ? { query_type: search_type } : {})
        },
        _count: {
          id: true
        },
        _avg: {
          response_time_ms: true,
          results_count: true
        }
      });
  
      // Get top queries
      const topQueries = await prisma.searchAnalytics.groupBy({
        by: ['query_text'],
        where: {
          created_at: {
            gte: cutoffDate
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
        take: 20
      });
  
      // Get search success rate (searches with results vs without)
      const successRate = await prisma.searchAnalytics.aggregate({
        where: {
          created_at: {
            gte: cutoffDate
          }
        },
        _count: {
          id: true
        },
        _avg: {
          results_count: true
        }
      });
  
      const analytics = {
        search_volume: searchVolume,
        top_queries: topQueries,
        success_rate: {
          total_searches: successRate._count.id,
          avg_results: successRate._avg.results_count,
          success_percentage: successRate._avg.results_count > 0 ? 
            ((successRate._avg.results_count / successRate._count.id) * 100).toFixed(2) : 0
        },
        period: {
          days: parseInt(days),
          start_date: cutoffDate.toISOString(),
          end_date: new Date().toISOString()
        }
      };
  
      res.json({
        success: true,
        data: analytics
      });
  
    } catch (error) {
      logger.error('Get search analytics failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch search analytics',
        message: error.message
      });
    }
  };
  
  /**
   * @route   POST /api/v1/search/admin/reindex
   * @desc    Reindex all listings for search (regenerate embeddings)
   * @access  Private (Admin+)
   */
  const reindexListings = async (req, res) => {
    try {
      const { batch_size = 10, force = false } = req.body;
  
      logger.info('Starting search reindexing', {
        adminId: req.user.id,
        batchSize: batch_size,
        force
      });
  
      // Get all active listings
      const listings = await prisma.listing.findMany({
        where: {
          status: 'ACTIVE'
        },
        include: {
          images: {
            where: { is_primary: true },
            take: 1
          }
        }
      });
  
      // Process embeddings in batches
      const result = await batchProcessEmbeddings(listings);
  
      // Log admin action
      await prisma.adminAction.create({
        data: {
          admin_id: req.user.id,
          action_type: 'reindex_search',
          target_type: 'listings',
          target_id: 'all',
          metadata: JSON.stringify({
            total_listings: listings.length,
            successful: result.successful,
            failed: result.failed,
            batch_size
          })
        }
      });
  
      logger.info('Search reindexing completed', {
        adminId: req.user.id,
        totalListings: listings.length,
        successful: result.successful,
        failed: result.failed
      });
  
      res.json({
        success: true,
        message: 'Search reindexing completed',
        data: {
          total_listings: listings.length,
          successful: result.successful,
          failed: result.failed,
          errors: result.errors
        }
      });
  
    } catch (error) {
      logger.error('Search reindexing failed:', error);
      res.status(500).json({
        success: false,
        error: 'Reindexing failed',
        message: error.message
      });
    }
  };
  
  /**
   * @route   PUT /api/v1/search/admin/suggestions/:id
   * @desc    Update search suggestion (mark as trending, etc.)
   * @access  Private (Admin+)
   */
  const updateSearchSuggestion = async (req, res) => {
    try {
      const { id } = req.params;
      const { is_trending, search_count } = req.body;
  
      const suggestion = await prisma.searchSuggestion.update({
        where: { id },
        data: {
          ...(is_trending !== undefined ? { is_trending } : {}),
          ...(search_count !== undefined ? { search_count } : {}),
          updated_at: new Date()
        }
      });
  
      logger.info('Search suggestion updated', {
        adminId: req.user.id,
        suggestionId: id,
        updates: { is_trending, search_count }
      });
  
      res.json({
        success: true,
        data: suggestion
      });
  
    } catch (error) {
      logger.error('Update search suggestion failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update suggestion',
        message: error.message
      });
    }
  };
  
  // ================================
  // EXPORTS
  // ================================
  
  module.exports = {
    // Public search endpoints
    universalSearch,
    imageSearch,
    autocomplete,
    getTrendingSearches,
    getPopularSearches,
    getSearchRecommendations,
    trackSearchClick,
    
    // Admin endpoints
    getSearchAnalytics,
    reindexListings,
    updateSearchSuggestion
  };