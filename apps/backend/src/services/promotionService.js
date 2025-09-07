// apps/backend/src/services/promotionService.js
// Comprehensive promotion and discount management system

const { dbRouter, QueryOptimizer } = require('../config/db');
const logger = require('../utils/logger');
const { PROMOTION_TYPE } = require('../config/constants');
const notificationService = require('./notificationService');

// ================================
// CORE PROMOTION FUNCTIONS
// ================================

/**
 * Create a new promotion
 * @param {Object} promotionData - Promotion details
 * @returns {Object} Created promotion
 */
const createPromotion = async (promotionData) => {
  try {
    const {
      code,
      name,
      description,
      type,
      discount_value,
      minimum_amount = null,
      maximum_discount = null,
      usage_limit = null,
      user_limit = 1,
      valid_from,
      valid_until,
      is_active = true,
      target_users = null, // Array of user IDs or null for all users
      target_categories = null, // Array of category IDs or null for all categories
      created_by
    } = promotionData;

    // Validate required fields
    if (!code || !name || !type || !discount_value || !valid_from || !valid_until) {
      throw new Error('Missing required promotion fields');
    }

    // Validate promotion type
    if (!Object.values(PROMOTION_TYPE).includes(type)) {
      throw new Error('Invalid promotion type');
    }

    // Validate dates
    const startDate = new Date(valid_from);
    const endDate = new Date(valid_until);
    
    if (startDate >= endDate) {
      throw new Error('End date must be after start date');
    }

    // Check if promotion code already exists
    const existingPromotion = await dbRouter.promotion.findUnique({
      where: { code: code.toUpperCase() }
    });

    if (existingPromotion) {
      throw new Error('Promotion code already exists');
    }

    // Validate discount value based on type
    if (type === PROMOTION_TYPE.PERCENTAGE_DISCOUNT && (discount_value <= 0 || discount_value > 100)) {
      throw new Error('Percentage discount must be between 0 and 100');
    }

    if (type === PROMOTION_TYPE.FIXED_DISCOUNT && discount_value <= 0) {
      throw new Error('Fixed discount must be greater than 0');
    }

    // Create promotion
    const promotion = await dbRouter.promotion.create({
      data: {
        code: code.toUpperCase(),
        name,
        description,
        type,
        discount_value,
        minimum_amount,
        maximum_discount,
        usage_limit,
        user_limit,
        usage_count: 0,
        valid_from: startDate,
        valid_until: endDate,
        is_active,
        target_users: target_users ? JSON.stringify(target_users) : null,
        target_categories: target_categories ? JSON.stringify(target_categories) : null,
        created_by
      }
    });

    logger.info('Promotion created successfully', {
      promotionId: promotion.id,
      code: promotion.code,
      type: promotion.type,
      discountValue: promotion.discount_value,
      createdBy: created_by
    });

    return promotion;

  } catch (error) {
    logger.error('Promotion creation failed:', error);
    throw error;
  }
};

/**
 * Validate and apply promotion code
 * @param {string} code - Promotion code
 * @param {Object} validationData - Validation context
 * @returns {Object} Validation result
 */
