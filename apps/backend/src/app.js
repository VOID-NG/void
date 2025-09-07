// apps/backend/src/app.js
// Complete Express application factory for VOID Marketplace

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

// Import utilities and middleware
const logger = require('./utils/logger');
const { 
  errorHandler, 
  notFoundHandler, 
  addRequestId,
  AppError 
} = require('./middleware/errorMiddleware');

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
    const { dbRouter } = require('./config/db');
    const user = await dbRouter.user.findUnique({
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

    if (!user) {
      return next(new Error('User not found'));
    }

    if (user.status === 'BANNED' || user.status === 'SUSPENDED') {
      return next(new Error('Account suspended'));
    }

    socket.user = user;
    socket.userId = user.id;
    
    logger.info('Socket authenticated', { 
      userId: user.id, 
      username: user.username,
      socketId: socket.id 
    });
    
    next();
  } catch (error) {
    logger.error('Socket authentication failed:', error);
    next(new Error('Authentication failed'));
  }
};

// ================================
// SOCKET.IO EVENT HANDLERS
// ================================

const setupSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    logger.info('Client connected', { 
      socketId: socket.id, 
      userId: socket.user?.id || 'anonymous' 
    });

    // Join user to their personal room for notifications
    if (socket.user) {
      socket.join(`user_${socket.user.id}`);
      
      // Join vendor room if applicable
      if (socket.user.role === 'VENDOR' || socket.user.role === 'ADMIN' || socket.user.role === 'SUPER_ADMIN') {
        socket.join(`vendor_${socket.user.id}`);
      }
    }

    // Chat event handlers
    socket.on('join_chat', async (data) => {
      try {
        const { chatId } = data;
        if (!chatId) return;

        // Verify user has access to this chat
        const { dbRouter } = require('./config/db');
        const chat = await dbRouter.chat.findFirst({
          where: {
            id: chatId,
            OR: [
              { buyer_id: socket.user?.id },
              { vendor_id: socket.user?.id }
            ]
          }
        });

        if (chat) {
          socket.join(`chat_${chatId}`);
          socket.emit('chat_joined', { chatId });
          logger.info('User joined chat', { userId: socket.user?.id, chatId });
        }
      } catch (error) {
        logger.error('Join chat error:', error);
        socket.emit('error', { message: 'Failed to join chat' });
      }
    });

    socket.on('leave_chat', (data) => {
      const { chatId } = data;
      if (chatId) {
        socket.leave(`chat_${chatId}`);
        socket.emit('chat_left', { chatId });
      }
    });

    socket.on('send_message', async (data) => {
      try {
        const { chatId, content, type = 'TEXT' } = data;
        
        if (!socket.user) {
          return socket.emit('error', { message: 'Authentication required' });
        }

        // Import message service
        const messageService = require('./services/messageService');
        const message = await messageService.createMessage({
          chat_id: chatId,
          sender_id: socket.user.id,
          content,
          type
        });

        // Emit to all users in the chat
        io.to(`chat_${chatId}`).emit('new_message', { message });
        
        logger.info('Message sent', { 
          chatId, 
          senderId: socket.user.id, 
          messageId: message.id 
        });

      } catch (error) {
        logger.error('Send message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('typing_start', (data) => {
      const { chatId } = data;
      if (chatId && socket.user) {
        socket.to(`chat_${chatId}`).emit('user_typing', {
          userId: socket.user.id,
          username: socket.user.username,
          chatId
        });
      }
    });

    socket.on('typing_stop', (data) => {
      const { chatId } = data;
      if (chatId && socket.user) {
        socket.to(`chat_${chatId}`).emit('user_stopped_typing', {
          userId: socket.user.id,
          chatId
        });
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info('Client disconnected', { 
        socketId: socket.id, 
        userId: socket.user?.id || 'anonymous',
        reason 
      });
    });
  });

  logger.info('✅ Socket.IO event handlers configured');
};

// ================================
// APPLICATION FACTORY
// ================================

const createApp = async () => {
  try {
    logger.info('🏗️  Creating Express application...');

    // ================================
    // 1. INITIALIZE DATABASE
    // ================================
    
    const { initializeDatabase } = require('./config/db');
    await initializeDatabase();
    logger.info('✅ Database connected and ready');

    // ================================
    // 2. CREATE EXPRESS APP & HTTP SERVER
    // ================================
    
    const app = express();
    const httpServer = createServer(app);

    // Store server reference for Socket.IO
    app.set('server', httpServer);

    // Add request ID to all requests
    app.use(addRequestId);

    // ================================
    // 3. INITIALIZE SOCKET.IO
    // ================================
    
    const io = new Server(httpServer, {
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

    // Make io available to routes
    app.set('io', io);

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
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || (process.env.NODE_ENV === 'production' ? 100 : 1000),
      message: {
        error: 'Too many requests from this IP, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
      },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/api/v1/health' || req.path === '/api/v1';
      }
    });

    app.use('/api/', limiter);

    // ================================
    // 7. GENERAL MIDDLEWARE
    // ================================
    
    // Logging
    if (process.env.NODE_ENV !== 'test') {
      app.use(morgan('combined', {
        stream: {
          write: (message) => logger.info(message.trim())
        }
      }));
    }

    // Compression
    app.use(compression());

    // Body parsing
    app.use(express.json({ 
      limit: '10mb',
      type: ['application/json', 'text/plain']
    }));
    app.use(express.urlencoded({ 
      extended: true, 
      limit: '10mb' 
    }));

    // Static file serving
    app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
      maxAge: '1d',
      etag: true,
      lastModified: true
    }));

    // ================================
    // 8. API ROUTES
    // ================================
    
    // Import all routes
    const apiRoutes = require('./routes');
    app.use('/api/v1', apiRoutes);

    // Root endpoint
    app.get('/', (req, res) => {
      res.json({
        message: 'VOID Marketplace API',
        version: '1.0.0',
        status: 'operational',
        documentation: '/api/v1',
        health: '/api/v1/health'
      });
    });

    // ================================
    // 9. ERROR HANDLING
    // ================================
    
    // 404 handler
    app.use(notFoundHandler);

    // Global error handler
    app.use(errorHandler);

    logger.info('✅ Express application created successfully');
    
    return { app, httpServer, io };

  } catch (error) {
    logger.error('❌ Failed to create application:', error);
    throw error;
  }
};

// ================================
// UTILITY FUNCTIONS FOR SOCKET.IO
// ================================

const emitToUser = (io, userId, event, data) => {
  try {
    io.to(`user_${userId}`).emit(event, data);
    logger.info('Event emitted to user', { userId, event });
  } catch (error) {
    logger.error('Failed to emit to user:', error);
  }
};

const emitToChat = (io, chatId, event, data) => {
  try {
    io.to(`chat_${chatId}`).emit(event, data);
    logger.info('Event emitted to chat', { chatId, event });
  } catch (error) {
    logger.error('Failed to emit to chat:', error);
  }
};

module.exports = { 
  createApp, 
  authenticateSocket, 
  setupSocketHandlers,
  emitToUser,
  emitToChat 
};