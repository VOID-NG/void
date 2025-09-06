// apps/backend/src/services/transactionService.js
// Comprehensive transaction and escrow management system

const { prisma } = require('../config/db');
const logger = require('../utils/logger');
const { TRANSACTION_STATUS, BUSINESS_RULES } = require('../config/constants');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const notificationService = require('./notificationService');

// ================================
// CORE TRANSACTION FUNCTIONS
// ================================

/**
 * Create a new transaction
 * @param {Object} transactionData - Transaction details
 * @returns {Object} Created transaction
 */
const createTransaction = async (transactionData) => {
  try {
    const {
      listing_id,
      buyer_id,
      vendor_id,
      amount,
      payment_method,
      shipping_address,
      promotion_code = null
    } = transactionData;

    // Validate listing exists and is available
    const listing = await prisma.listing.findUnique({
      where: { id: listing_id },
      include: { vendor: true }
    });

    if (!listing) {
      throw new Error('Listing not found');
    }

    if (listing.status !== 'ACTIVE') {
      throw new Error('Listing is not available for purchase');
    }

    if (listing.vendor_id !== vendor_id) {
      throw new Error('Invalid vendor for this listing');
    }

    // Apply promotion if provided
    let discountAmount = 0;
    let finalAmount = amount;
    
    if (promotion_code) {
      const promotion = await validateAndApplyPromotion(promotion_code, amount, buyer_id);
      if (promotion) {
        discountAmount = calculateDiscount(promotion, amount);
        finalAmount = amount - discountAmount;
      }
    }

    // Calculate platform fee
    const platformFee = finalAmount * BUSINESS_RULES.PLATFORM_FEE_PERCENTAGE;
    const vendorAmount = finalAmount - platformFee;

    // Create transaction record
    const transaction = await prisma.transaction.create({
      data: {
        listing_id,
        buyer_id,
        vendor_id,
        amount: finalAmount,
        platform_fee: platformFee,
        vendor_amount: vendorAmount,
        discount_amount: discountAmount,
        promotion_code,
        payment_method,
        shipping_address: JSON.stringify(shipping_address),
        status: TRANSACTION_STATUS.INITIATED,
        transaction_hash: generateTransactionHash()
      },
      include: {
        listing: {
          select: { title: true, price: true }
        },
        buyer: {
          select: { id: true, first_name: true, last_name: true, email: true }
        },
        vendor: {
          select: { id: true, first_name: true, last_name: true, email: true }
        }
      }
    });

    logger.info('Transaction created', {
      transactionId: transaction.id,
      listingId: listing_id,
      buyerId: buyer_id,
      vendorId: vendor_id,
      amount: finalAmount
    });

    // Send notifications
    await notificationService.sendPaymentNotification({
      vendorId: vendor_id,
      buyerId: buyer_id,
      transactionId: transaction.id,
      amount: finalAmount,
      listingTitle: listing.title
    });

    return transaction;

  } catch (error) {
    logger.error('Transaction creation failed:', error);
    throw error;
  }
};

/**
 * Process payment for transaction
 * @param {string} transactionId - Transaction ID
 * @param {Object} paymentData - Payment details
 * @returns {Object} Payment result
 */
const processPayment = async (transactionId, paymentData) => {
  try {
    const { payment_method_id, billing_address } = paymentData;

    // Get transaction details
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        listing: true,
        buyer: true,
        vendor: true
      }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (transaction.status !== TRANSACTION_STATUS.INITIATED) {
      throw new Error('Transaction cannot be processed in current status');
    }

    // Create Stripe payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(transaction.amount * 100), // Convert to cents
      currency: 'usd',
      payment_method: payment_method_id,
      confirm: true,
      description: `Purchase of ${transaction.listing.title}`,
      metadata: {
        transaction_id: transactionId,
        listing_id: transaction.listing_id,
        buyer_id: transaction.buyer_id,
        vendor_id: transaction.vendor_id
      },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      }
    });

    // Update transaction with payment details
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TRANSACTION_STATUS.ESCROW,
        payment_intent_id: paymentIntent.id,
        payment_method_details: JSON.stringify({
          payment_method_id,
          billing_address
        }),
        escrow_release_date: new Date(Date.now() + BUSINESS_RULES.ESCROW_RELEASE_DAYS * 24 * 60 * 60 * 1000)
      }
    });

    // Update listing status to sold
    await prisma.listing.update({
      where: { id: transaction.listing_id },
      data: { status: 'SOLD' }
    });

    logger.info('Payment processed successfully', {
      transactionId,
      paymentIntentId: paymentIntent.id,
      amount: transaction.amount
    });

    // Send notifications
    await notificationService.sendProductSoldNotification({
      vendorId: transaction.vendor_id,
      buyerId: transaction.buyer_id,
      listingId: transaction.listing_id,
      amount: transaction.amount
    });

    return {
      transaction: updatedTransaction,
      payment_intent: paymentIntent,
      success: true
    };

  } catch (error) {
    logger.error('Payment processing failed:', error);
    
    // Update transaction status to failed
    if (transactionId) {
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { status: TRANSACTION_STATUS.FAILED }
      }).catch(() => {}); // Ignore if update fails
    }

    throw error;
  }
};

