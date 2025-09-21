// apps/backend/src/utils/rateLimiter.js
// Advanced Rate Limiter for Search Cost Control and API Protection

const logger = require('./logger');

// ================================
// IN-MEMORY RATE LIMITER
// ================================

class InMemoryRateLimiter {
  constructor() {
    this.requests = new Map(); // key -> { count, resetTime, timestamps }
    this.cleanupInterval = null;
    this.startCleanup();
  }

  /**
   * Try to consume a request from the rate limit bucket
   * @param {string} key - Rate limit key (user ID, IP, etc.)
   * @param {number} limit - Requests per minute limit
   * @param {boolean} consume - Whether to actually consume the request
   * @returns {Object} Rate limit result
   */
  tryConsume(key, limit, consume = true) {
    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    const resetTime = Math.ceil(now / windowMs) * windowMs;

    // Get or create request data for this key
    let requestData = this.requests.get(key);
    
    if (!requestData || requestData.resetTime <= now) {
      // Reset window
      requestData = {
        count: 0,
        resetTime,
        timestamps: [],
        firstRequest: now
      };
    }

    // Clean old timestamps (sliding window)
    requestData.timestamps = requestData.timestamps.filter(
      timestamp => timestamp > now - windowMs
    );

    // Check if limit would be exceeded
    const currentCount = requestData.timestamps.length;
    const wouldExceed = currentCount >= limit;

    if (wouldExceed) {
      // Calculate wait time until next slot is available
      const oldestTimestamp = requestData.timestamps[0];
      const waitMs = oldestTimestamp ? (oldestTimestamp + windowMs) - now : 0;

      return {
        allowed: false,
        limit,
        requestCount: currentCount,
        resetTime,
        waitMs: Math.max(0, waitMs)
      };
    }

    // Consume the request if requested
    if (consume) {
      requestData.timestamps.push(now);
      requestData.count++;
      this.requests.set(key, requestData);
    }

    return {
      allowed: true,
      limit,
      requestCount: requestData.timestamps.length,
      resetTime,
      waitMs: 0
    };
  }

  /**
   * Get current rate limit status without consuming
   * @param {string} key - Rate limit key
   * @param {number} limit - Requests per minute limit
   * @returns {Object} Current status
   */
  getStatus(key, limit) {
    return this.tryConsume(key, limit, false);
  }

  /**
   * Reset rate limit for a specific key
   * @param {string} key - Rate limit key to reset
   */
  reset(key) {
    this.requests.delete(key);
    logger.debug('Rate limit reset for key:', key);
  }

  /**
   * Start periodic cleanup of expired entries
   */
  startCleanup() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const expiredKeys = [];

      for (const [key, data] of this.requests.entries()) {
        // Remove entries older than 5 minutes
        if (data.resetTime < now - 300000) {
          expiredKeys.push(key);
        }
      }

      expiredKeys.forEach(key => this.requests.delete(key));
      
      if (expiredKeys.length > 0) {
        logger.debug(`Cleaned up ${expiredKeys.length} expired rate limit entries`);
      }
    }, 60000); // Clean every minute
  }

  /**
   * Stop cleanup interval
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get statistics about current rate limiting
   * @returns {Object} Statistics
   */
  getStats() {
    const totalKeys = this.requests.size;
    let totalRequests = 0;
    let activeKeys = 0;
    const now = Date.now();

    for (const [key, data] of this.requests.entries()) {
      totalRequests += data.count;
      if (data.resetTime > now) {
        activeKeys++;
      }
    }

    return {
      totalKeys,
      activeKeys,
      totalRequests,
      memoryUsage: this.requests.size * 100 // Rough estimate
    };
  }
}

// ================================
// REDIS RATE LIMITER (for production)
// ================================

class RedisRateLimiter {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async tryConsume(key, limit, consume = true) {
    const now = Date.now();
    const window = 60000; // 1 minute
    const windowKey = `ratelimit:${key}:${Math.floor(now / window)}`;

    try {
      // Use Redis pipeline for atomic operations
      const pipeline = this.redis.pipeline();
      pipeline.incr(windowKey);
      pipeline.expire(windowKey, 60); // Expire after 1 minute
      
      const results = await pipeline.exec();
      const currentCount = results[0][1];

      if (currentCount > limit) {
        const ttl = await this.redis.ttl(windowKey);
        const waitMs = ttl > 0 ? ttl * 1000 : 0;

        return {
          allowed: false,
          limit,
          requestCount: currentCount,
          resetTime: now + waitMs,
          waitMs
        };
      }

      if (!consume && currentCount > 1) {
        // If we're just checking, decrement the count
        await this.redis.decr(windowKey);
      }

      return {
        allowed: true,
        limit,
        requestCount: currentCount,
        resetTime: now + (60 - (now % 60)) * 1000,
        waitMs: 0
      };

    } catch (error) {
      logger.error('Redis rate limiter error:', error);
      // Fallback to allowing request if Redis is unavailable
      return {
        allowed: true,
        limit,
        requestCount: 0,
        resetTime: now + 60000,
        waitMs: 0,
        error: error.message
      };
    }
  }

