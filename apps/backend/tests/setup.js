// apps/backend/tests/setup.js
// Global Test Setup

const { config } = require('dotenv');
const path = require('path');

// Load test environment variables
config({ path: path.join(__dirname, '../.env.test') });

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test_user:test_pass@localhost:5432/void_marketplace_test';

// Mock external services for testing
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// Mock Gemini AI service for tests
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          text: jest.fn().mockReturnValue(JSON.stringify({
            productInfo: {
              category: 'electronics',
              brand: 'Test Brand',
              model: 'Test Model',
              condition: 'NEW'
            },
            marketplaceData: {
              estimatedPriceRange: { min: 100, max: 500 },
              keyFeatures: ['feature1', 'feature2'],
              searchKeywords: ['test', 'product']
            },
            confidence: 0.85
          }))
        }
      })
    })
  }))
}));

// Global test timeout
jest.setTimeout(30000);

// Mock Prisma Client for all tests
jest.mock('@prisma/client', () => {
  const mockPrisma = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    listing: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    category: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    searchAnalytics: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $transaction: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  };
  
  return {
    PrismaClient: jest.fn(() => mockPrisma)
  };
});

// Setup global test utilities
try {
  global.testHelpers = require('./utils/testHelpers');
} catch (error) {
  console.warn('⚠️ Test helpers not available, continuing without them');
  global.testHelpers = {};
}

// Clean up after each test
afterEach(async () => {
  // Clear all mocks
  jest.clearAllMocks();
});

// Global setup before all tests
beforeAll(async () => {
  console.log('🧪 Setting up test environment...');
});

// Global cleanup after all tests
afterAll(async () => {
  console.log('🧹 Cleaning up test environment...');
});