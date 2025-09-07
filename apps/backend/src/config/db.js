// apps/backend/src/config/db-optimized.js
// Enterprise-grade database configuration with performance optimizations

const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

// ================================
// ADVANCED DATABASE CONFIGURATION
// ================================

const createOptimizedPrismaClient = () => {
  const prisma = new PrismaClient({
    // Connection optimization
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    },
    
    // Query optimization
    log: [
      {
        emit: 'event',
        level: 'query',
      },
      {
        emit: 'event', 
        level: 'error'
      },
      {
        emit: 'event',
        level: 'warn'
      }
    ],
    
    // Performance optimization
    __internal: {
      engine: {
        // Connection pooling configuration
        connection_limit: parseInt(process.env.DB_CONNECTION_LIMIT) || 50,
        pool_timeout: parseInt(process.env.DB_POOL_TIMEOUT) || 30,
        
        // Query optimization
        schema_cache_size: parseInt(process.env.DB_SCHEMA_CACHE_SIZE) || 100,
        query_cache_size: parseInt(process.env.DB_QUERY_CACHE_SIZE) || 1000,
        
        // Performance tuning
        statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT) || 30000,
        query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT) || 20000,
      }
    }
  });

  // ================================
  // QUERY PERFORMANCE MONITORING
  // ================================
  
  prisma.$on('query', (e) => {
    const duration = e.duration;
    
    // Log slow queries for optimization
    if (duration > 1000) { // Queries slower than 1 second
      logger.warn('SLOW QUERY DETECTED', {
        query: e.query,
        params: e.params,
        duration: `${duration}ms`,
        timestamp: e.timestamp
      });
    }
    
    // Log extremely slow queries as errors
    if (duration > 5000) { // Queries slower than 5 seconds
      logger.error('CRITICAL SLOW QUERY', {
        query: e.query,
        duration: `${duration}ms`,
        stackTrace: new Error().stack
      });
    }
  });

  prisma.$on('error', (e) => {
    logger.error('DATABASE ERROR', {
      message: e.message,
      target: e.target,
      timestamp: e.timestamp
    });
  });

  return prisma;
};

// ================================
// READ REPLICA CONFIGURATION
// ================================

const createReadReplicaClients = () => {
  const readReplicas = [];
  const replicaUrls = process.env.DATABASE_READ_REPLICAS?.split(',') || [];
  
  replicaUrls.forEach((url, index) => {
    if (url.trim()) {
      const replica = new PrismaClient({
        datasources: {
          db: { url: url.trim() }
        },
        log: ['error', 'warn']
      });
      
      readReplicas.push(replica);
      logger.info(`Read replica ${index + 1} configured: ${url.split('@')[1]}`);
    }
  });
  
  return readReplicas;
};

// ================================
// INTELLIGENT QUERY ROUTER
// ================================

class DatabaseRouter {
  constructor() {
    this.writeClient = createOptimizedPrismaClient();
    this.readReplicas = createReadReplicaClients();
    this.replicaIndex = 0;
    this.queryMetrics = new Map();
  }

  // Get write client for mutations
  getWriteClient() {
    return this.writeClient;
  }

  // Get read client with load balancing
  getReadClient() {
    if (this.readReplicas.length === 0) {
      return this.writeClient; // Fallback to write client
    }

    // Round-robin load balancing
    const client = this.readReplicas[this.replicaIndex];
    this.replicaIndex = (this.replicaIndex + 1) % this.readReplicas.length;
    
    return client;
  }

  // Intelligent routing based on query type
  getClientForQuery(operation) {
    const readOperations = ['findMany', 'findFirst', 'findUnique', 'count', 'aggregate'];
    const writeOperations = ['create', 'update', 'delete', 'upsert', 'createMany', 'updateMany', 'deleteMany'];

    if (readOperations.some(op => operation.includes(op))) {
      return this.getReadClient();
    } else if (writeOperations.some(op => operation.includes(op))) {
      return this.getWriteClient();
    }

    // Default to write client for safety
    return this.getWriteClient();
  }

  // Track query performance
  trackQuery(operation, duration) {
    if (!this.queryMetrics.has(operation)) {
      this.queryMetrics.set(operation, {
        count: 0,
        totalDuration: 0,
        avgDuration: 0,
        maxDuration: 0
      });
    }

    const metrics = this.queryMetrics.get(operation);
    metrics.count++;
    metrics.totalDuration += duration;
    metrics.avgDuration = metrics.totalDuration / metrics.count;
    metrics.maxDuration = Math.max(metrics.maxDuration, duration);
  }

  // Get performance metrics
  getPerformanceMetrics() {
    return Object.fromEntries(this.queryMetrics);
  }