const validatePromotion = async (code, validationData) => {
  try {
    const {
      user_id,
      amount,
      category_id = null,
      listing_id = null
    } = validationData;

    // Find active promotion
    const promotion = await dbRouter.promotion.findFirst({
      where: {
        code: code.toUpperCase(),
        is_active: true,
        valid_from: { lte: new Date() },
        valid_until: { gte: new Date() }
      }
    });

    if (!promotion) {
      return {
        valid: false,
        error: 'Invalid or expired promotion code',
        discount_amount: 0
      };
    }

    // Check usage limit
    if (promotion.usage_limit && promotion.usage_count >= promotion.usage_limit) {
      return {
        valid: false,
        error: 'Promotion usage limit exceeded',
        discount_amount: 0
      };
    }

    // Check minimum amount
    if (promotion.minimum_amount && amount < promotion.minimum_amount) {
      return {
        valid: false,
        error: `Minimum order amount of $${promotion.minimum_amount} required`,
        discount_amount: 0
      };
    }

    // Check user eligibility
    if (promotion.target_users) {
      const targetUsers = JSON.parse(promotion.target_users);
      if (!targetUsers.includes(user_id)) {
        return {
          valid: false,
          error: 'This promotion is not available for your account',
          discount_amount: 0
        };
      }
    }

    // Check category eligibility
    if (promotion.target_categories && category_id) {
      const targetCategories = JSON.parse(promotion.target_categories);
      if (!targetCategories.includes(category_id)) {
        return {
          valid: false,
          error: 'This promotion is not valid for this category',
          discount_amount: 0
        };
      }
    }

    // Check user usage limit
    if (promotion.user_limit) {
      const userUsageCount = await dbRouter.transaction.count({
        where: {
          buyer_id: user_id,
          promotion_code: code.toUpperCase(),
          status: { not: 'CANCELLED' }
        }
      });

      if (userUsageCount >= promotion.user_limit) {
        return {
          valid: false,
          error: 'You have already used this promotion code',
          discount_amount: 0
        };
      }
    }

    // Calculate discount amount
    const discountAmount = calculateDiscountAmount(promotion, amount);

    return {
      valid: true,
      promotion,
      discount_amount: discountAmount,
      final_amount: amount - discountAmount
    };

  } catch (error) {
    logger.error('Promotion validation failed:', error);
    return {
      valid: false,
      error: 'Error validating promotion code',
      discount_amount: 0
    };
  }
};

/**
 * Apply promotion to transaction
 * @param {string} promotionCode - Promotion code
 * @param {string} transactionId - Transaction ID
 * @returns {Object} Application result
 */
