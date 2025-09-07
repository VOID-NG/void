// apps/backend/src/config/db.js
// Complete database configuration and initialization for VOID Marketplace

const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

// ================================
// PRISMA CLIENT CONFIGURATION
// ================================

const prismaConfig = {
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
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
};

// Add additional configuration for production
if (process.env.NODE_ENV === 'production') {
  prismaConfig.log = ['error', 'warn'];
}

// Create Prisma client instance
const prisma = new PrismaClient(prismaConfig);

// ================================
// EVENT LISTENERS
// ================================

// Log database queries in development
if (process.env.NODE_ENV === 'development' && process.env.LOG_DB_QUERIES === 'true') {
  dbRouter.$on('query', (e) => {
    logger.db(e.query, e.params, e.duration);
  });
}

// Log database errors
dbRouter.$on('error', (e) => {
  logger.error('Database Error:', {
    error: e.message,
    target: e.target,
    category: 'database_error'
  });
});

// Log database info events
dbRouter.$on('info', (e) => {
  logger.info('Database Info:', {
    message: e.message,
    category: 'database_info'
  });
});

// Log database warnings
dbRouter.$on('warn', (e) => {
  logger.warn('Database Warning:', {
    message: e.message,
    category: 'database_warning'
  });
});

// ================================
// CONNECTION MANAGEMENT
// ================================

/**
 * Test database connection
 * @returns {Promise<boolean>} Connection success
 */
const testConnection = async () => {
  try {
    await dbRouter.$connect();
    logger.info('✅ Database connected successfully');
    
    // Test a simple query
    await dbRouter.$queryRaw`SELECT 1 as test`;
    logger.info('✅ Database query test successful');
    
    return true;
  } catch (error) {
    logger.error('❌ Database connection failed:', {
      error: error.message,
      code: error.code,
      meta: error.meta
    });
    return false;
  }
};

/**
 * Initialize database connection and run migrations
 * @returns {Promise<void>}
 */
const initializeDatabase = async () => {
  try {
    logger.info('🗃️  Initializing database...');

    // Test connection
    const isConnected = await testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to database');
    }

    // Check if database is accessible
    await checkDatabaseAccess();

    // Run health checks
    await runHealthChecks();

    logger.info('✅ Database initialization completed successfully');
  } catch (error) {
    logger.error('❌ Database initialization failed:', error);
    
    // Provide helpful troubleshooting info
    logger.info('🔧 Database troubleshooting steps:');
    logger.info('1. Check if PostgreSQL is running');
    logger.info('2. Verify DATABASE_URL in .env file');
    logger.info('3. Ensure database exists and user has permissions');
    logger.info('4. Run: npx prisma migrate dev --name init');
    logger.info('5. Run: npx prisma generate');
    
    throw error;
  }
};

/**
 * Check database access and permissions
 * @returns {Promise<void>}
 */
const checkDatabaseAccess = async () => {
  try {
    // Check if we can create and drop a test table
    await dbRouter.$executeRaw`
      CREATE TABLE IF NOT EXISTS health_check_test (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    
    await dbRouter.$executeRaw`DROP TABLE IF EXISTS health_check_test`;
    
    logger.info('✅ Database permissions verified');
  } catch (error) {
    logger.warn('⚠️  Database permission check failed:', error.message);
    // Don't throw error here as tables might not exist yet
  }
};

/**
 * Run database health checks
 * @returns {Promise<void>}
 */
const runHealthChecks = async () => {
  try {
    // Check if main tables exist
    const tableChecks = await Promise.allSettled([
      checkTableExists('User'),
      checkTableExists('Listing'),
      checkTableExists('Chat'),
      checkTableExists('Transaction'),
      checkTableExists('Category')
    ]);

    const existingTables = tableChecks
      .filter(result => result.status === 'fulfilled' && result.value)
      .length;

    logger.info(`📊 Database tables check: ${existingTables}/5 core tables exist`);

    if (existingTables === 0) {
      logger.warn('⚠️  No core tables found. You may need to run migrations:');
      logger.info('   npx prisma migrate dev --name init');
    }

    // Check database size and performance
    await checkDatabaseStats();

  } catch (error) {
    logger.warn('Database health checks failed:', error.message);
  }
};

/**
 * Check if a table exists
 * @param {string} tableName - Table name to check
 * @returns {Promise<boolean>} Table exists
 */
const checkTableExists = async (tableName) => {
  try {
    const result = await dbRouter.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = ${tableName.toLowerCase()}
      )
    `;
    
    return result[0]?.exists || false;
  } catch (error) {
    return false;
  }
};

