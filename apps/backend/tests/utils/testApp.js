// apps/backend/tests/utils/testApp.js
// Test Application Setup

const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

// Import middleware
const { errorHandler } = require('../../src/middleware/errorMiddleware');
const { initializeRateLimiter } = require('../../src/utils/rateLimiter');

// Import routes
const searchRoutes = require('../../src/routes/searchRoutes');
const authRoutes = require('../../src/routes/authRoutes');

/**
 * Create test Express application
 * @returns {Express} Test app instance
 */
const createTestApp = async () => {
  const app = express();

  // Basic middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Initialize rate limiter for testing
  initializeRateLimiter({
    configs: {
      // Relaxed limits for testing
      search: {
        text: { rpm: 1000, burst: 100 },
        image: { rpm: 500, burst: 50 },
        ai: { rpm: 200, burst: 20 }
      }
    }
  });

  // Test routes
  app.use('/api/v1/search', searchRoutes);
  app.use('/api/v1/auth', authRoutes);

  // Health check for tests
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Error handling
  app.use(errorHandler);

  return app;
};

module.exports = { createTestApp };

// ================================

// apps/backend/tests/utils/testDatabase.js
// Test Database Setup and Management

const { PrismaClient } = require('@prisma/client');
const { execSync } = require('child_process');

let testPrisma;
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 
  'postgresql://test_user:test_pass@localhost:5432/void_marketplace_test';

/**
 * Create and setup test database
 * @returns {PrismaClient} Test database client
 */
const createTestDatabase = async () => {
  if (testPrisma) {
    return testPrisma;
  }

  // Create test database client
  testPrisma = new PrismaClient({
    datasources: {
      db: { url: TEST_DATABASE_URL }
    }
  });

  try {
    // Connect to database
    await testPrisma.$connect();

    // Run migrations
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: 'inherit'
    });

    console.log('✅ Test database setup completed');
    return testPrisma;

  } catch (error) {
    console.error('❌ Test database setup failed:', error);
    throw error;
  }
};

/**
 * Clean test database (remove all data)
 */
const cleanTestDatabase = async () => {
  if (!testPrisma) return;

  try {
    // Delete in reverse dependency order
    const tablesToClean = [
      'user_interactions',
      'search_analytics',
      'search_suggestions',
      'user_search_preferences',
      'listing_embeddings',
      'listing_3d_models',
      'listing_videos',
      'listing_images',
      'reviews',
      'notifications',
      'transactions',
      'messages',
      'chats',
      'listings',
      'subscriptions',
      'promotions',
      'categories',
      'users'
    ];

    for (const table of tablesToClean) {
      try {
        await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
      } catch (error) {
        // Table might not exist, continue
        console.warn(`Warning: Could not truncate table ${table}:`, error.message);
      }
    }

    console.log('✅ Test database cleaned');

  } catch (error) {
    console.error('❌ Test database cleanup failed:', error);
    throw error;
  }
};

/**
 * Reset test database sequences
 */
const resetTestDatabaseSequences = async () => {
  if (!testPrisma) return;

  try {
    // Reset sequences for auto-increment fields
    const sequences = [
      'users_id_seq',
      'categories_id_seq',
      'listings_id_seq'
    ];

    for (const sequence of sequences) {
      try {
        await testPrisma.$executeRawUnsafe(`ALTER SEQUENCE "${sequence}" RESTART WITH 1`);
      } catch (error) {
        // Sequence might not exist
      }
    }

  } catch (error) {
    console.warn('Warning: Could not reset sequences:', error.message);
  }
};

/**
 * Close test database connection
 */
const closeTestDatabase = async () => {
  if (testPrisma) {
    await testPrisma.$disconnect();
    testPrisma = null;
  }
};

module.exports = {
  createTestDatabase,
  cleanTestDatabase,
  resetTestDatabaseSequences,
  closeTestDatabase,
  get testPrisma() { return testPrisma; }
};

// ================================

