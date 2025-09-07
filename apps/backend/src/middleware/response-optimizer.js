// apps/backend/src/middleware/response-optimizer.js
// API response optimization with intelligent pagination

const logger = require('../utils/logger');
const { getCacheManager } = require('../services/cache-manager');
const compression = require('compression');

// ================================
// INTELLIGENT RESPONSE OPTIMIZATION
// ================================

class APIResponseOptimizer {
  constructor() {
    this.cache = getCacheManager();
    this.compressionMiddleware = this.setupCompression();
    this.responseMetrics = new Map();
    
    // Performance thresholds
    this.thresholds = {
      responseTime: 500, // ms
      payloadSize: 1024 * 1024, // 1MB
      maxItems: 100
    };
  }

  // ================================
  // SMART PAGINATION SYSTEM
  // ================================

  createPaginationMiddleware() {
    return (req, res, next) => {
      // Extract pagination parameters
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(
        parseInt(req.query.limit) || 20,
        parseInt(process.env.MAX_PAGE_SIZE) || 100
      );
      const offset = (page - 1) * limit;

      // Add pagination to request
      req.pagination = {
        page,
        limit,
        offset,
        // Calculate optimal limit based on client type
        optimizedLimit: this.calculateOptimalLimit(req, limit)
      };

      // Add pagination helpers to response
      res.paginate = (data, totalCount, additionalMeta = {}) => {
        return this.createPaginatedResponse(req, data, totalCount, additionalMeta);
      };

      next();
    };
  }

  calculateOptimalLimit(req, requestedLimit) {
    const userAgent = req.get('User-Agent') || '';
    const isMobile = /Mobile|Android|iPhone|iPad/.test(userAgent);
    const isSlowConnection = req.get('Save-Data') === 'on';

    let optimizedLimit = requestedLimit;

    // Reduce limit for mobile devices
    if (isMobile) {
      optimizedLimit = Math.min(optimizedLimit, 15);
    }

    // Further reduce for slow connections
    if (isSlowConnection) {
      optimizedLimit = Math.min(optimizedLimit, 10);
    }

    return optimizedLimit;
  }

