// server.js
// Main entry point for Void Marketplace Backend
// Nigerian-optimized marketplace with comprehensive payment integration

const path = require('path');
const cluster = require('cluster');
const os = require('os');

// Load environment variables first
require('dotenv').config();

// Import core modules
const logger = require('./src/utils/logger');
const { initializeDatabase } = require('./src/config/db');

// Global error handling
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception - shutting down application:', {
    error: error.message,
    stack: error.stack
  });
  
  // Give time for logger to write
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at Promise:', {
    reason: reason,
    promise: promise
  });
  
  // Give time for logger to write
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// ================================
// CLUSTER SETUP FOR PRODUCTION
// ================================

const CLUSTER_MODE = process.env.CLUSTER_MODE === 'true';
const NUM_WORKERS = process.env.NUM_WORKERS || os.cpus().length;

if (CLUSTER_MODE && cluster.isMaster) {
  logger.info(`🚀 Starting Void Marketplace in cluster mode with ${NUM_WORKERS} workers`);
  
  // Fork workers
  for (let i = 0; i < NUM_WORKERS; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
    logger.info('Starting a new worker...');
    cluster.fork();
  });
  
  cluster.on('online', (worker) => {
    logger.info(`Worker ${worker.process.pid} is online`);
  });
  
} else {
  // Single process or worker process
  startServer();
}

// ================================
// MAIN SERVER STARTUP FUNCTION
// ================================

async function startServer() {
  try {
    logger.info('🚀 Initializing Void Marketplace Backend...');
    
    // Display startup banner
    displayBanner();
    
    // ================================
    // 1. VALIDATE ENVIRONMENT
    // ================================
    
    await validateEnvironment();
    logger.info('✅ Environment validation passed');
    
    // ================================
    // 2. INITIALIZE DATABASE
    // ================================
    
    logger.info('🗃️  Connecting to database...');
    await initializeDatabase();
    logger.info('✅ Database connected successfully');
    
    // ================================
    // 3. INITIALIZE REDIS (if enabled)
    // ================================
    
    if (process.env.REDIS_URL) {
      try {
        const redis = require('./src/config/redis');
        await redis.connect();
        logger.info('✅ Redis connected successfully');
      } catch (error) {
        logger.warn('⚠️  Redis connection failed, continuing without cache:', error.message);
      }
    }
    
    // ================================
    // 4. INITIALIZE PAYMENT PROVIDERS
    // ================================
    
    logger.info('💳 Initializing Nigerian payment providers...');
    await initializePaymentProviders();
    logger.info('✅ Payment providers initialized');
    
    // ================================
    // 5. START EXPRESS APP
    // ================================
    
    logger.info('🌐 Starting Express server...');
    const app = await require('./src/app')();
    
    // ================================
    // 6. START HTTP SERVER
    // ================================
    
    const PORT = process.env.PORT || 5000;
    const HOST = process.env.HOST || '0.0.0.0';
    
    const server = app.listen(PORT, HOST, () => {
      logger.info('🎉 VOID MARKETPLACE STARTED SUCCESSFULLY!');
      logger.info(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🌐 Server: http://${HOST}:${PORT}`);
      logger.info(`📊 Health: http://${HOST}:${PORT}/health`);
      logger.info(`🔗 API: http://${HOST}:${PORT}/api/v1`);
      logger.info(`🔐 Auth: http://${HOST}:${PORT}/api/v1/auth`);
      logger.info(`📝 Listings: http://${HOST}:${PORT}/api/v1/listings`);
      logger.info(`💬 Chat: WebSocket enabled on port ${PORT}`);
      logger.info(`💳 Nigerian Payment Providers: Paystack, Flutterwave, Opay`);
      logger.info(`🇳🇬 Nigerian Market Features: NGN currency, mobile money, USSD`);
      
      if (cluster.worker) {
        logger.info(`👷 Worker ID: ${cluster.worker.id} | PID: ${process.pid}`);
      }
      
      logger.info('✅ Ready for connections!');
    });
    
    // ================================
    // 7. SETUP GRACEFUL SHUTDOWN
    // ================================
    
    setupGracefulShutdown(server);
    
    // ================================
    // 8. SETUP MONITORING & HEALTH CHECKS
    // ================================
    
    if (process.env.NODE_ENV === 'production') {
      setupMonitoring();
    }
    
    // ================================
    // 9. SETUP SCHEDULED TASKS
    // ================================
    
    setupScheduledTasks();
    
  } catch (error) {
    logger.error('❌ Failed to start server:', {
      error: error.message,
      stack: error.stack
    });
    
    // Try fallback mode
    await startFallbackServer();
  }
}

// ================================
// HELPER FUNCTIONS
// ================================

function displayBanner() {
  const banner = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║  ██╗   ██╗ ██████╗ ██╗██████╗     ███╗   ███╗ █████╗ ██████╗ ██╗  ██╗███████╗║
║  ██║   ██║██╔═══██╗██║██╔══██╗    ████╗ ████║██╔══██╗██╔══██╗██║ ██╔╝██╔════╝║
║  ██║   ██║██║   ██║██║██║  ██║    ██╔████╔██║███████║██████╔╝█████╔╝ █████╗  ║
║  ╚██╗ ██╔╝██║   ██║██║██║  ██║    ██║╚██╔╝██║██╔══██║██╔══██╗██╔═██╗ ██╔══╝  ║
║   ╚████╔╝ ╚██████╔╝██║██████╔╝    ██║ ╚═╝ ██║██║  ██║██║  ██║██║  ██╗███████╗║
║    ╚═══╝   ╚═════╝ ╚═╝╚═════╝     ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝║
║                                                                              ║
║                       🇳🇬 NIGERIAN MARKETPLACE BACKEND 🇳🇬                   ║
║                                                                              ║
║               Powered by: Express.js + PostgreSQL + Socket.IO               ║
║               Payments: Paystack + Flutterwave + Opay + Mobile Money        ║
║               Features: AI Search + Chat + Escrow + NGN Support             ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;
  
  console.log(banner);
  logger.info('Void Marketplace Backend Starting...');
}

async function validateEnvironment() {
  const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'PAYSTACK_SECRET_KEY',
    'FLUTTERWAVE_SECRET_KEY'
  ];
  
  const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
  
  // Validate JWT secret strength
  if (process.env.JWT_SECRET.length < 32) {
    logger.warn('⚠️  JWT_SECRET should be at least 32 characters long for better security');
  }
  
  // Validate Nigerian payment provider keys
  if (!process.env.PAYSTACK_PUBLIC_KEY) {
    logger.warn('⚠️  PAYSTACK_PUBLIC_KEY not set - frontend payments may not work');
  }
  
  if (!process.env.FLUTTERWAVE_PUBLIC_KEY) {
    logger.warn('⚠️  FLUTTERWAVE_PUBLIC_KEY not set - frontend payments may not work');
  }
}

