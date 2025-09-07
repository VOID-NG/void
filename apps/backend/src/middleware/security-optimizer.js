// apps/backend/src/middleware/security-optimizer.js
// High-performance security optimization without compromising protection

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { getCacheManager } = require('../services/cache-manager');

// ================================
// HIGH-PERFORMANCE SECURITY MANAGER
// ================================

class SecurityOptimizer {
  constructor() {
    this.cache = getCacheManager();
    this.ipBlacklist = new Set();
    this.suspiciousIPs = new Map();
    this.tokenBlacklist = new Set();
    this.rateLimitStore = new Map();
    
    // Security metrics
    this.metrics = {
      blockedRequests: 0,
      suspiciousActivity: 0,
      rateLimitViolations: 0,
      tokenValidations: 0,
      avgSecurityCheckTime: 0
    };

    // Performance thresholds
    this.thresholds = {
      maxSecurityCheckTime: 5, // ms
      rateLimitWindow: 15 * 60 * 1000, // 15 minutes
      maxRequestsPerWindow: 1000,
      suspiciousActivityThreshold: 10
    };

    this.setupSecurityMonitoring();
  }

  // ================================
  // OPTIMIZED RATE LIMITING
  // ================================

  createIntelligentRateLimit() {
    // Custom rate limiter with performance optimization
    return (req, res, next) => {
      const startTime = Date.now();
      
      try {
        const clientId = this.getClientIdentifier(req);
        const endpoint = this.getEndpointCategory(req);
        
        // Get rate limit configuration for endpoint
        const limitConfig = this.getRateLimitConfig(endpoint, req);
        
        // Check if client is already blocked
        if (this.isClientBlocked(clientId)) {
          this.metrics.blockedRequests++;
          return res.status(429).json({
            error: 'IP temporarily blocked due to suspicious activity',
            code: 'IP_BLOCKED',
            retryAfter: this.getBlockExpiryTime(clientId)
          });
        }

        // Fast rate limit check using in-memory store
        const allowed = this.checkRateLimit(clientId, limitConfig);
        
        if (!allowed) {
          this.metrics.rateLimitViolations++;
          this.recordSuspiciousActivity(clientId, 'rate_limit_exceeded');
          
          return res.status(429).json({
            error: 'Rate limit exceeded',
            code: 'RATE_LIMITED',
            limit: limitConfig.max,
            window: limitConfig.windowMs,
            retryAfter: Math.ceil(limitConfig.windowMs / 1000)
          });
        }

        // Track security check performance
        const checkTime = Date.now() - startTime;
        this.updateSecurityMetrics(checkTime);

        next();

      } catch (error) {
        logger.error('Rate limiting error:', error);
        next(); // Fail open for availability
      }
    };
  }

  getClientIdentifier(req) {
    // Multi-factor client identification for better accuracy
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent') || '';
    const forwarded = req.get('X-Forwarded-For') || '';
    
    // Create a composite identifier
    const composite = `${ip}:${crypto.createHash('md5').update(userAgent).digest('hex').substr(0, 8)}`;
    
    // Use user ID if authenticated for more granular control
    if (req.user?.id) {
      return `user:${req.user.id}:${ip}`;
    }
    
    return composite;
  }

  getEndpointCategory(req) {
    const path = req.path;
    const method = req.method;
    
    // Categorize endpoints for different rate limits
    if (path.includes('/auth/login')) return 'auth_login';
    if (path.includes('/auth/register')) return 'auth_register';
    if (path.includes('/auth/reset')) return 'auth_reset';
    if (path.includes('/upload')) return 'file_upload';
    if (path.includes('/search')) return 'search';
    if (method === 'POST' && path.includes('/listings')) return 'create_listing';
    if (method === 'POST' && path.includes('/messages')) return 'send_message';
    if (method === 'GET') return 'read_api';
    
    return 'general_api';
  }

