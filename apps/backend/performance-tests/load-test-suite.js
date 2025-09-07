// apps/backend/performance-tests/load-test-suite.js
// performance testing framework

const artillery = require('artillery');
const autocannon = require('autocannon');
const clinic = require('clinic');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../src/utils/logger');

// ================================
// COMPREHENSIVE PERFORMANCE TESTER
// ================================

class PerformanceTester {
  constructor() {
    this.testResults = new Map();
    this.testSuites = new Map();
    this.setupTestSuites();
    
    // Performance thresholds
    this.thresholds = {
      responseTime: {
        p50: 200,    // 50th percentile < 200ms
        p95: 500,    // 95th percentile < 500ms
        p99: 1000    // 99th percentile < 1000ms
      },
      throughput: {
        min: 1000,   // Minimum 1000 requests/second
        target: 5000 // Target 5000 requests/second
      },
      errorRate: {
        max: 0.01    // Maximum 1% error rate
      },
      cpu: {
        max: 80      // Maximum 80% CPU usage
      },
      memory: {
        max: 85      // Maximum 85% memory usage
      }
    };
  }

  // ================================
  // TEST SUITE DEFINITIONS
  // ================================

  setupTestSuites() {
    // Basic API load test
    this.testSuites.set('api_load_test', {
      name: 'API Load Test',
      description: 'Basic API endpoints under increasing load',
      type: 'load',
      duration: 300, // 5 minutes
      scenarios: [
        { name: 'listings_get', weight: 40, endpoint: '/api/v1/listings' },
        { name: 'search_query', weight: 30, endpoint: '/api/v1/search?q=electronics' },
        { name: 'categories_get', weight: 20, endpoint: '/api/v1/categories' },
        { name: 'health_check', weight: 10, endpoint: '/api/v1/health' }
      ]
    });

    // Authentication stress test
    this.testSuites.set('auth_stress_test', {
      name: 'Authentication Stress Test',
      description: 'High-frequency authentication requests',
      type: 'stress',
      duration: 180, // 3 minutes
      scenarios: [
        { name: 'login', weight: 60, endpoint: '/api/v1/auth/login', method: 'POST' },
        { name: 'register', weight: 25, endpoint: '/api/v1/auth/register', method: 'POST' },
        { name: 'refresh', weight: 15, endpoint: '/api/v1/auth/refresh', method: 'POST' }
      ]
    });

    // File upload performance test
    this.testSuites.set('upload_performance_test', {
      name: 'File Upload Performance Test',
      description: 'File upload endpoints under load',
      type: 'load',
      duration: 240, // 4 minutes
      scenarios: [
        { name: 'image_upload', weight: 70, endpoint: '/api/v1/upload/images', method: 'POST' },
        { name: 'video_upload', weight: 20, endpoint: '/api/v1/upload/videos', method: 'POST' },
        { name: 'model_upload', weight: 10, endpoint: '/api/v1/upload/models', method: 'POST' }
      ]
    });

    // Real-time messaging stress test
    this.testSuites.set('realtime_stress_test', {
      name: 'Real-time Messaging Stress Test',
      description: 'Socket.IO connections and messaging under load',
      type: 'stress',
      duration: 300, // 5 minutes
      scenarios: [
        { name: 'socket_connect', weight: 40, type: 'websocket' },
        { name: 'chat_message', weight: 40, type: 'websocket' },
        { name: 'typing_indicator', weight: 20, type: 'websocket' }
      ]
    });

    // Database performance test
    this.testSuites.set('database_performance_test', {
      name: 'Database Performance Test',
      description: 'Database-heavy operations under load',
      type: 'load',
      duration: 360, // 6 minutes
      scenarios: [
        { name: 'complex_search', weight: 30, endpoint: '/api/v1/search?q=electronics&filters=complex' },
        { name: 'user_dashboard', weight: 25, endpoint: '/api/v1/users/dashboard' },
        { name: 'analytics_query', weight: 20, endpoint: '/api/v1/analytics/summary' },
        { name: 'report_generation', weight: 15, endpoint: '/api/v1/reports/generate' },
        { name: 'bulk_operations', weight: 10, endpoint: '/api/v1/admin/bulk' }
      ]
    });

    // Spike test
    this.testSuites.set('spike_test', {
      name: 'Traffic Spike Test',
      description: 'Sudden traffic spikes simulation',
      type: 'spike',
      duration: 180, // 3 minutes
      scenarios: [
        { name: 'flash_sale', weight: 60, endpoint: '/api/v1/listings/featured' },
        { name: 'viral_content', weight: 30, endpoint: '/api/v1/listings/trending' },
        { name: 'breaking_news', weight: 10, endpoint: '/api/v1/notifications' }
      ]
    });
  }