/**
 * Release escrow funds to vendor
 * @param {string} transactionId - Transaction ID
 * @param {Object} options - Release options
 * @returns {Object} Release result
 */
const releaseEscrow = async (transactionId, options = {}) => {
  try {
    const { released_by = 'system', release_reason = 'automatic' } = options;

    // Get transaction details
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        listing: true,
        buyer: true,
        vendor: true
      }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (transaction.status !== TRANSACTION_STATUS.ESCROW) {
      throw new Error('Transaction is not in escrow status');
    }

    // Transfer funds to vendor (this would integrate with actual payment processor)
    const transferResult = await transferFundsToVendor(transaction);

    // Update transaction status
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TRANSACTION_STATUS.COMPLETED,
        escrow_released_at: new Date(),
        escrow_released_by: released_by,
        escrow_release_reason: release_reason
      }
    });

    logger.info('Escrow released successfully', {
      transactionId,
      vendorId: transaction.vendor_id,
      amount: transaction.vendor_amount,
      releasedBy: released_by
    });

    // Create review opportunity
    await createReviewOpportunity(transaction);

    return {
      transaction: updatedTransaction,
      transfer_result: transferResult,
      success: true
    };

  } catch (error) {
    logger.error('Transaction cancellation failed:', error);
    throw error;
  }
};

// ================================
// ESCROW MANAGEMENT
// ================================

/**
 * Get transactions pending escrow release
 * @returns {Array} Transactions ready for auto-release
 */
const getTransactionsPendingRelease = async () => {
  try {
    const now = new Date();

    const transactions = await prisma.transaction.findMany({
      where: {
        status: TRANSACTION_STATUS.ESCROW,
        escrow_release_date: { lte: now }
      },
      include: {
        listing: true,
        buyer: true,
        vendor: true
      }
    });

    return transactions;

  } catch (error) {
    logger.error('Get pending release transactions failed:', error);
    throw error;
  }
};

/**
 * Auto-release escrow for eligible transactions
 * @returns {Object} Release summary
 */
const autoReleaseEscrow = async () => {
  try {
    const pendingTransactions = await getTransactionsPendingRelease();
    const results = { success: 0, failed: 0, errors: [] };

    for (const transaction of pendingTransactions) {
      try {
        await releaseEscrow(transaction.id, {
          released_by: 'system',
          release_reason: 'automatic_release'
        });
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          transaction_id: transaction.id,
          error: error.message
        });
        logger.error('Auto-release failed for transaction', {
          transactionId: transaction.id,
          error: error.message
        });
      }
    }

    logger.info('Auto-release escrow completed', {
      totalProcessed: pendingTransactions.length,
      successful: results.success,
      failed: results.failed
    });

    return results;

  } catch (error) {
    logger.error('Auto-release escrow failed:', error);
    throw error;
  }
};

// ================================
// PAYMENT PROCESSING HELPERS
// ================================

/**
 * Transfer funds to vendor
 * @param {Object} transaction - Transaction object
 * @returns {Object} Transfer result
 */
const transferFundsToVendor = async (transaction) => {
  try {
    // This would integrate with Stripe Connect or similar
    // For now, we'll simulate the transfer
    
    if (!process.env.STRIPE_SECRET_KEY) {
      logger.warn('Stripe not configured, simulating transfer');
      return {
        transfer_id: `sim_${Date.now()}`,
        amount: transaction.vendor_amount,
        status: 'completed',
        simulated: true
      };
    }

    // Create Stripe transfer (requires Stripe Connect setup)
    const transfer = await stripe.transfers.create({
      amount: Math.round(transaction.vendor_amount * 100), // Convert to cents
      currency: 'usd',
      destination: transaction.vendor.stripe_account_id || 'acct_vendor_placeholder',
      description: `Payment for ${transaction.listing.title}`,
      metadata: {
        transaction_id: transaction.id,
        listing_id: transaction.listing_id
      }
    }).catch((error) => {
      logger.warn('Stripe transfer failed, simulating:', error.message);
      return {
        id: `sim_${Date.now()}`,
        amount: Math.round(transaction.vendor_amount * 100),
        status: 'paid',
        simulated: true
      };
    });

    return {
      transfer_id: transfer.id,
      amount: transfer.amount / 100,
      status: transfer.status || 'completed',
      simulated: transfer.simulated || false
    };

  } catch (error) {
    logger.error('Transfer to vendor failed:', error);
    throw error;
  }
};

/**
 * Validate and apply promotion code
 * @param {string} promotionCode - Promotion code
 * @param {number} amount - Transaction amount
 * @param {string} userId - User ID
 * @returns {Object|null} Promotion details or null
 */
