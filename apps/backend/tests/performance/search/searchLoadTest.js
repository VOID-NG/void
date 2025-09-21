// apps/backend/tests/performance/search/searchLoadTest.js
// Performance and Load Testing for Search System

const { performance } = require('perf_hooks');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Test configuration
const LOAD_TEST_CONFIG = {
  // Base configuration
  BASE_URL: process.env.TEST_BASE_URL || 'http://localhost:5000',
  
  // Load test scenarios
  SCENARIOS: {
    basic_text_search: {
      duration: 60000, // 1 minute
      concurrent_users: 50,
      requests_per_second: 100,
      endpoints: ['/api/v1/search']
    },
    mixed_search_load: {
      duration: 120000, // 2 minutes
      concurrent_users: 100,
      requests_per_second: 200,
      endpoints: ['/api/v1/search', '/api/v1/search/autocomplete', '/api/v1/search/trending']
    },
    ai_search_stress: {
      duration: 300000, // 5 minutes
      concurrent_users: 20,
      requests_per_second: 30,
      endpoints: ['/api/v1/search/advanced']
    },
    image_search_load: {
      duration: 180000, // 3 minutes
      concurrent_users: 10,
      requests_per_second: 15,
      endpoints: ['/api/v1/search/image-url']
    }
  },

  // Performance thresholds
  THRESHOLDS: {
    response_time_p95: 2000, // 95th percentile under 2 seconds
    response_time_p99: 5000, // 99th percentile under 5 seconds
    error_rate: 0.01, // Less than 1% error rate
    throughput_min: 50, // Minimum 50 requests/second
    memory_usage_max: 512 * 1024 * 1024, // 512MB max memory
    cpu_usage_max: 80 // 80% max CPU usage
  }
};

// Test data generators
const TEST_DATA = {
  searchQueries: [
    'iPhone 15',
    'Samsung Galaxy',
    'MacBook Pro',
    'Sony headphones',
    'gaming laptop',
    'wireless mouse',
    'smartphone case',
    'USB cable',
    'tablet computer',
    'bluetooth speaker',
    'camera lens',
    'laptop charger',
    'phone screen protector',
    'wireless earbuds',
    'smartwatch'
  ],
  
  complexQueries: [
    'recommend the best smartphone for photography under $800',
    'show me similar products to iPhone but cheaper',
    'what are the top trending electronics this month',
    'find laptops suitable for video editing and gaming',
    'compare wireless headphones with noise canceling features'
  ],

  imageUrls: [
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400',
    'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=400',
    'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400',
    'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=400'
  ],

  filters: [
    { category: 'electronics', min_price: 100, max_price: 500 },
    { condition: 'NEW', max_price: 1000 },
    { min_price: 50, max_price: 200, sort_by: 'price', sort_order: 'asc' },
    { is_featured: true, sort_by: 'created_at', sort_order: 'desc' }
  ]
};

// Performance metrics collector
class PerformanceMetrics {
  constructor() {
    this.metrics = {
      requests: [],
      errors: [],
      responseTimeStats: {
        min: Infinity,
        max: 0,
        sum: 0,
        count: 0,
        percentiles: {}
      },
      throughput: {
        requests_per_second: 0,
        total_requests: 0
      },
      systemMetrics: {
        memory: [],
        cpu: []
      }
    };
    
    this.startTime = performance.now();
    this.systemMetricsInterval = null;
  }

  startSystemMonitoring() {
    this.systemMetricsInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      this.metrics.systemMetrics.memory.push({
        timestamp: Date.now(),
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal
      });
      
      this.metrics.systemMetrics.cpu.push({
        timestamp: Date.now(),
        user: cpuUsage.user,
        system: cpuUsage.system
      });
    }, 1000);
  }

  stopSystemMonitoring() {
    if (this.systemMetricsInterval) {
      clearInterval(this.systemMetricsInterval);
    }
  }

  recordRequest(responseTime, status, endpoint, error = null) {
    const timestamp = Date.now();
    
    this.metrics.requests.push({
      timestamp,
      responseTime,
      status,
      endpoint,
      success: status >= 200 && status < 400
    });

    if (error || status >= 400) {
      this.metrics.errors.push({
        timestamp,
        status,
        endpoint,
        error: error?.message || 'HTTP Error'
      });
    }

    // Update response time stats
    const stats = this.metrics.responseTimeStats;
    stats.min = Math.min(stats.min, responseTime);
    stats.max = Math.max(stats.max, responseTime);
    stats.sum += responseTime;
    stats.count++;
  }

  calculateFinalMetrics() {
    const endTime = performance.now();
    const totalDuration = (endTime - this.startTime) / 1000; // seconds

    // Calculate throughput
    this.metrics.throughput = {
      requests_per_second: this.metrics.requests.length / totalDuration,
      total_requests: this.metrics.requests.length,
      duration: totalDuration
    };

    // Calculate response time percentiles
    const responseTimes = this.metrics.requests
      .map(r => r.responseTime)
      .sort((a, b) => a - b);

    this.metrics.responseTimeStats.percentiles = {
      p50: this.calculatePercentile(responseTimes, 50),
      p90: this.calculatePercentile(responseTimes, 90),
      p95: this.calculatePercentile(responseTimes, 95),
      p99: this.calculatePercentile(responseTimes, 99)
    };

    // Calculate error rate
    const errorCount = this.metrics.errors.length;
    this.metrics.errorRate = errorCount / this.metrics.requests.length;

    // Calculate average response time
    this.metrics.responseTimeStats.average = 
      this.metrics.responseTimeStats.sum / this.metrics.responseTimeStats.count;

    return this.metrics;
  }

  calculatePercentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)];
  }
}