  // ================================
  // ARTILLERY.JS INTEGRATION
  // ================================

  async runArtilleryTest(testSuiteName, options = {}) {
    const testSuite = this.testSuites.get(testSuiteName);
    if (!testSuite) {
      throw new Error(`Test suite '${testSuiteName}' not found`);
    }

    const config = this.generateArtilleryConfig(testSuite, options);
    const configPath = path.join(__dirname, `configs/${testSuiteName}_config.yml`);
    
    // Write config to file
    await this.writeArtilleryConfig(configPath, config);
    
    logger.info(`🧪 Starting Artillery test: ${testSuite.name}`);
    
    return new Promise((resolve, reject) => {
      artillery.run(configPath, {
        output: path.join(__dirname, `results/${testSuiteName}_results.json`)
      }, (error, results) => {
        if (error) {
          reject(error);
        } else {
          this.testResults.set(testSuiteName, results);
          resolve(results);
        }
      });
    });
  }

  generateArtilleryConfig(testSuite, options) {
    const baseUrl = options.baseUrl || 'http://localhost:5000';
    
    return {
      config: {
        target: baseUrl,
        phases: this.generateLoadPhases(testSuite.type, testSuite.duration),
        payload: {
          path: path.join(__dirname, 'fixtures/test-data.csv'),
          fields: ['email', 'password', 'listingId', 'searchQuery']
        },
        plugins: {
          metrics: {
            statsd: {
              host: 'localhost',
              port: 8125,
              prefix: 'artillery.'
            }
          }
        }
      },
      scenarios: this.generateArtilleryScenarios(testSuite.scenarios)
    };
  }

  generateLoadPhases(testType, duration) {
    const phases = [];
    const totalDuration = duration;

    switch (testType) {
      case 'load':
        phases.push(
          { duration: Math.floor(totalDuration * 0.2), arrivalRate: 10, name: 'Warm up' },
          { duration: Math.floor(totalDuration * 0.6), arrivalRate: 50, name: 'Sustained load' },
          { duration: Math.floor(totalDuration * 0.2), arrivalRate: 10, name: 'Cool down' }
        );
        break;

      case 'stress':
        phases.push(
          { duration: Math.floor(totalDuration * 0.1), arrivalRate: 10, name: 'Warm up' },
          { duration: Math.floor(totalDuration * 0.3), arrivalRate: 100, name: 'Ramp up' },
          { duration: Math.floor(totalDuration * 0.4), arrivalRate: 200, name: 'Peak stress' },
          { duration: Math.floor(totalDuration * 0.2), arrivalRate: 50, name: 'Cool down' }
        );
        break;

      case 'spike':
        phases.push(
          { duration: Math.floor(totalDuration * 0.3), arrivalRate: 20, name: 'Normal load' },
          { duration: Math.floor(totalDuration * 0.1), arrivalRate: 500, name: 'Spike' },
          { duration: Math.floor(totalDuration * 0.3), arrivalRate: 20, name: 'Recovery' },
          { duration: Math.floor(totalDuration * 0.1), arrivalRate: 1000, name: 'Second spike' },
          { duration: Math.floor(totalDuration * 0.2), arrivalRate: 20, name: 'Final recovery' }
        );
        break;

      default:
        phases.push({ duration: totalDuration, arrivalRate: 50, name: 'Default test' });
    }

    return phases;
  }

  generateArtilleryScenarios(scenarios) {
    return scenarios.map(scenario => ({
      name: scenario.name,
      weight: scenario.weight,
      flow: this.generateScenarioFlow(scenario)
    }));
  }

