// apps/backend/src/services/reviewService.js
// Comprehensive review and rating system for Void Marketplace

const { dbRouter, QueryOptimizer } = require('../config/db');
const logger = require('../utils/logger');
const { BUSINESS_RULES } = require('../config/constants');
const notificationService = require('./notificationService');

// ================================
// CORE REVIEW FUNCTIONS
// ================================

/**
 * Create a new review
 * @param {Object} reviewData - Review details
 * @returns {Object} Created review
 */
const createReview = async (reviewData) => {
  try {
    const {
      transaction_id,
      listing_id,
      reviewer_id,
      reviewee_id,
      rating,
      comment,
      review_type = 'LISTING_REVIEW' // 'LISTING_REVIEW', 'VENDOR_REVIEW', 'BUYER_REVIEW'
    } = reviewData;

    // Validate required fields
    if (!transaction_id || !listing_id || !reviewer_id || !reviewee_id || !rating) {
      throw new Error('Missing required review fields');
    }

    // Validate rating range (1-5 stars)
    if (rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5 stars');
    }

    // Check if transaction exists and is completed
    const transaction = await dbRouter.transaction.findUnique({
      where: { id: transaction_id },
      include: {
        listing: true,
        buyer: true,
        vendor: true
      }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (transaction.status !== 'COMPLETED') {
      throw new Error('Can only review completed transactions');
    }

    // Validate reviewer is part of the transaction
    if (![transaction.buyer_id, transaction.vendor_id].includes(reviewer_id)) {
      throw new Error('Only transaction participants can leave reviews');
    }

    // Check if review already exists
    const existingReview = await dbRouter.review.findFirst({
      where: {
        transaction_id,
        reviewer_id,
        reviewee_id
      }
    });

    if (existingReview) {
      throw new Error('Review already exists for this transaction');
    }

    // Check review window (within REVIEW_WINDOW_DAYS of transaction completion)
    const reviewDeadline = new Date(transaction.updated_at.getTime() + BUSINESS_RULES.REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (new Date() > reviewDeadline) {
      throw new Error('Review window has expired');
    }

    // Create the review
    const review = await dbRouter.review.create({
      data: {
        transaction_id,
        listing_id,
        reviewer_id,
        reviewee_id,
        rating,
        comment: comment?.trim() || null,
        review_type,
        is_verified: true // All transaction-based reviews are verified
      },
      include: {
        reviewer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        reviewee: {
          select: {
            id: true,
            first_name: true,
            last_name: true
          }
        },
        listing: {
          select: {
            id: true,
            title: true
          }
        },
        transaction: {
          select: {
            id: true,
            amount: true
          }
        }
      }
    });

    // Update reviewee's rating statistics
    await updateUserRatingStats(reviewee_id);

    // Update listing rating if it's a listing review
    if (review_type === 'LISTING_REVIEW') {
      await updateListingRatingStats(listing_id);
    }

    logger.info('Review created successfully', {
      reviewId: review.id,
      transactionId: transaction_id,
      reviewerId: reviewer_id,
      revieweeId: reviewee_id,
      rating,
      reviewType: review_type
    });

    // Send notification to reviewee
    await notificationService.createNotification({
      user_id: reviewee_id,
      type: 'REVIEW_RECEIVED',
      title: 'New Review Received',
      message: `You received a ${rating}-star review from ${review.reviewer.first_name} ${review.reviewer.last_name}`,
      metadata: {
        review_id: review.id,
        reviewer_id: reviewer_id,
        rating,
        listing_id,
        transaction_id
      },
      send_push: true
    });

    return review;

  } catch (error) {
    logger.error('Review creation failed:', error);
    throw error;
  }
};

/**
 * Get reviews for a listing
 * @param {string} listingId - Listing ID
 * @param {Object} options - Query options
 * @returns {Object} Reviews and metadata
 */
const getListingReviews = async (listingId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      rating_filter = null,
      sort = 'newest' // 'newest', 'oldest', 'highest_rating', 'lowest_rating'
    } = options;

    const offset = (page - 1) * limit;
    
    const whereClause = {
      listing_id: listingId,
      review_type: 'LISTING_REVIEW'
    };

    if (rating_filter) {
      whereClause.rating = parseInt(rating_filter);
    }

    // Determine sort order
    let orderBy = { created_at: 'desc' }; // default: newest
    switch (sort) {
      case 'oldest':
        orderBy = { created_at: 'asc' };
        break;
      case 'highest_rating':
        orderBy = [{ rating: 'desc' }, { created_at: 'desc' }];
        break;
      case 'lowest_rating':
        orderBy = [{ rating: 'asc' }, { created_at: 'desc' }];
        break;
    }

    const [reviews, totalCount, ratingStats] = await Promise.all([
      dbRouter.review.findMany({
        where: whereClause,
        include: {
          reviewer: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              avatar_url: true
            }
          },
          transaction: {
            select: {
              id: true,
              amount: true,
              created_at: true
            }
          }
        },
        orderBy,
        skip: offset,
        take: limit
      }),
      dbRouter.review.count({ where: whereClause }),
      getListingRatingStats(listingId)
    ]);

    return {
      reviews,
      pagination: {
        current_page: page,
        total_pages: Math.ceil(totalCount / limit),
        total_count: totalCount,
        per_page: limit
      },
      rating_stats: ratingStats
    };

  } catch (error) {
    logger.error('Get listing reviews failed:', error);
    throw error;
  }
};

