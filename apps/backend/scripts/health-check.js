// apps/backend/scripts/health-check.js
// System Health Check Script

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const prisma = new PrismaClient();

async function runHealthCheck() {
  console.log('🏥 Void Marketplace Health Check');
  console.log('=' .repeat(50));
  
  const checks = [];
  
  // 1. API Health Check
  try {
    const response = await axios.get(`${BASE_URL}/health`, { timeout: 5000 });
    checks.push({
      name: 'API Server',
      status: response.status === 200 ? 'HEALTHY' : 'UNHEALTHY',
      responseTime: response.headers['x-response-time'] || 'N/A',
      details: response.data
    });
  } catch (error) {
    checks.push({
      name: 'API Server',
      status: 'UNHEALTHY',
      error: error.message
    });
  }
  
  // 2. Database Health Check
  try {
    await prisma.$executeRaw`SELECT 1`;
    const userCount = await prisma.user.count();
    const listingCount = await prisma.listing.count();
    
    checks.push({
      name: 'Database',
      status: 'HEALTHY',
      details: {
        users: userCount,
        listings: listingCount
      }
    });
  } catch (error) {
    checks.push({
      name: 'Database',
      status: 'UNHEALTHY',
      error: error.message
    });
  }
  
  // 3. Search System Health Check
  try {
    const response = await axios.get(`${BASE_URL}/api/v1/search`, {
      params: { q: 'test' },
      timeout: 10000
    });
    
    checks.push({
      name: 'Search System',
      status: response.data.success ? 'HEALTHY' : 'UNHEALTHY',
      responseTime: response.data.performance?.responseTime || 'N/A',
      strategy: response.data.performance?.strategy
    });
  } catch (error) {
    checks.push({
      name: 'Search System',
      status: 'UNHEALTHY',
      error: error.message
    });
  }
  
  // 4. AI Services Health Check
  try {
    const response = await axios.post(`${BASE_URL}/api/v1/search/advanced`, {
      query: 'health check test',
      requireAI: false
    }, { timeout: 15000 });
    
    checks.push({
      name: 'AI Services',
      status: response.data.success ? 'HEALTHY' : 'DEGRADED',
      aiEnabled: !!response.data.aiInsights
    });
  } catch (error) {
    checks.push({
      name: 'AI Services',
      status: 'UNHEALTHY',
      error: error.message
    });
  }
  
  // Print results
  console.log('\n📋 Health Check Results:');
  console.log('-'.repeat(50));
  
  let overallHealthy = true;
  
  checks.forEach(check => {
    const statusIcon = check.status === 'HEALTHY' ? '✅' : 
                     check.status === 'DEGRADED' ? '⚠️' : '❌';
    
    console.log(`${statusIcon} ${check.name}: ${check.status}`);
    
    if (check.responseTime) {
      console.log(`   Response Time: ${check.responseTime}`);
    }
    
    if (check.details) {
      console.log(`   Details:`, check.details);
    }
    
    if (check.error) {
      console.log(`   Error: ${check.error}`);
    }
    
    if (check.status !== 'HEALTHY') {
      overallHealthy = false;
    }
  });
  
  console.log('\n🎯 Overall Status:', overallHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY');
  
  // Cleanup
  await prisma.$disconnect();
  
  return { overall: overallHealthy, checks };
}

// Run health check if called directly
if (require.main === module) {
  runHealthCheck()
    .then((result) => {
      process.exit(result.overall ? 0 : 1);
    })
    .catch((error) => {
      console.error('Health check failed:', error);
      process.exit(1);
    });
}

module.exports = { runHealthCheck };