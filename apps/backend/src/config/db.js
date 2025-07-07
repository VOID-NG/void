// apps/backend/src/config/db.js
// Database configuration and Prisma client setup

const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

// Create Prisma client with logging configuration
const prisma = new PrismaClient({
  log: [
    {
      emit: 'event',
      level: 'query',
    },
    {
      emit: 'event',
      level: 'error',
    },
    {
      emit: 'event',
      level: 'info',
    },
    {
      emit: 'event',
      level: 'warn',
    },
  ],
  errorFormat: 'colorless',
});

// Log database queries in development
if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    logger.debug(`Query: ${e.query}`);
    logger.debug(`Params: ${e.params}`);
    logger.debug(`Duration: ${e.duration}ms`);
  });
}

// Log database errors
prisma.$on('error', (e) => {
  logger.error('Database Error:', e);
});

// Log database info
prisma.$on('info', (e) => {
  logger.info('Database Info:', e.message);
});

// Log database warnings
prisma.$on('warn', (e) => {
  logger.warn('Database Warning:', e.message);
});

// Database connection test
const testConnection = async () => {
  try {
    await prisma.$connect();
    logger.info('✅ Database connected successfully');
    
    // Test a simple query
    await prisma.$queryRaw`SELECT 1`;
    logger.info('✅ Database query test successful');
    
    return true;
  } catch (error) {
    logger.error('❌ Database connection failed:', error.message);
    return false;
  }
};

// Initialize database connection
const initializeDatabase = async () => {
  const isConnected = await testConnection();
  
  if (!isConnected) {
    logger.error('Failed to connect to database. Exiting...');
    process.exit(1);
  }

  // Enable pgvector extension if not already enabled
  try {
    await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS vector`;
    logger.info('✅ pgvector extension enabled');
  } catch (error) {
    logger.warn('pgvector extension setup warning:', error.message);
  }

  return prisma;
};

// Graceful shutdown
const disconnect = async () => {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected gracefully');
  } catch (error) {
    logger.error('Error disconnecting from database:', error);
  }
};

// Database utility functions
const dbUtils = {
  // Health check
  healthCheck: async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'healthy', timestamp: new Date() };
    } catch (error) {
      return { status: 'unhealthy', error: error.message, timestamp: new Date() };
    }
  },

  // Get database stats
  getStats: async () => {
    try {
      const [
        userCount,
        listingCount,
        transactionCount,
        chatCount
      ] = await Promise.all([
        prisma.user.count(),
        prisma.listing.count(),
        prisma.transaction.count(),
        prisma.chat.count()
      ]);

      return {
        users: userCount,
        listings: listingCount,
        transactions: transactionCount,
        chats: chatCount,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Error getting database stats:', error);
      return null;
    }
  },

  // Clean up old data (for maintenance)
  cleanup: async () => {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Clean up old notifications
      const deletedNotifications = await prisma.notification.deleteMany({
        where: {
          is_read: true,
          created_at: {
            lt: thirtyDaysAgo
          }
        }
      });

      // Clean up old user interactions (keep only recent 90 days)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const deletedInteractions = await prisma.userInteraction.deleteMany({
        where: {
          created_at: {
            lt: ninetyDaysAgo
          }
        }
      });

      logger.info(`Cleanup completed: ${deletedNotifications.count} notifications, ${deletedInteractions.count} interactions`);
      
      return {
        deletedNotifications: deletedNotifications.count,
        deletedInteractions: deletedInteractions.count
      };
    } catch (error) {
      logger.error('Error during cleanup:', error);
      throw error;
    }
  }
};

module.exports = {
  prisma,
  initializeDatabase,
  disconnect,
  testConnection,
  dbUtils
};