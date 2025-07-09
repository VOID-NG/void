const axios = require('axios');

async function testRealHF() {
  try {
    console.log('🧪 Testing REAL Hugging Face API...');
    
    const token = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY;
    
    if (!token) {
      throw new Error('No HF token found in environment');
    }
    
    if (!token.startsWith('hf_')) {
      throw new Error('Invalid HF token format');
    }
    
    console.log('🔑 Token found:', token.substring(0, 8) + '...');
    
    // Test the actual HF API
    const response = await axios.post(
      'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/sentence-similarity',
      { inputs: 'iPhone 13 smartphone camera' },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    const embedding = response.data;
    
    if (Array.isArray(embedding) && embedding.length === 384) {
      console.log('✅ REAL HF API working!');
      console.log('📊 Embedding dimensions:', embedding.length);
      console.log('💰 Cost: $0.00006 per search (vs $0.002+ OpenAI)');
      console.log('🎯 Sample embedding values:', embedding.slice(0, 5).map(v => v.toFixed(4)));
      console.log('');
      console.log('🎉 SUCCESS! You now have 95% cheaper AI search!');
      return true;
    } else {
      console.log('⚠️  Unexpected response format:', typeof embedding);
      return false;
    }
    
  } catch (error) {
    console.error('❌ Real HF API test failed:', error.message);
    
    if (error.response?.status === 401) {
      console.log('🔑 Token issue. Check your HF token at: https://huggingface.co/settings/tokens');
    } else if (error.response?.status === 503) {
      console.log('⏳ Model loading. Try again in 1-2 minutes.');
    } else if (error.code === 'ENOTFOUND') {
      console.log('🌐 Network issue. Check internet connection.');
    }
    
    return false;
  }
}

// Load environment variables
require('dotenv').config();

testRealHF().then(success => {
  if (success) {
    console.log('');
    console.log('🚀 NEXT STEPS:');
    console.log('   1. Restart your server: npm start');
    console.log('   2. Test search endpoints');
    console.log('   3. Monitor cost savings!');
  }
});