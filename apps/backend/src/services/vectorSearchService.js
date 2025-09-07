// apps/backend/src/services/vectorSearchService.js
// Vector search engine with Redis/pgvector optimizations

const { dbRouter, QueryOptimizer } = require('../config/db');
const logger = require('../utils/logger');
const Redis = require('ioredis');

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

    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      vectorComputations: 0,
      avgSearchTime: 0,
      totalSearches: 0
    };
  }

  async initializeOptimizations() {
    await this.preloadPopularEmbeddings();
    await this.precomputeSimilarityMatrices();
    this.setupCacheWarming();
    logger.info('✅ Vector search engine optimizations initialized');
  }

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
      const cacheKey = this.generateCacheKey(queryEmbedding, {
        limit,
        threshold,
        category_filters,
        price_range
      });

      if (use_cache) {
        const cachedResult = await this.getCachedSearchResult(cacheKey);
        if (cachedResult) {
          this.metrics.cacheHits++;
          return cachedResult;
        }
      }

      this.metrics.cacheMisses++;

      const optimizedQuery = this.buildOptimizedVectorQuery(
        queryEmbedding,
        threshold,
        category_filters,
        price_range
      );

      const results = await this.executeOptimizedVectorQuery(optimizedQuery, limit);
      const enrichedResults = await this.enrichSearchResults(results);

      if (use_cache && enrichedResults.length > 0) {
        await this.cacheSearchResult(cacheKey, enrichedResults);
      }

      const searchTime = Date.now() - startTime;
      this.updateSearchMetrics(searchTime);
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

    if (categoryFilters.category_id) {
      whereClause += ` AND l.category_id = $${paramIndex}`;
      params.push(categoryFilters.category_id);
      paramIndex++;
    }
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
          1 - (l.embedding <=> $1::vector) as similarity_score,
          CASE WHEN l.is_featured THEN 1.2 ELSE 1.0 END as feature_boost,
          LOG(GREATEST(l.views_count, 1)) / 
          LOG(GREATEST(EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 86400, 1) + 1) as popularity_score
        FROM listings l
        WHERE ${whereClause}
          AND (l.embedding <=> $1::vector) < (1 - $2)
        ORDER BY 
          l.embedding <=> $1::vector,
          l.is_featured DESC,
          l.views_count DESC
      )
      SELECT 
        vs.*,
        u.username as vendor_username,
        u.vendor_verified,
        c.name as category_name,
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
    const results = await client.$queryRawUnsafe(
      `${queryData.query} LIMIT ${limit}`,
      ...queryData.params
    );
    return results;
  }

  generateCacheKey(embedding, options) {
    const crypto = require('crypto');
    const embeddingHash = crypto.createHash('md5').update(embedding.toString()).digest('hex');
    const optionsHash = crypto.createHash('md5').update(JSON.stringify(options)).digest('hex');
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

  async preloadPopularEmbeddings() {
    try {
      const client = dbRouter.getReadClient();
      const popularListings = await client.$queryRawUnsafe(`
        SELECT id, title, embedding, views_count
        FROM listings 
        WHERE status = 'ACTIVE' 
          AND embedding IS NOT NULL
          AND views_count > 10
        ORDER BY views_count DESC
        LIMIT 1000
      `);
      popularListings.forEach(listing => {
        this.embeddingCache.set(listing.id, {
          embedding: listing.embedding,
          title: listing.title,
          views: listing.views_count,
          cached_at: Date.now()
        });
      });
    } catch (error) {
      logger.error('Failed to preload embeddings:', error);
    }
  }

  async precomputeSimilarityMatrices() {
    try {
      const client = dbRouter.getReadClient();
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
      const batchSize = 50;
      for (let i = 0; i < trendingItems.length; i += batchSize) {
        const batch = trendingItems.slice(i, i + batchSize);
        await this.computeSimilarityBatch(batch, trendingItems);
        await new Promise(resolve => setImmediate(resolve));
      }
    } catch (error) {
      logger.error('Failed to pre-compute similarities:', error);
    }
  }

  async computeSimilarityBatch(batch) {
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
      this.precomputedSimilarities.set(item.id, similarities);
    }
  }

  setupCacheWarming() {
    setInterval(async () => {
      try { await this.warmPopularSearches(); } catch (e) { logger.warn('Cache warming failed:', e); }
    }, 600000);
    setInterval(async () => {
      try { await this.cleanExpiredCache?.(); } catch (e) { /* optional */ }
    }, 1800000);
  }

  async warmPopularSearches() {
    try {
      const popular = await this.getPopularSearchQueries?.();
      if (!popular) return;
      for (const s of popular) {
        await this.performVectorSearch(s.embedding, { ...(s.filters || {}), use_cache: true });
        await new Promise(r => setTimeout(r, 100));
      }
    } catch (error) {
      logger.error('Cache warming failed:', error);
    }
  }

  async enrichSearchResults(results) {
    const listingIds = results.map(r => r.id);
    if (listingIds.length === 0) return results;
    const client = dbRouter.getReadClient();
    const images = await client.listing_images.findMany({
      where: { listing_id: { in: listingIds }, is_primary: true },
      select: { listing_id: true, url: true, alt_text: true }
    });
    const imageMap = new Map();
    images.forEach(img => { imageMap.set(img.listing_id, img); });
    return results.map(result => ({
      ...result,
      primary_image: imageMap.get(result.id) || null,
      relevance_score: result.final_score || result.similarity_score || 0
    }));
  }

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
      precomputedSimilarities: this.precomputedSimilarities.size
    };
  }
}

let vectorSearchEngine = null;
const getVectorSearchEngine = () => {
  if (!vectorSearchEngine) {
    vectorSearchEngine = new VectorSearchEngine();
  }
  return vectorSearchEngine;
};

const initializeVectorSearch = async () => {
  const engine = getVectorSearchEngine();
  await engine.initializeOptimizations();
};

module.exports = {
  VectorSearchEngine,
  getVectorSearchEngine,
  initializeVectorSearch
};