  generateScenarioFlow(scenario) {
    const flow = [];

    if (scenario.type === 'websocket') {
      flow.push(
        { ws: { url: '/socket.io/?EIO=4&transport=websocket' } },
        { send: { match: { json: '$.type', value: 'connection' } } },
        { think: 1 },
        { send: { match: { json: '$.type', value: 'message' } } },
        { think: 2 }
      );
    } else {
      const request = {
        [scenario.method || 'get']: {
          url: scenario.endpoint,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Artillery-LoadTest/1.0'
          }
        }
      };

      if (scenario.method === 'POST') {
        request[scenario.method].json = this.generateRequestPayload(scenario.name);
      }

      flow.push(request);
      flow.push({ think: 1 }); // 1 second think time
    }

    return flow;
  }

  generateRequestPayload(scenarioName) {
    const payloads = {
      login: {
        email: '{{ email }}',
        password: '{{ password }}'
      },
      register: {
        email: 'test_{{ $randomString() }}@example.com',
        password: 'TestPassword123!',
        firstName: 'Test',
        lastName: 'User'
      },
      image_upload: {
        file: 'base64encodedimagedata...',
        filename: 'test-image.jpg',
        type: 'image/jpeg'
      },
      video_upload: {
        file: 'base64encodedvideodata...',
        filename: 'test-video.mp4',
        type: 'video/mp4'
      },
      chat_message: {
        chatId: '{{ listingId }}',
        content: 'Test message {{ $randomString() }}',
        type: 'TEXT'
      }
    };

    return payloads[scenarioName] || {};
  }

  // ================================
  // AUTOCANNON INTEGRATION
  // ================================

  async runAutocannonTest(endpoint, options = {}) {
    const defaultOptions = {
      url: `http://localhost:5000${endpoint}`,
      connections: 100,
      duration: 60,
      pipelining: 1,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Autocannon-LoadTest/1.0'
      }
    };

    const testOptions = { ...defaultOptions, ...options };
    
    logger.info(`🚀 Starting Autocannon test: ${endpoint}`);
    
    return new Promise((resolve, reject) => {
      autocannon(testOptions, (error, results) => {
        if (error) {
          reject(error);
        } else {
          const processedResults = this.processAutocannonResults(results);
          resolve(processedResults);
        }
      });
    });
  }

  processAutocannonResults(results) {
    return {
      summary: {
        duration: results.duration,
        connections: results.connections,
        pipelining: results.pipelining,
        url: results.url
      },
      throughput: {
        requests: results.requests,
        bytes: results.throughput
      },
      latency: {
        average: results.latency.average,
        p50: results.latency.p50,
        p90: results.latency.p90,
        p95: results.latency.p95,
        p99: results.latency.p99,
        max: results.latency.max
      },
      errors: results.errors,
      timeouts: results.timeouts,
      status: this.evaluatePerformance(results)
    };
  }

  // ================================
  // CLINIC.JS PROFILING
  // ================================

  async runProfilingTest(testFunction, profileType = 'doctor') {
    logger.info(`🔬 Starting Clinic.js profiling: ${profileType}`);
    
    const profilePath = path.join(__dirname, `profiles/${Date.now()}_${profileType}`);
    
    return new Promise((resolve, reject) => {
      const clinicCommand = clinic[profileType];
      
      if (!clinicCommand) {
        reject(new Error(`Unknown profile type: ${profileType}`));
        return;
      }

      clinicCommand({
        dest: profilePath,
        debug: true
      }, testFunction, (error, report) => {
        if (error) {
          reject(error);
        } else {
          logger.info(`📊 Profile saved to: ${profilePath}`);
          resolve(report);
        }
      });
    });
  }

  // ================================
  // COMPREHENSIVE TEST RUNNER
  // ================================

  async runFullTestSuite(options = {}) {
    const results = {
      startTime: new Date(),
      tests: [],
      summary: {},
      recommendations: []
    };

    logger.info('🧪 Starting comprehensive performance test suite');

    try {
      // 1. API Load Tests
      logger.info('📊 Running API load tests...');
      const apiLoadResults = await this.runArtilleryTest('api_load_test', options);
      results.tests.push({ name: 'API Load Test', results: apiLoadResults });

      // 2. Authentication Stress Test
      logger.info('🔐 Running authentication stress test...');
      const authStressResults = await this.runArtilleryTest('auth_stress_test', options);
      results.tests.push({ name: 'Auth Stress Test', results: authStressResults });

      // 3. Database Performance Test
      logger.info('🗄️ Running database performance test...');
      const dbPerformanceResults = await this.runArtilleryTest('database_performance_test', options);
      results.tests.push({ name: 'Database Performance Test', results: dbPerformanceResults });

      // 4. Spike Test
      logger.info('⚡ Running spike test...');
      const spikeResults = await this.runArtilleryTest('spike_test', options);
      results.tests.push({ name: 'Spike Test', results: spikeResults });

      // 5. Individual endpoint benchmarks
      logger.info('🎯 Running endpoint benchmarks...');
      const benchmarkResults = await this.runEndpointBenchmarks();
      results.tests.push({ name: 'Endpoint Benchmarks', results: benchmarkResults });

      // 6. System resource monitoring
      logger.info('📈 Collecting system metrics...');
      const systemMetrics = await this.collectSystemMetrics();
      results.tests.push({ name: 'System Metrics', results: systemMetrics });

      results.endTime = new Date();
      results.summary = this.generateTestSummary(results);
      results.recommendations = this.generateRecommendations(results);

      // Save results
      await this.saveTestResults(results);
      
      // Generate report
      await this.generatePerformanceReport(results);

      logger.info('✅ Performance test suite completed');
      return results;

    } catch (error) {
      logger.error('❌ Performance test suite failed:', error);
      throw error;
    }
  }

  async runEndpointBenchmarks() {
    const endpoints = [
      '/api/v1/listings',
      '/api/v1/search?q=test',
      '/api/v1/categories',
      '/api/v1/auth/me',
      '/api/v1/health'
    ];

    const results = {};

    for (const endpoint of endpoints) {
      try {
        logger.info(`🎯 Benchmarking ${endpoint}`);
        const result = await this.runAutocannonTest(endpoint, {
          connections: 50,
          duration: 30
        });
        results[endpoint] = result;
      } catch (error) {
        logger.error(`Benchmark failed for ${endpoint}:`, error);
        results[endpoint] = { error: error.message };
      }
    }

    return results;
  }

  async collectSystemMetrics() {
    const os = require('os');
    const v8 = require('v8');

    return {
      cpu: {
        cores: os.cpus().length,
        loadAverage: os.loadavg(),
        usage: process.cpuUsage()
      },
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        process: process.memoryUsage(),
        heap: v8.getHeapStatistics()
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        uptime: os.uptime(),
        processUptime: process.uptime()
      }
    };
  }

  // ================================
  // PERFORMANCE EVALUATION
  // ================================

  evaluatePerformance(results) {
    const issues = [];
    const warnings = [];
    let overallScore = 100;

    // Check response time thresholds
    if (results.latency.p95 > this.thresholds.responseTime.p95) {
      issues.push(`P95 response time (${results.latency.p95}ms) exceeds threshold (${this.thresholds.responseTime.p95}ms)`);
      overallScore -= 20;
    } else if (results.latency.p95 > this.thresholds.responseTime.p95 * 0.8) {
      warnings.push(`P95 response time approaching threshold`);
      overallScore -= 5;
    }

    // Check throughput
    const rps = results.requests.average;
    if (rps < this.thresholds.throughput.min) {
      issues.push(`Throughput (${rps} req/s) below minimum threshold (${this.thresholds.throughput.min} req/s)`);
      overallScore -= 25;
    }

    // Check error rate
    const errorRate = results.errors / results.requests.total;
    if (errorRate > this.thresholds.errorRate.max) {
      issues.push(`Error rate (${(errorRate * 100).toFixed(2)}%) exceeds maximum (${this.thresholds.errorRate.max * 100}%)`);
      overallScore -= 30;
    }

    return {
      score: Math.max(0, overallScore),
      status: overallScore >= 80 ? 'PASS' : overallScore >= 60 ? 'WARNING' : 'FAIL',
      issues,
      warnings
    };
  }

  generateTestSummary(results) {
    const totalTests = results.tests.length;
    const passedTests = results.tests.filter(test => 
      test.results.status?.status === 'PASS'
    ).length;

    return {
      duration: results.endTime - results.startTime,
      totalTests,
      passedTests,
      failedTests: totalTests - passedTests,
      successRate: (passedTests / totalTests) * 100,
      overallStatus: passedTests === totalTests ? 'PASS' : 'FAIL'
    };
  }

  generateRecommendations(results) {
    const recommendations = [];

    results.tests.forEach(test => {
      if (test.results.status?.issues) {
        test.results.status.issues.forEach(issue => {
          if (issue.includes('response time')) {
            recommendations.push({
              type: 'performance',
              priority: 'high',
              title: 'Optimize Response Times',
              description: 'Consider implementing caching, database query optimization, or load balancing',
              affected: test.name
            });
          }
          
          if (issue.includes('throughput')) {
            recommendations.push({
              type: 'scalability',
              priority: 'high',
              title: 'Increase Throughput Capacity',
              description: 'Scale horizontally with more instances or optimize request processing',
              affected: test.name
            });
          }
          
          if (issue.includes('error rate')) {
            recommendations.push({
              type: 'reliability',
              priority: 'critical',
              title: 'Reduce Error Rate',
              description: 'Investigate and fix the root causes of errors',
              affected: test.name
            });
          }
        });
      }
    });

    return recommendations;
  }

  // ================================
  // REPORT GENERATION
  // ================================

  async generatePerformanceReport(results) {
    const reportPath = path.join(__dirname, `reports/performance_report_${Date.now()}.html`);
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Void Marketplace - Performance Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric-card { background: #f8f9fa; padding: 20px; border-radius: 6px; text-align: center; }
        .metric-value { font-size: 2em; font-weight: bold; color: #2c3e50; }
        .metric-label { color: #666; margin-top: 5px; }
        .test-result { margin-bottom: 30px; padding: 20px; border: 1px solid #ddd; border-radius: 6px; }
        .status-pass { color: #27ae60; }
        .status-fail { color: #e74c3c; }
        .status-warning { color: #f39c12; }
        .recommendations { background: #fff3cd; padding: 20px; border-radius: 6px; border-left: 4px solid #ffc107; }
        .chart-container { margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f8f9fa; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Void Marketplace Performance Test Report</h1>
            <p>Generated on ${new Date().toISOString()}</p>
            <p>Test Duration: ${Math.round((results.endTime - results.startTime) / 1000 / 60)} minutes</p>
        </div>

        <div class="summary">
            <div class="metric-card">
                <div class="metric-value ${results.summary.overallStatus.toLowerCase() === 'pass' ? 'status-pass' : 'status-fail'}">
                    ${results.summary.overallStatus}
                </div>
                <div class="metric-label">Overall Status</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${results.summary.successRate.toFixed(1)}%</div>
                <div class="metric-label">Success Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${results.summary.totalTests}</div>
                <div class="metric-label">Tests Run</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${results.summary.passedTests}</div>
                <div class="metric-label">Tests Passed</div>
            </div>
        </div>

        <h2>📊 Test Results</h2>
        ${results.tests.map(test => `
            <div class="test-result">
                <h3>${test.name}</h3>
                <p><strong>Status:</strong> <span class="status-${test.results.status?.status?.toLowerCase() || 'unknown'}">${test.results.status?.status || 'Unknown'}</span></p>
                ${test.results.latency ? `
                    <table>
                        <tr><th>Metric</th><th>Value</th></tr>
                        <tr><td>Average Response Time</td><td>${test.results.latency.average}ms</td></tr>
                        <tr><td>P95 Response Time</td><td>${test.results.latency.p95}ms</td></tr>
                        <tr><td>P99 Response Time</td><td>${test.results.latency.p99}ms</td></tr>
                        <tr><td>Max Response Time</td><td>${test.results.latency.max}ms</td></tr>
                    </table>
                ` : ''}
                ${test.results.status?.issues?.length > 0 ? `
                    <h4>Issues:</h4>
                    <ul>${test.results.status.issues.map(issue => `<li class="status-fail">${issue}</li>`).join('')}</ul>
                ` : ''}
                ${test.results.status?.warnings?.length > 0 ? `
                    <h4>Warnings:</h4>
                    <ul>${test.results.status.warnings.map(warning => `<li class="status-warning">${warning}</li>`).join('')}</ul>
                ` : ''}
            </div>
        `).join('')}

        ${results.recommendations.length > 0 ? `
            <div class="recommendations">
                <h2>💡 Recommendations</h2>
                ${results.recommendations.map(rec => `
                    <div style="margin-bottom: 15px;">
                        <h4>${rec.title} <span style="color: ${rec.priority === 'critical' ? '#e74c3c' : rec.priority === 'high' ? '#f39c12' : '#3498db'};">[${rec.priority.toUpperCase()}]</span></h4>
                        <p>${rec.description}</p>
                        <small>Affected: ${rec.affected}</small>
                    </div>
                `).join('')}
            </div>
        ` : ''}

        <div style="margin-top: 40px; text-align: center; color: #666;">
            <p>Report generated by Void Marketplace Performance Testing Framework</p>
        </div>
    </div>
</body>
</html>
    `;

    await fs.writeFile(reportPath, html);
    logger.info(`📄 Performance report saved to: ${reportPath}`);
    
    return reportPath;
  }

  async saveTestResults(results) {
    const resultsPath = path.join(__dirname, `results/test_results_${Date.now()}.json`);
    await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));
    logger.info(`💾 Test results saved to: ${resultsPath}`);
  }

  async writeArtilleryConfig(configPath, config) {
    const yaml = require('js-yaml');
    const yamlContent = yaml.dump(config);
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, yamlContent);
  }

  // ================================
  // CONTINUOUS MONITORING
  // ================================

  async startContinuousMonitoring(interval = 300000) { // 5 minutes
    logger.info('🔄 Starting continuous performance monitoring');
    
    setInterval(async () => {
      try {
        await this.runQuickHealthCheck();
      } catch (error) {
        logger.error('Continuous monitoring check failed:', error);
      }
    }, interval);
  }

  async runQuickHealthCheck() {
    const quickTests = [
      { endpoint: '/api/v1/health', threshold: 100 },
      { endpoint: '/api/v1/listings?limit=10', threshold: 300 },
      { endpoint: '/api/v1/categories', threshold: 200 }
    ];

    for (const test of quickTests) {
      const result = await this.runAutocannonTest(test.endpoint, {
        connections: 10,
        duration: 10
      });

      if (result.latency.average > test.threshold) {
        logger.warn(`⚠️  Performance degradation detected on ${test.endpoint}`, {
          currentLatency: result.latency.average,
          threshold: test.threshold
        });
      }
    }
  }
}

// ================================
// CLI INTERFACE
// ================================

class PerformanceTestCLI {
  static async run() {
    const args = process.argv.slice(2);
    const command = args[0];
    const tester = new PerformanceTester();

    try {
      switch (command) {
        case 'full':
          await tester.runFullTestSuite();
          break;
          
        case 'load':
          await tester.runArtilleryTest('api_load_test');
          break;
          
        case 'stress':
          await tester.runArtilleryTest('auth_stress_test');
          break;
          
        case 'spike':
          await tester.runArtilleryTest('spike_test');
          break;
          
        case 'benchmark':
          await tester.runEndpointBenchmarks();
          break;
          
        case 'monitor':
          await tester.startContinuousMonitoring();
          break;
          
        default:
          console.log(`
🧪 Void Marketplace Performance Testing CLI

Usage: node performance-tests/load-test-suite.js <command>

Commands:
  full       Run complete test suite
  load       Run load tests
  stress     Run stress tests
  spike      Run spike tests
  benchmark  Run endpoint benchmarks
  monitor    Start continuous monitoring

Examples:
  node performance-tests/load-test-suite.js full
  node performance-tests/load-test-suite.js load
  node performance-tests/load-test-suite.js monitor
          `);
      }
    } catch (error) {
      console.error('❌ Test execution failed:', error);
      process.exit(1);
    }
  }
}

// ================================
// EXPORT AND CLI RUNNER
// ================================

if (require.main === module) {
  PerformanceTestCLI.run();
}

module.exports = {
  PerformanceTester,
  PerformanceTestCLI
};