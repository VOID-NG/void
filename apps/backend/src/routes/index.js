// apps/backend/src/routes/index.js
// Main routes configuration for VOID Marketplace API

const express = require('express');
const { API_CONFIG } = require('../config/constants');
const logger = require('../utils/logger');

const router = express.Router();

// ================================
// API INFORMATION & DOCUMENTATION
// ================================

/**
 * @route   GET /api/v1
 * @desc    API information and status
 * @access  Public
 */
router.get('/', (req, res) => {
  res.json({
    name: 'VOID Marketplace API',
    version: API_CONFIG.VERSION,
    description: 'Complete marketplace API with real-time chat, payments, and AI-powered search',
    status: 'operational',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    features: {
      authentication: '✅ JWT-based auth with refresh tokens',
      listings: '✅ Product CRUD with image/video/3D support',
      search: '✅ Text + AI image search with embeddings',
      chat: '✅ Real-time messaging with Socket.IO',
      payments: '✅ Stripe integration with escrow',
      notifications: '✅ Email, push, and in-app notifications',
      admin: '✅ Complete admin dashboard API',
      analytics: '✅ User behavior and search analytics'
    },
    endpoints: {
      auth: '/auth',
      listings: '/listings',
      search: '/search',
      chat: '/chat',
      messages: '/messages',
      transactions: '/transactions',
      notifications: '/notifications',
      admin: '/admin'
    },
    documentation: {
      api_info: 'GET /',
      health_check: 'GET /health',
      endpoints_list: 'GET /docs/endpoints',
      status_overview: 'GET /status'
    }
  });
});

// ================================
// HEALTH CHECK & STATUS
// ================================

/**
 * @route   GET /api/v1/health
 * @desc    API health check
 * @access  Public
 */