  getRateLimitConfig(category, req) {
    const configs = {
      auth_login: { max: 5, windowMs: 15 * 60 * 1000 }, // 5 per 15 min
      auth_register: { max: 3, windowMs: 60 * 60 * 1000 }, // 3 per hour
      auth_reset: { max: 3, windowMs: 60 * 60 * 1000 }, // 3 per hour
      file_upload: { max: 20, windowMs: 60 * 60 * 1000 }, // 20 per hour
      search: { max: 100, windowMs: 60 * 1000 }, // 100 per minute
      create_listing: { max: 10, windowMs: 60 * 60 * 1000 }, // 10 per hour
      send_message: { max: 60, windowMs: 60 * 1000 }, // 60 per minute
      read_api: { max: 1000, windowMs: 15 * 60 * 1000 }, // 1000 per 15 min
      general_api: { max: 500, windowMs: 15 * 60 * 1000 } // 500 per 15 min
    };

    let config = configs[category] || configs.general_api;

    // Adjust limits for authenticated users (higher limits)
    if (req.user?.id) {
      config = {
        max: Math.floor(config.max * 2),
        windowMs: config.windowMs
      };
    }

    // Adjust for premium users
    if (req.user?.subscription?.plan === 'PREMIUM') {
      config = {
        max: Math.floor(config.max * 1.5),
        windowMs: config.windowMs
      };
    }

    return config;
  }

  checkRateLimit(clientId, config) {
    const now = Date.now();
    const windowStart = now - config.windowMs;
    
    if (!this.rateLimitStore.has(clientId)) {
      this.rateLimitStore.set(clientId, []);
    }

    const requests = this.rateLimitStore.get(clientId);
    
    // Remove expired entries (sliding window)
    const validRequests = requests.filter(timestamp => timestamp > windowStart);
    
    // Check if under limit
    if (validRequests.length >= config.max) {
      return false;
    }

    // Add current request
    validRequests.push(now);
    this.rateLimitStore.set(clientId, validRequests);

    // Cleanup old entries periodically
    if (Math.random() < 0.01) { // 1% chance
      this.cleanupRateLimitStore();
    }

    return true;
  }

