// apps/backend/src/services/recommendationService.js
// Advanced AI-powered recommendation engine for Void Marketplace

const { dbRouter, QueryOptimizer } = require('../config/db');
const logger = require('../utils/logger');
const { AI_CONFIG, BUSINESS_RULES } = require('../config/constants');

// ================================
// CORE RECOMMENDATION ENGINE
// ================================

/**
 * Get personalized recommendations for a user
 * @param {string} userId - User ID
 * @param {Object} options - Recommendation options
 * @returns {Array} Personalized recommendations
 */
const getRecommendations = async (userId, options = {}) => {
  try {
    const {
      limit = 20,
      algorithm = 'hybrid', // 'collaborative', 'content', 'hybrid'
      includeReasons = true,
      excludeViewed = true,
      priceRange = null
    } = options;

    logger.info('Generating recommendations', { userId, algorithm, limit });

    // Get user preferences and history
    const userProfile = await getUserProfile(userId);
    
    let recommendations = [];

    switch (algorithm) {
      case 'collaborative':
        recommendations = await getCollaborativeRecommendations(userId, userProfile, limit);
        break;
      case 'content':
        recommendations = await getContentBasedRecommendations(userId, userProfile, limit);
        break;
      case 'hybrid':
      default:
        recommendations = await getHybridRecommendations(userId, userProfile, limit);
        break;
    }

    // Apply filters
    if (excludeViewed) {
      recommendations = await filterViewedListings(userId, recommendations);
    }

    if (priceRange) {
      recommendations = filterByPriceRange(recommendations, priceRange);
    }

    // Add recommendation reasons if requested
    if (includeReasons) {
      recommendations = recommendations.map(rec => ({
        ...rec,
        reason: generateRecommendationReason(rec, userProfile)
      }));
    }

    logger.info('Recommendations generated successfully', {
      userId,
      count: recommendations.length,
      algorithm
    });

    return recommendations.slice(0, limit);

  } catch (error) {
    logger.error('Recommendation generation failed:', error);
    throw error;
  }
};

/**
 * Get trending items based on recent activity
 * @param {Object} options - Trending options
 * @returns {Array} Trending listings
 */
const getTrendingRecommendations = async (options = {}) => {
  try {
    const { limit = 10, timeframe = '7d', category = null } = options;

    const timeframeHours = {
      '1d': 24,
      '7d': 168,
      '30d': 720
    }[timeframe] || 168;

    const since = new Date(Date.now() - timeframeHours * 60 * 60 * 1000);

    const whereClause = {
      status: 'ACTIVE',
      created_at: { gte: since }
    };

    if (category) {
      whereClause.category_id = category;
    }

    const trending = await dbRouter.listing.findMany({
      where: whereClause,
      include: {
        vendor: {
          select: { id: true, first_name: true, last_name: true, avatar_url: true }
        },
        category: {
          select: { name: true }
        },
        images: {
          select: { url: true, alt_text: true },
          orderBy: { display_order: 'asc' },
          take: 1
        },
        _count: {
          select: { interactions: true, reviews: true }
        }
      },
      orderBy: [
        { views_count: 'desc' },
        { likes_count: 'desc' },
        { created_at: 'desc' }
      ],
      take: limit
    });

    // Calculate trending score
    const trendingWithScores = trending.map(listing => {
      const viewsScore = Math.log(listing.views_count + 1) * 0.4;
      const likesScore = Math.log(listing.likes_count + 1) * 0.3;
      const interactionsScore = Math.log(listing._count.interactions + 1) * 0.2;
      const recencyScore = Math.log(Date.now() - listing.created_at.getTime()) * -0.1;
      
      const trendingScore = viewsScore + likesScore + interactionsScore + recencyScore;

      return {
        id: listing.id,
        title: listing.title,
        price: listing.price,
        image_url: listing.images[0]?.url || null,
        vendor: listing.vendor,
        category: listing.category.name,
        trending_score: trendingScore,
        views_count: listing.views_count,
        likes_count: listing.likes_count,
        recommendation_type: 'trending'
      };
    });

    return trendingWithScores.sort((a, b) => b.trending_score - a.trending_score);

  } catch (error) {
    logger.error('Trending recommendations failed:', error);
    throw error;
  }
};

/**
 * Get similar items to a specific listing
 * @param {string} listingId - Reference listing ID
 * @param {Object} options - Similarity options
 * @returns {Array} Similar listings
 */