// Load test runner
class SearchLoadTester {
  constructor(scenario, config) {
    this.scenario = scenario;
    this.config = config;
    this.metrics = new PerformanceMetrics();
    this.isRunning = false;
    this.workers = [];
  }

  async runLoadTest() {
    console.log(`\n🚀 Starting load test: ${this.scenario}`);
    console.log(`Duration: ${this.config.duration / 1000}s`);
    console.log(`Concurrent users: ${this.config.concurrent_users}`);
    console.log(`Target RPS: ${this.config.requests_per_second}`);
    
    this.isRunning = true;
    this.metrics.startSystemMonitoring();
    
    const startTime = Date.now();
    const endTime = startTime + this.config.duration;
    
    // Create worker threads for concurrent load
    const workerPromises = Array.from({ length: this.config.concurrent_users }, (_, i) =>
      this.createWorker(i, startTime, endTime)
    );

    // Wait for all workers to complete
    await Promise.all(workerPromises);
    
    this.isRunning = false;
    this.metrics.stopSystemMonitoring();
    
    const finalMetrics = this.metrics.calculateFinalMetrics();
    return this.analyzeResults(finalMetrics);
  }

  async createWorker(workerId, startTime, endTime) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: {
          workerId,
          config: this.config,
          startTime,
          endTime,
          baseUrl: LOAD_TEST_CONFIG.BASE_URL,
          testData: TEST_DATA
        }
      });

      worker.on('message', (data) => {
        if (data.type === 'request_completed') {
          this.metrics.recordRequest(
            data.responseTime,
            data.status,
            data.endpoint,
            data.error
          );
        }
      });

      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        } else {
          resolve();
        }
      });

      this.workers.push(worker);
    });
  }

  analyzeResults(metrics) {
    const results = {
      scenario: this.scenario,
      success: true,
      metrics,
      thresholdViolations: [],
      performance: 'PASS'
    };

    // Check performance thresholds
    const thresholds = LOAD_TEST_CONFIG.THRESHOLDS;
    
    if (metrics.responseTimeStats.percentiles.p95 > thresholds.response_time_p95) {
      results.thresholdViolations.push(
        `P95 response time (${metrics.responseTimeStats.percentiles.p95}ms) exceeds threshold (${thresholds.response_time_p95}ms)`
      );
    }

    if (metrics.responseTimeStats.percentiles.p99 > thresholds.response_time_p99) {
      results.thresholdViolations.push(
        `P99 response time (${metrics.responseTimeStats.percentiles.p99}ms) exceeds threshold (${thresholds.response_time_p99}ms)`
      );
    }

    if (metrics.errorRate > thresholds.error_rate) {
      results.thresholdViolations.push(
        `Error rate (${(metrics.errorRate * 100).toFixed(2)}%) exceeds threshold (${thresholds.error_rate * 100}%)`
      );
    }

    if (metrics.throughput.requests_per_second < thresholds.throughput_min) {
      results.thresholdViolations.push(
        `Throughput (${metrics.throughput.requests_per_second.toFixed(2)} RPS) below minimum (${thresholds.throughput_min} RPS)`
      );
    }

    // Check memory usage
    const maxMemory = Math.max(...metrics.systemMetrics.memory.map(m => m.heapUsed));
    if (maxMemory > thresholds.memory_usage_max) {
      results.thresholdViolations.push(
        `Memory usage (${(maxMemory / 1024 / 1024).toFixed(2)}MB) exceeds threshold (${thresholds.memory_usage_max / 1024 / 1024}MB)`
      );
    }

    if (results.thresholdViolations.length > 0) {
      results.success = false;
      results.performance = 'FAIL';
    }

    return results;
  }

  cleanup() {
    this.workers.forEach(worker => worker.terminate());
    this.metrics.stopSystemMonitoring();
  }
}

