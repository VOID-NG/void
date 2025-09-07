// apps/backend/src/services/optimized-search-service.js
// AI search optimization with vector database performance tuning

const { dbRouter, QueryOptimizer } = require('../config/db-optimized');
const logger = require('../utils/logger');
const Redis = require('ioredis');

// ================================
// VECTOR SEARCH OPTIMIZATION ENGINE
// ================================

class VectorSearchEngine {
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      lazyConnect: true
    });
    
    this.embeddingCache = new Map();
    this.searchCache = new Map();
    this.precomputedSimilarities = new Map();
    
    // Performance metrics
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      vectorComputations: 0,
      avgSearchTime: 0,
      totalSearches: 0
    };
    
    this.initializeOptimizations();
  }

  async initializeOptimizations() {
    // Pre-load popular embeddings into memory
    await this.preloadPopularEmbeddings();
    
    // Pre-compute similarity matrices for trending items
    await this.precomputeSimilarityMatrices();
    
    // Set up cache warming
    this.setupCacheWarming();
    
    logger.info('✅ Vector search engine optimizations initialized');
  }

  // ================================
  // OPTIMIZED VECTOR SIMILARITY SEARCH
  // ================================

  async performVectorSearch(queryEmbedding, options = {}) {
    const startTime = Date.now();
    const {
      limit = 20,
      threshold = 0.7,
      category_filters = {},
      price_range = {},
      use_cache = true
    } = options;

    try {
      // Generate cache key
      const cacheKey = this.generateCacheKey(queryEmbedding, options);
      
      // Check cache first
      if (use_cache) {
        const cachedResult = await this.getCachedSearchResult(cacheKey);
        if (cachedResult) {
          this.metrics.cacheHits++;
          logger.debug('Vector search cache hit', { cacheKey });
          return cachedResult;
        }
      }
      
      this.metrics.cacheMisses++;
      
      // Optimize query based on filters
      const optimizedQuery = this.buildOptimizedVectorQuery(
        queryEmbedding, 
        threshold, 
        category_filters, 
        price_range
      );
      
      // Execute vector search with pgvector optimization
      const results = await this.executeOptimizedVectorQuery(optimizedQuery, limit);
      
      // Post-process and enrich results
      const enrichedResults = await this.enrichSearchResults(results);
      
      // Cache the results
      if (use_cache && enrichedResults.length > 0) {
        await this.cacheSearchResult(cacheKey, enrichedResults);
      }
      
      // Update metrics
      const searchTime = Date.now() - startTime;
      this.updateSearchMetrics(searchTime);
      
      logger.info('Vector search completed', {
        duration: `${searchTime}ms`,
        resultsCount: enrichedResults.length,
        cacheKey: use_cache ? cacheKey : 'no-cache'
      });
      
      return enrichedResults;
      
    } catch (error) {
      logger.error('Vector search failed:', error);
      throw error;
    }
  }

  buildOptimizedVectorQuery(embedding, threshold, categoryFilters, priceRange) {
    let whereClause = `l.status = 'ACTIVE' AND l.embedding IS NOT NULL`;
    const params = [embedding, threshold];
    let paramIndex = 3;

    // Add category filters
    if (categoryFilters.category_id) {
      whereClause += ` AND l.category_id = $${paramIndex}`;
      params.push(categoryFilters.category_id);
      paramIndex++;
    }

    // Add price range filters
    if (priceRange.min) {
      whereClause += ` AND l.price >= $${paramIndex}`;
      params.push(priceRange.min);
      paramIndex++;
    }
    
    if (priceRange.max) {
      whereClause += ` AND l.price <= $${paramIndex}`;
      params.push(priceRange.max);
      paramIndex++;
    }

    // Advanced pgvector optimization with HNSW index
    const optimizedQuery = `
      WITH vector_search AS (
        SELECT 
          l.id,
          l.title,
          l.price,
          l.condition,
          l.is_featured,
          l.vendor_id,
          l.category_id,
          l.created_at,
          l.views_count,
          -- Use cosine distance with pgvector optimization
          1 - (l.embedding <=> $1::vector) as similarity_score,
          -- Boost featured listings
          CASE WHEN l.is_featured THEN 1.2 ELSE 1.0 END as feature_boost,
          -- Boost by popularity (views/age ratio)
          LOG(GREATEST(l.views_count, 1)) / 
          LOG(GREATEST(EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 86400, 1) + 1) as popularity_score
        FROM listings l
        WHERE ${whereClause}
          AND (l.embedding <=> $1::vector) < (1 - $2)  -- Use distance threshold
        ORDER BY 
          l.embedding <=> $1::vector,  -- Primary: similarity
          l.is_featured DESC,          -- Secondary: featured status
          l.views_count DESC           -- Tertiary: popularity
      )
      SELECT 
        vs.*,
        u.username as vendor_username,
        u.vendor_verified,
        c.name as category_name,
        -- Calculate final score combining similarity, features, and popularity
        (vs.similarity_score * vs.feature_boost * (1 + vs.popularity_score * 0.1)) as final_score
      FROM vector_search vs
      JOIN users u ON vs.vendor_id = u.id
      JOIN categories c ON vs.category_id = c.id
      ORDER BY final_score DESC
    `;

    return { query: optimizedQuery, params };
  }

  async executeOptimizedVectorQuery(queryData, limit) {
    const client = dbRouter.getReadClient();
    
    try {
      // Use raw query for maximum performance with pgvector
      const results = await client.$queryRawUnsafe(
        `${queryData.query} LIMIT ${limit}`,
        ...queryData.params
      );
      
      return results;
    } catch (error) {
      logger.error('Vector query execution failed:', error);
      throw error;
    }
  }

  // ================================
  // INTELLIGENT CACHING SYSTEM
  // ================================

  generateCacheKey(embedding, options) {
    // Create a hash of the embedding and options for caching
    const crypto = require('crypto');
    const embeddingHash = crypto
      .createHash('md5')
      .update(embedding.toString())
      .digest('hex');
    
    const optionsHash = crypto
      .createHash('md5')
      .update(JSON.stringify(options))
      .digest('hex');
    
    return `vector_search:${embeddingHash}:${optionsHash}`;
  }

  async getCachedSearchResult(cacheKey) {
    try {
      const cached = await this.redis.get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.warn('Cache retrieval failed:', error);
      return null;
    }
  }

  async cacheSearchResult(cacheKey, results, ttl = 3600) {
    try {
      await this.redis.setex(cacheKey, ttl, JSON.stringify(results));
    } catch (error) {
      logger.warn('Cache storage failed:', error);
    }
  }

  // ================================
  // PRELOADING AND PREDICTIVE OPTIMIZATION
  // ================================

  async preloadPopularEmbeddings() {
    try {
      logger.info('🔄 Preloading popular embeddings...');
      
      const client = dbRouter.getReadClient();
      
      // Get most viewed/searched listings
      const popularListings = await client.$queryRawUnsafe(`
        SELECT id, title, embedding, views_count
        FROM listings 
        WHERE status = 'ACTIVE' 
          AND embedding IS NOT NULL
          AND views_count > 10
        ORDER BY views_count DESC
        LIMIT 1000
      `);
      
      // Cache embeddings in memory for fast access
      popularListings.forEach(listing => {
        this.embeddingCache.set(listing.id, {
          embedding: listing.embedding,
          title: listing.title,
          views: listing.views_count,
          cached_at: Date.now()
        });
      });
      
      logger.info(`✅ Preloaded ${popularListings.length} popular embeddings`);
      
    } catch (error) {
      logger.error('Failed to preload embeddings:', error);
    }
  }

  async precomputeSimilarityMatrices() {
    try {
      logger.info('🔄 Pre-computing similarity matrices...');
      
      const client = dbRouter.getReadClient();
      
      // Get trending items for similarity pre-computation
      const trendingItems = await client.$queryRawUnsafe(`
        SELECT id, embedding, category_id
        FROM listings 
        WHERE status = 'ACTIVE' 
          AND embedding IS NOT NULL
          AND (
            is_featured = true 
            OR views_count > 50 
            OR created_at > NOW() - INTERVAL '7 days'
          )
        ORDER BY 
          CASE WHEN is_featured THEN 1 ELSE 0 END DESC,
          views_count DESC
        LIMIT 500
      `);
      
      // Pre-compute similarities between trending items
      const batchSize = 50;
      for (let i = 0; i < trendingItems.length; i += batchSize) {
        const batch = trendingItems.slice(i, i + batchSize);
        await this.computeSimilarityBatch(batch, trendingItems);
        
        // Prevent blocking the event loop
        await new Promise(resolve => setImmediate(resolve));
      }
      
      logger.info(`✅ Pre-computed similarities for ${trendingItems.length} trending items`);
      
    } catch (error) {
      logger.error('Failed to pre-compute similarities:', error);
    }
  }

  async computeSimilarityBatch(batch, allItems) {
    const client = dbRouter.getReadClient();
    
    for (const item of batch) {
      const similarities = await client.$queryRawUnsafe(`
        SELECT 
          id,
          1 - (embedding <=> $1::vector) as similarity
        FROM listings
        WHERE id != $2 
          AND status = 'ACTIVE'
          AND embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT 20
      `, item.embedding, item.id);
      
      // Cache the similarities
      this.precomputedSimilarities.set(item.id, similarities);
    }
  }

  // ================================
  // MARKOV CHAIN PREDICTIVE LOADING
  // ================================

  setupMarkovChainPreloader() {
    // Implement Markov chain for predictive content loading
    this.userBehaviorChains = new Map();
    this.transitionProbabilities = new Map();
    
    // Background process to build Markov chains from user behavior
    setInterval(() => {
      this.buildMarkovChains();
    }, 300000); // Every 5 minutes
    
    // Predictive preloading based on current user state
    setInterval(() => {
      this.performPredictivePreloading();
    }, 60000); // Every minute
  }

  async buildMarkovChains() {
    try {
      const client = dbRouter.getReadClient();
      
      // Analyze user interaction sequences
      const interactions = await client.$queryRawUnsafe(`
        SELECT 
          user_id,
          listing_id,
          interaction_type,
          created_at,
          LAG(listing_id) OVER (
            PARTITION BY user_id 
            ORDER BY created_at
          ) as previous_listing_id
        FROM user_interactions 
        WHERE created_at > NOW() - INTERVAL '7 days'
        ORDER BY user_id, created_at
      `);
      
      // Build transition matrices
      const transitions = new Map();
      
      interactions.forEach(interaction => {
        if (interaction.previous_listing_id) {
          const key = `${interaction.previous_listing_id}->${interaction.listing_id}`;
          transitions.set(key, (transitions.get(key) || 0) + 1);
        }
      });
      
      // Calculate probabilities
      this.transitionProbabilities.clear();
      
      const totalTransitions = Array.from(transitions.values()).reduce((sum, count) => sum + count, 0);
      
      transitions.forEach((count, transition) => {
        const probability = count / totalTransitions;
        this.transitionProbabilities.set(transition, probability);
      });
      
      logger.info(`📊 Built Markov chains with ${transitions.size} transitions`);
      
    } catch (error) {
      logger.error('Failed to build Markov chains:', error);
    }
  }

  async performPredictivePreloading() {
    try {
      // Get currently active users and their current listings
      const activeSessions = await this.getActiveUserSessions();
      
      for (const session of activeSessions) {
        const predictedListings = this.predictNextListings(session.currentListingId, 5);
        
        if (predictedListings.length > 0) {
          // Preload predicted listings data
          await this.preloadListingsData(predictedListings, session.userId);
        }
      }
      
    } catch (error) {
      logger.error('Predictive preloading failed:', error);
    }
  }

  predictNextListings(currentListingId, limit = 5) {
    const predictions = [];
    
    // Find transitions from current listing
    for (const [transition, probability] of this.transitionProbabilities) {
      const [from, to] = transition.split('->');
      
      if (from === currentListingId) {
        predictions.push({
          listingId: to,
          probability: probability
        });
      }
    }
    
    // Sort by probability and return top predictions
    return predictions
      .sort((a, b) => b.probability - a.probability)
      .slice(0, limit)
      .map(p => p.listingId);
  }

  async preloadListingsData(listingIds, userId) {
    try {
      const client = dbRouter.getReadClient();
      
      const listings = await client.listing.findMany({
        where: {
          id: { in: listingIds },
          status: 'ACTIVE'
        },
        select: QueryOptimizer.optimizeListingQuery().select
      });
      
      // Cache preloaded data with user-specific key
      const cacheKey = `preloaded:${userId}:${Date.now()}`;
      await this.redis.setex(cacheKey, 300, JSON.stringify(listings)); // 5 min TTL
      
      logger.debug('Preloaded listings data', { 
        userId, 
        listingCount: listings.length 
      });
      
    } catch (error) {
      logger.warn('Failed to preload listings data:', error);
    }
  }

  // ================================
  // PERFORMANCE MONITORING
  // ================================

  updateSearchMetrics(searchTime) {
    this.metrics.totalSearches++;
    this.metrics.avgSearchTime = (
      (this.metrics.avgSearchTime * (this.metrics.totalSearches - 1)) + searchTime
    ) / this.metrics.totalSearches;
    
    this.metrics.vectorComputations++;
  }

  getPerformanceMetrics() {
    return {
      ...this.metrics,
      cacheHitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses),
      embeddingCacheSize: this.embeddingCache.size,
      precomputedSimilarities: this.precomputedSimilarities.size,
      markovTransitions: this.transitionProbabilities.size
    };
  }

  // ================================
  // CACHE WARMING AND MAINTENANCE
  // ================================

  setupCacheWarming() {
    // Warm cache with popular searches
    setInterval(async () => {
      await this.warmPopularSearches();
    }, 600000); // Every 10 minutes
    
    // Clean expired cache entries
    setInterval(async () => {
      await this.cleanExpiredCache();
    }, 1800000); // Every 30 minutes
  }

  async warmPopularSearches() {
    try {
      const popularSearches = await this.getPopularSearchQueries();
      
      for (const searchQuery of popularSearches) {
        // Pre-execute popular searches to warm cache
        await this.performVectorSearch(searchQuery.embedding, {
          ...searchQuery.filters,
          use_cache: true
        });
        
        // Prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      logger.info(`🔥 Warmed cache with ${popularSearches.length} popular searches`);
      
    } catch (error) {
      logger.error('Cache warming failed:', error);
    }
  }

  async enrichSearchResults(results) {
    // Add primary images efficiently
    const listingIds = results.map(r => r.id);
    
    if (listingIds.length === 0) return results;
    
    const client = dbRouter.getReadClient();
    
    const images = await client.listing_images.findMany({
      where: {
        listing_id: { in: listingIds },
        is_primary: true
      },
      select: {
        listing_id: true,
        url: true,
        alt_text: true
      }
    });
    
    // Create image lookup map
    const imageMap = new Map();
    images.forEach(img => {
      imageMap.set(img.listing_id, img);
    });
    
    // Enrich results with images
    return results.map(result => ({
      ...result,
      primary_image: imageMap.get(result.id) || null,
      // Add search relevance score
      relevance_score: result.final_score || result.similarity_score || 0
    }));
  }
}

// ================================
// FACTORY AND INITIALIZATION
// ================================

let vectorSearchEngine = null;

const getVectorSearchEngine = () => {
  if (!vectorSearchEngine) {
    vectorSearchEngine = new VectorSearchEngine();
  }
  return vectorSearchEngine;
};

const initializeVectorSearch = async () => {
  try {
    logger.info('🤖 Initializing AI search optimization engine...');
    
    const engine = getVectorSearchEngine();
    await engine.initializeOptimizations();
    
    logger.info('✅ AI search optimization engine ready');
    
  } catch (error) {
    logger.error('❌ AI search optimization failed:', error);
    throw error;
  }
};

module.exports = {
  VectorSearchEngine,
  getVectorSearchEngine,
  initializeVectorSearch
};