async function initializePaymentProviders() {
  try {
    // Initialize Paystack
    if (process.env.PAYSTACK_SECRET_KEY) {
      const PaystackService = require('./src/services/PaystackService');
      await PaystackService.initialize();
      logger.info('✅ Paystack initialized');
    }
    
    // Initialize Flutterwave
    if (process.env.FLUTTERWAVE_SECRET_KEY) {
      const FlutterwaveService = require('./src/services/FlutterwaveService');
      await FlutterwaveService.initialize();
      logger.info('✅ Flutterwave initialized');
    }
    
    // Initialize Opay
    if (process.env.OPAY_MERCHANT_ID) {
      const OpayService = require('./src/services/OpayService');
      await OpayService.initialize();
      logger.info('✅ Opay initialized');
    }
    
  } catch (error) {
    logger.warn('⚠️  Some payment providers failed to initialize:', error.message);
  }
}

function setupGracefulShutdown(server) {
  const gracefulShutdown = (signal) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    // Stop accepting new connections
    server.close(async (err) => {
      if (err) {
        logger.error('Error during server shutdown:', err);
        return process.exit(1);
      }
      
      try {
        // Close database connections
        const { prisma } = require('./src/config/db');
        await prisma.$disconnect();
        logger.info('✅ Database connections closed');
        
        // Close Redis connections
        if (process.env.REDIS_URL) {
          const redis = require('./src/config/redis');
          await redis.disconnect();
          logger.info('✅ Redis connections closed');
        }
        
        logger.info('✅ Graceful shutdown completed');
        process.exit(0);
        
      } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  };
  
  // Listen for termination signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Nodemon restart
}

function setupMonitoring() {
  // Setup error tracking
  if (process.env.SENTRY_DSN) {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV
    });
    logger.info('✅ Sentry error tracking initialized');
  }
  
  // Setup New Relic
  if (process.env.NEW_RELIC_LICENSE_KEY) {
    require('newrelic');
    logger.info('✅ New Relic monitoring initialized');
  }
}

function setupScheduledTasks() {
  const cron = require('node-cron');
  
  // Auto-release escrow every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const transactionService = require('./src/services/transactionService');
      await transactionService.autoReleaseEscrow();
      logger.info('✅ Auto-release escrow task completed');
    } catch (error) {
      logger.error('❌ Auto-release escrow task failed:', error);
    }
  });
  
  // Clean expired tokens daily at 2 AM WAT
  cron.schedule('0 2 * * *', async () => {
    try {
      const tokenService = require('./src/services/tokenService');
      await tokenService.cleanExpiredTokens();
      logger.info('✅ Token cleanup task completed');
    } catch (error) {
      logger.error('❌ Token cleanup task failed:', error);
    }
  }, {
    timezone: "Africa/Lagos"
  });
  
  // Generate daily analytics at 1 AM WAT
  cron.schedule('0 1 * * *', async () => {
    try {
      const analyticsService = require('./src/services/analyticsService');
      await analyticsService.generateDailyReport();
      logger.info('✅ Daily analytics generation completed');
    } catch (error) {
      logger.error('❌ Daily analytics generation failed:', error);
    }
  }, {
    timezone: "Africa/Lagos"
  });
  
  logger.info('✅ Scheduled tasks initialized');
}

async function startFallbackServer() {
  logger.warn('🆘 Starting in fallback mode (limited functionality)...');
  
  try {
    const express = require('express');
    const app = express();
    
    app.use(express.json());
    
    app.get('/health', (req, res) => {
      res.json({
        success: false,
        status: 'degraded',
        message: 'Server running in fallback mode - database connection failed',
        timestamp: new Date().toISOString(),
        fallback: true
      });
    });
    
    app.get('/test', (req, res) => {
      res.json({
        message: 'Void Marketplace Backend is running in fallback mode',
        timestamp: new Date().toISOString(),
        status: 'limited_functionality'
      });
    });
    
    app.use('*', (req, res) => {
      res.status(503).json({
        success: false,
        error: 'Service temporarily unavailable',
        message: 'Server is running in fallback mode. Please try again later.',
        fallback: true
      });
    });
    
    const PORT = process.env.PORT || 5000;
    
    app.listen(PORT, () => {
      logger.warn(`⚠️  Fallback server running on port ${PORT}`);
      logger.warn('🔧 Limited functionality - fix database connection for full features');
    });
    
  } catch (error) {
    logger.error('❌ Failed to start fallback server:', error);
    process.exit(1);
  }
}