/**
 * Get reviews for a user (vendor/buyer)
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Object} Reviews and metadata
 */
const getUserReviews = async (userId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      review_type = null, // 'VENDOR_REVIEW', 'BUYER_REVIEW', 'LISTING_REVIEW'
      as_reviewer = false // false: reviews received, true: reviews given
    } = options;

    const offset = (page - 1) * limit;
    
    const whereClause = {};
    
    if (as_reviewer) {
      whereClause.reviewer_id = userId;
    } else {
      whereClause.reviewee_id = userId;
    }

    if (review_type) {
      whereClause.review_type = review_type;
    }

    const [reviews, totalCount, ratingStats] = await Promise.all([
      dbRouter.review.findMany({
        where: whereClause,
        include: {
          reviewer: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              avatar_url: true
            }
          },
          reviewee: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              avatar_url: true
            }
          },
          listing: {
            select: {
              id: true,
              title: true,
              images: {
                select: { url: true },
                take: 1,
                orderBy: { display_order: 'asc' }
              }
            }
          },
          transaction: {
            select: {
              id: true,
              amount: true,
              created_at: true
            }
          }
        },
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      }),
      dbRouter.review.count({ where: whereClause }),
      as_reviewer ? null : getUserRatingStats(userId)
    ]);

    return {
      reviews,
      pagination: {
        current_page: page,
        total_pages: Math.ceil(totalCount / limit),
        total_count: totalCount,
        per_page: limit
      },
      rating_stats: ratingStats
    };

  } catch (error) {
    logger.error('Get user reviews failed:', error);
    throw error;
  }
};

/**
 * Get review by ID
 * @param {string} reviewId - Review ID
 * @param {string} userId - User ID requesting the review
 * @returns {Object} Review details
 */
const getReview = async (reviewId, userId) => {
  try {
    const review = await dbRouter.review.findUnique({
      where: { id: reviewId },
      include: {
        reviewer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        reviewee: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        listing: {
          select: {
            id: true,
            title: true,
            images: {
              select: { url: true, alt_text: true },
              take: 1,
              orderBy: { display_order: 'asc' }
            }
          }
        },
        transaction: {
          select: {
            id: true,
            amount: true,
            created_at: true,
            buyer_id: true,
            vendor_id: true
          }
        }
      }
    });

    if (!review) {
      throw new Error('Review not found');
    }

    // Check if user has access to this review
    const hasAccess = [
      review.reviewer_id,
      review.reviewee_id,
      review.transaction.buyer_id,
      review.transaction.vendor_id
    ].includes(userId);

    if (!hasAccess) {
      // Public reviews (listing reviews) can be viewed by anyone
      if (review.review_type !== 'LISTING_REVIEW') {
        throw new Error('Access denied');
      }
    }

    return review;

  } catch (error) {
    logger.error('Get review failed:', error);
    throw error;
  }
};