const applyPromotion = async (promotionCode, transactionId) => {
  try {
    // Get transaction details
    const transaction = await dbRouter.transaction.findUnique({
      where: { id: transactionId },
      include: { listing: true }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (transaction.status !== 'INITIATED') {
      throw new Error('Promotion can only be applied to initiated transactions');
    }

    // Validate promotion
    const validationResult = await validatePromotion(promotionCode, {
      user_id: transaction.buyer_id,
      amount: transaction.amount,
      category_id: transaction.listing.category_id,
      listing_id: transaction.listing_id
    });

    if (!validationResult.valid) {
      throw new Error(validationResult.error);
    }

    // Update transaction with promotion
    const updatedTransaction = await dbRouter.transaction.update({
      where: { id: transactionId },
      data: {
        promotion_code: promotionCode.toUpperCase(),
        discount_amount: validationResult.discount_amount,
        amount: validationResult.final_amount
      }
    });

    // Increment promotion usage count
    await dbRouter.promotion.update({
      where: { id: validationResult.promotion.id },
      data: {
        usage_count: { increment: 1 }
      }
    });

    logger.info('Promotion applied successfully', {
      promotionCode,
      transactionId,
      discountAmount: validationResult.discount_amount,
      finalAmount: validationResult.final_amount
    });

    return {
      success: true,
      transaction: updatedTransaction,
      discount_amount: validationResult.discount_amount
    };

  } catch (error) {
    logger.error('Promotion application failed:', error);
    throw error;
  }
};

/**
 * Get active promotions
 * @param {Object} options - Query options
 * @returns {Object} Promotions and metadata
 */
const getActivePromotions = async (options = {}) => {
  try {
    const {
      page = 1,
      limit = 20,
      user_id = null,
      category_id = null,
      public_only = true
    } = options;

    const offset = (page - 1) * limit;
    
    const whereClause = {
      is_active: true,
      valid_from: { lte: new Date() },
      valid_until: { gte: new Date() }
    };

    // If public_only is true, exclude user-specific promotions
    if (public_only) {
      whereClause.target_users = null;
    }

    // Filter by user eligibility
    if (user_id && !public_only) {
      whereClause.OR = [
        { target_users: null },
        { target_users: { contains: user_id } }
      ];
    }

    const [promotions, totalCount] = await Promise.all([
      dbRouter.promotion.findMany({
        where: whereClause,
        orderBy: [
          { valid_until: 'asc' },
          { created_at: 'desc' }
        ],
        skip: offset,
        take: limit
      }),
      dbRouter.promotion.count({ where: whereClause })
    ]);

    // Filter by category eligibility if specified
    let filteredPromotions = promotions;
    if (category_id) {
      filteredPromotions = promotions.filter(promo => {
        if (!promo.target_categories) return true;
        const targetCategories = JSON.parse(promo.target_categories);
        return targetCategories.includes(category_id);
      });
    }

    // Parse JSON fields and add usage percentage
    const promotionsWithDetails = filteredPromotions.map(promo => ({
      ...promo,
      target_users: promo.target_users ? JSON.parse(promo.target_users) : null,
      target_categories: promo.target_categories ? JSON.parse(promo.target_categories) : null,
      usage_percentage: promo.usage_limit ? (promo.usage_count / promo.usage_limit) * 100 : 0
    }));

    return {
      promotions: promotionsWithDetails,
      pagination: {
        current_page: page,
        total_pages: Math.ceil(totalCount / limit),
        total_count: totalCount,
        per_page: limit
      }
    };

  } catch (error) {
    logger.error('Get active promotions failed:', error);
    throw error;
  }
};

/**
 * Get promotion by ID or code
 * @param {string} identifier - Promotion ID or code
 * @param {Object} options - Query options
 * @returns {Object} Promotion details
 */
const getPromotion = async (identifier, options = {}) => {
  try {
    const { include_usage_stats = false } = options;

    // Try to find by ID first, then by code
    let promotion = await dbRouter.promotion.findUnique({
      where: { id: identifier }
    });

    if (!promotion) {
      promotion = await dbRouter.promotion.findUnique({
        where: { code: identifier.toUpperCase() }
      });
    }

    if (!promotion) {
      throw new Error('Promotion not found');
    }

    // Parse JSON fields
    const promotionWithDetails = {
      ...promotion,
      target_users: promotion.target_users ? JSON.parse(promotion.target_users) : null,
      target_categories: promotion.target_categories ? JSON.parse(promotion.target_categories) : null
    };

    // Include usage statistics if requested
    if (include_usage_stats) {
      const usageStats = await getPromotionUsageStats(promotion.id);
      promotionWithDetails.usage_stats = usageStats;
    }

    return promotionWithDetails;

  } catch (error) {
    logger.error('Get promotion failed:', error);
    throw error;
  }
};

/**
 * Update promotion
 * @param {string} promotionId - Promotion ID
 * @param {Object} updateData - Update data
 * @param {string} updatedBy - User ID performing the update
 * @returns {Object} Updated promotion
 */
const updatePromotion = async (promotionId, updateData, updatedBy) => {
  try {
    const {
      name,
      description,
      discount_value,
      minimum_amount,
      maximum_discount,
      usage_limit,
      user_limit,
      valid_from,
      valid_until,
      is_active,
      target_users,
      target_categories
    } = updateData;

    // Get existing promotion
    const existingPromotion = await dbRouter.promotion.findUnique({
      where: { id: promotionId }
    });

    if (!existingPromotion) {
      throw new Error('Promotion not found');
    }

    // Validate dates if provided
    if (valid_from || valid_until) {
      const startDate = valid_from ? new Date(valid_from) : existingPromotion.valid_from;
      const endDate = valid_until ? new Date(valid_until) : existingPromotion.valid_until;
      
      if (startDate >= endDate) {
        throw new Error('End date must be after start date');
      }
    }

    // Build update data
    const updateFields = {};
    
    if (name !== undefined) updateFields.name = name;
    if (description !== undefined) updateFields.description = description;
    if (discount_value !== undefined) updateFields.discount_value = discount_value;
    if (minimum_amount !== undefined) updateFields.minimum_amount = minimum_amount;
    if (maximum_discount !== undefined) updateFields.maximum_discount = maximum_discount;
    if (usage_limit !== undefined) updateFields.usage_limit = usage_limit;
    if (user_limit !== undefined) updateFields.user_limit = user_limit;
    if (valid_from !== undefined) updateFields.valid_from = new Date(valid_from);
    if (valid_until !== undefined) updateFields.valid_until = new Date(valid_until);
    if (is_active !== undefined) updateFields.is_active = is_active;
    if (target_users !== undefined) updateFields.target_users = target_users ? JSON.stringify(target_users) : null;
    if (target_categories !== undefined) updateFields.target_categories = target_categories ? JSON.stringify(target_categories) : null;

    // Update promotion
    const updatedPromotion = await dbRouter.promotion.update({
      where: { id: promotionId },
      data: updateFields
    });

    logger.info('Promotion updated successfully', {
      promotionId,
      updatedBy,
      changes: Object.keys(updateFields)
    });

    return {
      ...updatedPromotion,
      target_users: updatedPromotion.target_users ? JSON.parse(updatedPromotion.target_users) : null,
      target_categories: updatedPromotion.target_categories ? JSON.parse(updatedPromotion.target_categories) : null
    };

  } catch (error) {
    logger.error('Promotion update failed:', error);
    throw error;
  }
};

/**
 * Deactivate promotion
 * @param {string} promotionId - Promotion ID
 * @param {string} deactivatedBy - User ID performing the deactivation
 * @returns {Object} Deactivation result
 */
const deactivatePromotion = async (promotionId, deactivatedBy) => {
  try {
    const updatedPromotion = await dbRouter.promotion.update({
      where: { id: promotionId },
      data: {
        is_active: false,
        deactivated_at: new Date(),
        deactivated_by: deactivatedBy
      }
    });

    logger.info('Promotion deactivated', {
      promotionId,
      deactivatedBy
    });

    return updatedPromotion;

  } catch (error) {
    logger.error('Promotion deactivation failed:', error);
    throw error;
  }
};

// ================================
// HELPER FUNCTIONS
// ================================

/**
 * Calculate discount amount based on promotion type
 * @param {Object} promotion - Promotion object
 * @param {number} amount - Order amount
 * @returns {number} Discount amount
 */
const calculateDiscountAmount = (promotion, amount) => {
  let discountAmount = 0;

  switch (promotion.type) {
    case PROMOTION_TYPE.PERCENTAGE_DISCOUNT:
      discountAmount = amount * (promotion.discount_value / 100);
      // Apply maximum discount limit if specified
      if (promotion.maximum_discount) {
        discountAmount = Math.min(discountAmount, promotion.maximum_discount);
      }
      break;

    case PROMOTION_TYPE.FIXED_DISCOUNT:
      discountAmount = Math.min(promotion.discount_value, amount);
      break;

    case PROMOTION_TYPE.FREE_SHIPPING:
      // Free shipping discount would be handled separately in shipping calculation
      discountAmount = 0;
      break;

    case PROMOTION_TYPE.BUY_ONE_GET_ONE:
      // BOGO logic would require item-level calculation
      // For now, apply as percentage based on discount_value
      discountAmount = amount * (promotion.discount_value / 100);
      break;

    default:
      discountAmount = 0;
  }

  // Ensure discount doesn't exceed order amount
  return Math.min(discountAmount, amount);
};

/**
 * Get promotion usage statistics
 * @param {string} promotionId - Promotion ID
 * @returns {Object} Usage statistics
 */
const getPromotionUsageStats = async (promotionId) => {
  try {
    const [usageByDay, topUsers, categoryBreakdown] = await Promise.all([
      // Usage by day
      dbRouter.transaction.groupBy({
        by: ['created_at'],
        where: {
          promotion_code: {
            in: await dbRouter.promotion.findUnique({
              where: { id: promotionId },
              select: { code: true }
            }).then(p => p ? [p.code] : [])
          }
        },
        _count: { id: true },
        _sum: { discount_amount: true }
      }),

      // Top users by usage
      dbRouter.transaction.groupBy({
        by: ['buyer_id'],
        where: {
          promotion_code: {
            in: await dbRouter.promotion.findUnique({
              where: { id: promotionId },
              select: { code: true }
            }).then(p => p ? [p.code] : [])
          }
        },
        _count: { id: true },
        _sum: { discount_amount: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10
      }),

      // Category breakdown
      dbRouter.transaction.groupBy({
        by: ['listing_id'],
        where: {
          promotion_code: {
            in: await dbRouter.promotion.findUnique({
              where: { id: promotionId },
              select: { code: true }
            }).then(p => p ? [p.code] : [])
          }
        },
        _count: { id: true },
        _sum: { discount_amount: true }
      })
    ]);

    return {
      daily_usage: usageByDay.map(item => ({
        date: item.created_at,
        usage_count: item._count.id,
        total_discount: item._sum.discount_amount || 0
      })),
      top_users: topUsers.map(item => ({
        user_id: item.buyer_id,
        usage_count: item._count.id,
        total_discount: item._sum.discount_amount || 0
      })),
      total_usage: usageByDay.reduce((sum, item) => sum + item._count.id, 0),
      total_discount_given: usageByDay.reduce((sum, item) => sum + (item._sum.discount_amount || 0), 0)
    };

  } catch (error) {
    logger.error('Get promotion usage stats failed:', error);
    return {
      daily_usage: [],
      top_users: [],
      total_usage: 0,
      total_discount_given: 0
    };
  }
};

/**
 * Generate unique promotion code
 * @param {string} prefix - Code prefix
 * @param {number} length - Code length
 * @returns {string} Generated code
 */
const generatePromotionCode = (prefix = '', length = 8) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = prefix.toUpperCase();
  
  for (let i = 0; i < length - prefix.length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  
  return result;
};

/**
 * Check for expired promotions and deactivate them
 * @returns {Object} Cleanup result
 */
const cleanupExpiredPromotions = async () => {
  try {
    const now = new Date();

    const result = await dbRouter.promotion.updateMany({
      where: {
        is_active: true,
        valid_until: { lt: now }
      },
      data: {
        is_active: false,
        deactivated_at: now
      }
    });

    logger.info('Expired promotions cleaned up', {
      deactivatedCount: result.count
    });

    return {
      deactivated_count: result.count
    };

  } catch (error) {
    logger.error('Cleanup expired promotions failed:', error);
    throw error;
  }
};

// ================================
// PROMOTION CAMPAIGNS
// ================================

/**
 * Create promotional campaign
 * @param {Object} campaignData - Campaign details
 * @returns {Object} Created campaign
 */
const createPromotionCampaign = async (campaignData) => {
  try {
    const {
      name,
      description,
      start_date,
      end_date,
      target_audience = 'all', // 'all', 'new_users', 'existing_users', 'high_value_users'
      promotion_codes = [],
      email_template = null,
      created_by
    } = campaignData;

    // Create campaign record (if table exists)
    const campaign = await dbRouter.promotionCampaign.create({
      data: {
        name,
        description,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        target_audience,
        promotion_codes: JSON.stringify(promotion_codes),
        email_template,
        status: 'SCHEDULED',
        created_by
      }
    }).catch(() => {
      // If table doesn't exist, return simulated campaign
      logger.info('Promotion campaign created (simulated)', {
        name,
        targetAudience: target_audience,
        promotionCodes: promotion_codes.length
      });
      
      return {
        id: `campaign_${Date.now()}`,
        name,
        description,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        target_audience,
        status: 'SCHEDULED',
        simulated: true
      };
    });

    logger.info('Promotion campaign created', {
      campaignId: campaign.id,
      name: campaign.name,
      createdBy: created_by
    });

    return campaign;

  } catch (error) {
    logger.error('Promotion campaign creation failed:', error);
    throw error;
  }
};

/**
 * Send promotion notifications to eligible users
 * @param {string} promotionId - Promotion ID
 * @param {Object} options - Notification options
 * @returns {Object} Notification result
 */
const sendPromotionNotifications = async (promotionId, options = {}) => {
  try {
    const {
      target_audience = 'all',
      custom_message = null,
      send_email = true,
      send_push = true
    } = options;

    const promotion = await getPromotion(promotionId);
    
    if (!promotion) {
      throw new Error('Promotion not found');
    }

    // Get target users based on audience
    let targetUsers = [];
    
    switch (target_audience) {
      case 'new_users':
        targetUsers = await dbRouter.user.findMany({
          where: {
            created_at: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
            },
            status: 'ACTIVE'
          },
          select: { id: true }
        });
        break;
        
      case 'existing_users':
        targetUsers = await dbRouter.user.findMany({
          where: {
            created_at: {
              lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            },
            status: 'ACTIVE'
          },
          select: { id: true }
        });
        break;
        
      case 'high_value_users':
        // Users with transactions > $500 in last 6 months
        targetUsers = await dbRouter.user.findMany({
          where: {
            status: 'ACTIVE',
            transactions_buyer: {
              some: {
                amount: { gte: 500 },
                created_at: {
                  gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
                },
                status: 'COMPLETED'
              }
            }
          },
          select: { id: true }
        });
        break;
        
      default: // 'all'
        targetUsers = await dbRouter.user.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true }
        });
    }

    // Send notifications
    const userIds = targetUsers.map(user => user.id);
    const message = custom_message || `🎉 New promotion available! Use code ${promotion.code} for ${promotion.type === 'PERCENTAGE_DISCOUNT' ? promotion.discount_value + '%' : '$' + promotion.discount_value} off your next purchase!`;
    const metadata = {
      promotion_id: promotionId,
      promotion_code: promotion.code,
      discount_value: promotion.discount_value,
      promotion_type: promotion.type
    };

    const notifications = await notificationService.createBulkNotifications(userIds, {
      type: 'PROMOTION_ALERT',
      title: 'Special Promotion Available!',
      message,
      metadata,
      send_email,
      send_push
    });

    logger.info('Promotion notifications sent', {
      promotionId,
      targetAudience: target_audience,
      userCount: userIds.length
    });

    return {
      promotion,
      target_users_count: userIds.length,
      notifications_sent: notifications.length
    };

  } catch (error) {
    logger.error('Send promotion notifications failed:', error);
    throw error;
  }
};

