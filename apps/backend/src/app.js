// apps/backend/src/app.js
// Fixed Main Express application setup for VOID Marketplace

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

// Import utilities (these don't depend on database)
const logger = require('./utils/logger');

// ================================
// MAIN STARTUP FUNCTION
// ================================

async function startServer() {
  try {
    logger.info('🚀 Starting VOID Marketplace API...');

    // ================================
    // 1. INITIALIZE DATABASE FIRST
    // ================================
    
    logger.info('🗃️  Initializing database connection...');
    const { prisma, initializeDatabase } = require('./config/db');
    
    await initializeDatabase();
    logger.info('✅ Database connected and ready');

    // ================================
    // 2. CREATE EXPRESS APP
    // ================================
    
    const app = express();
    const server = createServer(app);

    // Initialize Socket.IO
    const io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URLS?.split(',') || [
          "http://localhost:3000", 
          "http://localhost:5173",
          "http://localhost:8081"
        ],
        credentials: true
      }
    });

    // ================================
    // 3. SECURITY MIDDLEWARE
    // ================================

    // Security headers
    app.use(helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
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
        // Allow requests with no origin (mobile apps, etc.)
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
          // Allow all origins in development
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
      max: process.env.NODE_ENV === 'production' ? 100 : 1000,
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
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10,
      message: {
        error: 'Too many authentication attempts, please try again later.',
        retryAfter: '15 minutes'
      }
    });

    app.use('/api/v1/auth/login', authLimiter);
    app.use('/api/v1/auth/register', authLimiter);
    app.use('/api/v1/auth/forgot-password', authLimiter);

    // ================================
    // 5. GENERAL MIDDLEWARE
    // ================================

    // Compression
    app.use(compression());

    // Logging
    if (process.env.NODE_ENV === 'production') {
      app.use(morgan('combined', { 
        stream: { write: message => logger.info(message.trim()) } 
      }));
    } else {
      app.use(morgan('dev'));
    }

    // Body parsing
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

    logger.info('Upload directories created/verified');

    // Static files for uploads
    app.use('/uploads', express.static('uploads', {
      maxAge: process.env.NODE_ENV === 'production' ? '7d' : '0',
      etag: true
    }));

    // ================================
    // 6. SOCKET.IO SETUP
    // ================================

    // Store io instance for use in other modules
    app.set('io', io);

    // Socket.IO connection handling
    io.on('connection', (socket) => {
      logger.info(`Socket connected: ${socket.id}`);

      // Join user-specific room for notifications
      socket.on('join_user_room', (userId) => {
        socket.join(`user_${userId}`);
        logger.info(`User ${userId} joined their room`);
      });

      // Join chat room
      socket.on('join_chat', (chatId) => {
        socket.join(`chat_${chatId}`);
        logger.info(`Socket ${socket.id} joined chat ${chatId}`);
      });

      // Leave chat room
      socket.on('leave_chat', (chatId) => {
        socket.leave(`chat_${chatId}`);
        logger.info(`Socket ${socket.id} left chat ${chatId}`);
      });

      // Handle typing indicators
      socket.on('typing_start', ({ chatId, userId }) => {
        socket.to(`chat_${chatId}`).emit('user_typing', { userId, isTyping: true });
      });

      socket.on('typing_stop', ({ chatId, userId }) => {
        socket.to(`chat_${chatId}`).emit('user_typing', { userId, isTyping: false });
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${socket.id}`);
      });
    });

    // ================================
    // 7. LOAD ROUTES (AFTER DATABASE IS READY)
    // ================================

    logger.info('📝 Loading API routes...');
    
    // Health check (before routes)
    app.get('/health', (req, res) => {
      res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        version: '1.0.0',
        database: 'connected'
      });
    });

    // API documentation endpoint
    app.get('/api', (req, res) => {
      res.json({
        message: 'VOID Marketplace API v1',
        version: '1.0.0',
        documentation: '/api/docs',
        status: 'operational',
        endpoints: {
          auth: '/api/v1/auth',
          listings: '/api/v1/listings',
          search: '/api/v1/search',
          recommendations: '/api/v1/recommendations',
          chat: '/api/v1/chat',
          transactions: '/api/v1/transactions',
          notifications: '/api/v1/notifications',
          promotions: '/api/v1/promotions',
          subscriptions: '/api/v1/subscriptions',
          reviews: '/api/v1/reviews',
          admin: '/api/v1/admin'
        }
      });
    });

    // Load routes AFTER database is connected
    const routes = require('./routes');
    app.use('/api/v1', routes);

    logger.info('✅ API routes loaded successfully');

    // ================================
    // 8. ERROR HANDLING
    // ================================

    // 404 handler
    app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Route not found',
        message: `The requested endpoint ${req.method} ${req.originalUrl} does not exist.`
      });
    });

    // Global error handler (load after database is ready)
    const { errorHandler } = require('./middleware/errorMiddleware');
    app.use(errorHandler);

    // ================================
    // 9. START SERVER
    // ================================

    const PORT = process.env.PORT || 5000;
    const HOST = process.env.HOST || '0.0.0.0';

    server.listen(PORT, HOST, () => {
      logger.info('🚀 VOID Marketplace API server started');
      logger.info(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🌐 Server running on http://${HOST}:${PORT}`);
      logger.info(`📊 Health check: http://${HOST}:${PORT}/health`);
      logger.info(`🔗 API Documentation: http://${HOST}:${PORT}/api`);
      logger.info(`📡 Socket.IO enabled for real-time features`);
      logger.info('✅ Ready for connections!');
    });

    // ================================
    // 10. GRACEFUL SHUTDOWN
    // ================================

    const gracefulShutdown = (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      
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

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// ================================
// START THE APPLICATION
// ================================

// Only start server if this file is run directly
if (require.main === module) {
  startServer();
}

module.exports = { startServer };