router.get('/health', async (req, res) => {
  try {
    const { dbRouter, QueryOptimizer } = require('../config/db');
    
    // Test database connection
    await dbRouter.$queryRaw`SELECT 1`;
    
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: API_CONFIG.VERSION,
      services: {
        api: 'operational',
        database: 'connected',
        redis: process.env.REDIS_URL ? 'configured' : 'not_configured',
        email: process.env.EMAIL_SERVICE ? 'configured' : 'not_configured',
        storage: process.env.AWS_S3_BUCKET ? 's3' : 'local',
        search: process.env.OPENAI_API_KEY ? 'ai_enabled' : 'basic',
        payments: process.env.STRIPE_SECRET_KEY ? 'stripe_enabled' : 'disabled'
      },
      uptime: process.uptime(),
      memory_usage: process.memoryUsage(),
      node_version: process.version
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: 'Service unavailable',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/v1/status
 * @desc    Detailed API status
 * @access  Public
 */
router.get('/status', (req, res) => {
  res.json({
    api: {
      name: 'VOID Marketplace API',
      version: API_CONFIG.VERSION,
      status: 'operational',
      environment: process.env.NODE_ENV || 'development'
    },
    routes: {
      auth: {
        base: '/auth',
        description: 'User authentication and profile management ✅',
        methods: ['GET', 'POST', 'PUT', 'PATCH'],
        status: 'Active'
      },
      listings: {
        base: '/listings',
        description: 'Product listings CRUD with media uploads ✅',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        status: 'Active'
      },
      search: {
        base: '/search',
        description: 'Text and AI-powered image search ✅',
        methods: ['GET', 'POST'],
        status: 'Active'
      },
      chat: {
        base: '/chat',
        description: 'Real-time messaging system ✅',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        status: 'Active'
      },
      messages: {
        base: '/messages',
        description: 'Message management with Socket.IO ✅',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
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
// LOAD FEATURE ROUTES
// ================================

try {
  // Authentication routes
  const authRoutes = require('./authRoutes');
  router.use('/auth', authRoutes);
  logger.info('✅ Auth routes loaded');
} catch (error) {
  logger.error('❌ Failed to load auth routes:', error.message);
}

try {
  // Listing routes
  const listingRoutes = require('./listingRoutes');
  router.use('/listings', listingRoutes);
  logger.info('✅ Listing routes loaded');
} catch (error) {
  logger.error('❌ Failed to load listing routes:', error.message);
}

try {
  // Search routes
  const searchRoutes = require('./searchRoutes');
  router.use('/search', searchRoutes);
  logger.info('✅ Search routes loaded');
} catch (error) {
  logger.error('❌ Failed to load search routes:', error.message);
}

try {
  // Chat routes
  const chatRoutes = require('./chatRoutes');
  router.use('/chat', chatRoutes);
  logger.info('✅ Chat routes loaded');
} catch (error) {
  logger.error('❌ Failed to load chat routes:', error.message);
}

try {
  // Message routes
  const messageRoutes = require('./messageRoutes');
  router.use('/messages', messageRoutes);
  logger.info('✅ Message routes loaded');
} catch (error) {
  logger.error('❌ Failed to load message routes:', error.message);
}

try {
  // Transaction routes
  const transactionRoutes = require('./transactionRoutes');
  router.use('/transactions', transactionRoutes);
  logger.info('✅ Transaction routes loaded');
} catch (error) {
  logger.error('❌ Failed to load transaction routes:', error.message);
}

try {
  // Review routes
  const reviewRoutes = require('./reviewRoutes');
  router.use('/reviews', reviewRoutes);
  logger.info('✅ Review routes loaded');
} catch (error) {
  logger.error('❌ Failed to load review routes:', error.message);
}

try {
  // Notification routes
  const notificationRoutes = require('./notificationRoutes');
  router.use('/notifications', notificationRoutes);
  logger.info('✅ Notification routes loaded');
} catch (error) {
  logger.error('❌ Failed to load notification routes:', error.message);
}

try {
  // Promotion routes
  const promotionRoutes = require('./promotionRoutes');
  router.use('/promotions', promotionRoutes);
  logger.info('✅ Promotion routes loaded');
} catch (error) {
  logger.error('❌ Failed to load promotion routes:', error.message);
}

try {
  // Subscription routes
  const subscriptionRoutes = require('./subscriptionRoutes');
  router.use('/subscriptions', subscriptionRoutes);
  logger.info('✅ Subscription routes loaded');
} catch (error) {
  logger.error('❌ Failed to load subscription routes:', error.message);
}

try {
  // Admin routes
  const adminRoutes = require('./adminRoutes');
  router.use('/admin', adminRoutes);
  logger.info('✅ Admin routes loaded');
} catch (error) {
  logger.error('❌ Failed to load admin routes:', error.message);
}

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
      // ✅ AUTHENTICATION ENDPOINTS
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
      'PATCH /auth/profile': {
        description: 'Update user profile',
        authentication: true,
        body: ['first_name', 'last_name', 'bio', 'location'],
        status: '✅ Active'
      },
      'POST /auth/refresh': {
        description: 'Refresh access token',
        authentication: false,
        body: ['refreshToken'],
        status: '✅ Active'
      },
      'POST /auth/logout': {
        description: 'Logout user',
        authentication: true,
        status: '✅ Active'
      },

      // ✅ LISTING ENDPOINTS
      'GET /listings': {
        description: 'Get listings with filters',
        authentication: false,
        query: ['category', 'min_price', 'max_price', 'location', 'page', 'limit'],
        status: '✅ Active'
      },
      'POST /listings': {
        description: 'Create new listing',
        authentication: true,
        role: 'VENDOR',
        body: ['title', 'description', 'price', 'condition', 'category_id'],
        files: ['images', 'videos', 'models_3d'],
        status: '✅ Active'
      },
      'GET /listings/:id': {
        description: 'Get listing by ID',
        authentication: false,
        status: '✅ Active'
      },
      'PUT /listings/:id': {
        description: 'Update listing',
        authentication: true,
        ownership: 'vendor_only',
        status: '✅ Active'
      },
      'DELETE /listings/:id': {
        description: 'Delete listing',
        authentication: true,
        ownership: 'vendor_or_admin',
        status: '✅ Active'
      },

      // ✅ SEARCH ENDPOINTS
      'GET /search': {
        description: 'Text search with filters',
        authentication: false,
        query: ['q', 'category', 'min_price', 'max_price', 'sort_by'],
        status: '✅ Active'
      },
      'GET /search/autocomplete': {
        description: 'Search autocomplete suggestions',
        authentication: false,
        query: ['q', 'limit'],
        status: '✅ Active'
      },
      'POST /search/image': {
        description: 'Image-based search',
        authentication: false,
        files: ['image'],
        body: ['category', 'similarity_threshold'],
        status: '✅ Active'
      },
      'POST /search/image-url': {
        description: 'Search by image URL',
        authentication: false,
        body: ['image_url', 'category', 'similarity_threshold'],
        status: '✅ Active'
      },

      // ✅ CHAT ENDPOINTS
      'GET /chat': {
        description: 'Get user chats',
        authentication: true,
        query: ['page', 'limit', 'status'],
        status: '✅ Active'
      },
      'POST /chat': {
        description: 'Create chat for listing',
        authentication: true,
        body: ['listing_id', 'vendor_id', 'initial_message'],
        status: '✅ Active'
      },
      'GET /chat/:id': {
        description: 'Get chat details',
        authentication: true,
        ownership: 'participant_only',
        status: '✅ Active'
      },
      'PATCH /chat/:id/status': {
        description: 'Update chat status',
        authentication: true,
        body: ['status'],
        status: '✅ Active'
      },

      // ✅ MESSAGE ENDPOINTS
      'POST /messages': {
        description: 'Send message',
        authentication: true,
        body: ['chat_id', 'content', 'type', 'offer_amount'],
        status: '✅ Active'
      },
      'GET /messages/:chatId': {
        description: 'Get chat messages',
        authentication: true,
        query: ['page', 'limit', 'before_message_id'],
        status: '✅ Active'
      },
      'PUT /messages/:id': {
        description: 'Edit message',
        authentication: true,
        ownership: 'sender_only',
        body: ['content'],
        status: '✅ Active'
      },
      'DELETE /messages/:id': {
        description: 'Delete message',
        authentication: true,
        ownership: 'sender_only',
        status: '✅ Active'
      },

      // ✅ TRANSACTION ENDPOINTS
      'POST /transactions': {
        description: 'Create transaction',
        authentication: true,
        body: ['listing_id', 'vendor_id', 'amount', 'payment_method_id'],
        status: '✅ Active'
      },
      'GET /transactions': {
        description: 'Get user transactions',
        authentication: true,
        query: ['page', 'limit', 'status_filter', 'role_filter'],
        status: '✅ Active'
      },
      'GET /transactions/:id': {
        description: 'Get transaction details',
        authentication: true,
        ownership: 'participant_only',
        status: '✅ Active'
      },
      'POST /transactions/:id/process-payment': {
        description: 'Process payment',
        authentication: true,
        body: ['payment_method_id', 'billing_address'],
        status: '✅ Active'
      },
      'POST /transactions/:id/release-escrow': {
        description: 'Release escrow funds',
        authentication: true,
        role: 'buyer_or_admin',
        status: '✅ Active'
      },

      // ✅ NOTIFICATION ENDPOINTS
      'GET /notifications': {
        description: 'Get user notifications',
        authentication: true,
        query: ['page', 'limit', 'type', 'status', 'category'],
        status: '✅ Active'
      },
      'GET /notifications/unread-count': {
        description: 'Get unread notification count',
        authentication: true,
        status: '✅ Active'
      },
      'PATCH /notifications/:id/read': {
        description: 'Mark notification as read',
        authentication: true,
        status: '✅ Active'
      },
      'PATCH /notifications/mark-all-read': {
        description: 'Mark all notifications as read',
        authentication: true,
        body: ['category', 'type'],
        status: '✅ Active'
      },

      // ✅ ADMIN ENDPOINTS
      'GET /admin/users': {
        description: 'Get all users',
        authentication: true,
        role: 'ADMIN',
        query: ['page', 'limit', 'role', 'status'],
        status: '✅ Active'
      },
      'PATCH /admin/users/:id': {
        description: 'Update user (block/verify/promote)',
        authentication: true,
        role: 'ADMIN',
        body: ['action', 'reason', 'new_role'],
        status: '✅ Active'
      },
      'GET /admin/listings': {
        description: 'Get all listings for review',
        authentication: true,
        role: 'MODERATOR',
        query: ['status', 'page', 'limit'],
        status: '✅ Active'
      },
      'PATCH /admin/listings/:id': {
        description: 'Approve/reject listing',
        authentication: true,
        role: 'MODERATOR',
        body: ['action', 'reason'],
        status: '✅ Active'
      },
      'GET /admin/transactions': {
        description: 'Get all transactions',
        authentication: true,
        role: 'ADMIN',
        query: ['status', 'page', 'limit', 'start_date', 'end_date'],
        status: '✅ Active'
      },
      'GET /admin/analytics': {
        description: 'Get system analytics',
        authentication: true,
        role: 'ADMIN',
        query: ['period', 'metrics'],
        status: '✅ Active'
      }
    },
    real_time_features: {
      'Socket.IO Events': {
        'join_user_room': 'Join personal notification room',
        'join_chat': 'Join specific chat room',
        'send_message': 'Send real-time message',
        'typing_start': 'Start typing indicator',
        'typing_stop': 'Stop typing indicator',
        'mark_messages_read': 'Mark messages as read'
      }
    },
    file_uploads: {
      'Listing Images': 'Up to 10 images, max 10MB each (JPEG, PNG, WebP)',
      'Listing Videos': 'Up to 1 video, max 100MB (MP4, WebM)',
      '3D Models': 'Up to 3 models, max 50MB each (GLB, OBJ)',
      'User Avatar': '1 image, max 5MB (JPEG, PNG, WebP)',
      'Search Images': 'Any image for visual search (JPEG, PNG, WebP)'
    },
    error_handling: {
      'Format': 'Consistent JSON error responses',
      'Codes': 'Specific error codes for different scenarios',
      'Validation': 'Detailed validation error messages',
      'Rate Limiting': '100 requests per 15 minutes in production'
    }
  });
});

// ================================
// DEVELOPMENT/TESTING ROUTES
// ================================

if (process.env.NODE_ENV === 'development' || process.env.ENABLE_TEST_ROUTES === 'true') {
  /**
   * @route   GET /api/v1/dev/test-accounts
   * @desc    Get test account information
   * @access  Development only
   */
  router.get('/dev/test-accounts', (req, res) => {
    res.json({
      message: 'Test accounts for development',
      accounts: [
        {
          role: 'SUPER_ADMIN',
          email: process.env.ADMIN_EMAIL || 'admin@voidmarketplace.com',
          password: 'Contact admin for password',
          description: 'System administrator account'
        },
        {
          role: 'VENDOR',
          email: 'vendor@test.com',
          password: 'TestUser123!',
          description: 'Test vendor account with sample listings'
        },
        {
          role: 'USER',
          email: 'buyer@test.com',
          password: 'TestUser123!',
          description: 'Test buyer account'
        }
      ],
      note: 'These accounts are created automatically during database seeding in development'
    });
  });

  /**
   * @route   POST /api/v1/dev/create-test-user
   * @desc    Create test user
   * @access  Development only
   */
  router.post('/dev/create-test-user', async (req, res) => {
    try {
      const { dbRouter, QueryOptimizer } = require('../config/db');
      const bcrypt = require('bcryptjs');

      const { email, role = 'USER' } = req.body;
      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Email is required'
        });
      }

      const password = 'TestUser123!';
      const hashedPassword = await bcrypt.hash(password, 12);

      const user = await dbRouter.user.create({
        data: {
          email,
          username: email.split('@')[0],
          password_hash: hashedPassword,
          first_name: 'Test',
          last_name: 'User',
          role,
          status: 'ACTIVE',
          is_verified: true
        },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          created_at: true
        }
      });

      res.json({
        success: true,
        message: 'Test user created',
        user,
        login_credentials: {
          email,
          password
        }
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        error: 'Failed to create test user',
        message: error.message
      });
    }
  });
}

// ================================
// API METRICS & MONITORING
// ================================

/**
 * @route   GET /api/v1/metrics
 * @desc    API metrics and usage statistics
 * @access  Public (basic metrics only)
 */
router.get('/metrics', (req, res) => {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();

  res.json({
    api: {
      uptime_seconds: Math.floor(uptime),
      uptime_human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      version: API_CONFIG.VERSION,
      environment: process.env.NODE_ENV
    },
    system: {
      memory: {
        used_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        total_mb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external_mb: Math.round(memoryUsage.external / 1024 / 1024)
      },
      process: {
        pid: process.pid,
        node_version: process.version,
        platform: process.platform
      }
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;