// ================================
// ANALYTICS
// ================================

/**
 * Get promotion analytics
 * @param {Object} options - Analytics options
 * @returns {Object} Promotion analytics
 */
const getPromotionAnalytics = async (options = {}) => {
  try {
    const {
      start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      end_date = new Date(),
      promotion_id = null
    } = options;

    const whereClause = {
      created_at: {
        gte: start_date,
        lte: end_date
      },
      promotion_code: { not: null }
    };

    if (promotion_id) {
      const promotion = await dbRouter.promotion.findUnique({
        where: { id: promotion_id },
        select: { code: true }
      });
      
      if (promotion) {
        whereClause.promotion_code = promotion.code;
      }
    }

    const [
      totalTransactions,
      totalDiscountGiven,
      averageDiscount,
      promotionBreakdown,
      conversionStats
    ] = await Promise.all([
      dbRouter.transaction.count({ where: whereClause }),
      dbRouter.transaction.aggregate({
        where: whereClause,
        _sum: { discount_amount: true }
      }),
      dbRouter.transaction.aggregate({
        where: whereClause,
        _avg: { discount_amount: true }
      }),
      dbRouter.transaction.groupBy({
        by: ['promotion_code'],
        where: whereClause,
        _count: { id: true },
        _sum: { discount_amount: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10
      }),
      // Calculate conversion from promotion views to usage
      dbRouter.promotion.findMany({
        where: {
          created_at: {
            gte: start_date,
            lte: end_date
          }
        },
        select: {
          id: true,
          code: true,
          usage_count: true
        }
      })
    ]);

    return {
      summary: {
        total_transactions: totalTransactions,
        total_discount_given: totalDiscountGiven._sum.discount_amount || 0,
        average_discount: averageDiscount._avg.discount_amount || 0
      },
      top_promotions: promotionBreakdown.map(item => ({
        promotion_code: item.promotion_code,
        usage_count: item._count.id,
        total_discount: item._sum.discount_amount || 0
      })),
      conversion_rates: conversionStats.map(promo => ({
        promotion_code: promo.code,
        usage_count: promo.usage_count,
        // Add view/click tracking when available
        conversion_rate: 0 // Placeholder
      }))
    };

  } catch (error) {
    logger.error('Get promotion analytics failed:', error);
    throw error;
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Core promotion functions
  createPromotion,
  validatePromotion,
  applyPromotion,
  getActivePromotions,
  getPromotion,
  updatePromotion,
  deactivatePromotion,

  // Campaign management
  createPromotionCampaign,
  sendPromotionNotifications,

  // Analytics
  getPromotionAnalytics,
  getPromotionUsageStats,

  // Utility functions
  calculateDiscountAmount,
  generatePromotionCode,
  cleanupExpiredPromotions
};