// Worker thread code for generating load
if (!isMainThread) {
  const { workerId, config, startTime, endTime, baseUrl, testData } = workerData;
  
  async function runWorkerLoad() {
    const requestDelay = Math.floor(1000 / (config.requests_per_second / config.concurrent_users));
    
    while (Date.now() < endTime) {
      const endpoint = config.endpoints[Math.floor(Math.random() * config.endpoints.length)];
      const requestStart = performance.now();
      
      try {
        
        let response;
        
        switch (endpoint) {
          case '/api/v1/search':
            response = await testTextSearch(baseUrl, testData);
            break;
          case '/api/v1/search/autocomplete':
            response = await testAutocomplete(baseUrl, testData);
            break;
          case '/api/v1/search/trending':
            response = await testTrending(baseUrl);
            break;
          case '/api/v1/search/advanced':
            response = await testAdvancedSearch(baseUrl, testData);
            break;
          case '/api/v1/search/image-url':
            response = await testImageSearch(baseUrl, testData);
            break;
          default:
            response = await testTextSearch(baseUrl, testData);
        }
        
        const responseTime = performance.now() - requestStart;
        
        parentPort.postMessage({
          type: 'request_completed',
          responseTime,
          status: response.status,
          endpoint,
          error: null
        });
        
      } catch (error) {
        const responseTime = performance.now() - requestStart;
        
        parentPort.postMessage({
          type: 'request_completed',
          responseTime,
          status: error.response?.status || 500,
          endpoint,
          error: {
            message: error.message,
            code: error.code,
            status: error.response?.status
          }
        });
      }
      
      // Wait before next request
      await new Promise(resolve => setTimeout(resolve, requestDelay + Math.random() * 100));
    }
  }
  
  // Test functions for different endpoints
  async function testTextSearch(baseUrl, testData) {
    const query = testData.searchQueries[Math.floor(Math.random() * testData.searchQueries.length)];
    const filters = testData.filters[Math.floor(Math.random() * testData.filters.length)];
    
    return axios.get(`${baseUrl}/api/v1/search`, {
      params: { q: query, ...filters },
      timeout: 10000
    });
  }
  
  async function testAutocomplete(baseUrl, testData) {
    const query = testData.searchQueries[Math.floor(Math.random() * testData.searchQueries.length)];
    const partialQuery = query.substring(0, 2 + Math.floor(Math.random() * 3));
    
    return axios.get(`${baseUrl}/api/v1/search/autocomplete`, {
      params: { q: partialQuery },
      timeout: 5000
    });
  }
  
  async function testTrending(baseUrl) {
    const timeframes = ['1h', '24h', '7d'];
    const timeframe = timeframes[Math.floor(Math.random() * timeframes.length)];
    
    return axios.get(`${baseUrl}/api/v1/search/trending`, {
      params: { timeframe, limit: 10 },
      timeout: 5000
    });
  }
  
  async function testAdvancedSearch(baseUrl, testData) {
    const query = testData.complexQueries[Math.floor(Math.random() * testData.complexQueries.length)];
    
    return axios.post(`${baseUrl}/api/v1/search/advanced`, {
      query,
      requireAI: Math.random() > 0.7, // 30% chance of AI
      analysisDepth: 'standard'
    }, {
      timeout: 15000
    });
  }
  
  async function testImageSearch(baseUrl, testData) {
    const imageUrl = testData.imageUrls[Math.floor(Math.random() * testData.imageUrls.length)];
    
    return axios.post(`${baseUrl}/api/v1/search/image-url`, {
      image_url: imageUrl
    }, {
      timeout: 20000
    });
  }
  
  runWorkerLoad().catch(console.error);
}

// Main test runner
class SearchPerformanceTestSuite {
  constructor() {
    this.results = [];
  }

  async runAllTests() {
    console.log('🧪 Starting Search Performance Test Suite\n');
    console.log('=' .repeat(60));
    
    for (const [scenarioName, config] of Object.entries(LOAD_TEST_CONFIG.SCENARIOS)) {
      try {
        const tester = new SearchLoadTester(scenarioName, config);
        const result = await tester.runLoadTest();
        this.results.push(result);
        
        this.printScenarioResults(result);
        tester.cleanup();
        
        // Wait between scenarios
        await new Promise(resolve => setTimeout(resolve, 5000));
        
      } catch (error) {
        console.error(`❌ Failed to run scenario ${scenarioName}:`, error.message);
        this.results.push({
          scenario: scenarioName,
          success: false,
          error: error.message,
          performance: 'ERROR'
        });
      }
    }

    this.printSummaryReport();
    await this.saveDetailedReport();
  }

