// Unified search service: delegates to Gemini-enhanced flows or vector engine

const logger = require('../utils/logger');
const {
  searchByText,
  searchByMedia,
  getAIRecommendations,
  analyzeProductAdvanced,
  analyzeSearchIntent,
  getMarketData,
  calculateBasicSimilarity,
  logSearchAnalytics,
  API_CONFIG,
  STRUCTURED_SCHEMAS
} = require('./searchService-original');

// Re-export advanced functions and config
module.exports = {
  searchByText,
  searchByMedia,
  getAIRecommendations,
  analyzeProductAdvanced,
  analyzeSearchIntent,
  getMarketData,
  calculateBasicSimilarity,
  logSearchAnalytics,
  API_CONFIG,
  STRUCTURED_SCHEMAS
};