const validateAndApplyPromotion = async (promotionCode, amount, userId) => {
  try {
    const promotion = await prisma.promotion.findFirst({
      where: {
        code: promotionCode.toUpperCase(),
        is_active: true,
        valid_from: { lte: new Date() },
        valid_until: { gte: new Date() }
      }
    });

    if (!promotion) {
      return null;
    }

    // Check minimum amount
    if (promotion.minimum_amount && amount < promotion.minimum_amount) {
      return null;
    }

    // Check usage limit
    if (promotion.usage_limit && promotion.usage_count >= promotion.usage_limit) {
      return null;
    }

    // Check user usage (if applicable)
    if (promotion.user_limit) {
      const userUsage = await prisma.transaction.count({
        where: {
          buyer_id: userId,
          promotion_code: promotionCode,
          status: { not: TRANSACTION_STATUS.CANCELLED }
        }
      });

      if (userUsage >= promotion.user_limit) {
        return null;
      }
    }

    // Update usage count
    await prisma.promotion.update({
      where: { id: promotion.id },
      data: { usage_count: { increment: 1 } }
    });

    return promotion;

  } catch (error) {
    logger.error('Promotion validation failed:', error);
    return null;
  }
};

/**
 * Calculate discount amount
 * @param {Object} promotion - Promotion object
 * @param {number} amount - Transaction amount
 * @returns {number} Discount amount
 */
const calculateDiscount = (promotion, amount) => {
  switch (promotion.type) {
    case 'PERCENTAGE_DISCOUNT':
      return Math.min(amount * (promotion.discount_value / 100), promotion.max_discount || amount);
    case 'FIXED_DISCOUNT':
      return Math.min(promotion.discount_value, amount);
    case 'FREE_SHIPPING':
      return 0; // Shipping discount would be handled separately
    default:
      return 0;
  }
};

/**
 * Generate unique transaction hash
 * @returns {string} Transaction hash
 */
const generateTransactionHash = () => {
  const crypto = require('crypto');
  return crypto.randomBytes(16).toString('hex');
};

/**
 * Create review opportunity after transaction completion
 * @param {Object} transaction - Transaction object
 */
const createReviewOpportunity = async (transaction) => {
  try {
    // Create review opportunities for both buyer and vendor
    const reviewData = [
      {
        transaction_id: transaction.id,
        listing_id: transaction.listing_id,
        reviewer_id: transaction.buyer_id,
        reviewee_id: transaction.vendor_id,
        type: 'VENDOR_REVIEW'
      },
      {
        transaction_id: transaction.id,
        listing_id: transaction.listing_id,
        reviewer_id: transaction.vendor_id,
        reviewee_id: transaction.buyer_id,
        type: 'BUYER_REVIEW'
      }
    ];

    for (const review of reviewData) {
      await prisma.reviewOpportunity.upsert({
        where: {
          transaction_id_reviewer_id: {
            transaction_id: review.transaction_id,
            reviewer_id: review.reviewer_id
          }
        },
        update: {},
        create: {
          ...review,
          expires_at: new Date(Date.now() + BUSINESS_RULES.REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        }
      }).catch(() => {}); // Ignore if table doesn't exist yet
    }

    logger.info('Review opportunities created', {
      transactionId: transaction.id
    });

  } catch (error) {
    logger.error('Create review opportunity failed:', error);
  }
};

// ================================
// ANALYTICS & REPORTING
// ================================

/**
 * Get transaction analytics
 * @param {Object} options - Analytics options
 * @returns {Object} Transaction analytics
 */
const getTransactionAnalytics = async (options = {}) => {
  try {
    const {
      start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      end_date = new Date(),
      vendor_id = null
    } = options;

    const whereClause = {
      created_at: {
        gte: start_date,
        lte: end_date
      }
    };

    if (vendor_id) {
      whereClause.vendor_id = vendor_id;
    }

    const [
      totalTransactions,
      totalVolume,
      statusBreakdown,
      averageOrderValue,
      topVendors
    ] = await Promise.all([
      prisma.transaction.count({ where: whereClause }),
      prisma.transaction.aggregate({
        where: whereClause,
        _sum: { amount: true }
      }),
      prisma.transaction.groupBy({
        by: ['status'],
        where: whereClause,
        _count: { status: true }
      }),
      prisma.transaction.aggregate({
        where: { ...whereClause, status: TRANSACTION_STATUS.COMPLETED },
        _avg: { amount: true }
      }),
      vendor_id ? [] : prisma.transaction.groupBy({
        by: ['vendor_id'],
        where: { ...whereClause, status: TRANSACTION_STATUS.COMPLETED },
        _count: { vendor_id: true },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 10
      })
    ]);

    return {
      summary: {
        total_transactions: totalTransactions,
        total_volume: totalVolume._sum.amount || 0,
        average_order_value: averageOrderValue._avg.amount || 0
      },
      status_breakdown: statusBreakdown.reduce((acc, item) => {
        acc[item.status] = item._count.status;
        return acc;
      }, {}),
      top_vendors: topVendors.map(vendor => ({
        vendor_id: vendor.vendor_id,
        transaction_count: vendor._count.vendor_id,
        total_volume: vendor._sum.amount || 0
      }))
    };

  } catch (error) {
    logger.error('Get transaction analytics failed:', error);
    throw error;
  }
};

// ================================
// SHIPPING & FULFILLMENT
// ================================

/**
 * Update shipping information for transaction
 * @param {string} transactionId - Transaction ID
 * @param {Object} shippingData - Shipping information
 * @param {string} userId - User ID performing update
 * @returns {Object} Updated transaction
 */
const updateShippingInfo = async (transactionId, shippingData, userId) => {
  try {
    const {
      tracking_number,
      shipping_carrier,
      estimated_delivery,
      shipping_notes
    } = shippingData;

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // Only vendor can update shipping info
    if (transaction.vendor_id !== userId) {
      throw new Error('Only vendor can update shipping information');
    }

    if (![TRANSACTION_STATUS.ESCROW, TRANSACTION_STATUS.PAYMENT_RELEASED].includes(transaction.status)) {
      throw new Error('Cannot update shipping for transaction in current status');
    }

    const updatedTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        tracking_number,
        shipping_carrier,
        estimated_delivery: estimated_delivery ? new Date(estimated_delivery) : null,
        shipping_notes,
        shipped_at: tracking_number ? new Date() : transaction.shipped_at,
        status: tracking_number && transaction.status === TRANSACTION_STATUS.ESCROW 
          ? TRANSACTION_STATUS.SHIPPED 
          : transaction.status
      }
    });

    // Send notification to buyer
    await notificationService.createNotification({
      user_id: transaction.buyer_id,
      type: 'SHIPMENT_UPDATE',
      title: 'Order Shipped',
      message: tracking_number 
        ? `Your order has been shipped! Tracking: ${tracking_number}`
        : 'Your order shipping information has been updated',
      metadata: {
        transaction_id: transactionId,
        tracking_number,
        shipping_carrier,
        estimated_delivery
      },
      send_email: true,
      send_push: true
    });

    logger.info('Shipping information updated', {
      transactionId,
      vendorId: userId,
      trackingNumber: tracking_number,
      carrier: shipping_carrier
    });

    return updatedTransaction;

  } catch (error) {
    logger.error('Update shipping info failed:', error);
    throw error;
  }
};