  // Health check for all clients
  async healthCheck() {
    const results = {
      write: false,
      readReplicas: []
    };

    try {
      await this.writeClient.$queryRaw`SELECT 1`;
      results.write = true;
    } catch (error) {
      logger.error('Write client health check failed:', error);
    }

    for (let i = 0; i < this.readReplicas.length; i++) {
      try {
        await this.readReplicas[i].$queryRaw`SELECT 1`;
        results.readReplicas.push({ index: i, healthy: true });
      } catch (error) {
        logger.error(`Read replica ${i} health check failed:`, error);
        results.readReplicas.push({ index: i, healthy: false });
      }
    }

    return results;
  }

  // Graceful shutdown
  async disconnect() {
    try {
      await this.writeClient.$disconnect();
      logger.info('Write client disconnected');

      for (let i = 0; i < this.readReplicas.length; i++) {
        await this.readReplicas[i].$disconnect();
        logger.info(`Read replica ${i} disconnected`);
      }
    } catch (error) {
      logger.error('Error during database disconnection:', error);
    }
  }
}

// ================================
// QUERY OPTIMIZATION HELPERS
// ================================

class QueryOptimizer {
  static optimizeListingQuery(filters = {}) {
    const baseQuery = {
      where: {
        status: 'ACTIVE',
        ...filters
      },
      select: {
        id: true,
        title: true,
        price: true,
        condition: true,
        location: true,
        is_featured: true,
        created_at: true,
        vendor: {
          select: {
            id: true,
            username: true,
            vendor_verified: true
          }
        },
        category: {
          select: {
            id: true,
            name: true
          }
        },
        listing_images: {
          where: { is_primary: true },
          select: {
            url: true,
            alt_text: true
          },
          take: 1
        },
        _count: {
          select: {
            reviews: true
          }
        }
      }
    };

    return baseQuery;
  }

  static optimizeSearchQuery(searchTerm, filters = {}) {
    return {
      where: {
        AND: [
          {
            OR: [
              {
                title: {
                  contains: searchTerm,
                  mode: 'insensitive'
                }
              },
              {
                description: {
                  contains: searchTerm,
                  mode: 'insensitive'
                }
              },
              {
                tags: {
                  hasSome: [searchTerm]
                }
              }
            ]
          },
          {
            status: 'ACTIVE'
          },
          ...Object.entries(filters).map(([key, value]) => ({
            [key]: value
          }))
        ]
      },
      select: QueryOptimizer.optimizeListingQuery().select,
      orderBy: [
        { is_featured: 'desc' },
        { created_at: 'desc' }
      ]
    };
  }

  static optimizeChatQuery(userId) {
    return {
      where: {
        OR: [
          { buyer_id: userId },
          { vendor_id: userId }
        ]
      },
      select: {
        id: true,
        listing_id: true,
        status: true,
        last_message_at: true,
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            listing_images: {
              where: { is_primary: true },
              select: { url: true },
              take: 1
            }
          }
        },
        buyer: {
          select: {
            id: true,
            username: true,
            first_name: true,
            avatar_url: true
          }
        },
        vendor: {
          select: {
            id: true,
            username: true,
            first_name: true,
            avatar_url: true
          }
        },
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: {
            id: true,
            content: true,
            type: true,
            created_at: true,
            is_read: true
          }
        }
      },
      orderBy: { last_message_at: 'desc' }
    };
  }
}

// ================================
// INITIALIZATION
// ================================

const dbRouter = new DatabaseRouter();

const initializeDatabase = async () => {
  try {
    logger.info('🗃️  Initializing optimized database connections...');
    
    // Test write connection
    await dbRouter.getWriteClient().$connect();
    logger.info('✅ Write database connected');
    
    // Test read replicas
    const healthCheck = await dbRouter.healthCheck();
    logger.info('📊 Database health check:', healthCheck);
    
    // Set up connection monitoring
    setInterval(async () => {
      const health = await dbRouter.healthCheck();
      if (!health.write) {
        logger.error('🚨 Write database connection lost!');
      }
      
      const unhealthyReplicas = health.readReplicas.filter(r => !r.healthy);
      if (unhealthyReplicas.length > 0) {
        logger.warn('⚠️  Some read replicas are unhealthy:', unhealthyReplicas);
      }
    }, 30000); // Check every 30 seconds
    
    logger.info('✅ Optimized database initialization complete');
    
  } catch (error) {
    logger.error('❌ Database initialization failed:', error);
    throw error;
  }
};

const disconnectDatabase = async () => {
  await dbRouter.disconnect();
};

module.exports = {
  prisma: dbRouter.getWriteClient(),
  dbRouter,
  QueryOptimizer,
  initializeDatabase,
  disconnectDatabase
};