// apps/backend/tests/utils/testFixtures.js
// Test Data Fixtures and Factories

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { testPrisma } = require('./testDatabase');

/**
 * Create test user
 * @param {Object} userData - User data overrides
 * @returns {Object} Created user with token
 */
const createTestUser = async (userData = {}) => {
  const defaultUser = {
    email: `test.user.${Date.now()}@example.com`,
    username: `testuser${Date.now()}`,
    password: 'password123',
    display_name: 'Test User',
    role: 'USER',
    is_verified: true,
    is_active: true
  };

  const user = { ...defaultUser, ...userData };
  
  // Hash password
  const hashedPassword = await bcrypt.hash(user.password, 10);

  const createdUser = await testPrisma.user.create({
    data: {
      ...user,
      password_hash: hashedPassword
    }
  });

  // Generate JWT token
  const token = jwt.sign(
    { userId: createdUser.id, role: createdUser.role },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '24h' }
  );

  return {
    ...createdUser,
    token,
    plainPassword: user.password
  };
};

/**
 * Create test category
 * @param {Object} categoryData - Category data overrides
 * @returns {Object} Created category
 */
const createTestCategory = async (categoryData = {}) => {
  const defaultCategory = {
    name: `Test Category ${Date.now()}`,
    description: 'Test category description'
  };

  const category = { ...defaultCategory, ...categoryData };

  return await testPrisma.category.create({
    data: category
  });
};

/**
 * Create test listing
 * @param {Object} listingData - Listing data overrides
 * @returns {Object} Created listing
 */
const createTestListing = async (listingData = {}) => {
  // Ensure we have required relations
  if (!listingData.vendor_id) {
    const vendor = await createTestUser({ role: 'VENDOR' });
    listingData.vendor_id = vendor.id;
  }

  if (!listingData.category_id) {
    const category = await createTestCategory();
    listingData.category_id = category.id;
  }

  const defaultListing = {
    title: `Test Product ${Date.now()}`,
    description: 'Test product description with detailed information',
    price: 99.99,
    condition: 'NEW',
    status: 'ACTIVE',
    quantity: 1,
    tags: ['test', 'product'],
    is_negotiable: true,
    is_featured: false
  };

  const listing = { ...defaultListing, ...listingData };

  const createdListing = await testPrisma.listing.create({
    data: listing,
    include: {
      category: true,
      vendor: {
        select: {
          id: true,
          username: true,
          display_name: true,
          is_verified: true
        }
      }
    }
  });

  // Add default image if none provided
  if (!listingData.skipImages) {
    await testPrisma.listingImage.create({
      data: {
        listing_id: createdListing.id,
        url: 'https://via.placeholder.com/400x300.jpg',
        is_primary: true,
        order_pos: 1
      }
    });
  }

  return createdListing;
};

/**
 * Create test chat
 * @param {Object} chatData - Chat data overrides
 * @returns {Object} Created chat
 */
const createTestChat = async (chatData = {}) => {
  // Ensure we have required relations
  if (!chatData.listing_id) {
    const listing = await createTestListing();
    chatData.listing_id = listing.id;
    chatData.vendor_id = listing.vendor_id;
  }

  if (!chatData.buyer_id) {
    const buyer = await createTestUser();
    chatData.buyer_id = buyer.id;
  }

  const defaultChat = {
    status: 'ACTIVE'
  };

  const chat = { ...defaultChat, ...chatData };

  return await testPrisma.chat.create({
    data: chat,
    include: {
      listing: true,
      buyer: {
        select: { id: true, username: true, display_name: true }
      },
      vendor: {
        select: { id: true, username: true, display_name: true }
      }
    }
  });
};

/**
 * Create test message
 * @param {Object} messageData - Message data overrides
 * @returns {Object} Created message
 */
