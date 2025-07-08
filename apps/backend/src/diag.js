// apps/backend/src/app.js
// DIAGNOSTIC VERSION - Find what's causing the crash

console.log('🚀 Starting VOID Marketplace API...');

// Test environment variables first
require('dotenv').config();
console.log('✅ Environment loaded');

// Test basic requires
try {
  const express = require('express');
  console.log('✅ Express loaded');
  
  const cors = require('cors');
  console.log('✅ CORS loaded');
  
  const helmet = require('helmet');
  console.log('✅ Helmet loaded');
  
  const morgan = require('morgan');
  console.log('✅ Morgan loaded');
  
  const compression = require('compression');
  console.log('✅ Compression loaded');
  
  const rateLimit = require('express-rate-limit');
  console.log('✅ Rate limit loaded');
  
} catch (error) {
  console.error('❌ Failed to load basic dependencies:', error.message);
  process.exit(1);
}

// Test Prisma
try {
  console.log('🗃️  Testing database connection...');
  const { prisma, initializeDatabase } = require('./config/db');
  console.log('✅ Database config loaded');
  
  // Test database connection
  initializeDatabase()
    .then(() => {
      console.log('✅ Database connected successfully');
      startServer();
    })
    .catch((error) => {
      console.error('❌ Database connection failed:', error.message);
      console.log('🔧 Database troubleshooting:');
      console.log('1. Check if PostgreSQL is running');
      console.log('2. Verify DATABASE_URL in .env');
      console.log('3. Make sure database exists');
      console.log('4. Run: npx prisma db push');
      
      // Start server anyway for testing
      console.log('⚠️  Starting server without database...');
      startServerWithoutDB();
    });
    
} catch (error) {
  console.error('❌ Failed to load database config:', error.message);
  console.log('⚠️  Starting server without database...');
  startServerWithoutDB();
}

function startServer() {
  try {
    console.log('🌐 Setting up Express server...');
    
    const express = require('express');
    const cors = require('cors');
    const helmet = require('helmet');
    const morgan = require('morgan');
    const compression = require('compression');
    const rateLimit = require('express-rate-limit');
    const { createServer } = require('http');
    const { Server } = require('socket.io');
    // Initialize Express app
    const app = express();
    const server = createServer(app);
    console.log('✅ Express app created');

    // Initialize Socket.IO
    const io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URLS?.split(',') || ["http://localhost:3000", "http://localhost:5173"],
        credentials: true
      }
    });
    console.log('✅ Socket.IO initialized');

    // Security middleware
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
    console.log('✅ Security middleware loaded');

    // CORS configuration
    app.use(cors({
      origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const allowedOrigins = process.env.FRONTEND_URLS?.split(',') || [
          'http://localhost:3000',
          'http://localhost:5173',
          'http://localhost:8081'
        ];
        
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, true); // Allow all origins in development
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
    }));
    console.log('✅ CORS configured');

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: process.env.NODE_ENV === 'production' ? 100 : 1000,
      message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
      },
      standardHeaders: true,
      legacyHeaders: false,
    });

    app.use('/api/', limiter);
    console.log('✅ Rate limiting configured');

    // General middleware
    app.use(compression());
    app.use(morgan('dev'));
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    console.log('✅ General middleware loaded');

    // Static files
    app.use('/uploads', express.static('uploads', {
      maxAge: process.env.NODE_ENV === 'production' ? '7d' : '0',
      etag: true
    }));
    console.log('✅ Static file serving configured');

    // Store io instance
    app.set('io', io);

    // Basic health check
    app.get('/health', (req, res) => {
      res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0',
        database: 'connected'
      });
    });
    console.log('✅ Health check route added');

    // Test route
    app.get('/test', (req, res) => {
      res.json({
        message: 'VOID Marketplace API is working!',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV
      });
    });
    console.log('✅ Test route added');

    // Load API routes
    try {
      const routes = require('./routes');
      app.use('/api/v1', routes);
      console.log('✅ API routes loaded');
    } catch (error) {
      console.error('⚠️  Failed to load API routes:', error.message);
      console.log('🔧 API will work without full routes');
    }

    // 404 handler
    app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Route not found',
        message: `The requested endpoint ${req.method} ${req.originalUrl} does not exist.`,
        availableEndpoints: ['/health', '/test', '/api/v1/auth', '/api/v1/listings']
      });
    });

    // Error handler
    app.use((error, req, res, next) => {
      console.error('Express Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    });

    // Start server
    const PORT = process.env.PORT || 5000;
    const HOST = process.env.HOST || '0.0.0.0';

    server.listen(PORT, HOST, () => {
      console.log('\n🎉 SUCCESS! VOID Marketplace API is running!');
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 Server: http://${HOST}:${PORT}`);
      console.log(`📊 Health: http://${HOST}:${PORT}/health`);
      console.log(`🧪 Test: http://${HOST}:${PORT}/test`);
      console.log(`🔗 API: http://${HOST}:${PORT}/api/v1`);
      console.log(`🔐 Auth: http://${HOST}:${PORT}/api/v1/auth`);
      console.log(`📝 Listings: http://${HOST}:${PORT}/api/v1/listings`);
      console.log('\n✅ Ready for connections!');
    });

    // Socket.IO connection handling
    io.on('connection', (socket) => {
      console.log(`🔌 Socket connected: ${socket.id}`);
      
      socket.on('disconnect', () => {
        console.log(`🔌 Socket disconnected: ${socket.id}`);
      });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

function startServerWithoutDB() {
  console.log('⚠️  Starting in fallback mode (no database)...');
  
  try {
    const express = require('express');
    const app = express();
    
    app.use(express.json());
    
    app.get('/health', (req, res) => {
      res.json({
        success: false,
        status: 'degraded',
        message: 'Server running but database not connected',
        timestamp: new Date().toISOString()
      });
    });
    
    app.get('/test', (req, res) => {
      res.json({
        message: 'Server is running but database connection failed',
        timestamp: new Date().toISOString()
      });
    });
    
    const PORT = process.env.PORT || 5000;
    
    app.listen(PORT, () => {
      console.log(`⚠️  Fallback server running on port ${PORT}`);
      console.log(`🧪 Test: http://localhost:${PORT}/test`);
      console.log('❌ Database connection required for full functionality');
    });
    
  } catch (error) {
    console.error('❌ Failed to start fallback server:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});