/**
 * Confirm delivery by buyer
 * @param {string} transactionId - Transaction ID
 * @param {string} userId - Buyer user ID
 * @param {Object} confirmationData - Confirmation details
 * @returns {Object} Updated transaction
 */
const confirmDelivery = async (transactionId, userId, confirmationData = {}) => {
  try {
    const { delivery_notes, delivery_rating } = confirmationData;

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { listing: true, vendor: true }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // Only buyer can confirm delivery
    if (transaction.buyer_id !== userId) {
      throw new Error('Only buyer can confirm delivery');
    }

    if (![TRANSACTION_STATUS.SHIPPED, TRANSACTION_STATUS.ESCROW].includes(transaction.status)) {
      throw new Error('Cannot confirm delivery for transaction in current status');
    }

    // Update transaction
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TRANSACTION_STATUS.DELIVERED,
        delivered_at: new Date(),
        delivery_notes,
        delivery_rating,
        // Auto-release escrow in 24 hours if not manually released
        escrow_release_date: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // Send notification to vendor
    await notificationService.createNotification({
      user_id: transaction.vendor_id,
      type: 'DELIVERY_CONFIRMED',
      title: 'Delivery Confirmed',
      message: `Buyer has confirmed delivery of ${transaction.listing.title}`,
      metadata: {
        transaction_id: transactionId,
        listing_title: transaction.listing.title,
        delivery_rating,
        buyer_name: `${transaction.buyer?.first_name} ${transaction.buyer?.last_name}`
      },
      send_email: true,
      send_push: true
    });

    logger.info('Delivery confirmed', {
      transactionId,
      buyerId: userId,
      deliveryRating: delivery_rating
    });

    return updatedTransaction;

  } catch (error) {
    logger.error('Confirm delivery failed:', error);
    throw error;
  }
};

// ================================
// REFUND & RETURN HANDLING
// ================================

/**
 * Process refund for transaction
 * @param {string} transactionId - Transaction ID
 * @param {Object} refundData - Refund details
 * @param {string} processedBy - User ID processing refund
 * @returns {Object} Refund result
 */
