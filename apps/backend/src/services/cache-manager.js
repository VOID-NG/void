// apps/backend/src/services/cache-manager.js
// caching and memory management system

const Redis = require('ioredis');
const logger = require('../utils/logger');
const { EventEmitter } = require('events');

// ================================
// MULTI-LAYER CACHE ARCHITECTURE
// ================================

class EnterpriseCache extends EventEmitter {
  constructor() {
    super();
    
    // L1 Cache: In-Memory (fastest, smallest)
    this.l1Cache = new Map();
    this.l1MaxSize = parseInt(process.env.L1_CACHE_SIZE) || 1000;
    this.l1TTL = parseInt(process.env.L1_CACHE_TTL) || 300; // 5 minutes
    
    // L2 Cache: Redis (fast, medium size)
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxmemoryPolicy: 'allkeys-lru',
      // Connection pool optimization
      family: 4,
      keepAlive: true,
      connectTimeout: 10000,
      commandTimeout: 5000
    });
    
    // L3 Cache: Database query cache (slowest, largest)
    this.dbCache = new Map();
    this.dbCacheMaxSize = parseInt(process.env.DB_CACHE_SIZE) || 5000;
    
    // Cache statistics
    this.stats = {
      l1: { hits: 0, misses: 0, evictions: 0 },
      l2: { hits: 0, misses: 0 },
      l3: { hits: 0, misses: 0, evictions: 0 },
      memory: { usage: 0, peak: 0 }
    };
    
    // Initialize cache management
    this.initializeCacheManagement();
  }

  async initializeCacheManagement() {
    try {
      // Connect to Redis
      await this.redis.connect();
      logger.info('✅ Redis cache connected');
      
      // Set up memory monitoring
      this.setupMemoryMonitoring();
      
      // Set up cache warming
      this.setupCacheWarming();
      
      // Set up cleanup processes
      this.setupCacheCleanup();
      
      // Set up performance monitoring
      this.setupPerformanceMonitoring();
      
      logger.info('✅ Enterprise cache system initialized');
      
    } catch (error) {
      logger.error('❌ Cache initialization failed:', error);
      throw error;
    }
  }

  // ================================
  // INTELLIGENT MULTI-LAYER RETRIEVAL
  // ================================

  async get(key, options = {}) {
    const startTime = Date.now();
    const { bypassCache = false, refreshTTL = false } = options;
    
    if (bypassCache) {
      return null;
    }

    try {
      // L1 Cache: Check in-memory first
      const l1Result = this.getFromL1(key);
      if (l1Result !== null) {
        this.stats.l1.hits++;
        this.emit('cache-hit', { layer: 'L1', key, duration: Date.now() - startTime });
        
        if (refreshTTL) {
          this.refreshTTL(key, l1Result);
        }
        
        return l1Result;
      }
      this.stats.l1.misses++;

      // L2 Cache: Check Redis
      const l2Result = await this.getFromL2(key);
      if (l2Result !== null) {
        this.stats.l2.hits++;
        
        // Promote to L1 cache
        this.setToL1(key, l2Result);
        
        this.emit('cache-hit', { layer: 'L2', key, duration: Date.now() - startTime });
        return l2Result;
      }
      this.stats.l2.misses++;

      // L3 Cache: Check database cache
      const l3Result = this.getFromL3(key);
      if (l3Result !== null) {
        this.stats.l3.hits++;
        
        // Promote to higher levels
        await this.setToL2(key, l3Result);
        this.setToL1(key, l3Result);
        
        this.emit('cache-hit', { layer: 'L3', key, duration: Date.now() - startTime });
        return l3Result;
      }
      this.stats.l3.misses++;

      // Cache miss
      this.emit('cache-miss', { key, duration: Date.now() - startTime });
      return null;

    } catch (error) {
      logger.error('Cache retrieval error:', error);
      this.emit('cache-error', { operation: 'get', key, error: error.message });
      return null;
    }
  }

  async set(key, value, ttl = this.l1TTL, options = {}) {
    const { 
      l1Only = false, 
      l2Only = false, 
      l3Only = false,
      priority = 'normal' 
    } = options;

    try {
      const serializedValue = this.serializeValue(value);
      
      // Set based on priority and options
      if (!l2Only && !l3Only) {
        this.setToL1(key, serializedValue, ttl, priority);
      }
      
      if (!l1Only && !l3Only) {
        await this.setToL2(key, serializedValue, ttl);
      }
      
      if (!l1Only && !l2Only) {
        this.setToL3(key, serializedValue, ttl);
      }
      
      this.emit('cache-set', { key, layers: this.getTargetLayers(l1Only, l2Only, l3Only) });
      return true;

    } catch (error) {
      logger.error('Cache set error:', error);
      this.emit('cache-error', { operation: 'set', key, error: error.message });
      return false;
    }
  }

  // ================================
  // L1 CACHE (IN-MEMORY) OPERATIONS
  // ================================

  getFromL1(key) {
    const item = this.l1Cache.get(key);
    
    if (!item) return null;
    
    // Check TTL
    if (Date.now() > item.expires) {
      this.l1Cache.delete(key);
      return null;
    }
    
    // Update access time for LRU
    item.lastAccess = Date.now();
    return item.value;
  }

  setToL1(key, value, ttl = this.l1TTL, priority = 'normal') {
    // Check if cache is full
    if (this.l1Cache.size >= this.l1MaxSize) {
      this.evictFromL1(priority);
    }
    
    const item = {
      value: value,
      expires: Date.now() + (ttl * 1000),
      lastAccess: Date.now(),
      priority: priority,
      size: this.calculateSize(value)
    };
    
    this.l1Cache.set(key, item);
  }

  evictFromL1(priority = 'normal') {
    // Smart eviction based on priority and LRU
    const entries = Array.from(this.l1Cache.entries());
    
    // Sort by priority (low priority first) and last access
    entries.sort((a, b) => {
      const priorityWeight = { low: 1, normal: 2, high: 3 };
      const aPriority = priorityWeight[a[1].priority] || 2;
      const bPriority = priorityWeight[b[1].priority] || 2;
      
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      
      return a[1].lastAccess - b[1].lastAccess;
    });
    
    // Evict 10% of cache or at least 1 item
    const evictCount = Math.max(1, Math.floor(this.l1Cache.size * 0.1));
    
    for (let i = 0; i < evictCount && entries.length > 0; i++) {
      const [key] = entries[i];
      this.l1Cache.delete(key);
      this.stats.l1.evictions++;
    }
  }

  // ================================
  // L2 CACHE (REDIS) OPERATIONS
  // ================================

  async getFromL2(key) {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.warn('Redis get error:', error);
      return null;
    }
  }

  async setToL2(key, value, ttl = 3600) {
    try {
      const serialized = JSON.stringify(value);
      await this.redis.setex(key, ttl, serialized);
      return true;
    } catch (error) {
      logger.warn('Redis set error:', error);
      return false;
    }
  }

  // ================================
  // L3 CACHE (DATABASE CACHE) OPERATIONS
  // ================================

  getFromL3(key) {
    const item = this.dbCache.get(key);
    
    if (!item) return null;
    
    // Check TTL
    if (Date.now() > item.expires) {
      this.dbCache.delete(key);
      return null;
    }
    
    return item.value;
  }

  setToL3(key, value, ttl = 7200) {
    // Check if cache is full
    if (this.dbCache.size >= this.dbCacheMaxSize) {
      this.evictFromL3();
    }
    
    const item = {
      value: value,
      expires: Date.now() + (ttl * 1000),
      lastAccess: Date.now()
    };
    
    this.dbCache.set(key, item);
  }

  evictFromL3() {
    // Simple LRU eviction for database cache
    const entries = Array.from(this.dbCache.entries());
    entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    
    const evictCount = Math.floor(this.dbCacheMaxSize * 0.1);
    
    for (let i = 0; i < evictCount; i++) {
      const [key] = entries[i];
      this.dbCache.delete(key);
      this.stats.l3.evictions++;
    }
  }

  // ================================
  // SPECIALIZED CACHING STRATEGIES
  // ================================

  async cacheListings(listings, category = 'all', page = 1, filters = {}) {
    const cacheKey = this.generateListingCacheKey(category, page, filters);
    
    // Use different TTL based on data freshness requirements
    const ttl = this.getOptimalTTL('listings', filters);
    
    await this.set(cacheKey, listings, ttl, { priority: 'high' });
    
    // Also cache individual listings for faster detail views
    for (const listing of listings) {
      const listingKey = `listing:${listing.id}`;
      await this.set(listingKey, listing, ttl * 2, { priority: 'normal' });
    }
  }

  async cacheSearchResults(query, results, filters = {}) {
    const cacheKey = this.generateSearchCacheKey(query, filters);
    
    // Search results have shorter TTL due to dynamic nature
    const ttl = this.getOptimalTTL('search', filters);
    
    await this.set(cacheKey, results, ttl, { priority: 'normal' });
    
    // Cache search analytics
    await this.recordSearchAnalytics(query, results.length);
  }

  async cacheUserData(userId, userData, type = 'profile') {
    const cacheKey = `user:${type}:${userId}`;
    
    // User data has longer TTL
    const ttl = this.getOptimalTTL('user', { type });
    
    await this.set(cacheKey, userData, ttl, { priority: 'high' });
  }

  // ================================
  // INTELLIGENT TTL MANAGEMENT
  // ================================

  getOptimalTTL(dataType, context = {}) {
    const baseTTLs = {
      listings: 1800,    // 30 minutes
      search: 900,       // 15 minutes
      user: 3600,        // 1 hour
      categories: 86400, // 24 hours
      system: 43200      // 12 hours
    };
    
    let ttl = baseTTLs[dataType] || 1800;
    
    // Adjust TTL based on context
    if (context.isRealTime) {
      ttl = Math.floor(ttl * 0.3); // Reduce TTL for real-time data
    }
    
    if (context.isPopular) {
      ttl = Math.floor(ttl * 1.5); // Increase TTL for popular content
    }
    
    if (context.isFeatured) {
      ttl = Math.floor(ttl * 2); // Longer TTL for featured content
    }
    
    return ttl;
  }

  async refreshTTL(key, value) {
    // Intelligently refresh TTL based on access patterns
    try {
      const accessCount = await this.redis.incr(`access:${key}`);
      const ttlMultiplier = Math.min(2.0, 1 + (accessCount * 0.1));
      
      const newTTL = Math.floor(this.l1TTL * ttlMultiplier);
      await this.set(key, value, newTTL);
      
    } catch (error) {
      logger.warn('TTL refresh failed:', error);
    }
  }

  // ================================
  // MEMORY MANAGEMENT
  // ================================

  setupMemoryMonitoring() {
    setInterval(() => {
      const memUsage = process.memoryUsage();
      this.stats.memory.usage = memUsage.heapUsed;
      
      if (memUsage.heapUsed > this.stats.memory.peak) {
        this.stats.memory.peak = memUsage.heapUsed;
      }
      
      // Memory pressure management
      const memoryPressure = memUsage.heapUsed / memUsage.heapTotal;
      
      if (memoryPressure > 0.85) {
        logger.warn('High memory pressure detected', { 
          usage: memUsage.heapUsed,
          total: memUsage.heapTotal,
          pressure: memoryPressure 
        });
        
        this.performEmergencyCleanup();
      }
      
    }, 30000); // Check every 30 seconds
  }

  performEmergencyCleanup() {
    logger.info('🧹 Performing emergency cache cleanup');
    
    // Aggressive L1 cache cleanup
    const l1Size = this.l1Cache.size;
    const targetSize = Math.floor(l1Size * 0.5); // Reduce to 50%
    
    this.evictFromL1('low');
    this.evictFromL1('normal');
    
    // L3 cache cleanup
    const l3Size = this.dbCache.size;
    const l3TargetSize = Math.floor(l3Size * 0.7); // Reduce to 70%
    
    while (this.dbCache.size > l3TargetSize) {
      this.evictFromL3();
    }
    
    // Force garbage collection
    if (global.gc) {
      global.gc();
    }
    
    logger.info('✅ Emergency cleanup completed', {
      l1Before: l1Size,
      l1After: this.l1Cache.size,
      l3Before: l3Size,
      l3After: this.dbCache.size
    });
  }

  // ================================
  // CACHE WARMING STRATEGIES
  // ================================

  setupCacheWarming() {
    // Warm cache with popular content on startup
    setTimeout(() => {
      this.warmPopularContent();
    }, 10000); // Wait 10 seconds after startup
    
    // Periodic cache warming
    setInterval(() => {
      this.warmPopularContent();
    }, 1800000); // Every 30 minutes
  }

  async warmPopularContent() {
    try {
      logger.info('🔥 Warming cache with popular content');
      
      // Warm popular listings
      await this.warmPopularListings();
      
      // Warm popular searches
      await this.warmPopularSearches();
      
      // Warm category data
      await this.warmCategoryData();
      
      logger.info('✅ Cache warming completed');
      
    } catch (error) {
      logger.error('Cache warming failed:', error);
    }
  }

  async warmPopularListings() {
    const { dbRouter } = require('../config/db-optimized');
    const client = dbRouter.getReadClient();
    
    try {
      const popularListings = await client.listing.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { views_count: 'desc' },
        take: 100,
        select: {
          id: true,
          title: true,
          price: true,
          condition: true,
          views_count: true
        }
      });
      
      for (const listing of popularListings) {
        await this.set(`listing:${listing.id}`, listing, 7200, { priority: 'high' });
      }
      
      logger.info(`🔥 Warmed ${popularListings.length} popular listings`);
      
    } catch (error) {
      logger.warn('Failed to warm popular listings:', error);
    }
  }

  // ================================
  // UTILITY METHODS
  // ================================

  generateListingCacheKey(category, page, filters) {
    const filterString = Object.keys(filters)
      .sort()
      .map(key => `${key}:${filters[key]}`)
      .join('|');
    
    return `listings:${category}:p${page}:${filterString}`;
  }

  generateSearchCacheKey(query, filters) {
    const crypto = require('crypto');
    const queryHash = crypto.createHash('md5').update(query).digest('hex');
    const filterHash = crypto.createHash('md5').update(JSON.stringify(filters)).digest('hex');
    
    return `search:${queryHash}:${filterHash}`;
  }

  serializeValue(value) {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  calculateSize(value) {
    return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
  }

  getTargetLayers(l1Only, l2Only, l3Only) {
    const layers = [];
    if (!l2Only && !l3Only) layers.push('L1');
    if (!l1Only && !l3Only) layers.push('L2');
    if (!l1Only && !l2Only) layers.push('L3');
    return layers;
  }

  // ================================
  // PERFORMANCE MONITORING
  // ================================

  setupPerformanceMonitoring() {
    setInterval(() => {
      this.logCacheStatistics();
    }, 300000); // Every 5 minutes
  }

  logCacheStatistics() {
    const stats = this.getDetailedStatistics();
    
    logger.info('📊 Cache Performance Statistics', stats);
    
    // Alert on poor performance
    if (stats.l1HitRate < 0.7) {
      logger.warn('⚠️  Low L1 cache hit rate', { hitRate: stats.l1HitRate });
    }
    
    if (stats.l2HitRate < 0.8) {
      logger.warn('⚠️  Low L2 cache hit rate', { hitRate: stats.l2HitRate });
    }
  }

  getDetailedStatistics() {
    const l1HitRate = this.stats.l1.hits / (this.stats.l1.hits + this.stats.l1.misses) || 0;
    const l2HitRate = this.stats.l2.hits / (this.stats.l2.hits + this.stats.l2.misses) || 0;
    const l3HitRate = this.stats.l3.hits / (this.stats.l3.hits + this.stats.l3.misses) || 0;
    
    return {
      l1: {
        ...this.stats.l1,
        hitRate: l1HitRate,
        size: this.l1Cache.size,
        maxSize: this.l1MaxSize
      },
      l2: {
        ...this.stats.l2,
        hitRate: l2HitRate
      },
      l3: {
        ...this.stats.l3,
        hitRate: l3HitRate,
        size: this.dbCache.size,
        maxSize: this.dbCacheMaxSize
      },
      memory: {
        ...this.stats.memory,
        usageMB: Math.round(this.stats.memory.usage / 1024 / 1024),
        peakMB: Math.round(this.stats.memory.peak / 1024 / 1024)
      },
      overall: {
        totalHits: this.stats.l1.hits + this.stats.l2.hits + this.stats.l3.hits,
        totalMisses: this.stats.l1.misses + this.stats.l2.misses + this.stats.l3.misses
      }
    };
  }

  async cleanup() {
    try {
      await this.redis.disconnect();
      this.l1Cache.clear();
      this.dbCache.clear();
      logger.info('✅ Cache cleanup completed');
    } catch (error) {
      logger.error('Cache cleanup failed:', error);
    }
  }
}

// ================================
// SINGLETON INSTANCE
// ================================

let cacheInstance = null;

const getCacheManager = () => {
  if (!cacheInstance) {
    cacheInstance = new EnterpriseCache();
  }
  return cacheInstance;
};

const initializeCache = async () => {
  try {
    const cache = getCacheManager();
    await cache.initializeCacheManagement();
    logger.info('✅ Enterprise cache system ready');
    return cache;
  } catch (error) {
    logger.error('❌ Cache initialization failed:', error);
    throw error;
  }
};

module.exports = {
  EnterpriseCache,
  getCacheManager,
  initializeCache
};