const createTestMessage = async (messageData = {}) => {
  if (!messageData.chat_id) {
    const chat = await createTestChat();
    messageData.chat_id = chat.id;
    messageData.sender_id = chat.buyer_id;
  }

  const defaultMessage = {
    content: `Test message ${Date.now()}`,
    type: 'TEXT'
  };

  const message = { ...defaultMessage, ...messageData };

  return await testPrisma.message.create({
    data: message
  });
};

/**
 * Create test transaction
 * @param {Object} transactionData - Transaction data overrides
 * @returns {Object} Created transaction
 */
const createTestTransaction = async (transactionData = {}) => {
  if (!transactionData.listing_id) {
    const listing = await createTestListing();
    transactionData.listing_id = listing.id;
    transactionData.vendor_id = listing.vendor_id;
  }

  if (!transactionData.buyer_id) {
    const buyer = await createTestUser();
    transactionData.buyer_id = buyer.id;
  }

  const defaultTransaction = {
    amount: 99.99,
    status: 'PENDING',
    payment_method: 'stripe'
  };

  const transaction = { ...defaultTransaction, ...transactionData };

  return await testPrisma.transaction.create({
    data: transaction,
    include: {
      listing: true,
      buyer: {
        select: { id: true, username: true, display_name: true }
      },
      vendor: {
        select: { id: true, username: true, display_name: true }
      }
    }
  });
};

/**
 * Create test search analytics entry
 * @param {Object} analyticsData - Analytics data overrides
 * @returns {Object} Created analytics entry
 */
const createTestSearchAnalytics = async (analyticsData = {}) => {
  const defaultAnalytics = {
    query_text: `test query ${Date.now()}`,
    query_type: 'text',
    filters_applied: {},
    results_count: 5,
    response_time_ms: 250
  };

  const analytics = { ...defaultAnalytics, ...analyticsData };

  return await testPrisma.searchAnalytics.create({
    data: analytics
  });
};

/**
 * Create multiple test listings for search testing
 * @param {number} count - Number of listings to create
 * @param {Object} baseData - Base data for all listings
 * @returns {Array} Created listings
 */
const createTestListings = async (count = 5, baseData = {}) => {
  const listings = [];
  
  for (let i = 0; i < count; i++) {
    const listing = await createTestListing({
      ...baseData,
      title: `${baseData.title || 'Test Product'} ${i + 1}`,
      price: (baseData.price || 100) + (i * 50),
      tags: [...(baseData.tags || ['test']), `tag${i}`]
    });
    
    listings.push(listing);
  }

  return listings;
};

/**
 * Create test image file buffer
 * @returns {Buffer} Test image buffer
 */
const createTestImageBuffer = () => {
  // Create a minimal valid JPEG buffer
  const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
  const jpegData = Buffer.alloc(1000).fill(0x42); // Dummy data
  const jpegFooter = Buffer.from([0xFF, 0xD9]);
  
  return Buffer.concat([jpegHeader, jpegData, jpegFooter]);
};

/**
 * Wait for a specified amount of time
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise} Promise that resolves after the delay
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Create test data set for search testing
 * @returns {Object} Complete test data set
 */