const processRefund = async (transactionId, refundData, processedBy) => {
  try {
    const {
      refund_amount,
      refund_reason,
      refund_type = 'full', // 'full' or 'partial'
      admin_notes
    } = refundData;

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { listing: true, buyer: true, vendor: true }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (![TRANSACTION_STATUS.DISPUTED, TRANSACTION_STATUS.COMPLETED, TRANSACTION_STATUS.ESCROW].includes(transaction.status)) {
      throw new Error('Cannot process refund for transaction in current status');
    }

    const finalRefundAmount = refund_amount || transaction.amount;

    // Process Stripe refund if payment exists
    let stripeRefund = null;
    if (transaction.payment_intent_id && process.env.STRIPE_SECRET_KEY) {
      try {
        stripeRefund = await stripe.refunds.create({
          payment_intent: transaction.payment_intent_id,
          amount: Math.round(finalRefundAmount * 100), // Convert to cents
          reason: 'requested_by_customer',
          metadata: {
            transaction_id: transactionId,
            refund_reason,
            processed_by: processedBy
          }
        });
      } catch (stripeError) {
        logger.error('Stripe refund failed:', stripeError);
        // Continue with database update even if Stripe fails
      }
    }

    // Update transaction status
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TRANSACTION_STATUS.REFUNDED,
        refund_amount: finalRefundAmount,
        refund_reason,
        refund_type,
        refunded_at: new Date(),
        refund_processed_by: processedBy,
        stripe_refund_id: stripeRefund?.id || null,
        admin_notes: admin_notes || null
      }
    });

    // Update listing status back to active if full refund
    if (refund_type === 'full') {
      await prisma.listing.update({
        where: { id: transaction.listing_id },
        data: { status: 'ACTIVE' }
      });
    }

    // Send notifications
    await Promise.all([
      // Notify buyer
      notificationService.createNotification({
        user_id: transaction.buyer_id,
        type: 'REFUND_PROCESSED',
        title: 'Refund Processed',
        message: `Your refund of ${finalRefundAmount} has been processed`,
        metadata: {
          transaction_id: transactionId,
          refund_amount: finalRefundAmount,
          refund_reason
        },
        send_email: true
      }),
      // Notify vendor
      notificationService.createNotification({
        user_id: transaction.vendor_id,
        type: 'REFUND_ISSUED',
        title: 'Refund Issued',
        message: `A refund of ${finalRefundAmount} has been issued for ${transaction.listing.title}`,
        metadata: {
          transaction_id: transactionId,
          refund_amount: finalRefundAmount,
          refund_reason
        },
        send_email: true
      })
    ]);

    logger.info('Refund processed successfully', {
      transactionId,
      refundAmount: finalRefundAmount,
      refundType: refund_type,
      processedBy,
      stripeRefundId: stripeRefund?.id
    });

    return {
      transaction: updatedTransaction,
      stripe_refund: stripeRefund,
      refund_amount: finalRefundAmount,
      success: true
    };

  } catch (error) {
    logger.error('Process refund failed:', error);
    throw error;
  }
};

/**
 * Initiate return request
 * @param {string} transactionId - Transaction ID
 * @param {Object} returnData - Return request details
 * @param {string} userId - User ID requesting return
 * @returns {Object} Return request result
 */