/**
 * Update review (within edit window)
 * @param {string} reviewId - Review ID
 * @param {string} userId - User ID updating the review
 * @param {Object} updateData - Update data
 * @returns {Object} Updated review
 */
const updateReview = async (reviewId, userId, updateData) => {
  try {
    const { rating, comment } = updateData;

    // Get existing review
    const existingReview = await dbRouter.review.findUnique({
      where: { id: reviewId },
      include: { transaction: true }
    });

    if (!existingReview) {
      throw new Error('Review not found');
    }

    if (existingReview.reviewer_id !== userId) {
      throw new Error('Only the reviewer can update the review');
    }

    // Check if review is still within edit window (24 hours)
    const editDeadline = new Date(existingReview.created_at.getTime() + 24 * 60 * 60 * 1000);
    if (new Date() > editDeadline) {
      throw new Error('Review edit window has expired');
    }

    // Validate rating if provided
    if (rating && (rating < 1 || rating > 5)) {
      throw new Error('Rating must be between 1 and 5 stars');
    }

    // Update review
    const updatedReview = await dbRouter.review.update({
      where: { id: reviewId },
      data: {
        ...(rating && { rating }),
        ...(comment !== undefined && { comment: comment?.trim() || null }),
        updated_at: new Date()
      },
      include: {
        reviewer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        reviewee: {
          select: {
            id: true,
            first_name: true,
            last_name: true
          }
        },
        listing: {
          select: {
            id: true,
            title: true
          }
        }
      }
    });

    // Update rating statistics if rating changed
    if (rating && rating !== existingReview.rating) {
      await updateUserRatingStats(existingReview.reviewee_id);
      
      if (existingReview.review_type === 'LISTING_REVIEW') {
        await updateListingRatingStats(existingReview.listing_id);
      }
    }

    logger.info('Review updated successfully', {
      reviewId,
      reviewerId: userId,
      oldRating: existingReview.rating,
      newRating: rating || existingReview.rating
    });

    return updatedReview;

  } catch (error) {
    logger.error('Review update failed:', error);
    throw error;
  }
};

/**
 * Delete review (admin only or within grace period)
 * @param {string} reviewId - Review ID
 * @param {string} userId - User ID requesting deletion
 * @param {Object} options - Deletion options
 * @returns {Object} Deletion result
 */
const deleteReview = async (reviewId, userId, options = {}) => {
  try {
    const { admin_deletion = false, reason = null } = options;

    // Get existing review
    const review = await dbRouter.review.findUnique({
      where: { id: reviewId },
      include: { transaction: true }
    });

    if (!review) {
      throw new Error('Review not found');
    }

    // Check permissions
    if (!admin_deletion) {
      if (review.reviewer_id !== userId) {
        throw new Error('Only the reviewer can delete the review');
      }

      // Check if review is still within delete grace period (1 hour)
      const deleteDeadline = new Date(review.created_at.getTime() + 60 * 60 * 1000);
      if (new Date() > deleteDeadline) {
        throw new Error('Review deletion grace period has expired');
      }
    }

    // Delete the review
    await dbRouter.review.delete({
      where: { id: reviewId }
    });

    // Update rating statistics
    await updateUserRatingStats(review.reviewee_id);
    
    if (review.review_type === 'LISTING_REVIEW') {
      await updateListingRatingStats(review.listing_id);
    }

    logger.info('Review deleted successfully', {
      reviewId,
      deletedBy: userId,
      adminDeletion: admin_deletion,
      reason
    });

    return { success: true };

  } catch (error) {
    logger.error('Review deletion failed:', error);
    throw error;
  }
};

// ================================
// RATING STATISTICS
// ================================

/**
 * Get listing rating statistics
 * @param {string} listingId - Listing ID
 * @returns {Object} Rating statistics
 */
