// apps/backend/src/routes/transactionRoutes.js
// Transaction and escrow management routes

const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole, requireMinRole } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validateMiddleware');
const logger = require('../utils/logger');

const router = express.Router();

// All transaction routes require authentication
router.use(verifyToken);

// ================================
// TRANSACTION ROUTES
// ================================

/**
 * @route   GET /api/v1/transactions
 * @desc    Get user's transactions (buyer or seller)
 * @access  Private
 */
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      type = 'all' // 'buyer', 'seller', 'all'
    } = req.query;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    // Build where clause
    let whereClause = {};
    
    if (type === 'buyer') {
      whereClause.buyer_id = req.user.id;
    } else if (type === 'seller') {
      whereClause.vendor_id = req.user.id;
    } else {
      whereClause = {
        OR: [
          { buyer_id: req.user.id },
          { vendor_id: req.user.id }
        ]
      };
    }

    if (status) {
      whereClause.status = status.toUpperCase();
    }

    // Get transactions
    const transactions = await dbRouter.transaction.findMany({
      where: whereClause,
      include: {
        buyer: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        vendor: {
          select: {
            id: true,
            username: true,
            business_name: true,
            avatar_url: true
          }
        },
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            images: {
              where: { is_primary: true },
              take: 1
            }
          }
        }
      },
      orderBy: { created_at: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    });

    // Get total count
    const totalCount = await dbRouter.transaction.count({
      where: whereClause
    });

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / parseInt(limit))
        }
      }
    });

  } catch (error) {
    logger.error('Get transactions failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get transactions',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/v1/transactions
 * @desc    Create a new transaction (initiate purchase)
 * @access  Private
 */
router.post('/', async (req, res) => {
  try {
    const { 
      listing_id, 
      quantity = 1, 
      offer_amount,
      payment_method = 'ESCROW',
      shipping_address 
    } = req.body;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    // Validate listing
    const listing = await dbRouter.listing.findUnique({
      where: { id: listing_id },
      include: { vendor: true }
    });

    if (!listing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    if (listing.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        error: 'Listing is not available for purchase'
      });
    }

    // Prevent self-purchase
    if (listing.vendor_id === req.user.id) {
      return res.status(400).json({
        success: false,
        error: 'Cannot purchase your own listing'
      });
    }

    // Calculate amounts
    const listingPrice = parseFloat(listing.price);
    const finalPrice = offer_amount ? parseFloat(offer_amount) : listingPrice;
    const totalAmount = finalPrice * parseInt(quantity);
    
    // Platform fee (2.9% + $0.30)
    const platformFee = Math.round((totalAmount * 0.029 + 0.30) * 100) / 100;
    const vendorAmount = Math.round((totalAmount - platformFee) * 100) / 100;

    // Create transaction
    const transaction = await dbRouter.transaction.create({
      data: {
        listing_id,
        buyer_id: req.user.id,
        vendor_id: listing.vendor_id,
        quantity: parseInt(quantity),
        unit_price: finalPrice,
        total_amount: totalAmount,
        platform_fee: platformFee,
        vendor_amount: vendorAmount,
        payment_method,
        shipping_address: shipping_address ? JSON.stringify(shipping_address) : null,
        status: 'INITIATED',
        escrow_status: payment_method === 'ESCROW' ? 'PENDING' : null
      },
      include: {
        buyer: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            email: true
          }
        },
        vendor: {
          select: {
            id: true,
            username: true,
            business_name: true,
            email: true
          }
        },
        listing: {
          select: {
            id: true,
            title: true,
            price: true
          }
        }
      }
    });

    // TODO: Integrate with payment processor (Stripe, PayPal, etc.)
    // For now, we'll simulate escrow creation

    logger.info('Transaction created', {
      transactionId: transaction.id,
      buyerId: req.user.id,
      vendorId: listing.vendor_id,
      amount: totalAmount
    });

    // Emit real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${listing.vendor_id}`).emit('new_transaction', {
        transaction,
        type: 'new_purchase'
      });
    }

    res.status(201).json({
      success: true,
      data: { transaction },
      message: 'Transaction initiated successfully'
    });

  } catch (error) {
    logger.error('Create transaction failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create transaction',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/v1/transactions/:transactionId
 * @desc    Get specific transaction details
 * @access  Private
 */
router.get('/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    const transaction = await dbRouter.transaction.findUnique({
      where: { id: transactionId },
      include: {
        buyer: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        vendor: {
          select: {
            id: true,
            username: true,
            business_name: true,
            avatar_url: true
          }
        },
        listing: {
          select: {
            id: true,
            title: true,
            description: true,
            price: true,
            images: {
              where: { is_primary: true },
              take: 1
            }
          }
        }
      }
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    // Verify user has access to this transaction
    if (transaction.buyer_id !== req.user.id && transaction.vendor_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: { transaction }
    });

  } catch (error) {
    logger.error('Get transaction details failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get transaction details',
      message: error.message
    });
  }
});