  printScenarioResults(result) {
    const { scenario, success, metrics, thresholdViolations } = result;
    
    console.log(`\n📊 Results for ${scenario}:`);
    console.log('-'.repeat(40));
    console.log(`Status: ${success ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Total Requests: ${metrics.throughput.total_requests}`);
    console.log(`Throughput: ${metrics.throughput.requests_per_second.toFixed(2)} RPS`);
    console.log(`Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%`);
    console.log(`Avg Response Time: ${metrics.responseTimeStats.average.toFixed(2)}ms`);
    console.log(`P95 Response Time: ${metrics.responseTimeStats.percentiles.p95.toFixed(2)}ms`);
    console.log(`P99 Response Time: ${metrics.responseTimeStats.percentiles.p99.toFixed(2)}ms`);
    
    if (thresholdViolations.length > 0) {
      console.log('\n⚠️  Threshold Violations:');
      thresholdViolations.forEach(violation => {
        console.log(`  - ${violation}`);
      });
    }
  }

  printSummaryReport() {
    console.log('\n📈 PERFORMANCE TEST SUMMARY');
    console.log('=' .repeat(60));
    
    const passedTests = this.results.filter(r => r.success).length;
    const totalTests = this.results.length;
    
    console.log(`Overall Success Rate: ${passedTests}/${totalTests} (${((passedTests / totalTests) * 100).toFixed(1)}%)`);
    
    this.results.forEach(result => {
      const status = result.success ? '✅' : '❌';
      const perf = result.performance || 'N/A';
      console.log(`${status} ${result.scenario}: ${perf}`);
    });

    // Performance recommendations
    console.log('\n💡 Performance Recommendations:');
    this.generateRecommendations();
  }

  generateRecommendations() {
    const allMetrics = this.results.filter(r => r.metrics).map(r => r.metrics);
    
    if (allMetrics.length === 0) {
      console.log('  - No performance data available for recommendations');
      return;
    }

    // Analyze response times
    const avgResponseTimes = allMetrics.map(m => m.responseTimeStats.average);
    const maxAvgResponseTime = Math.max(...avgResponseTimes);
    
    if (maxAvgResponseTime > 1000) {
      console.log('  - Consider implementing response caching for frequently searched queries');
      console.log('  - Optimize database queries and add appropriate indexes');
    }

    // Analyze error rates
    const errorRates = allMetrics.map(m => m.errorRate);
    const maxErrorRate = Math.max(...errorRates);
    
    if (maxErrorRate > 0.005) { // More than 0.5%
      console.log('  - Implement circuit breakers for external AI service calls');
      console.log('  - Add more robust error handling and fallback mechanisms');
    }

    // Analyze throughput
    const throughputs = allMetrics.map(m => m.throughput.requests_per_second);
    const minThroughput = Math.min(...throughputs);
    
    if (minThroughput < 75) {
      console.log('  - Consider horizontal scaling for search services');
      console.log('  - Implement connection pooling and optimize resource usage');
    }

    console.log('  - Monitor AI service costs and optimize AI vs traditional search routing');
    console.log('  - Implement search result caching for popular queries');
  }

  async saveDetailedReport() {
    const report = {
      timestamp: new Date().toISOString(),
      testSuite: 'Search Performance Tests',
      configuration: LOAD_TEST_CONFIG,
      results: this.results,
      summary: {
        totalScenarios: this.results.length,
        passedScenarios: this.results.filter(r => r.success).length,
        failedScenarios: this.results.filter(r => !r.success).length
      }
    };

    const reportPath = path.join(__dirname, `../../../reports/search-performance-${Date.now()}.json`);
    
    try {
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    } catch (error) {
      console.error('Failed to save detailed report:', error.message);
    }
  }
}

// Export for programmatic use
module.exports = {
  SearchLoadTester,
  SearchPerformanceTestSuite,
  LOAD_TEST_CONFIG,
  PerformanceMetrics
};

// Run tests if this file is executed directly
if (require.main === module && isMainThread) {
  const testSuite = new SearchPerformanceTestSuite();
  
  testSuite.runAllTests()
    .then(() => {
      console.log('\n🎉 Performance test suite completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Performance test suite failed:', error);
      process.exit(1);
    });
}