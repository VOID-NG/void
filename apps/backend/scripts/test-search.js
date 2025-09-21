// apps/backend/scripts/test-search.js
// Search System Test Script

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

// Test queries for different scenarios
const TEST_SCENARIOS = {
  basicTextSearch: {
    name: 'Basic Text Search',
    requests: [
      { endpoint: '/api/v1/search', params: { q: 'iPhone' } },
      { endpoint: '/api/v1/search', params: { q: 'laptop' } },
      { endpoint: '/api/v1/search', params: { q: 'headphones' } }
    ]
  },
  
  filteredSearch: {
    name: 'Filtered Search',
    requests: [
      { 
        endpoint: '/api/v1/search', 
        params: { q: 'smartphone', min_price: 500, max_price: 1500, condition: 'NEW' }
      }
    ]
  },
  
  autocomplete: {
    name: 'Autocomplete',
    requests: [
      { endpoint: '/api/v1/search/autocomplete', params: { q: 'iph' } },
      { endpoint: '/api/v1/search/autocomplete', params: { q: 'lap' } },
      { endpoint: '/api/v1/search/autocomplete', params: { q: 'sam' } }
    ]
  },
  
  trending: {
    name: 'Trending Searches',
    requests: [
      { endpoint: '/api/v1/search/trending', params: { timeframe: '24h' } },
      { endpoint: '/api/v1/search/trending', params: { timeframe: '7d' } }
    ]
  },
  
  advancedSearch: {
    name: 'Advanced AI Search',
    method: 'POST',
    requests: [
      {
        endpoint: '/api/v1/search/advanced',
        data: {
          query: 'recommend the best smartphone for photography',
          requireAI: true,
          analysisDepth: 'deep'
        }
      }
    ]
  }
};

async function runSearchTests() {
  console.log('🔍 Testing Void Marketplace Search System');
  console.log('=' .repeat(60));
  
  const results = [];
  
  for (const [scenarioKey, scenario] of Object.entries(TEST_SCENARIOS)) {
    console.log(`\n📋 Testing: ${scenario.name}`);
    console.log('-'.repeat(40));
    
    for (const request of scenario.requests) {
      try {
        const startTime = Date.now();
        
        let response;
        if (scenario.method === 'POST') {
          response = await axios.post(`${BASE_URL}${request.endpoint}`, request.data);
        } else {
          response = await axios.get(`${BASE_URL}${request.endpoint}`, {
            params: request.params
          });
        }
        
        const responseTime = Date.now() - startTime;
        
        const result = {
          scenario: scenario.name,
          endpoint: request.endpoint,
          method: scenario.method || 'GET',
          status: response.status,
          responseTime,
          dataCount: response.data.data?.length || 0,
          success: response.data.success,
          strategy: response.data.performance?.strategy
        };
        
        results.push(result);
        
        console.log(`✅ ${request.endpoint}`);
        console.log(`   Status: ${response.status}`);
        console.log(`   Response Time: ${responseTime}ms`);
        console.log(`   Results: ${result.dataCount}`);
        console.log(`   Strategy: ${result.strategy || 'N/A'}`);
        
      } catch (error) {
        const result = {
          scenario: scenario.name,
          endpoint: request.endpoint,
          method: scenario.method || 'GET',
          status: error.response?.status || 'ERROR',
          responseTime: 0,
          success: false,
          error: error.message
        };
        
        results.push(result);
        
        console.log(`❌ ${request.endpoint}`);
        console.log(`   Error: ${error.message}`);
      }
    }
  }
  
  // Generate summary report
  console.log('\n📊 TEST SUMMARY');
  console.log('=' .repeat(60));
  
  const totalTests = results.length;
  const successfulTests = results.filter(r => r.success).length;
  const averageResponseTime = results
    .filter(r => r.responseTime > 0)
    .reduce((sum, r) => sum + r.responseTime, 0) / totalTests;
  
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Successful: ${successfulTests} (${((successfulTests / totalTests) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${totalTests - successfulTests}`);
  console.log(`Average Response Time: ${averageResponseTime.toFixed(2)}ms`);
  
  // Save detailed results
  const reportPath = path.join(__dirname, `../reports/search-test-${Date.now()}.json`);
  
  try {
    await fs.promises.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.promises.writeFile(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        total: totalTests,
        successful: successfulTests,
        failed: totalTests - successfulTests,
        averageResponseTime
      },
      results
    }, null, 2));
    
    console.log(`\n📄 Detailed report saved: ${reportPath}`);
  } catch (error) {
    console.error('Failed to save report:', error.message);
  }
  
  return results;
}

// Run tests if called directly
if (require.main === module) {
  runSearchTests()
    .then((results) => {
      const success = results.every(r => r.success);
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Test runner failed:', error);
      process.exit(1);
    });
}

module.exports = { runSearchTests, TEST_SCENARIOS };

// ================================
