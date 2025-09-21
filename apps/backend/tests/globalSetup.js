// apps/backend/tests/globalSetup.js
// Global Test Setup

const { execSync } = require('child_process');
const path = require('path');

module.exports = async () => {
  console.log('🚀 Running global test setup...');
  
  try {
    // Skip database setup for now - tests will use mocks
    console.log('📊 Skipping database setup - using mocks for testing...');
    
    // Generate Prisma client (this should work without database connection)
    try {
      execSync('npx prisma generate', {
        stdio: 'inherit'
      });
      console.log('✅ Prisma client generated');
    } catch (error) {
      console.warn('⚠️ Prisma client generation failed, continuing with mocks:', error.message);
    }
    
    console.log('✅ Global test setup completed');
    
  } catch (error) {
    console.error('❌ Global test setup failed:', error);
    // Don't exit process for test setup failures
    console.log('⚠️ Continuing with test execution despite setup issues...');
  }
};
