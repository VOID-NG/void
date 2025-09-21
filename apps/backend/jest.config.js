// apps/backend/jest.config.js
// Jest Configuration

module.exports = {
    // Test environment
    testEnvironment: 'node',
    
    // Setup files
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    
    // Test file patterns
    testMatch: [
      '<rootDir>/tests/**/*.test.js',
      '<rootDir>/tests/**/*.spec.js'
    ],
    
    // Ignore patterns
    testPathIgnorePatterns: [
      '/node_modules/',
      '/build/',
      '/dist/'
    ],
    
    // Coverage settings
    collectCoverageFrom: [
      'src/**/*.js',
      '!src/server.js',
      '!src/app.js',
      '!src/config/db.js',
      '!src/**/*.test.js'
    ],
    
    coverageDirectory: 'coverage',
    
    coverageReporters: [
      'text',
      'text-summary',
      'html',
      'lcov',
      'json'
    ],
    
    coverageThreshold: {
      global: {
        branches: 70,
        functions: 75,
        lines: 80,
        statements: 80
      },
      './src/services/': {
        branches: 80,
        functions: 85,
        lines: 85,
        statements: 85
      },
      './src/controllers/': {
        branches: 75,
        functions: 80,
        lines: 80,
        statements: 80
      }
    },
    
    // Performance settings
    testTimeout: 30000,
    maxWorkers: '50%',
    
    // Module paths
    moduleDirectories: ['node_modules', '<rootDir>/src'],
    
    // Transform settings
    transform: {},
    
    // Clear mocks between tests
    clearMocks: true,
    resetMocks: true,
    restoreMocks: true,
    
    // Verbose output
    verbose: true,
    
    // Test results processor
    // testResultsProcessor: 'jest-sonar-reporter', // Commented out - package not installed
    
    // Global setup/teardown
    globalSetup: '<rootDir>/tests/globalSetup.js',
    globalTeardown: '<rootDir>/tests/globalTeardown.js'
  };
  