  createPaginatedResponse(req, data, totalCount, additionalMeta = {}) {
    const { page, limit } = req.pagination;
    const totalPages = Math.ceil(totalCount / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    // Calculate next/prev URLs
    const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}${req.path}`;
    const queryParams = { ...req.query };

    const nextUrl = hasNext ? this.buildUrl(baseUrl, { ...queryParams, page: page + 1 }) : null;
    const prevUrl = hasPrev ? this.buildUrl(baseUrl, { ...queryParams, page: page - 1 }) : null;

    return {
      success: true,
      data: data,
      pagination: {
        current_page: page,
        per_page: limit,
        total_items: totalCount,
        total_pages: totalPages,
        has_next: hasNext,
        has_previous: hasPrev,
        next_url: nextUrl,
        previous_url: prevUrl,
        ...additionalMeta
      },
      performance: {
        cached: req.fromCache || false,
        response_time: Date.now() - req.startTime,
        data_size: this.calculateResponseSize(data)
      }
    };
  }

  // ================================
  // RESPONSE COMPRESSION & OPTIMIZATION
  // ================================

  setupCompression() {
    return compression({
      // Dynamic compression based on response size
      filter: (req, res) => {
        // Don't compress responses for browsers that don't support it
        if (req.headers['x-no-compression']) {
          return false;
        }

        // Don't compress if already compressed
        const contentType = res.get('Content-Type');
        if (contentType && contentType.includes('compressed')) {
          return false;
        }

        // Compress text-based responses
        return compression.filter(req, res);
      },

      // Adaptive compression level based on content size
      level: (req, res) => {
        const contentLength = res.get('Content-Length');
        if (contentLength) {
          const size = parseInt(contentLength);
          if (size > 1024 * 1024) return 9; // Maximum compression for large responses
          if (size > 100 * 1024) return 6;  // Medium compression
          return 1; // Light compression for small responses
        }
        return 6; // Default medium compression
      },

      // Compression threshold
      threshold: 1024, // Only compress responses larger than 1KB

      // Memory level optimization
      memLevel: 8,
      
      // Window bits for deflate
      windowBits: 15,

      // Chunk size optimization
      chunkSize: 16 * 1024 // 16KB chunks
    });
  }

  // ================================
  // RESPONSE CACHING MIDDLEWARE
  // ================================

  createCachingMiddleware() {
    return async (req, res, next) => {
      const method = req.method;
      
      // Only cache GET requests
      if (method !== 'GET') {
        return next();
      }

      // Generate cache key
      const cacheKey = this.generateCacheKey(req);
      
      try {
        // Check cache
        const cachedResponse = await this.cache.get(cacheKey);
        
        if (cachedResponse) {
          // Set cache headers
          res.set({
            'X-Cache': 'HIT',
            'X-Cache-Key': cacheKey,
            'Cache-Control': 'public, max-age=300',
            'ETag': cachedResponse.etag
          });

          // Check if client has current version (304 Not Modified)
          if (req.get('If-None-Match') === cachedResponse.etag) {
            return res.status(304).end();
          }

          req.fromCache = true;
          return res.json(cachedResponse.data);
        }

        // Cache miss - continue to route handler
        res.set('X-Cache', 'MISS');
        
        // Override res.json to cache the response
        const originalJson = res.json.bind(res);
        res.json = (data) => {
          // Cache successful responses
          if (res.statusCode === 200) {
            this.cacheResponse(cacheKey, data, req);
          }
          return originalJson(data);
        };

        next();

      } catch (error) {
        logger.warn('Cache middleware error:', error);
        next();
      }
    };
  }

  async cacheResponse(cacheKey, data, req) {
    try {
      const etag = this.generateETag(data);
      const ttl = this.calculateCacheTTL(req);

      await this.cache.set(cacheKey, {
        data: data,
        etag: etag,
        cached_at: Date.now()
      }, ttl);

    } catch (error) {
      logger.warn('Response caching failed:', error);
    }
  }

  // ================================
  // RESPONSE TRANSFORMATION
  // ================================

  createResponseTransformer() {
    return (req, res, next) => {
      const originalJson = res.json.bind(res);
      
      res.json = (data) => {
        const startTime = req.startTime || Date.now();
        const responseTime = Date.now() - startTime;

        // Transform response based on client capabilities
        const transformedData = this.transformResponseForClient(req, data);
        
        // Add performance metadata
        const optimizedResponse = this.addPerformanceMetadata(
          transformedData, 
          responseTime, 
          req
        );

        // Set appropriate headers
        this.setOptimizedHeaders(res, optimizedResponse);

        // Track response metrics
        this.trackResponseMetrics(req, optimizedResponse, responseTime);

        return originalJson(optimizedResponse);
      };

      next();
    };
  }

  transformResponseForClient(req, data) {
    const userAgent = req.get('User-Agent') || '';
    const isMobile = /Mobile|Android|iPhone|iPad/.test(userAgent);
    const acceptsWebP = req.get('Accept')?.includes('image/webp');

    // Clone data to avoid mutations
    let transformedData = JSON.parse(JSON.stringify(data));

    // Optimize for mobile clients
    if (isMobile) {
      transformedData = this.optimizeForMobile(transformedData);
    }

    // Optimize images
    if (acceptsWebP) {
      transformedData = this.optimizeImageUrls(transformedData, 'webp');
    }

    // Remove null/undefined values to reduce payload size
    transformedData = this.removeEmptyValues(transformedData);

    return transformedData;
  }

  optimizeForMobile(data) {
    // Reduce image quality for mobile
    if (data.data && Array.isArray(data.data)) {
      data.data = data.data.map(item => {
        if (item.listing_images) {
          item.listing_images = item.listing_images.map(img => ({
            ...img,
            url: this.addImageOptimization(img.url, 'mobile')
          }));
        }
        return item;
      });
    }

    // Remove heavy fields for mobile
    if (data.data) {
      data.data = this.removeHeavyFields(data.data, ['detailed_description', 'metadata']);
    }

    return data;
  }

  optimizeImageUrls(data, format) {
    const traverse = (obj) => {
      if (Array.isArray(obj)) {
        return obj.map(traverse);
      } else if (obj && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          if (key.includes('url') && typeof value === 'string' && value.includes('image')) {
            result[key] = this.convertImageFormat(value, format);
          } else {
            result[key] = traverse(value);
          }
        }
        return result;
      }
      return obj;
    };

    return traverse(data);
  }

  // ================================
  // STREAMING RESPONSES
  // ================================

  createStreamingMiddleware() {
    return (req, res, next) => {
      // Add streaming helper to response
      res.streamJSON = (dataStream, options = {}) => {
        const { 
          batchSize = 50,
          delimiter = '\n',
          metadata = {}
        } = options;

        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson',
          'Transfer-Encoding': 'chunked',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-cache'
        });

        // Send metadata first
        if (Object.keys(metadata).length > 0) {
          res.write(JSON.stringify({ type: 'metadata', data: metadata }) + delimiter);
        }

        let batch = [];
        let batchCount = 0;

        const flushBatch = () => {
          if (batch.length > 0) {
            const batchData = {
              type: 'data',
              batch: batchCount++,
              items: batch,
              count: batch.length
            };
            res.write(JSON.stringify(batchData) + delimiter);
            batch = [];
          }
        };

        // Stream data
        dataStream.on('data', (item) => {
          batch.push(item);
          
          if (batch.length >= batchSize) {
            flushBatch();
          }
        });

        dataStream.on('end', () => {
          flushBatch(); // Flush remaining items
          
          // Send completion signal
          res.write(JSON.stringify({ 
            type: 'complete',
            total_batches: batchCount,
            timestamp: new Date().toISOString()
          }) + delimiter);
          
          res.end();
        });

        dataStream.on('error', (error) => {
          res.write(JSON.stringify({ 
            type: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
          }) + delimiter);
          res.end();
        });
      };

      next();
    };
  }

  // ================================
  // LAZY LOADING HELPERS
  // ================================

  createLazyLoadingHelpers() {
    return (req, res, next) => {
      // Add lazy loading helper to request
      req.lazy = {
        // Load additional data on demand
        loadField: async (entityId, fieldName) => {
          const cacheKey = `lazy:${entityId}:${fieldName}`;
          
          let data = await this.cache.get(cacheKey);
          if (!data) {
            data = await this.loadFieldData(entityId, fieldName);
            await this.cache.set(cacheKey, data, 1800); // 30 min cache
          }
          
          return data;
        },

        // Load paginated relations
        loadRelation: async (entityId, relationName, page = 1, limit = 10) => {
          const cacheKey = `lazy:${entityId}:${relationName}:${page}:${limit}`;
          
          let data = await this.cache.get(cacheKey);
          if (!data) {
            data = await this.loadRelationData(entityId, relationName, page, limit);
            await this.cache.set(cacheKey, data, 900); // 15 min cache
          }
          
          return data;
        }
      };

      next();
    };
  }

  // ================================
  // RESPONSE PRELOADING
  // ================================

  async preloadPopularResponses() {
    try {
      logger.info('🔄 Preloading popular API responses...');

      const popularEndpoints = [
        { path: '/api/v1/listings', params: { page: 1, limit: 20 } },
        { path: '/api/v1/listings', params: { page: 1, limit: 20, featured: true } },
        { path: '/api/v1/categories', params: {} },
        { path: '/api/v1/search', params: { q: 'electronics', page: 1 } }
      ];

      for (const endpoint of popularEndpoints) {
        const cacheKey = this.generateCacheKeyFromEndpoint(endpoint);
        
        // Check if already cached
        const cached = await this.cache.get(cacheKey);
        if (!cached) {
          // Simulate request and cache response
          await this.simulateAndCacheRequest(endpoint);
        }
      }

      logger.info('✅ Popular responses preloaded');

    } catch (error) {
      logger.error('Preloading failed:', error);
    }
  }

  // ================================
  // PERFORMANCE MONITORING
  // ================================

  trackResponseMetrics(req, response, responseTime) {
    const endpoint = `${req.method} ${req.route?.path || req.path}`;
    
    if (!this.responseMetrics.has(endpoint)) {
      this.responseMetrics.set(endpoint, {
        count: 0,
        totalTime: 0,
        avgTime: 0,
        maxTime: 0,
        minTime: Infinity,
        totalSize: 0,
        avgSize: 0
      });
    }

    const metrics = this.responseMetrics.get(endpoint);
    const responseSize = this.calculateResponseSize(response);

    metrics.count++;
    metrics.totalTime += responseTime;
    metrics.avgTime = metrics.totalTime / metrics.count;
    metrics.maxTime = Math.max(metrics.maxTime, responseTime);
    metrics.minTime = Math.min(metrics.minTime, responseTime);
    metrics.totalSize += responseSize;
    metrics.avgSize = metrics.totalSize / metrics.count;

    // Alert on performance issues
    if (responseTime > this.thresholds.responseTime) {
      logger.warn('⚠️  Slow API response', {
        endpoint,
        responseTime: `${responseTime}ms`,
        threshold: `${this.thresholds.responseTime}ms`
      });
    }

    if (responseSize > this.thresholds.payloadSize) {
      logger.warn('⚠️  Large API response', {
        endpoint,
        responseSize: `${Math.round(responseSize / 1024)}KB`,
        threshold: `${Math.round(this.thresholds.payloadSize / 1024)}KB`
      });
    }
  }

  // ================================
  // UTILITY METHODS
  // ================================

  generateCacheKey(req) {
    const baseKey = `api:${req.method}:${req.path}`;
    const queryString = Object.keys(req.query)
      .sort()
      .map(key => `${key}=${req.query[key]}`)
      .join('&');
    
    const userHash = req.user ? 
      require('crypto').createHash('md5').update(req.user.id).digest('hex').substr(0, 8) : 
      'anon';

    return `${baseKey}:${queryString}:${userHash}`;
  }

  generateETag(data) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
  }

  calculateCacheTTL(req) {
    // Dynamic TTL based on endpoint
    if (req.path.includes('/listings')) return 1800; // 30 minutes
    if (req.path.includes('/search')) return 900;    // 15 minutes
    if (req.path.includes('/categories')) return 86400; // 24 hours
    if (req.path.includes('/user')) return 3600;    // 1 hour
    
    return 600; // Default 10 minutes
  }

  calculateResponseSize(data) {
    return Buffer.byteLength(JSON.stringify(data), 'utf8');
  }

  buildUrl(baseUrl, params) {
    const url = new URL(baseUrl);
    Object.keys(params).forEach(key => {
      url.searchParams.set(key, params[key]);
    });
    return url.toString();
  }

  addImageOptimization(url, optimization) {
    if (!url || !url.includes('http')) return url;
    
    const params = optimization === 'mobile' ? 'w=400&h=300&q=70' : 'w=800&h=600&q=85';
    const separator = url.includes('?') ? '&' : '?';
    
    return `${url}${separator}${params}`;
  }

  convertImageFormat(url, format) {
    if (!url || !url.includes('http')) return url;
    
    // Simple format conversion (replace with actual CDN logic)
    return url.replace(/\.(jpg|jpeg|png)$/i, `.${format}`);
  }

  removeEmptyValues(obj) {
    if (Array.isArray(obj)) {
      return obj.map(this.removeEmptyValues.bind(this)).filter(item => item !== null);
    } else if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== null && value !== undefined && value !== '') {
          result[key] = this.removeEmptyValues(value);
        }
      }
      return result;
    }
    return obj;
  }

  removeHeavyFields(data, fieldsToRemove) {
    if (Array.isArray(data)) {
      return data.map(item => this.removeHeavyFields(item, fieldsToRemove));
    } else if (data && typeof data === 'object') {
      const result = { ...data };
      fieldsToRemove.forEach(field => {
        delete result[field];
      });
      return result;
    }
    return data;
  }

  addPerformanceMetadata(data, responseTime, req) {
    return {
      ...data,
      _meta: {
        response_time: responseTime,
        cached: req.fromCache || false,
        timestamp: new Date().toISOString(),
        api_version: '1.0',
        ...(data._meta || {})
      }
    };
  }

  setOptimizedHeaders(res, data) {
    const size = this.calculateResponseSize(data);
    
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'X-Response-Size': size.toString(),
      'X-API-Version': '1.0',
      'Vary': 'Accept-Encoding, User-Agent'
    });

    // Set cache headers based on content type
    if (res.get('X-Cache') === 'HIT') {
      res.set('Cache-Control', 'public, max-age=300');
    } else {
      res.set('Cache-Control', 'public, max-age=60');
    }
  }

  getPerformanceMetrics() {
    return Object.fromEntries(this.responseMetrics);
  }
}

// ================================
// MIDDLEWARE FACTORY
// ================================

let optimizerInstance = null;

const getResponseOptimizer = () => {
  if (!optimizerInstance) {
    optimizerInstance = new APIResponseOptimizer();
  }
  return optimizerInstance;
};

const createOptimizedMiddleware = () => {
  const optimizer = getResponseOptimizer();
  
  return {
    pagination: optimizer.createPaginationMiddleware(),
    caching: optimizer.createCachingMiddleware(),
    compression: optimizer.compressionMiddleware,
    transformation: optimizer.createResponseTransformer(),
    streaming: optimizer.createStreamingMiddleware(),
    lazyLoading: optimizer.createLazyLoadingHelpers()
  };
};

module.exports = {
  APIResponseOptimizer,
  getResponseOptimizer,
  createOptimizedMiddleware
};