const createSearchTestDataSet = async () => {
  // Create categories
  const electronicsCategory = await createTestCategory({
    name: 'Electronics',
    description: 'Electronic devices and accessories'
  });

  const fashionCategory = await createTestCategory({
    name: 'Fashion',
    description: 'Clothing and accessories'
  });

  // Create users
  const vendor1 = await createTestUser({ 
    role: 'VENDOR',
    username: 'vendor1',
    email: 'vendor1@test.com'
  });

  const vendor2 = await createTestUser({ 
    role: 'VENDOR',
    username: 'vendor2',
    email: 'vendor2@test.com'
  });

  const buyer = await createTestUser({
    role: 'USER',
    username: 'buyer1',
    email: 'buyer1@test.com'
  });

  const admin = await createTestUser({
    role: 'ADMIN',
    username: 'admin1',
    email: 'admin1@test.com'
  });

  // Create listings
  const listings = await Promise.all([
    createTestListing({
      title: 'iPhone 15 Pro Max',
      description: 'Latest Apple smartphone with advanced camera',
      price: 1199,
      category_id: electronicsCategory.id,
      vendor_id: vendor1.id,
      tags: ['apple', 'iphone', 'smartphone', 'pro'],
      condition: 'NEW'
    }),
    createTestListing({
      title: 'Samsung Galaxy S24 Ultra',
      description: 'Premium Android smartphone with S Pen',
      price: 1299,
      category_id: electronicsCategory.id,
      vendor_id: vendor2.id,
      tags: ['samsung', 'galaxy', 'android', 'ultra'],
      condition: 'NEW'
    }),
    createTestListing({
      title: 'MacBook Pro 16-inch',
      description: 'Powerful laptop for professionals',
      price: 2499,
      category_id: electronicsCategory.id,
      vendor_id: vendor1.id,
      tags: ['apple', 'macbook', 'laptop', 'pro'],
      condition: 'LIKE_NEW'
    }),
    createTestListing({
      title: 'Designer Leather Jacket',
      description: 'Premium leather jacket in excellent condition',
      price: 299,
      category_id: fashionCategory.id,
      vendor_id: vendor2.id,
      tags: ['leather', 'jacket', 'fashion', 'designer'],
      condition: 'GOOD'
    })
  ]);

  // Create some search analytics
  await Promise.all([
    createTestSearchAnalytics({
      query_text: 'iphone',
      results_count: 2,
      user_id: buyer.id
    }),
    createTestSearchAnalytics({
      query_text: 'laptop',
      results_count: 1,
      user_id: buyer.id
    }),
    createTestSearchAnalytics({
      query_text: 'samsung',
      results_count: 1
    })
  ]);

  return {
    categories: {
      electronics: electronicsCategory,
      fashion: fashionCategory
    },
    users: {
      vendor1,
      vendor2,
      buyer,
      admin
    },
    listings,
    tokens: {
      vendor1: vendor1.token,
      vendor2: vendor2.token,
      buyer: buyer.token,
      admin: admin.token
    }
  };
};

module.exports = {
  // User creation
  createTestUser,
  
  // Content creation
  createTestCategory,
  createTestListing,
  createTestListings,
  createTestChat,
  createTestMessage,
  createTestTransaction,
  
  // Analytics
  createTestSearchAnalytics,
  
  // Utilities
  createTestImageBuffer,
  delay,
  createSearchTestDataSet
};

// ================================

// apps/backend/tests/utils/testHelpers.js
// Additional Test Helper Functions

const { performance } = require('perf_hooks');

/**
 * Measure execution time of an async function
 * @param {Function} fn - Async function to measure
 * @returns {Object} Result and execution time
 */
const measureExecutionTime = async (fn) => {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  
  return {
    result,
    executionTime: end - start
  };
};

/**
 * Create mock request object for testing
 * @param {Object} options - Request options
 * @returns {Object} Mock request object
 */
const createMockRequest = (options = {}) => {
  return {
    body: options.body || {},
    query: options.query || {},
    params: options.params || {},
    headers: options.headers || {},
    user: options.user || null,
    ip: options.ip || '127.0.0.1',
    file: options.file || null,
    files: options.files || null,
    get: jest.fn((header) => options.headers[header.toLowerCase()]),
    ...options.custom
  };
};

/**
 * Create mock response object for testing
 * @param {Object} options - Response options
 * @returns {Object} Mock response object
 */
const createMockResponse = (options = {}) => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    ...options.custom
  };

  return res;
};

/**
 * Create mock next function for middleware testing
 * @returns {Function} Mock next function
 */
const createMockNext = () => {
  return jest.fn();
};

/**
 * Wait for a condition to be true with timeout
 * @param {Function} condition - Condition function
 * @param {number} timeout - Timeout in milliseconds
 * @param {number} interval - Check interval in milliseconds
 * @returns {Promise} Promise that resolves when condition is true
 */
