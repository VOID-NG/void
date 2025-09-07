// apps/backend/src/app.js
// Complete Express application for VOID Marketplace

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Import utilities and middleware
const logger = require('./utils/logger');
const { 
  errorHandler, 
  notFoundHandler, 
  addRequestId,
  AppError 
} = require('./middleware/errorMiddleware');

// ================================
// STARTUP VALIDATION
// ================================

const validateEnvironment = () => {
  const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    logger.error('Missing required environment variables:', missingVars);
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  logger.info('Environment validation passed');
};

// ================================
// SOCKET.IO AUTHENTICATION
// ================================

const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || 
                  socket.handshake.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      // Allow anonymous connections for public features
      socket.user = null;
      return next();
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user info from database
    const { prisma } = require('./config/db');
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        first_name: true,
        last_name: true,
        role: true,
        status: true
      }
    });

    if (!user || user.status !== 'ACTIVE') {
      return next(new Error('User not found or inactive'));
    }

    socket.user = user;
    next();
  } catch (error) {
    logger.error('Socket authentication failed:', error);
    next(new Error('Authentication failed'));
  }
};

// ================================
// SOCKET.IO HANDLERS
// ================================

const setupSocketHandlers = (io) => {
  // Import chat service
  const chatService = require('./services/chatService');
  const messageService = require('./services/messageService');

  // Connection tracking
  const connectedUsers = new Map(); // userId -> socketId
  const userSockets = new Map(); // socketId -> user data

  io.on('connection', (socket) => {
    logger.debug(`Socket connected: ${socket.id}`);

    // ================================
    // USER AUTHENTICATION & PRESENCE
    // ================================

    socket.on('join_user_room', (data) => {
      try {
        if (!socket.user) {
          socket.emit('error', { message: 'Authentication required' });
          return;
        }

        const userId = socket.user.id;
        
        // Track user connection
        connectedUsers.set(userId, socket.id);
        userSockets.set(socket.id, socket.user);

        // Join user's personal room for notifications
        socket.join(`user_${userId}`);
        
        logger.info(`User ${userId} joined their notification room`);
        
        socket.emit('user_room_joined', {
          success: true,
          user_id: userId
        });

        // Broadcast user online status to their contacts
        socket.broadcast.emit('user_online', {
          user_id: userId,
          username: socket.user.username
        });

      } catch (error) {
        logger.error('Join user room failed:', error);
        socket.emit('error', { message: 'Failed to join user room' });
      }
    });

    // ================================
    // CHAT MANAGEMENT
    // ================================

    socket.on('join_chat', async (data) => {
      try {
        if (!socket.user) {
          socket.emit('error', { message: 'Authentication required' });
          return;
        }

        const { chatId } = data;
        const userId = socket.user.id;

        // Verify user has access to this chat
        const hasAccess = await chatService.verifyUserChatAccess(userId, chatId);
        if (!hasAccess) {
          socket.emit('error', { message: 'Access denied to this chat' });
          return;
        }

        // Join the chat room
        socket.join(`chat_${chatId}`);

        // Get recent messages
        const messages = await chatService.getChatMessages({
          chatId,
          userId,
          limit: 50
        });

        socket.emit('chat_joined', {
          chat_id: chatId,
          messages: messages.data
        });

        // Notify other users in chat
        socket.to(`chat_${chatId}`).emit('user_joined_chat', {
          user_id: userId,
          username: socket.user.username,
          chat_id: chatId
        });

        logger.info(`User ${userId} joined chat ${chatId}`);

      } catch (error) {
        logger.error('Join chat failed:', error);
        socket.emit('error', { message: 'Failed to join chat' });
      }
    });

    socket.on('leave_chat', (data) => {
      try {
        const { chatId } = data;
        const userId = socket.user?.id;

        if (!userId) return;

        socket.leave(`chat_${chatId}`);
        
        socket.to(`chat_${chatId}`).emit('user_left_chat', {
          user_id: userId,
          chat_id: chatId
        });

        logger.info(`User ${userId} left chat ${chatId}`);

      } catch (error) {
        logger.error('Leave chat failed:', error);
      }
    });

    // ================================
    // MESSAGING
    // ================================

    socket.on('send_message', async (data) => {
      try {
        if (!socket.user) {
          socket.emit('error', { message: 'Authentication required' });
          return;
        }

        const { chatId, content, messageType = 'TEXT', offerAmount, metadata } = data;
        const userId = socket.user.id;

        // Create message using chat service
        const message = await chatService.createMessage({
          chatId,
          senderId: userId,
          content,
          messageType,
          offerAmount,
          metadata
        });

        // Emit to all users in chat
        io.to(`chat_${chatId}`).emit('new_message', {
          message,
          chat_id: chatId
        });

        // Send notification to recipient if they're not in the chat room
        const chatParticipants = await chatService.getChatParticipants(chatId);
        const recipient = chatParticipants.find(p => p.id !== userId);
        
        if (recipient) {
          io.to(`user_${recipient.id}`).emit('message_notification', {
            chat_id: chatId,
            sender: socket.user,
            message_preview: content?.substring(0, 50) || 'New message'
          });
        }

        logger.info(`Message sent in chat ${chatId} by user ${userId}`);

      } catch (error) {
        logger.error('Send message failed:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('typing_start', (data) => {
      try {
        const { chatId } = data;
        const userId = socket.user?.id;

        if (!userId) return;

        socket.to(`chat_${chatId}`).emit('user_typing', {
          user_id: userId,
          chat_id: chatId,
          typing: true
        });

      } catch (error) {
        logger.error('Typing start failed:', error);
      }
    });

    socket.on('typing_stop', (data) => {
      try {
        const { chatId } = data;
        const userId = socket.user?.id;

        if (!userId) return;

        socket.to(`chat_${chatId}`).emit('user_typing', {
          user_id: userId,
          chat_id: chatId,
          typing: false
        });

      } catch (error) {
        logger.error('Typing stop failed:', error);
      }
    });

    socket.on('mark_messages_read', async (data) => {
      try {
        if (!socket.user) return;

        const { chatId } = data;
        const userId = socket.user.id;

        await chatService.markMessagesAsRead(chatId, userId);

        socket.to(`chat_${chatId}`).emit('messages_read', {
          user_id: userId,
          chat_id: chatId
        });

      } catch (error) {
        logger.error('Mark messages read failed:', error);
      }
    });

    // ================================
    // DISCONNECTION
    // ================================

    socket.on('disconnect', () => {
      try {
        const userId = socket.user?.id;
        
        if (userId) {
          // Remove from tracking
          connectedUsers.delete(userId);
          userSockets.delete(socket.id);

          // Broadcast user offline status
          socket.broadcast.emit('user_offline', {
            user_id: userId,
            username: socket.user.username
          });

          logger.info(`User ${userId} disconnected`);
        }

        logger.debug(`Socket disconnected: ${socket.id}`);

      } catch (error) {
        logger.error('Socket disconnect handler failed:', error);
      }
    });

    // ================================
    // ERROR HANDLING
    // ================================

    socket.on('error', (error) => {
      logger.error('Socket error:', error);
    });
  });

  // Store reference for other parts of the app
  io.connectedUsers = connectedUsers;
  io.userSockets = userSockets;

  logger.info('Socket.IO handlers configured');
};

// ================================
// MAIN STARTUP FUNCTION
// ================================

async function startServer() {
  try {
    logger.info('🚀 Starting VOID Marketplace API...');

    // Validate environment
    validateEnvironment();

    // ================================
    // 1. INITIALIZE DATABASE
    // ================================
    
    logger.info('🗃️  Initializing database connection...');
    const { initializeDatabase } = require('./config/db');
    
    await initializeDatabase();
    logger.info('✅ Database connected and ready');

    // ================================
    // 2. CREATE EXPRESS APP & HTTP SERVER
    // ================================
    
    const app = express();
    const server = createServer(app);

    // Add request ID to all requests
    app.use(addRequestId);

    // ================================
    // 3. INITIALIZE SOCKET.IO
    // ================================
    
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
      pingTimeout: 60000,
      pingInterval: 25000,
      transports: ['websocket', 'polling'],
      allowUpgrades: true,
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true,
      }
    });

    // Set up Socket.IO authentication and handlers
    io.use(authenticateSocket);
    setupSocketHandlers(io);

    logger.info('✅ Socket.IO server initialized');

    // ================================
    // 4. SECURITY MIDDLEWARE
    // ================================
    
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

    // ================================
    // 5. CORS CONFIGURATION
    // ================================
    
    app.use(cors({
      origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const allowedOrigins = process.env.FRONTEND_URLS?.split(',') || [
          'http://localhost:3000',
          'http://localhost:5173',
          'http://localhost:8081'
        ];
        
        if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
    }));

    // ================================
    // 6. RATE LIMITING
    // ================================
    
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: process.env.NODE_ENV === 'production' ? 100 : 1000,
      message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
      },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        // Skip rate limiting for certain routes in development
        if (process.env.NODE_ENV === 'development') {
          return req.path.includes('/health') || req.path.includes('/docs');
        }
        return false;
      }
    });

    app.use('/api/', limiter);

    // ================================
    // 7. GENERAL MIDDLEWARE
    // ================================
    
    app.use(compression());
    app.use(morgan('combined', {
      stream: {
        write: (message) => logger.info(message.trim())
      }
    }));
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // ================================
    // 8. STATIC FILES
    // ================================
    
    app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
      maxAge: process.env.NODE_ENV === 'production' ? '7d' : '0',
      etag: true,
      setHeaders: (res, filePath) => {
        // Add security headers for uploaded files
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
      }
    }));

    // ================================
    // 9. STORE IO INSTANCE
    // ================================
    
    app.set('io', io);

    // ================================
    // 10. HEALTH CHECK ROUTES
    // ================================
    
    app.get('/health', (req, res) => {
      res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0',
        services: {
          database: 'connected',
          redis: process.env.REDIS_URL ? 'configured' : 'not_configured',
          email: process.env.EMAIL_SERVICE ? 'configured' : 'not_configured',
          storage: process.env.AWS_S3_BUCKET ? 's3' : 'local'
        }
      });
    });

    app.get('/api/health', (req, res) => {
      res.json({
        api: 'operational',
        timestamp: new Date().toISOString()
      });
    });

    // ================================
    // 11. API ROUTES
    // ================================
    
    try {
      const routes = require('./routes');
      app.use('/api/v1', routes);
      logger.info('✅ API routes loaded successfully');
    } catch (error) {
      logger.error('Failed to load API routes:', error);
      throw new AppError('Failed to initialize API routes', 500);
    }

    // ================================
    // 12. ERROR HANDLING
    // ================================
    
    // 404 handler for undefined routes
    app.use(notFoundHandler);
    
    // Global error handler
    app.use(errorHandler);

    // ================================
    // 13. GRACEFUL SHUTDOWN HANDLERS
    // ================================
    
    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received, starting graceful shutdown...`);
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        // Close Socket.IO
        io.close(() => {
          logger.info('Socket.IO server closed');
        });
        
        // Close database connections
        try {
          const { prisma } = require('./config/db');
          await prisma.$disconnect();
          logger.info('Database connections closed');
        } catch (error) {
          logger.error('Error closing database connections:', error);
        }
        
        logger.info('Graceful shutdown completed');
        process.exit(0);
      });
      
      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forcing shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // ================================
    // 14. START SERVER
    // ================================
    
    const PORT = process.env.PORT || 5000;
    const HOST = process.env.HOST || '0.0.0.0';

    server.listen(PORT, HOST, () => {
      logger.info(`
🎉 VOID Marketplace API is running!
🌐 Server: http://${HOST}:${PORT}
🏥 Health: http://${HOST}:${PORT}/health
📚 API: http://${HOST}:${PORT}/api/v1
🔌 Socket.IO: Enabled
🗃️  Database: Connected
🛡️  Security: Enabled
📊 Monitoring: Enabled
      `);
    });

    // ================================
    // 15. INITIALIZE SERVICES
    // ================================
    
    // Initialize notification service
    try {
      const notificationService = require('./services/notificationService');
      notificationService.initializeEmailTransporter();
      logger.info('✅ Notification service initialized');
    } catch (error) {
      logger.warn('Notification service initialization failed:', error);
    }

    return { app, server, io };

  } catch (error) {
    logger.fatal('Failed to start server:', error);
    process.exit(1);
  }
}

// ================================
// START THE APPLICATION
// ================================

if (require.main === module) {
  startServer().catch((error) => {
    logger.fatal('Startup failed:', error);
    process.exit(1);
  });
}

module.exports = { startServer };