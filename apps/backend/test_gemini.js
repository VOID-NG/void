// test_gemini_free_tier.js
// Quick test that works within Gemini free tier limits

const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
require('dotenv').config();

// ================================
// FREE TIER CONFIGURATION
// ================================

const FREE_TIER_CONFIG = {
  MODEL: 'gemini-1.5-flash', // 15 requests/min vs 2 for Pro
  LIMITS: {
    REQUESTS_PER_MINUTE: 15,
    REQUESTS_PER_DAY: 1500,
    INPUT_TOKENS_PER_MINUTE: 1000000
  },
  COST: 0, // Free!
  PAID_ALTERNATIVE: {
    MODEL: 'gemini-1.5-pro',
    COST_PER_IMAGE: 0.00125, // Still 87% cheaper than OpenAI
    LIMITS: 'Much higher'
  }
};

// ================================
// SIMPLE RATE LIMITER
// ================================

let requestCount = 0;
let lastMinute = Math.floor(Date.now() / 60000);

function canMakeRequest() {
  const currentMinute = Math.floor(Date.now() / 60000);
  
  if (currentMinute > lastMinute) {
    requestCount = 0;
    lastMinute = currentMinute;
  }
  
  return requestCount < FREE_TIER_CONFIG.LIMITS.REQUESTS_PER_MINUTE;
}

function recordRequest() {
  requestCount++;
}

// ================================
// FREE TIER GEMINI TEST
// ================================

/**
 * Test Gemini Flash model (free tier friendly)
 * @param {string} imageUrl - Image URL to analyze
 * @returns {Promise<Object>} Test results
 */
async function testGeminiFlash(imageUrl) {
  try {
    // Check rate limits
    if (!canMakeRequest()) {
      const waitTime = 60 - (Date.now() % 60000) / 1000;
      return {
        success: false,
        error: `Rate limited. Wait ${Math.ceil(waitTime)}s. Used ${requestCount}/${FREE_TIER_CONFIG.LIMITS.REQUESTS_PER_MINUTE} requests this minute.`,
        rateLimited: true
      };
    }

    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      return {
        success: false,
        error: 'Google API key not found. Set GOOGLE_API_KEY in .env',
        setup: true
      };
    }

    console.log(`🧪 Testing Gemini Flash (FREE): ${imageUrl}`);
    console.log(`📊 Current usage: ${requestCount}/${FREE_TIER_CONFIG.LIMITS.REQUESTS_PER_MINUTE} requests this minute`);
    
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: FREE_TIER_CONFIG.MODEL // Use Flash, not Pro
    });

    const startTime = Date.now();

    // Download image
    const imageResponse = await axios.get(imageUrl, { 
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    const imageBase64 = Buffer.from(imageResponse.data).toString('base64');
    const mimeType = imageResponse.headers['content-type'] || 'image/jpeg';

    // Shorter prompt to save tokens
    const prompt = `Describe this product for marketplace search: type, brand, color, features.`;

    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: mimeType
      }
    };

    // Record request
    recordRequest();

    // Generate content
    const result = await model.generateContent([prompt, imagePart]);
    const description = result.response.text();
    const endTime = Date.now();

    return {
      success: true,
      imageUrl,
      description,
      responseTime: endTime - startTime,
      model: FREE_TIER_CONFIG.MODEL,
      cost: FREE_TIER_CONFIG.COST,
      tier: 'FREE',
      requestsUsed: requestCount,
      requestsRemaining: FREE_TIER_CONFIG.LIMITS.REQUESTS_PER_MINUTE - requestCount
    };

  } catch (error) {
    return {
      success: false,
      imageUrl,
      error: error.message,
      model: FREE_TIER_CONFIG.MODEL,
      isQuotaError: error.message.includes('429') || error.message.includes('quota')
    };
  }
}

/**
 * Test multiple images with proper spacing
 * @param {string[]} imageUrls - Array of image URLs
 * @returns {Promise<void>}
 */