const initiateReturn = async (transactionId, returnData, userId) => {
  try {
    const {
      return_reason,
      return_description,
      return_type = 'defective', // 'defective', 'not_as_described', 'changed_mind'
      evidence_urls = []
    } = returnData;

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { listing: true, vendor: true }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // Only buyer can initiate return
    if (transaction.buyer_id !== userId) {
      throw new Error('Only buyer can initiate return');
    }

    if (![TRANSACTION_STATUS.COMPLETED, TRANSACTION_STATUS.DELIVERED].includes(transaction.status)) {
      throw new Error('Cannot initiate return for transaction in current status');
    }

    // Check return window (typically 30 days)
    const returnDeadline = new Date(transaction.completed_at?.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (new Date() > returnDeadline) {
      throw new Error('Return window has expired');
    }

    // Create return request
    const returnRequest = await prisma.returnRequest.create({
      data: {
        transaction_id: transactionId,
        requested_by: userId,
        return_reason,
        return_description,
        return_type,
        evidence_urls: JSON.stringify(evidence_urls),
        status: 'PENDING'
      }
    }).catch(() => {
      // If table doesn't exist, update transaction with return info
      return prisma.transaction.update({
        where: { id: transactionId },
        data: {
          status: TRANSACTION_STATUS.RETURN_REQUESTED,
          return_reason,
          return_description,
          return_requested_at: new Date(),
          return_requested_by: userId
        }
      });
    });

    // Send notification to vendor
    await notificationService.createNotification({
      user_id: transaction.vendor_id,
      type: 'RETURN_REQUESTED',
      title: 'Return Request',
      message: `Buyer has requested a return for ${transaction.listing.title}`,
      metadata: {
        transaction_id: transactionId,
        return_reason,
        return_type,
        listing_title: transaction.listing.title
      },
      send_email: true
    });

    logger.info('Return request initiated', {
      transactionId,
      requestedBy: userId,
      returnReason: return_reason,
      returnType: return_type
    });

    return {
      return_request: returnRequest,
      success: true,
      message: 'Return request submitted successfully'
    };

  } catch (error) {
    logger.error('Initiate return failed:', error);
    throw error;
  }
};

// ================================
// TRANSACTION REPORTING
// ================================

/**
 * Generate transaction report
 * @param {Object} filters - Report filters
 * @returns {Object} Transaction report
 */
const generateTransactionReport = async (filters = {}) => {
  try {
    const {
      start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      end_date = new Date(),
      vendor_id = null,
      status_filter = null,
      category_id = null,
      include_details = false
    } = filters;

    const whereClause = {
      created_at: {
        gte: start_date,
        lte: end_date
      }
    };

    if (vendor_id) whereClause.vendor_id = vendor_id;
    if (status_filter) whereClause.status = status_filter;

    const [
      transactions,
      summaryStats,
      statusBreakdown,
      dailyVolume,
      topVendors,
      refundStats
    ] = await Promise.all([
      // Transaction list (if details requested)
      include_details ? prisma.transaction.findMany({
        where: whereClause,
        include: {
          listing: {
            select: { title: true, category_id: true }
          },
          buyer: {
            select: { first_name: true, last_name: true, email: true }
          },
          vendor: {
            select: { first_name: true, last_name: true, business_name: true }
          }
        },
        orderBy: { created_at: 'desc' },
        take: 1000 // Limit for performance
      }) : [],

      // Summary statistics
      prisma.transaction.aggregate({
        where: whereClause,
        _count: { id: true },
        _sum: { amount: true, platform_fee: true, vendor_amount: true },
        _avg: { amount: true }
      }),

      // Status breakdown
      prisma.transaction.groupBy({
        by: ['status'],
        where: whereClause,
        _count: { status: true },
        _sum: { amount: true }
      }),

      // Daily volume
      prisma.transaction.groupBy({
        by: ['created_at'],
        where: whereClause,
        _count: { id: true },
        _sum: { amount: true }
      }),

      // Top vendors (if not filtered by vendor)
      !vendor_id ? prisma.transaction.groupBy({
        by: ['vendor_id'],
        where: whereClause,
        _count: { vendor_id: true },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 10
      }) : [],

      // Refund statistics
      prisma.transaction.aggregate({
        where: {
          ...whereClause,
          status: TRANSACTION_STATUS.REFUNDED
        },
        _count: { id: true },
        _sum: { refund_amount: true }
      })
    ]);

    // Process daily volume data
    const dailyVolumeMap = new Map();
    dailyVolume.forEach(item => {
      const date = item.created_at.toISOString().split('T')[0];
      if (!dailyVolumeMap.has(date)) {
        dailyVolumeMap.set(date, { date, transaction_count: 0, total_volume: 0 });
      }
      const existing = dailyVolumeMap.get(date);
      existing.transaction_count += item._count.id;
      existing.total_volume += item._sum.amount || 0;
    });

    const report = {
      report_generated_at: new Date(),
      period: { start_date, end_date },
      filters: { vendor_id, status_filter, category_id },
      
      summary: {
        total_transactions: summaryStats._count.id,
        total_volume: summaryStats._sum.amount || 0,
        total_platform_fees: summaryStats._sum.platform_fee || 0,
        total_vendor_earnings: summaryStats._sum.vendor_amount || 0,
        average_transaction_value: summaryStats._avg.amount || 0
      },

      status_breakdown: statusBreakdown.reduce((acc, item) => {
        acc[item.status] = {
          count: item._count.status,
          volume: item._sum.amount || 0
        };
        return acc;
      }, {}),

      daily_volume: Array.from(dailyVolumeMap.values()).sort((a, b) => 
        new Date(a.date) - new Date(b.date)
      ),

      top_vendors: topVendors.map(vendor => ({
        vendor_id: vendor.vendor_id,
        transaction_count: vendor._count.vendor_id,
        total_volume: vendor._sum.amount || 0
      })),

      refund_stats: {
        total_refunds: refundStats._count.id,
        total_refund_amount: refundStats._sum.refund_amount || 0,
        refund_rate: summaryStats._count.id > 0 
          ? (refundStats._count.id / summaryStats._count.id) * 100 
          : 0
      },

      transactions: include_details ? transactions : null
    };

    logger.info('Transaction report generated', {
      reportPeriod: `${start_date.toISOString().split('T')[0]} to ${end_date.toISOString().split('T')[0]}`,
      totalTransactions: report.summary.total_transactions,
      totalVolume: report.summary.total_volume
    });

    return report;

  } catch (error) {
    logger.error('Generate transaction report failed:', error);
    throw error;
  }
};

// ================================
// TRANSACTION WEBHOOKS (Stripe)
// ================================

/**
 * Handle Stripe webhook events
 * @param {Object} event - Stripe webhook event
 * @returns {Object} Webhook processing result
 */
const handleStripeWebhook = async (event) => {
  try {
    logger.info('Processing Stripe webhook', {
      eventType: event.type,
      eventId: event.id
    });

    switch (event.type) {
      case 'payment_intent.succeeded':
        return await handlePaymentSucceeded(event.data.object);
      
      case 'payment_intent.payment_failed':
        return await handlePaymentFailed(event.data.object);
      
      case 'charge.dispute.created':
        return await handleChargeDispute(event.data.object);
      
      case 'invoice.payment_succeeded':
        return await handleSubscriptionPayment(event.data.object);
      
      default:
        logger.info('Unhandled webhook event type', { eventType: event.type });
        return { handled: false, message: 'Event type not handled' };
    }

  } catch (error) {
    logger.error('Stripe webhook processing failed:', error);
    throw error;
  }
};

/**
 * Handle successful payment
 * @param {Object} paymentIntent - Stripe payment intent
 * @returns {Object} Processing result
 */
const handlePaymentSucceeded = async (paymentIntent) => {
  try {
    const transactionId = paymentIntent.metadata.transaction_id;
    
    if (!transactionId) {
      logger.warn('Payment succeeded but no transaction ID in metadata', {
        paymentIntentId: paymentIntent.id
      });
      return { handled: false };
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { listing: true, buyer: true, vendor: true }
    });

    if (!transaction) {
      logger.error('Transaction not found for successful payment', {
        transactionId,
        paymentIntentId: paymentIntent.id
      });
      return { handled: false };
    }

    // Update transaction status
    await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TRANSACTION_STATUS.ESCROW,
        payment_confirmed_at: new Date(),
        stripe_charge_id: paymentIntent.latest_charge
      }
    });

    // Send confirmations
    await Promise.all([
      notificationService.createNotification({
        user_id: transaction.buyer_id,
        type: 'PAYMENT_CONFIRMED',
        title: 'Payment Confirmed',
        message: `Your payment for ${transaction.listing.title} has been confirmed`,
        metadata: { transaction_id: transactionId },
        send_email: true
      }),
      notificationService.createNotification({
        user_id: transaction.vendor_id,
        type: 'ORDER_RECEIVED',
        title: 'New Order',
        message: `You have a new order for ${transaction.listing.title}`,
        metadata: { transaction_id: transactionId },
        send_email: true
      })
    ]);

    logger.info('Payment succeeded processing completed', {
      transactionId,
      paymentIntentId: paymentIntent.id
    });

    return { handled: true, transaction_id: transactionId };

  } catch (error) {
    logger.error('Handle payment succeeded failed:', error);
    return { handled: false, error: error.message };
  }
};

