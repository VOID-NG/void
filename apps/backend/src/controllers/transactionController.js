// apps/backend/src/controllers/transactionController.js
// Complete transaction management controller

const transactionService = require('../services/transactionService');
const logger = require('../utils/logger');
const { emitToUser, emitToChat } = require('../utils/socketUtils');

// ================================
// CORE TRANSACTION OPERATIONS
// ================================

/**
 * Create a new transaction
 */
const createTransaction = async (req, res) => {
  try {
    const {
      listing_id,
      vendor_id,
      amount,
      payment_method_id,
      shipping_address,
      promotion_code
    } = req.body;

    if (!listing_id || !vendor_id || !amount || !payment_method_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: listing_id, vendor_id, amount, payment_method_id'
      });
    }

    const transaction = await transactionService.createTransaction({
      listing_id,
      buyer_id: req.user.id,
      vendor_id,
      amount,
      payment_method: 'stripe',
      shipping_address,
      promotion_code
    });

    // Emit real-time notification to vendor
    const io = req.app.get('io');
    if (io) {
      emitToUser(io, vendor_id, 'new_transaction', {
        transaction,
        type: 'purchase_initiated'
      });
    }

    res.status(201).json({
      success: true,
      data: { transaction },
      message: 'Transaction created successfully'
    });

  } catch (error) {
    logger.error('Create transaction failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create transaction',
      message: error.message
    });
  }
};

/**
 * Process payment for transaction
 */
const processPayment = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { payment_method_id, billing_address } = req.body;

    if (!payment_method_id) {
      return res.status(400).json({
        success: false,
        error: 'Payment method ID is required'
      });
    }

    const result = await transactionService.processPayment(transactionId, {
      payment_method_id,
      billing_address
    });

    // Emit real-time updates
    const io = req.app.get('io');
    if (io && result.transaction) {
      emitToUser(io, result.transaction.buyer_id, 'payment_processed', {
        transaction_id: transactionId,
        status: 'escrow',
        payment_intent_id: result.payment_intent.id
      });

      emitToUser(io, result.transaction.vendor_id, 'order_received', {
        transaction_id: transactionId,
        buyer: result.transaction.buyer,
        listing: result.transaction.listing
      });
    }

    res.json({
      success: true,
      data: {
        transaction: result.transaction,
        payment_status: result.payment_intent.status
      },
      message: 'Payment processed successfully'
    });

  } catch (error) {
    logger.error('Process payment failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process payment',
      message: error.message
    });
  }
};

/**
 * Get transaction details
 */
const getTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transaction = await transactionService.getTransaction(transactionId, req.user.id);

    res.json({
      success: true,
      data: { transaction }
    });

  } catch (error) {
    logger.error('Get transaction failed:', error);
    const statusCode = error.message === 'Transaction not found' ? 404 :
                      error.message === 'Access denied' ? 403 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Get user transactions
 */
const getUserTransactions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status_filter,
      role_filter
    } = req.query;

    const result = await transactionService.getUserTransactions(req.user.id, {
      page: parseInt(page),
      limit: parseInt(limit),
      status_filter,
      role_filter
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Get user transactions failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get transactions',
      message: error.message
    });
  }
};

/**
 * Cancel transaction
 */
const cancelTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { reason } = req.body;

    const transaction = await transactionService.cancelTransaction(
      transactionId,
      req.user.id,
      reason || 'Cancelled by user'
    );

    // Emit real-time notification
    const io = req.app.get('io');
    if (io) {
      const otherPartyId = transaction.buyer_id === req.user.id 
        ? transaction.vendor_id 
        : transaction.buyer_id;
      
      emitToUser(io, otherPartyId, 'transaction_cancelled', {
        transaction_id: transactionId,
        cancelled_by: req.user.id,
        reason
      });
    }

    res.json({
      success: true,
      data: { transaction },
      message: 'Transaction cancelled successfully'
    });

  } catch (error) {
    logger.error('Cancel transaction failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel transaction',
      message: error.message
    });
  }
};

// ================================
// ESCROW MANAGEMENT
// ================================

/**
 * Release escrow manually
 */
const releaseEscrow = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { release_reason } = req.body;

    const result = await transactionService.releaseEscrow(transactionId, {
      released_by: req.user.id,
      release_reason: release_reason || 'manual_release'
    });

    // Emit real-time notification
    const io = req.app.get('io');
    if (io) {
      emitToUser(io, result.transaction.vendor_id, 'escrow_released', {
        transaction_id: transactionId,
        amount: result.transaction.vendor_amount
      });
    }

    res.json({
      success: true,
      data: result,
      message: 'Escrow released successfully'
    });

  } catch (error) {
    logger.error('Release escrow failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to release escrow',
      message: error.message
    });
  }
};

// ================================
// SHIPPING & FULFILLMENT
// ================================

/**
 * Update shipping information
 */
const updateShippingInfo = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const {
      tracking_number,
      shipping_carrier,
      estimated_delivery,
      shipping_notes
    } = req.body;

    const transaction = await transactionService.updateShippingInfo(
      transactionId,
      {
        tracking_number,
        shipping_carrier,
        estimated_delivery,
        shipping_notes
      },
      req.user.id
    );

    // Emit real-time notification to buyer
    const io = req.app.get('io');
    if (io) {
      emitToUser(io, transaction.buyer_id, 'shipping_updated', {
        transaction_id: transactionId,
        tracking_number,
        shipping_carrier,
        estimated_delivery
      });
    }

    res.json({
      success: true,
      data: { transaction },
      message: 'Shipping information updated successfully'
    });

  } catch (error) {
    logger.error('Update shipping info failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update shipping information',
      message: error.message
    });
  }
};