const getSimilarRecommendations = async (listingId, options = {}) => {
  try {
    const { limit = 10, userId = null } = options;

    // Get the reference listing
    const referenceListing = await dbRouter.listing.findUnique({
      where: { id: listingId },
      include: {
        category: true,
        embeddings: true
      }
    });

    if (!referenceListing) {
      throw new Error('Reference listing not found');
    }

    // Find similar listings
    const similarListings = await dbRouter.listing.findMany({
      where: {
        id: { not: listingId },
        status: 'ACTIVE',
        OR: [
          { category_id: referenceListing.category_id },
          { 
            price: {
              gte: referenceListing.price * 0.7,
              lte: referenceListing.price * 1.3
            }
          }
        ]
      },
      include: {
        vendor: {
          select: { id: true, first_name: true, last_name: true, avatar_url: true }
        },
        category: {
          select: { name: true }
        },
        images: {
          select: { url: true, alt_text: true },
          orderBy: { display_order: 'asc' },
          take: 1
        },
        embeddings: true
      },
      take: limit * 2 // Get more to calculate similarity scores
    });

    // Calculate similarity scores
    const similarWithScores = similarListings.map(listing => {
      let similarityScore = 0;

      // Category similarity (40% weight)
      if (listing.category_id === referenceListing.category_id) {
        similarityScore += 0.4;
      }

      // Price similarity (30% weight)
      const priceDiff = Math.abs(listing.price - referenceListing.price);
      const maxPrice = Math.max(listing.price, referenceListing.price);
      const priceScore = maxPrice > 0 ? (1 - priceDiff / maxPrice) * 0.3 : 0;
      similarityScore += priceScore;

      // Text similarity (30% weight)
      const textScore = calculateTextSimilarity(
        referenceListing.title + ' ' + referenceListing.description,
        listing.title + ' ' + listing.description
      ) * 0.3;
      similarityScore += textScore;

      return {
        id: listing.id,
        title: listing.title,
        price: listing.price,
        image_url: listing.images[0]?.url || null,
        vendor: listing.vendor,
        category: listing.category.name,
        similarity_score: similarityScore,
        recommendation_type: 'similar'
      };
    });

    // Exclude listings viewed by user if userId provided
    let filteredSimilar = similarWithScores;
    if (userId) {
      filteredSimilar = await filterViewedListings(userId, similarWithScores);
    }

    return filteredSimilar
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, limit);

  } catch (error) {
    logger.error('Similar recommendations failed:', error);
    throw error;
  }
};

// ================================
// RECOMMENDATION ALGORITHMS
// ================================

/**
 * Collaborative filtering recommendations
 */
const getCollaborativeRecommendations = async (userId, userProfile, limit) => {
  try {
    // Find users with similar behavior
    const similarUsers = await findSimilarUsers(userId, userProfile);
    
    if (similarUsers.length === 0) {
      return await getFallbackRecommendations(limit);
    }

    // Get listings liked/interacted with by similar users
    const recommendations = await dbRouter.listing.findMany({
      where: {
        status: 'ACTIVE',
        vendor_id: { not: userId },
        interactions: {
          some: {
            user_id: { in: similarUsers.map(u => u.id) },
            interaction_type: { in: ['VIEW', 'LIKE', 'SAVE'] }
          }
        }
      },
      include: {
        vendor: {
          select: { id: true, first_name: true, last_name: true, avatar_url: true }
        },
        category: {
          select: { name: true }
        },
        images: {
          select: { url: true, alt_text: true },
          orderBy: { display_order: 'asc' },
          take: 1
        },
        _count: {
          select: { interactions: true }
        }
      },
      orderBy: { views_count: 'desc' },
      take: limit
    });

    return recommendations.map(listing => ({
      id: listing.id,
      title: listing.title,
      price: listing.price,
      image_url: listing.images[0]?.url || null,
      vendor: listing.vendor,
      category: listing.category.name,
      recommendation_score: listing._count.interactions * 0.1,
      recommendation_type: 'collaborative'
    }));

  } catch (error) {
    logger.error('Collaborative filtering failed:', error);
    return await getFallbackRecommendations(limit);
  }
};

/**
 * Content-based recommendations
 */