  async getStatus(key, limit) {
    return this.tryConsume(key, limit, false);
  }

  async reset(key) {
    const pattern = `ratelimit:${key}:*`;
    const keys = await this.redis.keys(pattern);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}

// ================================
// RATE LIMIT CONFIGURATIONS
// ================================

const RATE_LIMIT_CONFIGS = {
  // Search-specific rate limits
  search: {
    text: { rpm: 120, burst: 20 }, // Text search
    image: { rpm: 30, burst: 5 },  // Image search (more expensive)
    ai: { rpm: 20, burst: 3 },     // AI-enhanced search
    autocomplete: { rpm: 300, burst: 50 } // Autocomplete (frequent)
  },
  
  // API rate limits by user type
  user: {
    anonymous: { rpm: 60, burst: 10 },
    authenticated: { rpm: 180, burst: 30 },
    premium: { rpm: 500, burst: 100 },
    admin: { rpm: 1000, burst: 200 }
  },
  
  // AI service rate limits (cost control)
  ai_services: {
    gemini: { rpm: 15, burst: 3 },
    openai: { rpm: 10, burst: 2 },
    huggingface: { rpm: 60, burst: 10 }
  },
  
  // Global system limits
  global: {
    api: { rpm: 10000, burst: 1000 },
    search: { rpm: 5000, burst: 500 },
    uploads: { rpm: 100, burst: 20 }
  }
};

// ================================
// SMART RATE LIMITER
// ================================

class SmartRateLimiter {
  constructor(options = {}) {
    this.redisClient = options.redisClient;
    this.limiter = this.redisClient 
      ? new RedisRateLimiter(this.redisClient)
      : new InMemoryRateLimiter();
    
    this.configs = { ...RATE_LIMIT_CONFIGS, ...options.configs };
    this.costTracking = new Map(); // Track AI costs
  }

  /**
   * Get rate limit for a specific context
   * @param {string} type - Rate limit type (search, user, ai_services, etc.)
   * @param {string} subtype - Subtype (text, image, ai, etc.)
   * @param {Object} context - Additional context (user role, etc.)
   * @returns {Object} Rate limit configuration
   */
  getRateLimit(type, subtype, context = {}) {
    const config = this.configs[type]?.[subtype];
    
    if (!config) {
      logger.warn(`Rate limit config not found for ${type}.${subtype}`);
      return { rpm: 60, burst: 10 }; // Default fallback
    }

    // Adjust limits based on context
    if (context.userRole) {
      const userLimits = this.configs.user[context.userRole];
      if (userLimits) {
        return {
          rpm: Math.min(config.rpm, userLimits.rpm),
          burst: Math.min(config.burst, userLimits.burst)
        };
      }
    }

    return config;
  }

  /**
   * Try to consume from multiple rate limits
   * @param {Array} limitChecks - Array of {key, type, subtype, context}
   * @returns {Object} Combined result
   */
  async tryConsumeMultiple(limitChecks) {
    const results = await Promise.all(
      limitChecks.map(async ({ key, type, subtype, context }) => {
        const limits = this.getRateLimit(type, subtype, context);
        return {
          ...await this.limiter.tryConsume(key, limits.rpm),
          type,
          subtype,
          key
        };
      })
    );

    // If any rate limit is exceeded, deny the request
    const deniedResult = results.find(r => !r.allowed);
    if (deniedResult) {
      return {
        allowed: false,
        limitType: `${deniedResult.type}.${deniedResult.subtype}`,
        waitMs: deniedResult.waitMs,
        message: `Rate limit exceeded for ${deniedResult.type}.${deniedResult.subtype}`
      };
    }

    return {
      allowed: true,
      results
    };
  }

