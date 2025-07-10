// apps/backend/src/app.js
// Updated Express application with complete Socket.IO chat integration

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();

// Import utilities
const logger = require('./utils/logger');
const { initializeSocketHandlers } = require('./utils/socketHandlers');

// ================================
// MAIN STARTUP FUNCTION
// ================================

async function startServer() {
  try {
    logger.info('🚀 Starting VOID Marketplace API with Chat System...');

    // ================================
    // 1. INITIALIZE DATABASE FIRST
    // ================================
    
    logger.info('🗃️  Initializing database connection...');
    const { prisma, initializeDatabase } = require('./config/db');
    
    await initializeDatabase();
    logger.info('✅ Database connected and ready');

    // ================================
    // 2. CREATE EXPRESS APP & HTTP SERVER
    // ================================
    
    const app = express();
    const server = createServer(app);

    // Initialize Socket.IO with enhanced configuration
    const io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URLS?.split(',') || [
          "http://localhost:3000", 
          "http://localhost:5173",
          "http://localhost:8081"
        ],
        credentials: true,
        methods: ["GET", "POST"]
      },
      // Enhanced Socket.IO configuration for chat
      pingTimeout: 60000,
      pingInterval: 25000,
      transports: ['websocket', 'polling'],
      allowUpgrades: true,
      // Connection state recovery for better UX
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true,
      }
    });

    logger.info('✅ Socket.IO server initialized with chat configuration');

    // ================================
    // 3. SECURITY MIDDLEWARE
    // ================================

    app.use(helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "ws:", "wss:"], // Allow WebSocket connections
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
    }));

    // CORS configuration
    app.use(cors({
      origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const allowedOrigins = process.env.FRONTEND_URLS?.split(',') || [
          'http://localhost:3000',
          'http://localhost:5173',
          'http://localhost:8081',
          'https://void-marketplace.com'
        ];
        
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          if (process.env.NODE_ENV !== 'production') {
            callback(null, true);
          } else {
            callback(new Error('Not allowed by CORS'));
          }
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
    }));

    // ================================
    // 4. RATE LIMITING
    // ================================

    // General rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: process.env.NODE_ENV === 'production' ? 1000 : 5000,
      message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
      },
      standardHeaders: true,
      legacyHeaders: false,
    });

    app.use('/api/', limiter);

    // Stricter rate limiting for auth endpoints
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: {
        error: 'Too many authentication attempts, please try again later.',
        retryAfter: '15 minutes'
      }
    });

    app.use('/api/v1/auth/login', authLimiter);
    app.use('/api/v1/auth/register', authLimiter);

    // More lenient rate limiting for chat endpoints
    const chatLimiter = rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 100, // 100 requests per minute for chat
      message: {
        error: 'Too many chat requests, please slow down.',
        retryAfter: '1 minute'
      }
    });

    app.use('/api/v1/chat', chatLimiter);
    app.use('/api/v1/messages', chatLimiter);

    // ================================
    // 5. GENERAL MIDDLEWARE
    // ================================

    app.use(compression());

    // Logging
    if (process.env.NODE_ENV === 'production') {
      app.use(morgan('combined', { 
        stream: { write: message => logger.info(message.trim()) } 
      }));
    } else {
      app.use(morgan('dev'));
    }

    // Body parsing with increased limits for file uploads
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Create upload directories
    const uploadPaths = [
      'uploads',
      'uploads/images',
      'uploads/videos', 
      'uploads/models'
    ];

    uploadPaths.forEach(uploadPath => {
      const fs = require('fs');
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
    });

    // Static files for uploads
    app.use('/uploads', express.static('uploads', {
      maxAge: process.env.NODE_ENV === 'production' ? '7d' : '0',
      etag: true
    }));

    // ================================
    // 6. SOCKET.IO SETUP & CHAT INTEGRATION
    // ================================

    // Store io instance for use in controllers and services
    app.set('io', io);

    // Initialize Socket.IO event handlers for chat
    initializeSocketHandlers(io);

    // Socket.IO connection monitoring
    let connectedUsers = 0;
    let activeChats = new Set();

    io.on('connection', (socket) => {
      connectedUsers++;
      logger.info(`Socket connected: ${socket.id} (Total: ${connectedUsers})`);

      socket.on('join_chat', (data) => {
        if (data.chatId) {
          activeChats.add(data.chatId);
        }
      });

      socket.on('disconnect', () => {
        connectedUsers--;
        logger.info(`Socket disconnected: ${socket.id} (Total: ${connectedUsers})`);
      });
    });

    // ================================
    // 7. HEALTH CHECKS & MONITORING
    // ================================

    // Enhanced health check with chat system status
    app.get('/health', async (req, res) => {
      try {
        // Check database
        const dbHealth = await prisma.$queryRaw`SELECT 1`;
        
        // Check Socket.IO
        const socketHealth = {
          connected_users: connectedUsers,
          active_chats: activeChats.size,
          engine_ready: io.engine.readyState === 'open'
        };

        res.status(200).json({ 
          status: 'healthy', 
          timestamp: new Date().toISOString(),
          environment: process.env.NODE_ENV,
          version: '1.0.0',
          services: {
            database: 'connected',
            websocket: 'active',
            chat_system: 'operational'
          },
          metrics: {
            uptime: process.uptime(),
            memory_usage: process.memoryUsage(),
            socket_stats: socketHealth
          }
        });
      } catch (error) {
        res.status(500).json({
          status: 'unhealthy',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Chat system status endpoint
    app.get('/api/v1/chat/status', (req, res) => {
      res.json({
        success: true,
        data: {
          websocket_connected: connectedUsers > 0,
          connected_users: connectedUsers,
          active_chats: activeChats.size,
          server_time: new Date().toISOString()
        }
      });
    });

    // API documentation endpoint
    app.get('/api', (req, res) => {
      res.json({
        message: 'VOID Marketplace API v1 with Real-time Chat',
        version: '1.0.0',
        documentation: '/api/docs',
        status: 'operational',
        features: {
          chat_system: 'enabled',
          real_time_messaging: 'enabled',
          offer_negotiation: 'enabled',
          file_uploads: 'enabled',
          ai_search: 'enabled'
        },
        endpoints: {
          auth: '/api/v1/auth',
          listings: '/api/v1/listings',
          search: '/api/v1/search',
          chat: '/api/v1/chat',
          messages: '/api/v1/messages',
          transactions: '/api/v1/transactions',
          notifications: '/api/v1/notifications',
          admin: '/api/v1/admin'
        },
        websocket: {
          url: `ws://${req.get('host')}`,
          events: [
            'join_user_room',
            'join_chat',
            'send_message',
            'typing_start',
            'typing_stop',
            'send_offer',
            'respond_to_offer'
          ]
        }
      });
    });

    // ================================
    // 8. LOAD ROUTES
    // ================================

    logger.info('📝 Loading API routes...');
    
    const routes = require('./routes');
    app.use('/api/v1', routes);

    logger.info('✅ API routes loaded successfully');

    // ================================
    // 9. ERROR HANDLING
    // ================================

    // 404 handler
    app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Route not found',
        message: `The requested endpoint ${req.method} ${req.originalUrl} does not exist.`,
        available_endpoints: [
          '/api/v1/auth',
          '/api/v1/listings', 
          '/api/v1/search',
          '/api/v1/chat',
          '/api/v1/messages'
        ]
      });
    });

    // Global error handler
    const { errorHandler } = require('./middleware/errorMiddleware');
    app.use(errorHandler);

    // ================================
    // 10. START SERVER
    // ================================

    const PORT = process.env.PORT || 5000;
    const HOST = process.env.HOST || '0.0.0.0';

    server.listen(PORT, HOST, () => {
      logger.info('🚀 VOID Marketplace API server started');
      logger.info(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🌐 Server running on http://${HOST}:${PORT}`);
      logger.info(`📊 Health check: http://${HOST}:${PORT}/health`);
      logger.info(`🔗 API Documentation: http://${HOST}:${PORT}/api`);
      logger.info(`💬 Chat WebSocket: ws://${HOST}:${PORT}`);
      logger.info(`📡 Real-time features: enabled`);
      logger.info('✅ Ready for connections!');
    });

    // ================================
    // 11. GRACEFUL SHUTDOWN
    // ================================

    const gracefulShutdown = (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      
      // Close Socket.IO connections
      io.close(() => {
        logger.info('Socket.IO server closed');
        
        // Close HTTP server
        server.close(() => {
          logger.info('HTTP server closed');
          
          // Close database connections
          prisma.$disconnect()
            .then(() => {
              logger.info('Database disconnected');
              logger.info('Graceful shutdown completed');
              process.exit(0);
            })
            .catch((error) => {
              logger.error('Error during database disconnect:', error);
              process.exit(1);
            });
        });
      });

      // Force close after 30 seconds
      setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 30000);
    };

    // Listen for termination signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return { app, server, io };

  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    console.error('💥 Startup Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// ================================
// GLOBAL ERROR HANDLERS
// ================================

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// ================================
// START THE APPLICATION
// ================================

if (require.main === module) {
  startServer();
}

module.exports = { startServer };