const getContentBasedRecommendations = async (userId, userProfile, limit) => {
  try {
    const preferredCategories = userProfile.preferredCategories || [];
    const priceRange = userProfile.averagePriceRange || { min: 0, max: 999999 };

    const recommendations = await dbRouter.listing.findMany({
      where: {
        status: 'ACTIVE',
        vendor_id: { not: userId },
        OR: [
          { category_id: { in: preferredCategories } },
          { 
            price: { 
              gte: priceRange.min * 0.8,
              lte: priceRange.max * 1.2
            }
          }
        ]
      },
      include: {
        vendor: {
          select: { id: true, first_name: true, last_name: true, avatar_url: true }
        },
        category: {
          select: { name: true }
        },
        images: {
          select: { url: true, alt_text: true },
          orderBy: { display_order: 'asc' },
          take: 1
        }
      },
      orderBy: { created_at: 'desc' },
      take: limit
    });

    return recommendations.map(listing => {
      let contentScore = 0.5; // Base score

      // Category preference boost
      if (preferredCategories.includes(listing.category_id)) {
        contentScore += 0.3;
      }

      // Price preference boost
      if (listing.price >= priceRange.min && listing.price <= priceRange.max) {
        contentScore += 0.2;
      }

      return {
        id: listing.id,
        title: listing.title,
        price: listing.price,
        image_url: listing.images[0]?.url || null,
        vendor: listing.vendor,
        category: listing.category.name,
        recommendation_score: contentScore,
        recommendation_type: 'content'
      };
    });

  } catch (error) {
    logger.error('Content-based recommendations failed:', error);
    return await getFallbackRecommendations(limit);
  }
};

/**
 * Hybrid recommendations (combines collaborative and content-based)
 */
const getHybridRecommendations = async (userId, userProfile, limit) => {
  try {
    const collaborativeWeight = 0.6;
    const contentWeight = 0.4;

    // Get recommendations from both algorithms
    const [collaborative, contentBased] = await Promise.all([
      getCollaborativeRecommendations(userId, userProfile, Math.ceil(limit * 0.7)),
      getContentBasedRecommendations(userId, userProfile, Math.ceil(limit * 0.7))
    ]);

    // Combine and deduplicate
    const combined = new Map();

    // Add collaborative recommendations
    collaborative.forEach(rec => {
      combined.set(rec.id, {
        ...rec,
        recommendation_score: rec.recommendation_score * collaborativeWeight,
        recommendation_type: 'hybrid'
      });
    });

    // Add content-based recommendations
    contentBased.forEach(rec => {
      if (combined.has(rec.id)) {
        // Combine scores if item exists
        const existing = combined.get(rec.id);
        existing.recommendation_score += rec.recommendation_score * contentWeight;
      } else {
        combined.set(rec.id, {
          ...rec,
          recommendation_score: rec.recommendation_score * contentWeight,
          recommendation_type: 'hybrid'
        });
      }
    });

    // Convert to array and sort by score
    const hybridRecommendations = Array.from(combined.values())
      .sort((a, b) => b.recommendation_score - a.recommendation_score)
      .slice(0, limit);

    // If we don't have enough, add trending items
    if (hybridRecommendations.length < limit) {
      const trending = await getTrendingRecommendations({ 
        limit: limit - hybridRecommendations.length 
      });
      
      const trendingFiltered = trending.filter(item => 
        !hybridRecommendations.some(rec => rec.id === item.id)
      );
      
      hybridRecommendations.push(...trendingFiltered);
    }

    return hybridRecommendations;

  } catch (error) {
    logger.error('Hybrid recommendations failed:', error);
    return await getFallbackRecommendations(limit);
  }
};

// ================================
// HELPER FUNCTIONS
// ================================

/**
 * Get user profile and preferences
 */
const getUserProfile = async (userId) => {
  try {
    // Get user's interaction history
    const interactions = await dbRouter.userInteraction.findMany({
      where: { user_id: userId },
      include: {
        listing: {
          select: { category_id: true, price: true }
        }
      },
      orderBy: { created_at: 'desc' },
      take: 100
    });

    // Analyze preferences
    const categoryFreq = {};
    const prices = [];

    interactions.forEach(interaction => {
      if (interaction.listing) {
        const categoryId = interaction.listing.category_id;
        categoryFreq[categoryId] = (categoryFreq[categoryId] || 0) + 1;
        prices.push(parseFloat(interaction.listing.price));
      }
    });

    // Get preferred categories (top 3)
    const preferredCategories = Object.entries(categoryFreq)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([categoryId]) => categoryId);

    // Calculate average price range
    const averagePriceRange = prices.length > 0 ? {
      min: Math.min(...prices),
      max: Math.max(...prices),
      average: prices.reduce((a, b) => a + b, 0) / prices.length
    } : { min: 0, max: 999999, average: 100 };

    return {
      userId,
      preferredCategories,
      averagePriceRange,
      totalInteractions: interactions.length,
      recentActivity: interactions.slice(0, 10)
    };

  } catch (error) {
    logger.error('Get user profile failed:', error);
    return {
      userId,
      preferredCategories: [],
      averagePriceRange: { min: 0, max: 999999, average: 100 },
      totalInteractions: 0,
      recentActivity: []
    };
  }
};