/**
 * Get database statistics
 * @returns {Promise<void>}
 */
const checkDatabaseStats = async () => {
  try {
    // Get database size
    const sizeResult = await dbRouter.$queryRaw`
      SELECT 
        pg_size_pretty(pg_database_size(current_database())) as size
    `;

    // Get connection count
    const connectionResult = await dbRouter.$queryRaw`
      SELECT 
        count(*) as active_connections 
      FROM pg_stat_activity 
      WHERE state = 'active'
    `;

    logger.info('📈 Database statistics:', {
      size: sizeResult[0]?.size || 'unknown',
      active_connections: Number(connectionResult[0]?.active_connections) || 0,
      max_connections: process.env.DB_POOL_MAX || 10
    });

  } catch (error) {
    logger.debug('Could not retrieve database stats:', error.message);
  }
};

// ================================
// DATABASE SEEDING
// ================================

/**
 * Seed database with initial data
 * @returns {Promise<void>}
 */
const seedDatabase = async () => {
  try {
    logger.info('🌱 Seeding database with initial data...');

    // Check if data already exists
    const userCount = await dbRouter.user.count();
    if (userCount > 0) {
      logger.info('Database already contains data, skipping seed');
      return;
    }

    // Seed categories
    await seedCategories();

    // Seed admin user
    await seedAdminUser();

    // Seed sample data in development
    if (process.env.NODE_ENV === 'development') {
      await seedSampleData();
    }

    logger.info('✅ Database seeding completed');

  } catch (error) {
    logger.error('Database seeding failed:', error);
    throw error;
  }
};

/**
 * Seed initial categories
 * @returns {Promise<void>}
 */
const seedCategories = async () => {
  try {
    const categories = [
      { name: 'Electronics', description: 'Electronic devices and gadgets' },
      { name: 'Fashion', description: 'Clothing, shoes, and accessories' },
      { name: 'Home & Garden', description: 'Home decor and garden supplies' },
      { name: 'Sports & Outdoors', description: 'Sports equipment and outdoor gear' },
      { name: 'Books & Media', description: 'Books, movies, and music' },
      { name: 'Toys & Games', description: 'Toys and gaming equipment' },
      { name: 'Automotive', description: 'Car parts and accessories' },
      { name: 'Health & Beauty', description: 'Health and beauty products' },
      { name: 'Collectibles', description: 'Rare and collectible items' },
      { name: 'Other', description: 'Miscellaneous items' }
    ];

    for (const category of categories) {
      await dbRouter.category.upsert({
        where: { name: category.name },
        update: {},
        create: category
      });
    }

    logger.info('✅ Categories seeded successfully');
  } catch (error) {
    logger.error('Category seeding failed:', error);
    throw error;
  }
};

/**
 * Seed admin user
 * @returns {Promise<void>}
 */
