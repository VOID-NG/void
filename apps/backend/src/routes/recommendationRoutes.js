// apps/backend/src/routes/recommendationRoutes.js
// AI-powered recommendation routes

const express = require('express');
const { getRecommendations } = require('../services/searchService');
const { verifyToken } = require('../middleware/authMiddleware');
const logger = require('../utils/logger');

const router = express.Router();

// Optional authentication middleware
const optionalAuth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (token) {
    verifyToken(req, res, (err) => next());
  } else {
    next();
  }
};

// ================================
// RECOMMENDATION ROUTES
// ================================

/**
 * @route   GET /api/v1/recommendations
 * @desc    Get personalized recommendations
 * @access  Public (better with auth)
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { 
      type = 'trending',
      limit = 10,
      category_id 
    } = req.query;

    const options = {
      limit: Math.min(parseInt(limit), 20),
      type,
      categoryId: category_id
    };

    const recommendations = await getRecommendations(req.user?.id, options);

    res.json({
      success: true,
      data: {
        recommendations,
        recommendation_type: type,
        user_id: req.user?.id || 'anonymous',
        metadata: {
          algorithm: 'huggingface_ai',
          generated_at: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    logger.error('Recommendations failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recommendations',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/v1/recommendations/trending
 * @desc    Get trending products
 * @access  Public
 */
router.get('/trending', optionalAuth, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const recommendations = await getRecommendations(req.user?.id, {
      type: 'trending',
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      data: {
        trending_items: recommendations,
        generated_at: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Trending recommendations failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get trending items',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/v1/recommendations/for-you
 * @desc    Get personalized recommendations for user
 * @access  Private
 */
router.get('/for-you', verifyToken, async (req, res) => {
  try {
    const { limit = 15 } = req.query;
    
    const recommendations = await getRecommendations(req.user.id, {
      type: 'personalized',
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      data: {
        personalized_recommendations: recommendations,
        user_id: req.user.id,
        generated_at: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Personalized recommendations failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get personalized recommendations',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/v1/recommendations/similar/:listingId
 * @desc    Get similar products to a specific listing
 * @access  Public
 */
router.get('/similar/:listingId', optionalAuth, async (req, res) => {
  try {
    const { listingId } = req.params;
    const { limit = 10 } = req.query;

    // Get the target listing
    const { prisma } = require('../config/db');
    const targetListing = await prisma.listing.findUnique({
      where: { id: listingId }
    });

    if (!targetListing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    // Use search service to find similar items
    const { searchByText } = require('../services/searchService');
    const searchQuery = `${targetListing.title} ${targetListing.description}`.substring(0, 100);
    
    const similarItems = await searchByText(searchQuery, {
      limit: parseInt(limit) + 1,
      userId: req.user?.id
    });

    // Remove the original listing from results
    const filteredSimilar = similarItems.filter(item => item.id !== listingId);

    res.json({
      success: true,
      data: {
        target_listing: {
          id: targetListing.id,
          title: targetListing.title
        },
        similar_items: filteredSimilar.slice(0, parseInt(limit)),
        similarity_method: 'ai_text_analysis'
      }
    });

  } catch (error) {
    logger.error('Similar recommendations failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get similar items',
      message: error.message
    });
  }
});

module.exports = router;