const waitForCondition = async (condition, timeout = 5000, interval = 100) => {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error(`Condition not met within ${timeout}ms`);
};

/**
 * Generate random test data
 * @param {string} type - Type of data to generate
 * @param {Object} options - Generation options
 * @returns {any} Generated data
 */
const generateTestData = (type, options = {}) => {
  const generators = {
    email: () => `test.${Date.now()}.${Math.random().toString(36).substr(2, 5)}@example.com`,
    username: () => `user_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    password: () => `password_${Math.random().toString(36).substr(2, 10)}`,
    title: () => `Test Product ${Math.random().toString(36).substr(2, 8)}`,
    description: () => `Test description with details ${Math.random().toString(36).substr(2, 20)}`,
    price: () => Math.floor(Math.random() * 1000) + 10,
    query: () => ['iphone', 'laptop', 'shoes', 'book', 'camera'][Math.floor(Math.random() * 5)],
    tags: () => ['tag1', 'tag2', 'tag3'].slice(0, Math.floor(Math.random() * 3) + 1)
  };

  const generator = generators[type];
  if (!generator) {
    throw new Error(`Unknown test data type: ${type}`);
  }

  return generator();
};

/**
 * Validate API response structure
 * @param {Object} response - API response
 * @param {Object} expectedStructure - Expected structure
 */
const validateResponseStructure = (response, expectedStructure) => {
  const validate = (obj, structure, path = '') => {
    for (const [key, expectedType] of Object.entries(structure)) {
      const currentPath = path ? `${path}.${key}` : key;
      
      if (!(key in obj)) {
        throw new Error(`Missing property: ${currentPath}`);
      }

      const value = obj[key];
      const actualType = Array.isArray(value) ? 'array' : typeof value;

      if (typeof expectedType === 'string') {
        if (actualType !== expectedType && value !== null) {
          throw new Error(`Type mismatch at ${currentPath}: expected ${expectedType}, got ${actualType}`);
        }
      } else if (typeof expectedType === 'object' && !Array.isArray(expectedType)) {
        if (actualType === 'object' && value !== null) {
          validate(value, expectedType, currentPath);
        }
      } else if (Array.isArray(expectedType) && expectedType.length > 0) {
        if (actualType === 'array' && value.length > 0) {
          validate(value[0], expectedType[0], `${currentPath}[0]`);
        }
      }
    }
  };

  validate(response, expectedStructure);
};

/**
 * Create test database transaction wrapper
 * @param {Function} testFn - Test function to wrap in transaction
 * @returns {Function} Wrapped test function
 */
const withDatabaseTransaction = (testFn) => {
  return async (...args) => {
    const { testPrisma } = require('./testDatabase');
    
    return await testPrisma.$transaction(async (tx) => {
      // Replace global testPrisma with transaction instance
      const originalPrisma = global.testPrisma;
      global.testPrisma = tx;
      
      try {
        const result = await testFn(...args);
        
        // Rollback transaction to clean up
        throw new Error('ROLLBACK_FOR_TEST');
      } catch (error) {
        if (error.message === 'ROLLBACK_FOR_TEST') {
          // Test completed successfully, rollback for cleanup
          return;
        }
        throw error;
      } finally {
        // Restore original prisma
        global.testPrisma = originalPrisma;
      }
    });
  };
};

/**
 * Suppress console output during tests
 * @param {Function} testFn - Test function
 * @returns {any} Test function result
 */
const suppressConsole = async (testFn) => {
  const originalConsole = { ...console };
  
  // Mock console methods
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
  console.info = jest.fn();
  
  try {
    return await testFn();
  } finally {
    // Restore original console
    Object.assign(console, originalConsole);
  }
};

module.exports = {
  measureExecutionTime,
  createMockRequest,
  createMockResponse,
  createMockNext,
  waitForCondition,
  generateTestData,
  validateResponseStructure,
  withDatabaseTransaction,
  suppressConsole
};