const seedAdminUser = async () => {
  try {
    const bcrypt = require('bcryptjs');
    
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@voidmarketplace.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'SecureAdmin123!';
    
    // Check if admin already exists
    const existingAdmin = await dbRouter.user.findUnique({
      where: { email: adminEmail }
    });

    if (existingAdmin) {
      logger.info('Admin user already exists');
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    // Create admin user
    await dbRouter.user.create({
      data: {
        email: adminEmail,
        username: 'admin',
        password_hash: hashedPassword,
        first_name: 'System',
        last_name: 'Administrator',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        is_verified: true,
        email_verified_at: new Date()
      }
    });

    logger.info('✅ Admin user created:', { email: adminEmail });
    logger.warn('🔒 Please change the admin password after first login');

  } catch (error) {
    logger.error('Admin user seeding failed:', error);
    throw error;
  }
};

/**
 * Seed sample data for development
 * @returns {Promise<void>}
 */
const seedSampleData = async () => {
  try {
    // Only seed in development
    if (process.env.NODE_ENV !== 'development') {
      return;
    }

    logger.info('🧪 Seeding sample development data...');

    // Create test vendor
    const bcrypt = require('bcryptjs');
    const testPassword = await bcrypt.hash('TestUser123!', 12);

    const testVendor = await dbRouter.user.upsert({
      where: { email: 'vendor@test.com' },
      update: {},
      create: {
        email: 'vendor@test.com',
        username: 'testvendor',
        password_hash: testPassword,
        first_name: 'Test',
        last_name: 'Vendor',
        role: 'VENDOR',
        status: 'ACTIVE',
        is_verified: true,
        vendor_verified: true,
        business_name: 'Test Electronics Store'
      }
    });

    // Create test buyer
    const testBuyer = await dbRouter.user.upsert({
      where: { email: 'buyer@test.com' },
      update: {},
      create: {
        email: 'buyer@test.com',
        username: 'testbuyer',
        password_hash: testPassword,
        first_name: 'Test',
        last_name: 'Buyer',
        role: 'USER',
        status: 'ACTIVE',
        is_verified: true
      }
    });

    // Get Electronics category
    const electronicsCategory = await dbRouter.category.findFirst({
      where: { name: 'Electronics' }
    });

    if (electronicsCategory) {
      // Create sample listing
      await dbRouter.listing.upsert({
        where: { 
          vendor_id_title: {
            vendor_id: testVendor.id,
            title: 'Sample iPhone 13 Pro'
          }
        },
        update: {},
        create: {
          title: 'Sample iPhone 13 Pro',
          description: 'A sample iPhone 13 Pro listing for testing purposes. This is a demo listing with all the features enabled.',
          price: 899.99,
          condition: 'LIKE_NEW',
          category_id: electronicsCategory.id,
          vendor_id: testVendor.id,
          status: 'ACTIVE',
          tags: ['iphone', 'apple', 'smartphone', 'mobile'],
          is_featured: true
        }
      });
    }

    logger.info('✅ Sample data seeded successfully');
    logger.info('🧪 Test accounts created:');
    logger.info('   Vendor: vendor@test.com / TestUser123!');
    logger.info('   Buyer: buyer@test.com / TestUser123!');

  } catch (error) {
    logger.error('Sample data seeding failed:', error);
    throw error;
  }
};

// ================================
// DATABASE MAINTENANCE
// ================================

/**
 * Clean up old data
 * @returns {Promise<void>}
 */
const cleanupOldData = async () => {
  try {
    logger.info('🧹 Starting database cleanup...');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Clean up old notifications
    const deletedNotifications = await dbRouter.notification.deleteMany({
      where: {
        created_at: { lt: thirtyDaysAgo },
        is_read: true
      }
    });

    // Clean up old search analytics
    const deletedSearchAnalytics = await dbRouter.searchAnalytics.deleteMany({
      where: {
        created_at: { lt: thirtyDaysAgo }
      }
    });

    // Clean up old user interactions
    const deletedInteractions = await dbRouter.userInteraction.deleteMany({
      where: {
        created_at: { lt: thirtyDaysAgo }
      }
    });

    logger.info('✅ Database cleanup completed:', {
      notifications_deleted: deletedNotifications.count,
      search_analytics_deleted: deletedSearchAnalytics.count,
      interactions_deleted: deletedInteractions.count
    });

  } catch (error) {
    logger.error('Database cleanup failed:', error);
  }
};

/**
 * Analyze database performance
 * @returns {Promise<Object>} Performance statistics
 */
const analyzePerformance = async () => {
  try {
    // Get table sizes
    const tableSizes = await dbRouter.$queryRaw`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
        pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `;

    // Get slow queries (if available)
    const slowQueries = await dbRouter.$queryRaw`
      SELECT 
        query,
        calls,
        total_time,
        mean_time,
        rows
      FROM pg_stat_statements 
      WHERE query NOT LIKE '%pg_stat_statements%'
      ORDER BY mean_time DESC 
      LIMIT 5
    `.catch(() => []);

    const stats = {
      table_sizes: tableSizes,
      slow_queries: slowQueries,
      analysis_timestamp: new Date().toISOString()
    };

    logger.info('📊 Database performance analysis completed');
    return stats;

  } catch (error) {
    logger.error('Database performance analysis failed:', error);
    return { error: error.message };
  }
};

// ================================
// GRACEFUL SHUTDOWN
// ================================

/**
 * Gracefully disconnect from database
 * @returns {Promise<void>}
 */
const gracefulShutdown = async () => {
  try {
    logger.info('🔌 Disconnecting from database...');
    await dbRouter.$disconnect();
    logger.info('✅ Database disconnected successfully');
  } catch (error) {
    logger.error('Database disconnect failed:', error);
    throw error;
  }
};

// Handle process termination
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('beforeExit', gracefulShutdown);

// ================================
// EXPORTS
// ================================

module.exports = {
  prisma,
  initializeDatabase,
  testConnection,
  seedDatabase,
  cleanupOldData,
  analyzePerformance,
  gracefulShutdown,
  
  // Individual seeding functions
  seedCategories,
  seedAdminUser,
  seedSampleData,
  
  // Health check functions
  runHealthChecks,
  checkTableExists,
  checkDatabaseStats
};