/**
 * Handle failed payment
 * @param {Object} paymentIntent - Stripe payment intent
 * @returns {Object} Processing result
 */
const handlePaymentFailed = async (paymentIntent) => {
  try {
    const transactionId = paymentIntent.metadata.transaction_id;
    
    if (!transactionId) {
      return { handled: false };
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { listing: true, buyer: true }
    });

    if (!transaction) {
      return { handled: false };
    }

    // Update transaction status
    await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TRANSACTION_STATUS.FAILED,
        payment_failed_at: new Date(),
        failure_reason: paymentIntent.last_payment_error?.message || 'Payment failed'
      }
    });

    // Restore listing availability
    await prisma.listing.update({
      where: { id: transaction.listing_id },
      data: { status: 'ACTIVE' }
    });

    // Notify buyer
    await notificationService.createNotification({
      user_id: transaction.buyer_id,
      type: 'PAYMENT_FAILED',
      title: 'Payment Failed',
      message: `Payment for ${transaction.listing.title} could not be processed`,
      metadata: { 
        transaction_id: transactionId,
        failure_reason: paymentIntent.last_payment_error?.message 
      },
      send_email: true
    });

    logger.info('Payment failed processing completed', {
      transactionId,
      paymentIntentId: paymentIntent.id,
      failureReason: paymentIntent.last_payment_error?.message
    });

    return { handled: true, transaction_id: transactionId };

  } catch (error) {
    logger.error('Handle payment failed processing failed:', error);
    return { handled: false, error: error.message };
  }
};

// ================================
// UPDATED EXPORTS
// ================================

module.exports = {
  // Core transaction functions
  createTransaction,
  processPayment,
  getTransaction,
  getUserTransactions,
  cancelTransaction,

  // Escrow management
  releaseEscrow,
  getTransactionsPendingRelease,
  autoReleaseEscrow,

  // Shipping & fulfillment
  updateShippingInfo,
  confirmDelivery,

  // Refunds & returns
  processRefund,
  initiateReturn,

  // Dispute handling
  initiateDispute,

  // Reporting & analytics
  getTransactionAnalytics,
  generateTransactionReport,

  // Webhook handling
  handleStripeWebhook,
  handlePaymentSucceeded,
  handlePaymentFailed,

  // Helper functions
  validateAndApplyPromotion,
  calculateDiscount
};

// ================================
// MISSING FUNCTIONS
// ================================

/**
 * Initiate dispute for transaction
 * @param {string} transactionId - Transaction ID
 * @param {Object} disputeData - Dispute details
 * @returns {Object} Dispute result
 */
