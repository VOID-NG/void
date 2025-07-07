// apps/backend/src/routes/index.js
// Central API router for VOID Marketplace

const express = require('express');
const { API_CONFIG } = require('../config/constants');
const logger = require('../utils/logger');

// Import route modules
const authRoutes = require('./authRoutes');
const listingRoutes = require('./listingRoutes');
const searchRoutes = require('./searchRoutes');
const recommendationRoutes = require('./recommendationRoutes');
const chatRoutes = require('./chatRoutes');
const messageRoutes = require('./messageRoutes');
const transactionRoutes = require('./transactionRoutes');
const reviewRoutes = require('./reviewRoutes');
const notificationRoutes = require('./notificationRoutes');
const promotionRoutes = require('./promotionRoutes');
const subscriptionRoutes = require('./subscriptionRoutes');
const adminRoutes = require('./adminRoutes');

// Initialize router
const router = express.Router();

// ================================
// MIDDLEWARE FOR ALL ROUTES
// ================================

// Request logging middleware
router.use((req, res, next) => {
  const start = Date.now();
  
  // Log request
  logger.http(`${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id || 'anonymous'
  });
  
  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.http(`${req.method} ${req.originalUrl} - ${res.statusCode}`, {
      duration,
      statusCode: res.statusCode,
      userId: req.user?.id || 'anonymous'
    });
  });
  
  next();
});

// Add request timestamp
router.use((req, res, next) => {
  req.timestamp = new Date().toISOString();
  next();
});

// ================================
// API HEALTH CHECK
// ================================

router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: API_CONFIG.VERSION,
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime()
  });
});

// ================================
// API DOCUMENTATION ENDPOINT
// ================================

router.get('/docs', (req, res) => {
  res.json({
    name: 'VOID Marketplace API',
    version: API_CONFIG.VERSION,
    description: 'AI-powered marketplace platform with advanced search and recommendations',
    documentation: {
      postman: '/api/v1/docs/postman',
      swagger: '/api/v1/docs/swagger',
      endpoints: '/api/v1/docs/endpoints'
    },
    features: [
      'User Authentication & Authorization',
      'Product Listings with Media Upload',
      'AI-Powered Image Search',
      'Fuzzy Text Search & Autocomplete',
      'Smart Recommendations',
      'Real-time Chat & Negotiations',
      'Escrow Transaction System',
      'Review & Rating System',
      'Notifications & Alerts',
      'Promotions & Discounts',
      'Subscription Management',
      'Admin Dashboard API'
    ],
    endpoints: {
      auth: {
        base: '/auth',
        description: 'Authentication and user management',
        methods: ['POST', 'GET', 'PUT', 'PATCH']
      },
      listings: {
        base: '/listings',
        description: 'Product listing management',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
      },
      search: {
        base: '/search',
        description: 'Text and image-based search',
        methods: ['GET', 'POST']
      },
      recommendations: {
        base: '/recommendations',
        description: 'AI-powered product recommendations',
        methods: ['GET']
      },
      chat: {
        base: '/chat',
        description: 'Chat thread management',
        methods: ['GET', 'POST', 'PATCH']
      },
      messages: {
        base: '/messages',
        description: 'Chat message handling',
        methods: ['GET', 'POST', 'PUT']
      },
      transactions: {
        base: '/transactions',
        description: 'Payment and escrow management',
        methods: ['GET', 'POST', 'PUT', 'PATCH']
      },
      reviews: {
        base: '/reviews',
        description: 'Review and rating system',
        methods: ['GET', 'POST', 'PUT', 'DELETE']
      },
      notifications: {
        base: '/notifications',
        description: 'User notification management',
        methods: ['GET', 'POST', 'PATCH']
      },
      promotions: {
        base: '/promotions',
        description: 'Discount and promotion management',
        methods: ['GET', 'POST', 'PUT', 'DELETE']
      },
      subscriptions: {
        base: '/subscriptions',
        description: 'Vendor subscription management',
        methods: ['GET', 'POST', 'PUT', 'PATCH']
      },
      admin: {
        base: '/admin',
        description: 'Administrative functions',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
      }
    }
  });
});

// ================================
// API ENDPOINTS DOCUMENTATION
// ================================

router.get('/docs/endpoints', (req, res) => {
  // This would normally be generated automatically from route definitions
  // For now, return a static structure
  res.json({
    version: API_CONFIG.VERSION,
    baseUrl: `/api/${API_CONFIG.VERSION}`,
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization: Bearer <token>',
      endpoints: {
        login: 'POST /auth/login',
        register: 'POST /auth/register',
        refresh: 'POST /auth/refresh',
        logout: 'POST /auth/logout'
      }
    },
    endpoints: {
      // Auth endpoints
      'POST /auth/register': {
        description: 'Register new user account',
        authentication: false,
        body: ['email', 'username', 'password', 'first_name', 'last_name']
      },
      'POST /auth/login': {
        description: 'User login',
        authentication: false,
        body: ['email', 'password']
      },
      'GET /auth/profile': {
        description: 'Get user profile',
        authentication: true
      },
      
      // Listing endpoints
      'GET /listings': {
        description: 'Get paginated listings',
        authentication: false,
        query: ['page', 'limit', 'category', 'search', 'minPrice', 'maxPrice']
      },
      'POST /listings': {
        description: 'Create new listing',
        authentication: true,
        body: ['title', 'description', 'price', 'category_id'],
        files: ['images', 'videos', 'models']
      },
      'GET /listings/:id': {
        description: 'Get listing details',
        authentication: false
      },
      'PUT /listings/:id': {
        description: 'Update listing',
        authentication: true,
        ownership: 'vendor_id'
      },
      
      // Search endpoints
      'GET /search': {
        description: 'Text-based search with autocomplete',
        authentication: false,
        query: ['q', 'page', 'limit', 'filters']
      },
      'POST /search/image': {
        description: 'Image-based search',
        authentication: false,
        files: ['image']
      },
      
      // Recommendations
      'GET /recommendations/trending': {
        description: 'Get trending products',
        authentication: false
      },
      'GET /recommendations/similar/:listingId': {
        description: 'Get similar products',
        authentication: false
      },
      'GET /recommendations/for-user': {
        description: 'Get personalized recommendations',
        authentication: true
      },
      
      // Chat endpoints
      'GET /chat': {
        description: 'Get user chat threads',
        authentication: true
      },
      'POST /chat': {
        description: 'Start new chat',
        authentication: true,
        body: ['listing_id', 'message']
      },
      
      // Transaction endpoints
      'GET /transactions': {
        description: 'Get user transactions',
        authentication: true
      },
      'POST /transactions': {
        description: 'Create new transaction',
        authentication: true,
        body: ['listing_id', 'quantity', 'offer_amount']
      },
      
      // Admin endpoints (require admin role)
      'GET /admin/users': {
        description: 'Get all users',
        authentication: true,
        role: 'ADMIN'
      },
      'GET /admin/analytics': {
        description: 'Get system analytics',
        authentication: true,
        role: 'ADMIN'
      }
    }
  });
});

// ================================
// MOUNT ROUTE MODULES
// ================================

// Authentication routes
router.use('/auth', authRoutes);

// Core marketplace routes
router.use('/listings', listingRoutes);
router.use('/search', searchRoutes);
router.use('/recommendations', recommendationRoutes);

// Communication routes
router.use('/chat', chatRoutes);
router.use('/messages', messageRoutes);

// Transaction routes
router.use('/transactions', transactionRoutes);
router.use('/reviews', reviewRoutes);

// User features
router.use('/notifications', notificationRoutes);
router.use('/promotions', promotionRoutes);
router.use('/subscriptions', subscriptionRoutes);

// Administrative routes
router.use('/admin', adminRoutes);

// ================================
// ERROR HANDLING FOR ROUTES
// ================================

// Handle 404 for unmatched API routes
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    message: `The endpoint ${req.method} ${req.originalUrl} does not exist`,
    availableEndpoints: '/api/v1/docs/endpoints'
  });
});

// ================================
// ROUTE STATISTICS MIDDLEWARE
// ================================

// Track API usage statistics
const routeStats = new Map();

router.use((req, res, next) => {
  const route = `${req.method} ${req.route?.path || req.path}`;
  const current = routeStats.get(route) || { count: 0, lastAccessed: null };
  
  routeStats.set(route, {
    count: current.count + 1,
    lastAccessed: new Date()
  });
  
  next();
});

// Endpoint to get route statistics (for monitoring)
router.get('/stats', (req, res) => {
  // Only allow admins to see stats
  if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: 'Access denied',
      message: 'Admin access required'
    });
  }
  
  const stats = {};
  for (const [route, data] of routeStats.entries()) {
    stats[route] = data;
  }
  
  res.json({
    success: true,
    data: {
      totalRoutes: routeStats.size,
      routeStats: stats,
      generatedAt: new Date().toISOString()
    }
  });
});

// ================================
// RATE LIMITING PER ROUTE TYPE
// ================================

// Add route-specific rate limiting headers
router.use((req, res, next) => {
  const path = req.path;
  let rateLimitInfo = {
    limit: API_CONFIG.RATE_LIMIT.MAX_REQUESTS,
    window: API_CONFIG.RATE_LIMIT.WINDOW_MS
  };
  
  // Stricter limits for certain endpoints
  if (path.startsWith('/auth/')) {
    rateLimitInfo.limit = API_CONFIG.RATE_LIMIT.AUTH_MAX_REQUESTS;
  } else if (path.startsWith('/search/image')) {
    rateLimitInfo.limit = 20; // Lower limit for image search
  } else if (path.startsWith('/admin/')) {
    rateLimitInfo.limit = 50; // Moderate limit for admin
  }
  
  // Add rate limit info to response headers
  res.set({
    'X-RateLimit-Limit': rateLimitInfo.limit,
    'X-RateLimit-Window': rateLimitInfo.window
  });
  
  next();
});

module.exports = router;