  cleanupRateLimitStore() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [clientId, requests] of this.rateLimitStore.entries()) {
      const validRequests = requests.filter(timestamp => (now - timestamp) < maxAge);
      
      if (validRequests.length === 0) {
        this.rateLimitStore.delete(clientId);
      } else {
        this.rateLimitStore.set(clientId, validRequests);
      }
    }
  }

  // ================================
  // OPTIMIZED HELMET CONFIGURATION
  // ================================

  createOptimizedHelmet() {
    return helmet({
      // DNS prefetch control
      dnsPrefetchControl: { allow: false },
      
      // Frame guard
      frameguard: { action: 'deny' },
      
      // Hide powered by
      hidePoweredBy: true,
      
      // HSTS
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
      },
      
      // IE no open
      ieNoOpen: true,
      
      // No sniff
      noSniff: true,
      
      // Referrer policy
      referrerPolicy: { policy: 'same-origin' },
      
      // XSS filter
      xssFilter: true,
      
      // Content Security Policy (optimized for performance)
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:", "blob:"],
          connectSrc: ["'self'", "wss:", "ws:"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'", "blob:"],
          frameSrc: ["'none'"],
          workerSrc: ["'self'", "blob:"],
          manifestSrc: ["'self'"]
        },
        // Performance optimization
        reportOnly: false,
        // Don't block inline styles in development
        directives: process.env.NODE_ENV === 'development' ? {
          ...this.directives,
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]
        } : undefined
      }
    });
  }

  // ================================
  // FAST JWT VALIDATION
  // ================================

  createOptimizedJWTValidator() {
    return async (req, res, next) => {
      const startTime = Date.now();
      
      try {
        const token = this.extractToken(req);
        
        if (!token) {
          return res.status(401).json({
            error: 'Authentication required',
            code: 'NO_TOKEN'
          });
        }

        // Check token blacklist (fast in-memory check)
        if (this.isTokenBlacklisted(token)) {
          return res.status(401).json({
            error: 'Token has been revoked',
            code: 'TOKEN_REVOKED'
          });
        }

        // Fast cache check for validated tokens
        const cacheKey = `jwt:${crypto.createHash('md5').update(token).digest('hex')}`;
        let userData = await this.cache.get(cacheKey);

        if (!userData) {
          // Verify token (expensive operation)
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // Get user data (with caching)
            userData = await this.getUserData(decoded.userId);
            
            if (!userData) {
              return res.status(401).json({
                error: 'User not found',
                code: 'USER_NOT_FOUND'
              });
            }

            // Cache the validated token for fast future lookups
            await this.cache.set(cacheKey, userData, 300); // 5 min cache
            
          } catch (jwtError) {
            return res.status(401).json({
              error: 'Invalid token',
              code: 'INVALID_TOKEN',
              details: jwtError.name
            });
          }
        }

        // Attach user to request
        req.user = userData;
        req.userId = userData.id;
        
        // Track performance
        const validationTime = Date.now() - startTime;
        this.metrics.tokenValidations++;
        
        if (validationTime > 10) {
          logger.warn('Slow JWT validation', { 
            time: validationTime, 
            cached: !!userData 
          });
        }

        next();

      } catch (error) {
        logger.error('JWT validation error:', error);
        res.status(500).json({
          error: 'Authentication service error',
          code: 'AUTH_ERROR'
        });
      }
    };
  }

  extractToken(req) {
    // Extract from Authorization header
    const authHeader = req.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Extract from cookie (if configured)
    if (req.cookies && req.cookies.access_token) {
      return req.cookies.access_token;
    }

    // Extract from query parameter (for WebSocket upgrades)
    if (req.query && req.query.token) {
      return req.query.token;
    }

    return null;
  }

  async getUserData(userId) {
    try {
      // Check cache first
      const cacheKey = `user:auth:${userId}`;
      let userData = await this.cache.get(cacheKey);

      if (!userData) {
        // Fetch from database
        const { dbRouter } = require('../config/db');
        const client = dbRouter.getReadClient();

        const user = await client.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            username: true,
            first_name: true,
            last_name: true,
            role: true,
            status: true,
            vendor_verified: true,
            last_login: true
          }
        });

        if (user && user.status === 'ACTIVE') {
          userData = user;
          // Cache for 10 minutes
          await this.cache.set(cacheKey, userData, 600);
        }
      }

      return userData;

    } catch (error) {
      logger.error('User data fetch error:', error);
      return null;
    }
  }

  // ================================
  // INTELLIGENT THREAT DETECTION
  // ================================

  createThreatDetectionMiddleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      
      try {
        const clientId = this.getClientIdentifier(req);
        const threat = this.analyzeThreatLevel(req, clientId);

        if (threat.level === 'HIGH') {
          this.blockClient(clientId, threat.reason, threat.duration);
          
          return res.status(403).json({
            error: 'Request blocked due to security policy',
            code: 'SECURITY_BLOCKED'
          });
        }

        if (threat.level === 'MEDIUM') {
          this.recordSuspiciousActivity(clientId, threat.reason);
          
          // Add security headers but allow request
          res.set({
            'X-Security-Level': 'MEDIUM',
            'X-Rate-Limit-Strict': 'true'
          });
        }

        // Track performance
        const detectionTime = Date.now() - startTime;
        if (detectionTime > 5) {
          logger.warn('Slow threat detection', { time: detectionTime });
        }

        next();

      } catch (error) {
        logger.error('Threat detection error:', error);
        next(); // Fail open
      }
    };
  }

  analyzeThreatLevel(req, clientId) {
    const indicators = [];
    let score = 0;

    // Check for suspicious patterns
    const userAgent = req.get('User-Agent') || '';
    const path = req.path;
    const method = req.method;
    
    // Bot detection
    if (this.isSuspiciousBot(userAgent)) {
      indicators.push('suspicious_bot');
      score += 30;
    }

    // SQL injection patterns
    if (this.hasSQLInjectionPatterns(req)) {
      indicators.push('sql_injection_attempt');
      score += 50;
    }

    // XSS patterns
    if (this.hasXSSPatterns(req)) {
      indicators.push('xss_attempt');
      score += 40;
    }

    // Path traversal
    if (this.hasPathTraversalPatterns(path)) {
      indicators.push('path_traversal');
      score += 35;
    }

    // Suspicious request frequency
    if (this.hasSuspiciousFrequency(clientId)) {
      indicators.push('suspicious_frequency');
      score += 25;
    }

    // Large payload attacks
    if (this.hasLargePayload(req)) {
      indicators.push('large_payload');
      score += 20;
    }

    // Determine threat level
    let level = 'LOW';
    let duration = 0;

    if (score >= 70) {
      level = 'HIGH';
      duration = 3600000; // 1 hour block
    } else if (score >= 40) {
      level = 'MEDIUM';
      duration = 900000; // 15 minute monitoring
    }

    return {
      level,
      score,
      indicators,
      reason: indicators.join(', '),
      duration
    };
  }

  // ================================
  // SECURITY PATTERN DETECTION
  // ================================

  isSuspiciousBot(userAgent) {
    const suspiciousPatterns = [
      /sqlmap/i,
      /nikto/i,
      /nessus/i,
      /nmap/i,
      /masscan/i,
      /python-requests/i,
      /curl\/[\d\.]+$/i,
      /wget/i,
      /^$/
    ];

    return suspiciousPatterns.some(pattern => pattern.test(userAgent));
  }

  hasSQLInjectionPatterns(req) {
    const patterns = [
      /(\bUNION\b.*\bSELECT\b)/i,
      /(\bSELECT\b.*\bFROM\b)/i,
      /(DROP|DELETE|INSERT|UPDATE).*\b(TABLE|DATABASE)\b/i,
      /1=1|1=2|'='|"="|OR\s+1=1/i,
      /CONCAT\s*\(/i,
      /CHAR\s*\(/i,
      /0x[0-9a-f]+/i
    ];

    const testString = JSON.stringify({
      ...req.query,
      ...req.body,
      ...req.params
    });

    return patterns.some(pattern => pattern.test(testString));
  }

  hasXSSPatterns(req) {
    const patterns = [
      /<script[^>]*>.*?<\/script>/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /<iframe[^>]*>/i,
      /<object[^>]*>/i,
      /<embed[^>]*>/i,
      /eval\s*\(/i,
      /expression\s*\(/i
    ];

    const testString = JSON.stringify({
      ...req.query,
      ...req.body,
      ...req.params
    });

    return patterns.some(pattern => pattern.test(testString));
  }

  hasPathTraversalPatterns(path) {
    const patterns = [
      /\.\./,
      /%2e%2e/i,
      /%252e%252e/i,
      /\0/,
      /%00/i
    ];

    return patterns.some(pattern => pattern.test(path));
  }

  // ================================
  // CLIENT BLOCKING & MONITORING
  // ================================

  isClientBlocked(clientId) {
    return this.ipBlacklist.has(clientId);
  }

  blockClient(clientId, reason, duration = 3600000) {
    this.ipBlacklist.add(clientId);
    
    // Auto-unblock after duration
    setTimeout(() => {
      this.ipBlacklist.delete(clientId);
      logger.info('Client unblocked', { clientId, reason });
    }, duration);

    logger.warn('Client blocked', { clientId, reason, duration });
  }

  recordSuspiciousActivity(clientId, activity) {
    if (!this.suspiciousIPs.has(clientId)) {
      this.suspiciousIPs.set(clientId, []);
    }

    const activities = this.suspiciousIPs.get(clientId);
    activities.push({
      activity,
      timestamp: Date.now()
    });

    // Keep only recent activities (last hour)
    const hourAgo = Date.now() - 3600000;
    const recentActivities = activities.filter(a => a.timestamp > hourAgo);
    this.suspiciousIPs.set(clientId, recentActivities);

    // Auto-block if too many suspicious activities
    if (recentActivities.length >= this.thresholds.suspiciousActivityThreshold) {
      this.blockClient(clientId, 'excessive_suspicious_activity', 3600000);
    }

    this.metrics.suspiciousActivity++;
  }

  // ================================
  // SECURITY MONITORING
  // ================================

  setupSecurityMonitoring() {
    // Regular cleanup of expired entries
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, 300000); // Every 5 minutes

    // Security metrics reporting
    setInterval(() => {
      this.reportSecurityMetrics();
    }, 60000); // Every minute
  }

  cleanupExpiredEntries() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Cleanup suspicious IPs
    for (const [clientId, activities] of this.suspiciousIPs.entries()) {
      const recentActivities = activities.filter(a => (now - a.timestamp) < maxAge);
      
      if (recentActivities.length === 0) {
        this.suspiciousIPs.delete(clientId);
      } else {
        this.suspiciousIPs.set(clientId, recentActivities);
      }
    }

    // Cleanup rate limit store (already handled in cleanupRateLimitStore)
  }

  reportSecurityMetrics() {
    const metrics = {
      ...this.metrics,
      activeBlocks: this.ipBlacklist.size,
      suspiciousIPs: this.suspiciousIPs.size,
      rateLimitEntries: this.rateLimitStore.size
    };

    logger.info('📊 Security Metrics', metrics);

    // Alert on high suspicious activity
    if (metrics.suspiciousActivity > 100) {
      logger.warn('⚠️  High suspicious activity detected', {
        count: metrics.suspiciousActivity
      });
    }
  }

  updateSecurityMetrics(checkTime) {
    this.metrics.avgSecurityCheckTime = (
      (this.metrics.avgSecurityCheckTime * 0.9) + (checkTime * 0.1)
    );

    if (checkTime > this.thresholds.maxSecurityCheckTime) {
      logger.warn('Slow security check', { time: checkTime });
    }
  }

  // ================================
  // TOKEN MANAGEMENT
  // ================================

  isTokenBlacklisted(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    return this.tokenBlacklist.has(tokenHash);
  }

  blacklistToken(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    this.tokenBlacklist.add(tokenHash);
    
    // Auto-remove after JWT expiry (assume 24 hours max)
    setTimeout(() => {
      this.tokenBlacklist.delete(tokenHash);
    }, 24 * 60 * 60 * 1000);
  }

  getSecurityMetrics() {
    return {
      ...this.metrics,
      activeBlocks: this.ipBlacklist.size,
      suspiciousIPs: this.suspiciousIPs.size,
      rateLimitEntries: this.rateLimitStore.size,
      blacklistedTokens: this.tokenBlacklist.size
    };
  }
}

// ================================
// MIDDLEWARE FACTORY
// ================================

let securityOptimizer = null;

const getSecurityOptimizer = () => {
  if (!securityOptimizer) {
    securityOptimizer = new SecurityOptimizer();
  }
  return securityOptimizer;
};

const createSecurityMiddleware = () => {
  const optimizer = getSecurityOptimizer();
  
  return {
    helmet: optimizer.createOptimizedHelmet(),
    rateLimit: optimizer.createIntelligentRateLimit(),
    jwtValidator: optimizer.createOptimizedJWTValidator(),
    threatDetection: optimizer.createThreatDetectionMiddleware()
  };
};

module.exports = {
  SecurityOptimizer,
  getSecurityOptimizer,
  createSecurityMiddleware
};