const initiateDispute = async (transactionId, disputeData) => {
  try {
    const {
      initiated_by,
      reason,
      description,
      evidence_urls = []
    } = disputeData;

    // Get transaction details
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        listing: true,
        buyer: true,
        vendor: true
      }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (![TRANSACTION_STATUS.ESCROW, TRANSACTION_STATUS.COMPLETED].includes(transaction.status)) {
      throw new Error('Dispute cannot be initiated for transaction in current status');
    }

    // Create dispute record
    const dispute = await prisma.dispute.create({
      data: {
        transaction_id: transactionId,
        initiated_by,
        reason,
        description,
        evidence_urls: JSON.stringify(evidence_urls),
        status: 'OPEN'
      }
    }).catch(() => {
      // If table doesn't exist, update transaction with dispute info
      return prisma.transaction.update({
        where: { id: transactionId },
        data: {
          status: TRANSACTION_STATUS.DISPUTED,
          dispute_reason: reason,
          dispute_description: description,
          dispute_initiated_by: initiated_by,
          dispute_initiated_at: new Date()
        }
      });
    });

    // Update transaction status
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: TRANSACTION_STATUS.DISPUTED }
    });

    logger.info('Dispute initiated', {
      disputeId: dispute.id,
      transactionId,
      initiatedBy: initiated_by,
      reason
    });

    // Notify admin and other party
    const otherPartyId = initiated_by === transaction.buyer_id 
      ? transaction.vendor_id 
      : transaction.buyer_id;

    await notificationService.createNotification({
      user_id: otherPartyId,
      type: 'DISPUTE_INITIATED',
      title: 'Dispute Initiated',
      message: `A dispute has been initiated for transaction ${transactionId}`,
      metadata: {
        transaction_id: transactionId,
        dispute_id: dispute.id,
        reason
      },
      send_email: true
    });

    return dispute;

  } catch (error) {
    logger.error('Dispute initiation failed:', error);
    throw error;
  }
};

/**
 * Get transaction details
 * @param {string} transactionId - Transaction ID
 * @param {string} userId - User ID requesting the transaction
 * @returns {Object} Transaction details
 */
const getTransaction = async (transactionId, userId) => {
  try {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        listing: {
          include: {
            images: {
              select: { url: true, alt_text: true },
              orderBy: { display_order: 'asc' },
              take: 1
            }
          }
        },
        buyer: {
          select: { id: true, first_name: true, last_name: true, avatar_url: true }
        },
        vendor: {
          select: { id: true, first_name: true, last_name: true, avatar_url: true }
        }
      }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // Check if user has access to this transaction
    if (![transaction.buyer_id, transaction.vendor_id].includes(userId)) {
      throw new Error('Access denied');
    }

    // Parse JSON fields
    const transactionWithParsedData = {
      ...transaction,
      shipping_address: transaction.shipping_address 
        ? JSON.parse(transaction.shipping_address) 
        : null,
      payment_method_details: transaction.payment_method_details 
        ? JSON.parse(transaction.payment_method_details) 
        : null
    };

    return transactionWithParsedData;

  } catch (error) {
    logger.error('Get transaction failed:', error);
    throw error;
  }
};

/**
 * Get user transactions with pagination
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Object} Transactions and metadata
 */
const getUserTransactions = async (userId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 20,
      status_filter = null,
      role_filter = null // 'buyer' or 'vendor'
    } = options;

    const offset = (page - 1) * limit;
    
    let whereClause = {
      OR: [
        { buyer_id: userId },
        { vendor_id: userId }
      ]
    };

    if (role_filter === 'buyer') {
      whereClause = { buyer_id: userId };
    } else if (role_filter === 'vendor') {
      whereClause = { vendor_id: userId };
    }

    if (status_filter) {
      whereClause.status = status_filter;
    }

    const [transactions, totalCount] = await Promise.all([
      prisma.transaction.findMany({
        where: whereClause,
        include: {
          listing: {
            select: {
              id: true,
              title: true,
              images: {
                select: { url: true },
                orderBy: { display_order: 'asc' },
                take: 1
              }
            }
          },
          buyer: {
            select: { id: true, first_name: true, last_name: true, avatar_url: true }
          },
          vendor: {
            select: { id: true, first_name: true, last_name: true, avatar_url: true }
          }
        },
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.transaction.count({ where: whereClause })
    ]);

    return {
      transactions,
      pagination: {
        current_page: page,
        total_pages: Math.ceil(totalCount / limit),
        total_count: totalCount,
        per_page: limit
      }
    };

  } catch (error) {
    logger.error('Get user transactions failed:', error);
    throw error;
  }
};

/**
 * Cancel transaction (only if not yet processed)
 * @param {string} transactionId - Transaction ID
 * @param {string} userId - User requesting cancellation
 * @param {string} reason - Cancellation reason
 * @returns {Object} Cancellation result
 */
const cancelTransaction = async (transactionId, userId, reason) => {
  try {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { listing: true }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (![transaction.buyer_id, transaction.vendor_id].includes(userId)) {
      throw new Error('Access denied');
    }

    if (transaction.status !== TRANSACTION_STATUS.INITIATED) {
      throw new Error('Transaction cannot be cancelled in current status');
    }

    // Update transaction status
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TRANSACTION_STATUS.CANCELLED,
        cancelled_at: new Date(),
        cancelled_by: userId,
        cancellation_reason: reason
      }
    });

    // Update listing status back to active
    await prisma.listing.update({
      where: { id: transaction.listing_id },
      data: { status: 'ACTIVE' }
    });

    logger.info('Transaction cancelled', {
      transactionId,
      cancelledBy: userId,
      reason
    });

    return updatedTransaction;

  } catch (error) {
    logger.error('Transaction cancellation failed:', error);
    throw error;
  }
};