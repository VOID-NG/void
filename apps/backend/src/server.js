#!/usr/bin/env node
// apps/backend/server.js
// Unified server entry point for VOID Marketplace

require('dotenv').config();
const logger = require('./src/utils/logger');

// ================================
// ENVIRONMENT VALIDATION
// ================================

const validateEnvironment = () => {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter(var_name => !process.env[var_name]);
  
  if (missing.length > 0) {
    logger.error('Missing required environment variables:', missing);
    logger.error('Please check your .env file and ensure all required variables are set');
    process.exit(1);
  }
  
  logger.info('✅ Environment validation passed');
};

// ================================
// GRACEFUL SHUTDOWN HANDLING
// ================================

let server;

const gracefulShutdown = (signal) => {
  logger.info(`${signal} received, starting graceful shutdown...`);
  
  if (server) {
    server.close(async (error) => {
      if (error) {
        logger.error('Error during server shutdown:', error);
        process.exit(1);
      }
      
      try {
        // Close database connections
        const { disconnectDatabase } = require('./src/config/db');
        await disconnectDatabase();
        logger.info('✅ Database connections closed');
        
        // Close other connections (Redis, etc.)
        // Add other cleanup tasks here
        
        logger.info('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (cleanupError) {
        logger.error('Error during cleanup:', cleanupError);
        process.exit(1);
      }
    });
  } else {
    process.exit(0);
  }
};

// ================================
// ERROR HANDLING
// ================================

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ================================
// APPLICATION STARTUP
// ================================

const startApplication = async () => {
  try {
    logger.info('🚀 Starting VOID Marketplace Backend...');
    
    // Validate environment
    validateEnvironment();
    
    // Import and start the main application
    const { createApp } = require('./src/app');
    const { app, httpServer } = await createApp();
    
    // Start the server
    const PORT = process.env.PORT || 5000;
    const HOST = process.env.HOST || '0.0.0.0';
    
    server = httpServer.listen(PORT, HOST, () => {
      logger.info(`🌐 Server running on ${HOST}:${PORT}`);
      logger.info(`📚 API Documentation: http://${HOST}:${PORT}/api/v1`);
      logger.info(`🏥 Health Check: http://${HOST}:${PORT}/api/v1/health`);
      logger.info(`🎯 Environment: ${process.env.NODE_ENV || 'development'}`);
      
      // Production deployment info
      if (process.env.NODE_ENV === 'production') {
        logger.info('🔒 Running in production mode');
        logger.info('📊 Monitoring enabled');
      } else {
        logger.info('🛠️  Running in development mode');
        logger.info('🧪 Debug features enabled');
      }
    });
    
    // Handle server errors
    server.on('error', (error) => {
      if (error.syscall !== 'listen') {
        throw error;
      }
      
      const bind = typeof PORT === 'string' ? 'Pipe ' + PORT : 'Port ' + PORT;
      
      switch (error.code) {
        case 'EACCES':
          logger.error(`${bind} requires elevated privileges`);
          process.exit(1);
          break;
        case 'EADDRINUSE':
          logger.error(`${bind} is already in use`);
          process.exit(1);
          break;
        default:
          throw error;
      }
    });
    
  } catch (error) {
    logger.error('❌ Failed to start application:', error);
    
    // Provide helpful error messages
    if (error.message.includes('connect ECONNREFUSED')) {
      logger.error('💡 Database connection failed. Please ensure PostgreSQL is running and DATABASE_URL is correct.');
    } else if (error.message.includes('JWT_SECRET')) {
      logger.error('💡 JWT configuration missing. Please check your .env file.');
    }
    
    process.exit(1);
  }
};

// ================================
// START THE APPLICATION
// ================================

if (require.main === module) {
  startApplication();
}

module.exports = { startApplication, gracefulShutdown };