const getListingRatingStats = async (listingId) => {
  try {
    const stats = await dbRouter.review.aggregate({
      where: {
        listing_id: listingId,
        review_type: 'LISTING_REVIEW'
      },
      _avg: { rating: true },
      _count: { rating: true }
    });

    const ratingDistribution = await dbRouter.review.groupBy({
      by: ['rating'],
      where: {
        listing_id: listingId,
        review_type: 'LISTING_REVIEW'
      },
      _count: { rating: true }
    });

    const distribution = {};
    for (let i = 1; i <= 5; i++) {
      distribution[i] = 0;
    }
    ratingDistribution.forEach(item => {
      distribution[item.rating] = item._count.rating;
    });

    return {
      average_rating: stats._avg.rating ? Number(stats._avg.rating.toFixed(2)) : 0,
      total_reviews: stats._count.rating,
      rating_distribution: distribution
    };

  } catch (error) {
    logger.error('Get listing rating stats failed:', error);
    return {
      average_rating: 0,
      total_reviews: 0,
      rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };
  }
};

/**
 * Get user rating statistics
 * @param {string} userId - User ID
 * @returns {Object} Rating statistics
 */
const getUserRatingStats = async (userId) => {
  try {
    // Get overall stats
    const overallStats = await dbRouter.review.aggregate({
      where: { reviewee_id: userId },
      _avg: { rating: true },
      _count: { rating: true }
    });

    // Get stats by review type
    const statsByType = await dbRouter.review.groupBy({
      by: ['review_type'],
      where: { reviewee_id: userId },
      _avg: { rating: true },
      _count: { rating: true }
    });

    // Get rating distribution
    const ratingDistribution = await dbRouter.review.groupBy({
      by: ['rating'],
      where: { reviewee_id: userId },
      _count: { rating: true }
    });

    const distribution = {};
    for (let i = 1; i <= 5; i++) {
      distribution[i] = 0;
    }
    ratingDistribution.forEach(item => {
      distribution[item.rating] = item._count.rating;
    });

    const typeStats = {};
    statsByType.forEach(item => {
      typeStats[item.review_type] = {
        average_rating: item._avg.rating ? Number(item._avg.rating.toFixed(2)) : 0,
        total_reviews: item._count.rating
      };
    });

    return {
      overall: {
        average_rating: overallStats._avg.rating ? Number(overallStats._avg.rating.toFixed(2)) : 0,
        total_reviews: overallStats._count.rating
      },
      by_type: typeStats,
      rating_distribution: distribution
    };

  } catch (error) {
    logger.error('Get user rating stats failed:', error);
    return {
      overall: { average_rating: 0, total_reviews: 0 },
      by_type: {},
      rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };
  }
};

/**
 * Update user rating statistics
 * @param {string} userId - User ID
 */
const updateUserRatingStats = async (userId) => {
  try {
    const stats = await getUserRatingStats(userId);
    
    // Update user record with calculated stats
    await dbRouter.user.update({
      where: { id: userId },
      data: {
        rating_average: stats.overall.average_rating,
        rating_count: stats.overall.total_reviews
      }
    }).catch(() => {}); // Ignore if columns don't exist

    logger.info('User rating stats updated', {
      userId,
      averageRating: stats.overall.average_rating,
      totalReviews: stats.overall.total_reviews
    });

  } catch (error) {
    logger.error('Update user rating stats failed:', error);
  }
};

/**
 * Update listing rating statistics
 * @param {string} listingId - Listing ID
 */
const updateListingRatingStats = async (listingId) => {
  try {
    const stats = await getListingRatingStats(listingId);
    
    // Update listing record with calculated stats
    await dbRouter.listing.update({
      where: { id: listingId },
      data: {
        rating_average: stats.average_rating,
        rating_count: stats.total_reviews
      }
    }).catch(() => {}); // Ignore if columns don't exist

    logger.info('Listing rating stats updated', {
      listingId,
      averageRating: stats.average_rating,
      totalReviews: stats.total_reviews
    });

  } catch (error) {
    logger.error('Update listing rating stats failed:', error);
  }
};

// ================================
// REVIEW OPPORTUNITIES
// ================================