/**
 * Find users with similar behavior
 */
const findSimilarUsers = async (userId, userProfile) => {
  try {
    if (userProfile.preferredCategories.length === 0) {
      return [];
    }

    const similarUsers = await dbRouter.user.findMany({
      where: {
        id: { not: userId },
        interactions: {
          some: {
            listing: {
              category_id: { in: userProfile.preferredCategories }
            }
          }
        }
      },
      include: {
        interactions: {
          include: {
            listing: {
              select: { category_id: true }
            }
          },
          take: 50
        }
      },
      take: 20
    });

    return similarUsers.filter(user => {
      const userCategories = user.interactions
        .map(i => i.listing?.category_id)
        .filter(Boolean);
      
      const overlap = userProfile.preferredCategories.filter(cat => 
        userCategories.includes(cat)
      ).length;
      
      return overlap >= 2; // At least 2 categories in common
    });

  } catch (error) {
    logger.error('Find similar users failed:', error);
    return [];
  }
};

/**
 * Filter out listings already viewed by user
 */
const filterViewedListings = async (userId, recommendations) => {
  try {
    const viewedListings = await dbRouter.userInteraction.findMany({
      where: {
        user_id: userId,
        interaction_type: 'VIEW'
      },
      select: { listing_id: true }
    });

    const viewedIds = new Set(viewedListings.map(v => v.listing_id));

    return recommendations.filter(rec => !viewedIds.has(rec.id));

  } catch (error) {
    logger.error('Filter viewed listings failed:', error);
    return recommendations;
  }
};

/**
 * Filter recommendations by price range
 */
const filterByPriceRange = (recommendations, priceRange) => {
  const { min, max } = priceRange;
  return recommendations.filter(rec => 
    rec.price >= min && rec.price <= max
  );
};

/**
 * Generate recommendation reason text
 */
const generateRecommendationReason = (recommendation, userProfile) => {
  const reasons = [];

  if (recommendation.recommendation_type === 'collaborative') {
    reasons.push('Users with similar interests liked this');
  }

  if (recommendation.recommendation_type === 'content') {
    reasons.push('Based on your browsing history');
  }

  if (recommendation.recommendation_type === 'similar') {
    reasons.push('Similar to items you viewed');
  }

  if (recommendation.recommendation_type === 'trending') {
    reasons.push('Trending in your area');
  }

  if (userProfile.preferredCategories.includes(recommendation.category)) {
    reasons.push(`Popular in ${recommendation.category}`);
  }

  return reasons.join(', ') || 'Recommended for you';
};

/**
 * Fallback recommendations when algorithms fail
 */
const getFallbackRecommendations = async (limit) => {
  try {
    const fallback = await dbRouter.listing.findMany({
      where: { status: 'ACTIVE' },
      include: {
        vendor: {
          select: { id: true, first_name: true, last_name: true, avatar_url: true }
        },
        category: {
          select: { name: true }
        },
        images: {
          select: { url: true, alt_text: true },
          orderBy: { display_order: 'asc' },
          take: 1
        }
      },
      orderBy: [
        { views_count: 'desc' },
        { created_at: 'desc' }
      ],
      take: limit
    });

    return fallback.map(listing => ({
      id: listing.id,
      title: listing.title,
      price: listing.price,
      image_url: listing.images[0]?.url || null,
      vendor: listing.vendor,
      category: listing.category.name,
      recommendation_score: 0.5,
      recommendation_type: 'popular'
    }));

  } catch (error) {
    logger.error('Fallback recommendations failed:', error);
    return [];
  }
};

/**
 * Simple text similarity calculation
 */
const calculateTextSimilarity = (text1, text2) => {
  const words1 = text1.toLowerCase().split(/\s+/);
  const words2 = text2.toLowerCase().split(/\s+/);
  
  const intersection = words1.filter(word => words2.includes(word));
  const union = new Set([...words1, ...words2]);
  
  return intersection.length / union.size;
};

// ================================
// EXPORTS
// ================================

module.exports = {
  getRecommendations,
  getTrendingRecommendations,
  getSimilarRecommendations
};