/**
 * Confirm delivery
 */
const confirmDelivery = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { delivery_notes, delivery_rating } = req.body;

    const transaction = await transactionService.confirmDelivery(
      transactionId,
      req.user.id,
      { delivery_notes, delivery_rating }
    );

    // Emit real-time notification to vendor
    const io = req.app.get('io');
    if (io) {
      emitToUser(io, transaction.vendor_id, 'delivery_confirmed', {
        transaction_id: transactionId,
        delivery_rating,
        buyer_id: req.user.id
      });
    }

    res.json({
      success: true,
      data: { transaction },
      message: 'Delivery confirmed successfully'
    });

  } catch (error) {
    logger.error('Confirm delivery failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm delivery',
      message: error.message
    });
  }
};

// ================================
// REFUNDS & RETURNS
// ================================

/**
 * Process refund (Admin only)
 */
const processRefund = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const {
      refund_amount,
      refund_reason,
      refund_type = 'full',
      admin_notes
    } = req.body;

    // Check admin permissions
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    const result = await transactionService.processRefund(
      transactionId,
      {
        refund_amount,
        refund_reason,
        refund_type,
        admin_notes
      },
      req.user.id
    );

    res.json({
      success: true,
      data: result,
      message: 'Refund processed successfully'
    });

  } catch (error) {
    logger.error('Process refund failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process refund',
      message: error.message
    });
  }
};

/**
 * Initiate return request
 */
const initiateReturn = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const {
      return_reason,
      return_description,
      return_type,
      evidence_urls
    } = req.body;

    if (!return_reason || !return_description) {
      return res.status(400).json({
        success: false,
        error: 'Return reason and description are required'
      });
    }

    const result = await transactionService.initiateReturn(
      transactionId,
      {
        return_reason,
        return_description,
        return_type,
        evidence_urls
      },
      req.user.id
    );

    res.json({
      success: true,
      data: result,
      message: 'Return request submitted successfully'
    });

  } catch (error) {
    logger.error('Initiate return failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate return',
      message: error.message
    });
  }
};

// ================================
// DISPUTE HANDLING
// ================================

/**
 * Initiate dispute
 */
const initiateDispute = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const {
      reason,
      description,
      evidence_urls
    } = req.body;

    if (!reason || !description) {
      return res.status(400).json({
        success: false,
        error: 'Dispute reason and description are required'
      });
    }

    const dispute = await transactionService.initiateDispute(transactionId, {
      initiated_by: req.user.id,
      reason,
      description,
      evidence_urls
    });

    // Emit real-time notification to admin
    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('dispute_created', {
        dispute_id: dispute.id,
        transaction_id: transactionId,
        initiated_by: req.user.id,
        reason
      });
    }

    res.json({
      success: true,
      data: { dispute },
      message: 'Dispute initiated successfully'
    });

  } catch (error) {
    logger.error('Initiate dispute failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate dispute',
      message: error.message
    });
  }
};

// ================================
// ANALYTICS & REPORTING
// ================================

/**
 * Get transaction analytics
 */
const getTransactionAnalytics = async (req, res) => {
  try {
    const {
      start_date,
      end_date,
      vendor_id
    } = req.query;

    // For vendor analytics, restrict to their own data
    const finalVendorId = req.user.role === 'VENDOR' ? req.user.id : vendor_id;

    const analytics = await transactionService.getTransactionAnalytics({
      start_date: start_date ? new Date(start_date) : undefined,
      end_date: end_date ? new Date(end_date) : undefined,
      vendor_id: finalVendorId
    });

    res.json({
      success: true,
      data: { analytics }
    });

  } catch (error) {
    logger.error('Get transaction analytics failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get analytics',
      message: error.message
    });
  }
};

/**
 * Generate transaction report (Admin only)
 */
const generateTransactionReport = async (req, res) => {
  try {
    // Check admin permissions
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    const {
      start_date,
      end_date,
      vendor_id,
      status_filter,
      category_id,
      include_details = false
    } = req.query;

    const report = await transactionService.generateTransactionReport({
      start_date: start_date ? new Date(start_date) : undefined,
      end_date: end_date ? new Date(end_date) : undefined,
      vendor_id,
      status_filter,
      category_id,
      include_details: include_details === 'true'
    });

    res.json({
      success: true,
      data: { report }
    });

  } catch (error) {
    logger.error('Generate transaction report failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate report',
      message: error.message
    });
  }
};

// ================================
// WEBHOOK HANDLING
// ================================

/**
 * Handle Stripe webhooks
 */
const handleStripeWebhook = async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      logger.error('Stripe webhook signature verification failed:', err);
      return res.status(400).json({
        success: false,
        error: 'Invalid webhook signature'
      });
    }

    const result = await transactionService.handleStripeWebhook(event);

    res.json({
      success: true,
      data: result,
      message: 'Webhook processed successfully'
    });

  } catch (error) {
    logger.error('Stripe webhook handling failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process webhook',
      message: error.message
    });
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Core operations
  createTransaction,
  processPayment,
  getTransaction,
  getUserTransactions,
  cancelTransaction,

  // Escrow management
  releaseEscrow,

  // Shipping & fulfillment
  updateShippingInfo,
  confirmDelivery,

  // Refunds & returns
  processRefund,
  initiateReturn,

  // Dispute handling
  initiateDispute,

  // Analytics & reporting
  getTransactionAnalytics,
  generateTransactionReport,

  // Webhook handling
  handleStripeWebhook
};