/**
 * Get review opportunities for a user
 * @param {string} userId - User ID
 * @returns {Array} Available review opportunities
 */
const getReviewOpportunities = async (userId) => {
  try {
    // Get completed transactions where user hasn't left a review yet
    const completedTransactions = await dbRouter.transaction.findMany({
      where: {
        OR: [
          { buyer_id: userId },
          { vendor_id: userId }
        ],
        status: 'COMPLETED',
        updated_at: {
          gte: new Date(Date.now() - BUSINESS_RULES.REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        }
      },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            images: {
              select: { url: true },
              take: 1,
              orderBy: { display_order: 'asc' }
            }
          }
        },
        buyer: {
          select: { id: true, first_name: true, last_name: true }
        },
        vendor: {
          select: { id: true, first_name: true, last_name: true }
        },
        reviews: true
      }
    });

    const opportunities = [];

    for (const transaction of completedTransactions) {
      const userIsBuyer = transaction.buyer_id === userId;
      const otherPartyId = userIsBuyer ? transaction.vendor_id : transaction.buyer_id;
      const otherParty = userIsBuyer ? transaction.vendor : transaction.buyer;

      // Check if user has already reviewed the other party
      const existingReview = transaction.reviews.find(review => 
        review.reviewer_id === userId && review.reviewee_id === otherPartyId
      );

      if (!existingReview) {
        opportunities.push({
          transaction_id: transaction.id,
          listing: transaction.listing,
          other_party: otherParty,
          review_type: userIsBuyer ? 'VENDOR_REVIEW' : 'BUYER_REVIEW',
          transaction_amount: transaction.amount,
          transaction_date: transaction.updated_at,
          expires_at: new Date(transaction.updated_at.getTime() + BUSINESS_RULES.REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        });
      }
    }

    return opportunities.sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));

  } catch (error) {
    logger.error('Get review opportunities failed:', error);
    throw error;
  }
};

/**
 * Send review reminder notifications
 * @returns {Object} Reminder summary
 */
const sendReviewReminders = async () => {
  try {
    // Get transactions completed 3 days ago that haven't been reviewed
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const eligibleTransactions = await dbRouter.transaction.findMany({
      where: {
        status: 'COMPLETED',
        updated_at: {
          gte: sevenDaysAgo,
          lte: threeDaysAgo
        }
      },
      include: {
        listing: { select: { title: true } },
        buyer: { select: { id: true, first_name: true, last_name: true } },
        vendor: { select: { id: true, first_name: true, last_name: true } },
        reviews: true
      }
    });

    let remindersSent = 0;

    for (const transaction of eligibleTransactions) {
      // Check if buyer needs reminder
      const buyerReview = transaction.reviews.find(r => 
        r.reviewer_id === transaction.buyer_id && r.reviewee_id === transaction.vendor_id
      );
      
      if (!buyerReview) {
        await notificationService.createNotification({
          user_id: transaction.buyer_id,
          type: 'REVIEW_REMINDER',
          title: 'Review Reminder',
          message: `Don't forget to review your purchase of ${transaction.listing.title}`,
          metadata: {
            transaction_id: transaction.id,
            listing_title: transaction.listing.title,
            vendor_name: `${transaction.vendor.first_name} ${transaction.vendor.last_name}`
          }
        });
        remindersSent++;
      }

      // Check if vendor needs reminder
      const vendorReview = transaction.reviews.find(r => 
        r.reviewer_id === transaction.vendor_id && r.reviewee_id === transaction.buyer_id
      );
      
      if (!vendorReview) {
        await notificationService.createNotification({
          user_id: transaction.vendor_id,
          type: 'REVIEW_REMINDER',
          title: 'Review Reminder',
          message: `Please review your transaction with ${transaction.buyer.first_name} ${transaction.buyer.last_name}`,
          metadata: {
            transaction_id: transaction.id,
            listing_title: transaction.listing.title,
            buyer_name: `${transaction.buyer.first_name} ${transaction.buyer.last_name}`
          }
        });
        remindersSent++;
      }
    }

    logger.info('Review reminders sent', {
      transactionsProcessed: eligibleTransactions.length,
      remindersSent
    });

    return {
      transactions_processed: eligibleTransactions.length,
      reminders_sent: remindersSent
    };

  } catch (error) {
    logger.error('Send review reminders failed:', error);
    throw error;
  }
};