async function testMultipleImages(imageUrls) {
  console.log('🚀 TESTING GEMINI FREE TIER\n');
  console.log(`Model: ${FREE_TIER_CONFIG.MODEL}`);
  console.log(`Limits: ${FREE_TIER_CONFIG.LIMITS.REQUESTS_PER_MINUTE} requests/minute`);
  console.log(`Cost: FREE! 🎉\n`);

  const results = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    
    console.log(`📸 Testing Image ${i + 1}/${imageUrls.length}`);
    
    const result = await testGeminiFlash(imageUrl);
    results.push(result);
    
    if (result.success) {
      console.log(`✅ SUCCESS (${result.responseTime}ms)`);
      console.log(`   Description: "${result.description.substring(0, 80)}..."`);
      console.log(`   Requests remaining: ${result.requestsRemaining}/minute\n`);
    } else if (result.rateLimited) {
      console.log(`⏳ RATE LIMITED: ${result.error}`);
      console.log(`   💡 Solution: Wait or upgrade to paid tier\n`);
      break;
    } else if (result.isQuotaError) {
      console.log(`❌ QUOTA EXCEEDED`);
      console.log(`   💡 Solutions:`);
      console.log(`      1. Wait until tomorrow (daily limit reset)`);
      console.log(`      2. Upgrade to paid tier ($0.00125/image)`);
      console.log(`      3. Use OpenAI fallback ($0.015/image)\n`);
      break;
    } else {
      console.log(`❌ ERROR: ${result.error}\n`);
    }

    // Space out requests to avoid rate limiting
    if (i < imageUrls.length - 1) {
      console.log('⏱️  Waiting 5 seconds to respect rate limits...\n');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // Generate summary
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log('📊 TEST SUMMARY');
  console.log('=' .repeat(40));
  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  
  if (successful.length > 0) {
    const avgTime = successful.reduce((sum, r) => sum + r.responseTime, 0) / successful.length;
    console.log(`⏱️  Average response time: ${avgTime.toFixed(0)}ms`);
    console.log(`💰 Total cost: $0 (FREE TIER!)`);
  }

  console.log('\n🎯 NEXT STEPS:');
  if (successful.length > 0) {
    console.log('✅ Gemini Flash working on free tier!');
    console.log('✅ Replace your searchService.js');
    console.log('✅ Add rate limiting for production');
  }
  
  if (failed.some(r => r.isQuotaError)) {
    console.log('💡 Consider paid tier for higher limits:');
    console.log(`   • Gemini Pro: $0.00125/image (87% cheaper than OpenAI)`);
    console.log(`   • Much higher rate limits`);
    console.log(`   • Still massive cost savings vs OpenAI!`);
  }
}

/**
 * Compare free vs paid tier costs
 */
function showCostComparison() {
  console.log('\n💰 COST COMPARISON (per 1000 images)');
  console.log('=' .repeat(50));
  console.log(`OpenAI GPT-4 Vision:     $15.00`);
  console.log(`Gemini Flash (FREE):     $0.00    (100% savings!) 🎉`);
  console.log(`Gemini Pro (PAID):       $1.25    (92% savings!)  🔥`);
  console.log(`\nFree tier limits:        50 images/day`);
  console.log(`Paid tier limits:        Virtually unlimited`);
}

// ================================
// MAIN EXECUTION
// ================================

async function main() {
  const testImages = [
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=500', // iPhone
    'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=500'  // Laptop
  ];

  // Show cost comparison first
  showCostComparison();

  // Test with rate limiting
  await testMultipleImages(testImages);

  console.log('\n🔧 TROUBLESHOOTING:');
  console.log('Rate limit hit? → Wait 1 minute or use paid tier');
  console.log('Daily quota exceeded? → Wait until tomorrow or upgrade');
  console.log('API key issues? → Check GOOGLE_API_KEY in .env');
  console.log('Need higher limits? → $0.00125/image (still 87% cheaper!)');
}

// Export for use
module.exports = {
  testGeminiFlash,
  testMultipleImages,
  FREE_TIER_CONFIG
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}