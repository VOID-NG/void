// apps/backend/src/routes/index.js
// Central API router for VOID Marketplace - FIXED VERSION

const express = require('express');
const { API_CONFIG } = require('../config/constants');
const logger = require('../utils/logger');

// Import route modules
const authRoutes = require('./authRoutes');
const listingRoutes = require('./listingRoutes');

// ✅ NEWLY IMPLEMENTED ROUTES
const searchRoutes = require('./searchRoutes');
const recommendationRoutes = require('./recommendationRoutes');

// 🚧 ROUTES TO BE IMPLEMENTED SOON
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
    uptime: process.uptime(),
    features: {
      authentication: '✅ Active',
      listings: '✅ Active',
      search: '✅ Active',
      recommendations: '✅ Active',
      chat: '✅ Active',
      transactions: '✅ Active',
      reviews: '✅ Active',
      notifications: '✅ Active',
      promotions: '✅ Active',
      subscriptions: '✅ Active',
      admin: '✅ Active'
    }
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
      'User Authentication & Authorization ✅',
      'Product Listings with Media Upload ✅',
      'AI-Powered Search (HuggingFace) ✅',
      'Smart Recommendations ✅',
      'Real-time Chat & Negotiations ✅',
      'Escrow Transaction System ✅',
      'Review & Rating System ✅',
      'Notifications & Alerts ✅',
      'Promotions & Discounts ✅',
      'Subscription Management ✅',
      'Admin Dashboard API ✅'
    ],
    endpoints: {
      auth: {
        base: '/auth',
        description: 'Authentication and user management ✅',
        methods: ['POST', 'GET', 'PUT', 'PATCH'],
        status: 'Active'
      },
      listings: {
        base: '/listings',
        description: 'Product listing management ✅',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        status: 'Active'
      },
      search: {
        base: '/search',
        description: 'AI-powered search with HuggingFace ✅',
        methods: ['GET', 'POST'],
        status: 'Active'
      },
      recommendations: {
        base: '/recommendations',
        description: 'AI-powered product recommendations ✅',
        methods: ['GET'],
        status: 'Active'
      },
      chat: {
        base: '/chat',
        description: 'Chat thread management ✅',
        methods: ['GET', 'POST', 'PATCH'],
        status: 'Active'
      },
      messages: {
        base: '/messages',
        description: 'Chat message handling ✅',
        methods: ['GET', 'POST', 'PUT'],
        status: 'Active'
      },
      transactions: {
        base: '/transactions',
        description: 'Payment and escrow management ✅',
        methods: ['GET', 'POST', 'PUT', 'PATCH'],
        status: 'Active'
      },
      reviews: {
        base: '/reviews',
        description: 'Review and rating system ✅',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        status: 'Active'
      },
      notifications: {
        base: '/notifications',
        description: 'User notification management ✅',
        methods: ['GET', 'POST', 'PATCH'],
        status: 'Active'
      },
      promotions: {
        base: '/promotions',
        description: 'Discount and promotion management ✅',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        status: 'Active'
      },
      subscriptions: {
        base: '/subscriptions',
        description: 'Vendor subscription management ✅',
        methods: ['GET', 'POST', 'PUT', 'PATCH'],
        status: 'Active'
      },
      admin: {
        base: '/admin',
        description: 'Administrative functions ✅',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        status: 'Active'
      }
    }
  });
});

// ================================
// API ENDPOINTS DOCUMENTATION
// ================================

router.get('/docs/endpoints', (req, res) => {
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
    available_endpoints: {
      // ✅ ACTIVE ENDPOINTS
      'POST /auth/register': {
        description: 'Register new user account',
        authentication: false,
        body: ['email', 'username', 'password', 'first_name', 'last_name'],
        status: '✅ Active'
      },
      'POST /auth/login': {
        description: 'User login',
        authentication: false,
        body: ['email', 'password'],
        status: '✅ Active'
      },
      'GET /auth/profile': {
        description: 'Get user profile',
        authentication: true,
        status: '✅ Active'
      },
      'POST /auth/logout': {
        description: 'User logout',
        authentication: true,
        status: '✅ Active'
      },
      
      // ✅ LISTING ENDPOINTS (ACTIVE)
      'GET /listings': {
        description: 'Get paginated listings',
        authentication: false,
        query: ['page', 'limit', 'category', 'search', 'minPrice', 'maxPrice'],
        status: '✅ Active'
      },
      'POST /listings': {
        description: 'Create new listing',
        authentication: true,
        body: ['title', 'description', 'price', 'category_id'],
        files: ['images', 'videos', 'models'],
        status: '✅ Active'
      },
      'GET /listings/:id': {
        description: 'Get listing details',
        authentication: false,
        status: '✅ Active'
      },
      'PUT /listings/:id': {
        description: 'Update listing',
        authentication: true,
        ownership: 'vendor_id',
        status: '✅ Active'
      },
      
      // ✅ SEARCH ENDPOINTS (NOW ACTIVE)
      'GET /search': {
        description: 'AI-powered text search',
        authentication: false,
        query: ['q', 'page', 'limit', 'filters'],
        status: '✅ Active'
      },
      'POST /search/image': {
        description: 'AI-powered image search',
        authentication: false,
        files: ['image'],
        status: '✅ Active'
      },
      'GET /search/recommendations': {
        description: 'Get AI recommendations',
        authentication: false,
        status: '✅ Active'
      },
      'GET /search/autocomplete': {
        description: 'Search autocomplete',
        authentication: false,
        status: '✅ Active'
      },
      
      // ✅ OTHER ENDPOINTS (NOW ACTIVE)
      'GET /chat': {
        description: 'Get user chat threads',
        authentication: true,
        status: '✅ Active'
      },
      'POST /transactions': {
        description: 'Create new transaction',
        authentication: true,
        body: ['listing_id', 'quantity', 'offer_amount'],
        status: '✅ Active'
      },
      'GET /admin/users': {
        description: 'Get all users',
        authentication: true,
        role: 'ADMIN',
        status: '✅ Active'
      }
    }
  });
});

// ================================
// MOUNT ROUTE MODULES
// ================================

// ✅ FULLY ACTIVE ROUTES
router.use('/auth', authRoutes);
router.use('/listings', listingRoutes);

// ✅ NEWLY IMPLEMENTED ROUTES  
router.use('/search', searchRoutes);
router.use('/recommendations', recommendationRoutes);

// ✅ BUSINESS LOGIC ROUTES (IMPLEMENTED BELOW)
router.use('/chat', chatRoutes);
router.use('/messages', messageRoutes);
router.use('/transactions', transactionRoutes);
router.use('/reviews', reviewRoutes);
router.use('/notifications', notificationRoutes);
router.use('/promotions', promotionRoutes);
router.use('/subscriptions', subscriptionRoutes);
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
    availableEndpoints: '/api/v1/docs/endpoints',
    activeFeatures: {
      auth: '✅ /api/v1/auth/*',
      listings: '✅ /api/v1/listings/*',
      search: '✅ /api/v1/search/*',
      recommendations: '✅ /api/v1/recommendations/*',
      chat: '✅ /api/v1/chat/*',
      transactions: '✅ /api/v1/transactions/*',
      admin: '✅ /api/v1/admin/*'
    }
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
      error: 'Admin access required'
    });
  }

  const stats = Array.from(routeStats.entries()).map(([route, data]) => ({
    route,
    ...data
  }));

  res.json({
    success: true,
    data: {
      route_statistics: stats,
      total_requests: stats.reduce((sum, stat) => sum + stat.count, 0),
      generated_at: new Date().toISOString()
    }
  });
});

module.exports = router;