// ================================
// REVIEW MODERATION
// ================================

/**
 * Flag review for moderation
 * @param {string} reviewId - Review ID
 * @param {string} reporterId - User reporting the review
 * @param {Object} reportData - Report details
 * @returns {Object} Report result
 */
const flagReview = async (reviewId, reporterId, reportData) => {
  try {
    const { reason, description } = reportData;

    // Check if review exists
    const review = await dbRouter.review.findUnique({
      where: { id: reviewId }
    });

    if (!review) {
      throw new Error('Review not found');
    }

    // Check if user already reported this review
    const existingReport = await dbRouter.reviewReport.findFirst({
      where: {
        review_id: reviewId,
        reporter_id: reporterId
      }
    }).catch(() => null);

    if (existingReport) {
      throw new Error('You have already reported this review');
    }

    // Create report
    const report = await dbRouter.reviewReport.create({
      data: {
        review_id: reviewId,
        reporter_id: reporterId,
        reason,
        description,
        status: 'PENDING'
      }
    }).catch(() => {
      // If table doesn't exist, just log the report
      logger.info('Review flagged (table not implemented)', {
        reviewId,
        reporterId,
        reason
      });
      return { id: 'simulated', reason, description };
    });

    logger.info('Review flagged for moderation', {
      reviewId,
      reporterId,
      reason,
      reportId: report.id
    });

    return report;

  } catch (error) {
    logger.error('Flag review failed:', error);
    throw error;
  }
};

/**
 * Get review analytics
 * @param {Object} options - Analytics options
 * @returns {Object} Review analytics
 */
const getReviewAnalytics = async (options = {}) => {
  try {
    const {
      start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      end_date = new Date(),
      user_id = null,
      listing_id = null
    } = options;

    const whereClause = {
      created_at: {
        gte: start_date,
        lte: end_date
      }
    };

    if (user_id) {
      whereClause.reviewee_id = user_id;
    }

    if (listing_id) {
      whereClause.listing_id = listing_id;
    }

    const [
      totalReviews,
      averageRating,
      ratingDistribution,
      reviewsByType
    ] = await Promise.all([
      dbRouter.review.count({ where: whereClause }),
      dbRouter.review.aggregate({
        where: whereClause,
        _avg: { rating: true }
      }),
      dbRouter.review.groupBy({
        by: ['rating'],
        where: whereClause,
        _count: { rating: true }
      }),
      dbRouter.review.groupBy({
        by: ['review_type'],
        where: whereClause,
        _count: { review_type: true },
        _avg: { rating: true }
      })
    ]);

    const distribution = {};
    for (let i = 1; i <= 5; i++) {
      distribution[i] = 0;
    }
    ratingDistribution.forEach(item => {
      distribution[item.rating] = item._count.rating;
    });

    const byType = {};
    reviewsByType.forEach(item => {
      byType[item.review_type] = {
        count: item._count.review_type,
        average_rating: item._avg.rating ? Number(item._avg.rating.toFixed(2)) : 0
      };
    });

    return {
      summary: {
        total_reviews: totalReviews,
        average_rating: averageRating._avg.rating ? Number(averageRating._avg.rating.toFixed(2)) : 0
      },
      rating_distribution: distribution,
      by_type: byType
    };

  } catch (error) {
    logger.error('Get review analytics failed:', error);
    throw error;
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Core review functions
  createReview,
  getListingReviews,
  getUserReviews,
  getReview,
  updateReview,
  deleteReview,

  // Rating statistics
  getListingRatingStats,
  getUserRatingStats,
  updateUserRatingStats,
  updateListingRatingStats,

  // Review opportunities
  getReviewOpportunities,
  sendReviewReminders,

  // Moderation
  flagReview,

  // Analytics
  getReviewAnalytics
};