  /**
   * Track AI service costs
   * @param {string} service - AI service name
   * @param {number} cost - Cost in USD
   * @param {string} userId - User ID (optional)
   */
  trackAICost(service, cost, userId = null) {
    const today = new Date().toISOString().split('T')[0];
    const costKey = `ai_cost:${service}:${today}`;
    
    if (!this.costTracking.has(costKey)) {
      this.costTracking.set(costKey, { total: 0, requests: 0, users: new Set() });
    }

    const tracking = this.costTracking.get(costKey);
    tracking.total += cost;
    tracking.requests++;
    
    if (userId) {
      tracking.users.add(userId);
    }

    // Log warning if daily costs are high
    if (tracking.total > 50) { // $50 daily threshold
      logger.warn(`High AI costs for ${service}: $${tracking.total.toFixed(2)} today`);
    }
  }

  /**
   * Get AI cost statistics
   * @param {string} service - AI service name (optional)
   * @returns {Object} Cost statistics
   */
  getAICostStats(service = null) {
    const today = new Date().toISOString().split('T')[0];
    const stats = {};

    for (const [key, data] of this.costTracking.entries()) {
      if (key.includes(today)) {
        const [, serviceName] = key.split(':');
        
        if (!service || serviceName === service) {
          stats[serviceName] = {
            dailyCost: data.total,
            requests: data.requests,
            uniqueUsers: data.users.size,
            avgCostPerRequest: data.requests > 0 ? data.total / data.requests : 0
          };
        }
      }
    }

    return stats;
  }

  /**
   * Create rate limit middleware for Express
   * @param {Object} options - Middleware options
   * @returns {Function} Express middleware
   */
  createMiddleware(options = {}) {
    const {
      type = 'api',
      subtype = 'general',
      keyGenerator = (req) => req.ip,
      skipSuccessfulRequests = false,
      skipFailedRequests = false
    } = options;

    return async (req, res, next) => {
      try {
        const key = keyGenerator(req);
        const context = {
          userRole: req.user?.role || 'anonymous',
          endpoint: req.route?.path
        };

        const limits = this.getRateLimit(type, subtype, context);
        const result = await this.limiter.tryConsume(key, limits.rpm);

        // Set rate limit headers
        res.set({
          'X-RateLimit-Limit': limits.rpm,
          'X-RateLimit-Remaining': Math.max(0, limits.rpm - result.requestCount),
          'X-RateLimit-Reset': new Date(result.resetTime).toISOString()
        });

        if (!result.allowed) {
          return res.status(429).json({
            success: false,
            error: 'Too Many Requests',
            error_code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: Math.ceil(result.waitMs / 1000),
            limit: limits.rpm,
            remaining: 0
          });
        }

        next();
      } catch (error) {
        logger.error('Rate limit middleware error:', error);
        next(); // Allow request on rate limiter error
      }
    };
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.limiter instanceof InMemoryRateLimiter) {
      this.limiter.stopCleanup();
    }
  }
}

// ================================
// GLOBAL INSTANCE AND EXPORTS
// ================================

let globalRateLimiter = null;

/**
 * Initialize global rate limiter
 * @param {Object} options - Configuration options
 */
const initializeRateLimiter = (options = {}) => {
  globalRateLimiter = new SmartRateLimiter(options);
  return globalRateLimiter;
};

/**
 * Get global rate limiter instance
 * @returns {SmartRateLimiter} Global rate limiter
 */
const getRateLimiter = () => {
  if (!globalRateLimiter) {
    globalRateLimiter = new SmartRateLimiter();
  }
  return globalRateLimiter;
};

/**
 * Convenient function to try consuming from rate limit
 * @param {string} key - Rate limit key
 * @param {number} limit - Requests per minute limit
 * @param {boolean} consume - Whether to consume the request
 * @returns {Object} Rate limit result
 */
const tryConsume = (key, limit, consume = true) => {
  const limiter = getRateLimiter();
  return limiter.limiter.tryConsume(key, limit, consume);
};

/**
 * Create search-specific rate limiter middleware
 * @param {string} searchType - Type of search (text, image, ai, autocomplete)
 * @returns {Function} Express middleware
 */
const createSearchRateLimit = (searchType) => {
  return getRateLimiter().createMiddleware({
    type: 'search',
    subtype: searchType,
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise IP
      return req.user?.id || `ip:${req.ip}`;
    }
  });
};

module.exports = {
  // Classes
  InMemoryRateLimiter,
  RedisRateLimiter,
  SmartRateLimiter,
  
  // Configuration
  RATE_LIMIT_CONFIGS,
  
  // Global functions
  initializeRateLimiter,
  getRateLimiter,
  tryConsume,
  createSearchRateLimit,
  
  // Utilities
  createMiddleware: (options) => getRateLimiter().createMiddleware(options),
  trackAICost: (service, cost, userId) => getRateLimiter().trackAICost(service, cost, userId),
  getAICostStats: (service) => getRateLimiter().getAICostStats(service)
};