/**
 * @route   PATCH /api/v1/transactions/:transactionId/status
 * @desc    Update transaction status
 * @access  Private
 */
router.patch('/:transactionId/status', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { status, reason } = req.body;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    const validStatuses = [
      'INITIATED', 'ESCROW_PENDING', 'ESCROW_ACTIVE', 
      'PAYMENT_RELEASED', 'COMPLETED', 'DISPUTED', 
      'CANCELLED', 'REFUNDED'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status',
        valid_statuses: validStatuses
      });
    }

    // Find transaction
    const transaction = await dbRouter.transaction.findUnique({
      where: { id: transactionId },
      include: { listing: true }
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    // Check permissions based on status change
    let hasPermission = false;
    
    if (status === 'CANCELLED') {
      // Buyer can cancel before escrow is active
      hasPermission = transaction.buyer_id === req.user.id && 
                     ['INITIATED', 'ESCROW_PENDING'].includes(transaction.status);
    } else if (status === 'COMPLETED') {
      // Buyer can mark as completed
      hasPermission = transaction.buyer_id === req.user.id;
    } else if (status === 'DISPUTED') {
      // Either party can initiate dispute
      hasPermission = transaction.buyer_id === req.user.id || 
                      transaction.vendor_id === req.user.id;
    }

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to change transaction to this status'
      });
    }

    // Update transaction
    const updatedTransaction = await dbRouter.transaction.update({
      where: { id: transactionId },
      data: {
        status,
        updated_at: new Date(),
        notes: reason ? JSON.stringify({ status_change: reason }) : transaction.notes
      },
      include: {
        buyer: true,
        vendor: true,
        listing: true
      }
    });

    // Handle side effects based on status
    if (status === 'COMPLETED') {
      // Mark listing as sold
      await dbRouter.listing.update({
        where: { id: transaction.listing_id },
        data: { status: 'SOLD' }
      });
    }

    // Emit real-time updates
    const io = req.app.get('io');
    if (io) {
      const otherPartyId = transaction.buyer_id === req.user.id ? 
                          transaction.vendor_id : transaction.buyer_id;
      
      io.to(`user_${otherPartyId}`).emit('transaction_updated', {
        transaction: updatedTransaction,
        status_change: status
      });
    }

    logger.info('Transaction status updated', {
      transactionId,
      oldStatus: transaction.status,
      newStatus: status,
      userId: req.user.id
    });

    res.json({
      success: true,
      data: { transaction: updatedTransaction },
      message: `Transaction ${status.toLowerCase()} successfully`
    });

  } catch (error) {
    logger.error('Update transaction status failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update transaction status',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/v1/transactions/:transactionId/dispute
 * @desc    Create a dispute for a transaction
 * @access  Private
 */
router.post('/:transactionId/dispute', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { reason, description } = req.body;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    // Find transaction
    const transaction = await dbRouter.transaction.findUnique({
      where: { id: transactionId }
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    // Verify user is part of transaction
    if (transaction.buyer_id !== req.user.id && transaction.vendor_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Update transaction status to disputed
    await dbRouter.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'DISPUTED',
        dispute_reason: reason,
        dispute_description: description,
        disputed_by: req.user.id,
        disputed_at: new Date()
      }
    });

    // TODO: Create dispute record and notify admin

    logger.info('Transaction disputed', {
      transactionId,
      disputedBy: req.user.id,
      reason
    });

    res.json({
      success: true,
      message: 'Dispute created successfully. Admin team will review.'
    });

  } catch (error) {
    logger.error('Create dispute failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create dispute',
      message: error.message
    });
  }
});

// ================================
// ADMIN TRANSACTION ROUTES
// ================================

/**
 * @route   GET /api/v1/transactions/admin/all
 * @desc    Get all transactions (admin only)
 * @access  Admin
 */
router.get('/admin/all', 
  requireMinRole('ADMIN'),
  async (req, res) => {
    try {
      const { 
        page = 1, 
        limit = 50, 
        status, 
        disputed_only = false 
      } = req.query;
      const { dbRouter, QueryOptimizer } = require('../config/db');

      let whereClause = {};
      if (status) whereClause.status = status.toUpperCase();
      if (disputed_only === 'true') whereClause.status = 'DISPUTED';

      const transactions = await dbRouter.transaction.findMany({
        where: whereClause,
        include: {
          buyer: {
            select: {
              id: true,
              username: true,
              email: true
            }
          },
          vendor: {
            select: {
              id: true,
              username: true,
              business_name: true,
              email: true
            }
          },
          listing: {
            select: {
              id: true,
              title: true,
              price: true
            }
          }
        },
        orderBy: { created_at: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      });

      const totalCount = await dbRouter.transaction.count({
        where: whereClause
      });

      res.json({
        success: true,
        data: {
          transactions,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalCount,
            pages: Math.ceil(totalCount / parseInt(limit))
          }
        }
      });

    } catch (error) {
      logger.error('Admin get transactions failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get transactions',
        message: error.message
      });
    }
  }
);

module.exports = router;

