// src/controllers/adminController.js
// Complete admin dashboard controller with Nigerian market insights
// Handles user management, vendor verification, transaction monitoring, and analytics

const { prisma } = require('../config/db');
const logger = require('../utils/logger');
const { formatNairaAmount, fromKobo } = require('../config/paymentConfig');
const { emitToUser } = require('../utils/socketUtils');

// ================================
// DASHBOARD ANALYTICS
// ================================

/**
 * Get admin dashboard overview
 */
const getDashboardOverview = async (req, res) => {
  try {
    const timeRange = req.query.range || '30d'; // 7d, 30d, 90d, 1y
    const endDate = new Date();
    const startDate = new Date();
    
    // Calculate date range
    switch (timeRange) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    // Parallel data fetching for performance
    const [
      userStats,
      vendorStats,
      listingStats,
      transactionStats,
      revenueStats,
      disputeStats,
      topCategories,
      topLocations,
      recentActivity
    ] = await Promise.all([
      getUserStatistics(startDate, endDate),
      getVendorStatistics(startDate, endDate),
      getListingStatistics(startDate, endDate),
      getTransactionStatistics(startDate, endDate),
      getRevenueStatistics(startDate, endDate),
      getDisputeStatistics(startDate, endDate),
      getTopCategories(startDate, endDate),
      getTopLocations(startDate, endDate),
      getRecentActivity(10)
    ]);

    // Calculate growth rates
    const previousStartDate = new Date(startDate);
    previousStartDate.setTime(previousStartDate.getTime() - (endDate.getTime() - startDate.getTime()));
    
    const previousStats = await getPreviousPeriodStats(previousStartDate, startDate);
    const growthRates = calculateGrowthRates(
      { users: userStats.total, transactions: transactionStats.total, revenue: revenueStats.total },
      previousStats
    );

    const overview = {
      summary: {
        totalUsers: userStats.total,
        totalVendors: vendorStats.total,
        totalListings: listingStats.total,
        totalTransactions: transactionStats.total,
        totalRevenue: revenueStats.total,
        totalDisputes: disputeStats.total,
        timeRange: timeRange
      },
      
      growth: {
        users: growthRates.users,
        transactions: growthRates.transactions,
        revenue: growthRates.revenue
      },
      
      breakdowns: {
        users: userStats.breakdown,
        vendors: vendorStats.breakdown,
        listings: listingStats.breakdown,
        transactions: transactionStats.breakdown,
        revenue: revenueStats.breakdown,
        disputes: disputeStats.breakdown
      },
      
      insights: {
        topCategories: topCategories,
        topLocations: topLocations,
        averageTransactionValue: transactionStats.total > 0 ? revenueStats.total / transactionStats.total : 0,
        disputeRate: transactionStats.total > 0 ? (disputeStats.total / transactionStats.total) * 100 : 0,
        vendorActivationRate: userStats.total > 0 ? (vendorStats.total / userStats.total) * 100 : 0
      },
      
      recentActivity: recentActivity,
      
      formatted: {
        totalRevenue: formatNairaAmount(revenueStats.total * 100),
        averageTransactionValue: formatNairaAmount((revenueStats.total / transactionStats.total || 0) * 100)
      }
    };

    res.json({
      success: true,
      data: { overview },
      message: 'Dashboard overview retrieved successfully'
    });

  } catch (error) {
    logger.error('Dashboard overview failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve dashboard overview',
      message: error.message
    });
  }
};

// ================================
// USER MANAGEMENT
// ================================

/**
 * Get all users with filtering and pagination
 */
const getUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      role = '',
      status = '',
      verified = '',
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build filter conditions
    const whereConditions = {};
    
    if (search) {
      whereConditions.OR = [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (role) {
      whereConditions.role = role;
    }
    
    if (status) {
      whereConditions.status = status;
    }
    
    if (verified !== '') {
      whereConditions.email_verified = verified === 'true';
    }

    // Get users with counts
    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where: whereConditions,
        select: {
          id: true,
          first_name: true,
          last_name: true,
          username: true,
          email: true,
          role: true,
          status: true,
          email_verified: true,
          phone: true,
          location: true,
          created_at: true,
          last_login: true,
          profile_image: true,
          _count: {
            select: {
              listings: true,
              transactions_as_buyer: true,
              transactions_as_vendor: true
            }
          }
        },
        orderBy: { [sortBy]: sortOrder },
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.user.count({ where: whereConditions })
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        users: users.map(user => ({
          ...user,
          totalListings: user._count.listings,
          totalPurchases: user._count.transactions_as_buyer,
          totalSales: user._count.transactions_as_vendor,
          _count: undefined
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: parseInt(page) < totalPages,
          hasPreviousPage: parseInt(page) > 1
        }
      }
    });

  } catch (error) {
    logger.error('Get users failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve users',
      message: error.message
    });
  }
};

/**
 * Get single user details
 */
const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        listings: {
          select: {
            id: true,
            title: true,
            price: true,
            status: true,
            created_at: true,
            views_count: true,
            images: true
          },
          orderBy: { created_at: 'desc' },
          take: 10
        },
        transactions_as_buyer: {
          select: {
            id: true,
            amount: true,
            status: true,
            created_at: true,
            listing: {
              select: { title: true, images: true }
            }
          },
          orderBy: { created_at: 'desc' },
          take: 10
        },
        transactions_as_vendor: {
          select: {
            id: true,
            amount: true,
            status: true,
            created_at: true,
            listing: {
              select: { title: true, images: true }
            }
          },
          orderBy: { created_at: 'desc' },
          take: 10
        },
        reviews_received: {
          select: {
            id: true,
            rating: true,
            comment: true,
            created_at: true,
            reviewer: {
              select: { first_name: true, last_name: true, username: true }
            }
          },
          orderBy: { created_at: 'desc' },
          take: 5
        },
        notifications: {
          select: {
            id: true,
            type: true,
            title: true,
            created_at: true,
            read: true
          },
          orderBy: { created_at: 'desc' },
          take: 5
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Calculate user statistics
    const stats = {
      totalListings: user.listings.length,
      activeLlistings: user.listings.filter(l => l.status === 'ACTIVE').length,
      totalPurchases: user.transactions_as_buyer.length,
      totalSales: user.transactions_as_vendor.length,
      totalReviews: user.reviews_received.length,
      averageRating: user.reviews_received.length > 0 
        ? user.reviews_received.reduce((sum, review) => sum + review.rating, 0) / user.reviews_received.length 
        : 0,
      totalRevenue: user.transactions_as_vendor
        .filter(t => t.status === 'COMPLETED')
        .reduce((sum, t) => sum + fromKobo(t.amount), 0),
      unreadNotifications: user.notifications.filter(n => !n.read).length
    };

    res.json({
      success: true,
      data: {
        user: {
          ...user,
          transactions_as_buyer: undefined,
          transactions_as_vendor: undefined
        },
        stats,
        recentActivity: {
          purchases: user.transactions_as_buyer,
          sales: user.transactions_as_vendor,
          listings: user.listings,
          reviews: user.reviews_received,
          notifications: user.notifications
        },
        formatted: {
          totalRevenue: formatNairaAmount(stats.totalRevenue * 100),
          averageRating: stats.averageRating.toFixed(1)
        }
      }
    });

  } catch (error) {
    logger.error('Get user details failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user details',
      message: error.message
    });
  }
};

/**
 * Update user role or status
 */
const updateUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, status, reason } = req.body;

    // Validate role
    const validRoles = ['USER', 'VENDOR', 'ADMIN', 'SUPER_ADMIN'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role specified'
      });
    }

    // Validate status
    const validStatuses = ['ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status specified'
      });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Prevent self-demotion from SUPER_ADMIN
    if (req.user.id === userId && req.user.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Cannot demote yourself from SUPER_ADMIN role'
      });
    }

    // Update user
    const updateData = {};
    if (role) updateData.role = role;
    if (status) updateData.status = status;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        role: true,
        status: true,
        updated_at: true
      }
    });

    // Log admin action
    await logAdminAction({
      admin_id: req.user.id,
      action: 'USER_ROLE_UPDATE',
      target_type: 'USER',
      target_id: userId,
      details: {
        previous_role: existingUser.role,
        new_role: role || existingUser.role,
        previous_status: existingUser.status,
        new_status: status || existingUser.status,
        reason: reason || 'No reason provided'
      }
    });

    // Send notification to user if status changed to suspended/banned
    if (status && ['SUSPENDED', 'BANNED'].includes(status)) {
      await createNotification({
        user_id: userId,
        type: 'ACCOUNT_STATUS_CHANGE',
        title: `Account ${status.toLowerCase()}`,
        message: `Your account has been ${status.toLowerCase()}. ${reason || ''}`,
        metadata: { status, reason }
      });
    }

    // Emit real-time notification
    const io = req.app.get('io');
    if (io) {
      emitToUser(io, userId, 'account_status_change', {
        status: status || existingUser.status,
        role: role || existingUser.role,
        message: `Your account status has been updated by an administrator`
      });
    }

    logger.info('User role/status updated:', {
      adminId: req.user.id,
      userId: userId,
      previousRole: existingUser.role,
      newRole: role || existingUser.role,
      previousStatus: existingUser.status,
      newStatus: status || existingUser.status
    });

    res.json({
      success: true,
      data: { user: updatedUser },
      message: 'User role/status updated successfully'
    });

  } catch (error) {
    logger.error('Update user role failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user role',
      message: error.message
    });
  }
};

/**
 * Verify vendor account
 */
const verifyVendor = async (req, res) => {
  try {
    const { userId } = req.params;
    const { verified, reason, documents_reviewed } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        vendor_profile: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (user.role !== 'VENDOR') {
      return res.status(400).json({
        success: false,
        error: 'User is not a vendor'
      });
    }

    // Update vendor verification status
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        vendor_verified: verified,
        vendor_verification_date: verified ? new Date() : null,
        vendor_profile: {
          update: {
            verification_status: verified ? 'VERIFIED' : 'REJECTED',
            verification_notes: reason,
            documents_reviewed: documents_reviewed || [],
            verified_by: req.user.id,
            verified_at: verified ? new Date() : null
          }
        }
      },
      include: {
        vendor_profile: true
      }
    });

    // Log admin action
    await logAdminAction({
      admin_id: req.user.id,
      action: 'VENDOR_VERIFICATION',
      target_type: 'USER',
      target_id: userId,
      details: {
        verified: verified,
        reason: reason,
        documents_reviewed: documents_reviewed
      }
    });

    // Send notification to vendor
    await createNotification({
      user_id: userId,
      type: verified ? 'VENDOR_VERIFIED' : 'VENDOR_REJECTED',
      title: verified ? 'Vendor Account Verified!' : 'Vendor Verification Failed',
      message: verified 
        ? 'Congratulations! Your vendor account has been verified. You can now start selling.'
        : `Your vendor verification was not approved. Reason: ${reason}`,
      metadata: { verified, reason }
    });

    // Emit real-time notification
    const io = req.app.get('io');
    if (io) {
      emitToUser(io, userId, 'vendor_verification_update', {
        verified: verified,
        message: verified ? 'Your vendor account has been verified!' : 'Vendor verification was rejected'
      });
    }

    res.json({
      success: true,
      data: { user: updatedUser },
      message: `Vendor ${verified ? 'verified' : 'rejected'} successfully`
    });

  } catch (error) {
    logger.error('Vendor verification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update vendor verification',
      message: error.message
    });
  }
};

// ================================
// LISTING MANAGEMENT
// ================================

/**
 * Get all listings with admin filters
 */
const getListings = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = '',
      category = '',
      search = '',
      vendor = '',
      flagged = '',
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build filter conditions
    const whereConditions = {};
    
    if (search) {
      whereConditions.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (status) {
      whereConditions.status = status;
    }
    
    if (category) {
      whereConditions.category = category;
    }
    
    if (vendor) {
      whereConditions.vendor_id = vendor;
    }
    
    if (flagged !== '') {
      whereConditions.is_flagged = flagged === 'true';
    }

    const [listings, totalCount] = await Promise.all([
      prisma.listing.findMany({
        where: whereConditions,
        include: {
          vendor: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              username: true,
              vendor_verified: true
            }
          },
          _count: {
            select: {
              transactions: true,
              reviews: true,
              reports: true
            }
          }
        },
        orderBy: { [sortBy]: sortOrder },
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.listing.count({ where: whereConditions })
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        listings: listings.map(listing => ({
          ...listing,
          totalTransactions: listing._count.transactions,
          totalReviews: listing._count.reviews,
          totalReports: listing._count.reports,
          _count: undefined,
          formatted_price: formatNairaAmount(listing.price)
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: parseInt(page) < totalPages,
          hasPreviousPage: parseInt(page) > 1
        }
      }
    });

  } catch (error) {
    logger.error('Get listings failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve listings',
      message: error.message
    });
  }
};

/**
 * Update listing status (approve, reject, feature, etc.)
 */
const updateListingStatus = async (req, res) => {
  try {
    const { listingId } = req.params;
    const { status, reason, is_featured, admin_notes } = req.body;

    const validStatuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'REJECTED'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status specified'
      });
    }

    const existingListing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        vendor: {
          select: { id: true, first_name: true, last_name: true }
        }
      }
    });

    if (!existingListing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    // Update listing
    const updateData = {};
    if (status) updateData.status = status;
    if (is_featured !== undefined) updateData.is_featured = is_featured;
    if (admin_notes) updateData.admin_notes = admin_notes;

    const updatedListing = await prisma.listing.update({
      where: { id: listingId },
      data: updateData,
      include: {
        vendor: {
          select: { id: true, first_name: true, last_name: true }
        }
      }
    });

    // Log admin action
    await logAdminAction({
      admin_id: req.user.id,
      action: 'LISTING_STATUS_UPDATE',
      target_type: 'LISTING',
      target_id: listingId,
      details: {
        previous_status: existingListing.status,
        new_status: status || existingListing.status,
        previous_featured: existingListing.is_featured,
        new_featured: is_featured !== undefined ? is_featured : existingListing.is_featured,
        reason: reason || 'No reason provided'
      }
    });

    // Send notification to vendor
    if (status && status !== existingListing.status) {
      await createNotification({
        user_id: existingListing.vendor_id,
        type: 'LISTING_STATUS_CHANGE',
        title: `Listing ${status.toLowerCase()}`,
        message: `Your listing "${existingListing.title}" has been ${status.toLowerCase()}. ${reason || ''}`,
        metadata: { listing_id: listingId, status, reason }
      });
    }

    res.json({
      success: true,
      data: { listing: updatedListing },
      message: 'Listing updated successfully'
    });

  } catch (error) {
    logger.error('Update listing status failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update listing',
      message: error.message
    });
  }
};

// ================================
// TRANSACTION MONITORING
// ================================

/**
 * Get all transactions with admin filters
 */
const getTransactions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = '',
      payment_method = '',
      min_amount = '',
      max_amount = '',
      start_date = '',
      end_date = '',
      user_id = '',
      vendor_id = '',
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build filter conditions
    const whereConditions = {};
    
    if (status) {
      whereConditions.status = status;
    }
    
    if (payment_method) {
      whereConditions.payment_method = payment_method;
    }
    
    if (min_amount || max_amount) {
      whereConditions.amount = {};
      if (min_amount) whereConditions.amount.gte = parseInt(min_amount) * 100; // Convert to kobo
      if (max_amount) whereConditions.amount.lte = parseInt(max_amount) * 100;
    }
    
    if (start_date || end_date) {
      whereConditions.created_at = {};
      if (start_date) whereConditions.created_at.gte = new Date(start_date);
      if (end_date) whereConditions.created_at.lte = new Date(end_date);
    }
    
    if (user_id) {
      whereConditions.buyer_id = user_id;
    }
    
    if (vendor_id) {
      whereConditions.vendor_id = vendor_id;
    }

    const [transactions, totalCount] = await Promise.all([
      prisma.transaction.findMany({
        where: whereConditions,
        include: {
          buyer: {
            select: { id: true, first_name: true, last_name: true, username: true }
          },
          vendor: {
            select: { id: true, first_name: true, last_name: true, username: true }
          },
          listing: {
            select: { id: true, title: true, images: true }
          },
          disputes: {
            select: { id: true, status: true, reason: true }
          }
        },
        orderBy: { [sortBy]: sortOrder },
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.transaction.count({ where: whereConditions })
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        transactions: transactions.map(transaction => ({
          ...transaction,
          formatted_amount: formatNairaAmount(transaction.amount),
          has_disputes: transaction.disputes.length > 0,
          active_disputes: transaction.disputes.filter(d => d.status === 'OPEN').length
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: parseInt(page) < totalPages,
          hasPreviousPage: parseInt(page) > 1
        }
      }
    });

  } catch (error) {
    logger.error('Get transactions failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve transactions',
      message: error.message
    });
  }
};

/**
 * Force release escrow (admin override)
 */
const forceReleaseEscrow = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { reason } = req.body;

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        buyer: true,
        vendor: true,
        listing: true
      }
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    if (transaction.status !== 'ESCROW') {
      return res.status(400).json({
        success: false,
        error: 'Transaction is not in escrow status'
      });
    }

    // Update transaction status
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'COMPLETED',
        escrow_released_at: new Date(),
        escrow_released_by: req.user.id,
        admin_notes: reason || 'Escrow released by admin'
      }
    });

    // Log admin action
    await logAdminAction({
      admin_id: req.user.id,
      action: 'FORCE_ESCROW_RELEASE',
      target_type: 'TRANSACTION',
      target_id: transactionId,
      details: {
        amount: fromKobo(transaction.amount),
        reason: reason || 'No reason provided',
        buyer_id: transaction.buyer_id,
        vendor_id: transaction.vendor_id
      }
    });

    // Send notifications
    await Promise.all([
      createNotification({
        user_id: transaction.vendor_id,
        type: 'ESCROW_RELEASED',
        title: 'Payment Released',
        message: `Escrow payment of ${formatNairaAmount(transaction.amount)} has been released by admin.`,
        metadata: { transaction_id: transactionId, amount: transaction.amount }
      }),
      createNotification({
        user_id: transaction.buyer_id,
        type: 'ESCROW_RELEASED',
        title: 'Transaction Completed',
        message: `Transaction for "${transaction.listing.title}" has been completed by admin.`,
        metadata: { transaction_id: transactionId, listing_id: transaction.listing_id }
      })
    ]);

    res.json({
      success: true,
      data: { transaction: updatedTransaction },
      message: 'Escrow released successfully'
    });

  } catch (error) {
    logger.error('Force release escrow failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to release escrow',
      message: error.message
    });
  }
};

// ================================
// DISPUTE RESOLUTION
// ================================

/**
 * Get all disputes
 */
const getDisputes = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = '',
      priority = '',
      assigned_to = '',
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const whereConditions = {};
    if (status) whereConditions.status = status;
    if (priority) whereConditions.priority = priority;
    if (assigned_to) whereConditions.assigned_to = assigned_to;

    const [disputes, totalCount] = await Promise.all([
      prisma.dispute.findMany({
        where: whereConditions,
        include: {
          transaction: {
            include: {
              buyer: { select: { id: true, first_name: true, last_name: true } },
              vendor: { select: { id: true, first_name: true, last_name: true } },
              listing: { select: { id: true, title: true } }
            }
          },
          initiated_by_user: { select: { id: true, first_name: true, last_name: true } },
          assigned_admin: { select: { id: true, first_name: true, last_name: true } },
          messages: { take: 1, orderBy: { created_at: 'desc' } }
        },
        orderBy: { [sortBy]: sortOrder },
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.dispute.count({ where: whereConditions })
    ]);

    res.json({
      success: true,
      data: {
        disputes: disputes.map(dispute => ({
          ...dispute,
          last_message: dispute.messages[0] || null,
          messages: undefined,
          transaction_amount: formatNairaAmount(dispute.transaction.amount)
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          totalCount
        }
      }
    });

  } catch (error) {
    logger.error('Get disputes failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve disputes',
      message: error.message
    });
  }
};

/**
 * Resolve dispute
 */
const resolveDispute = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { resolution, refund_amount, winner, admin_notes } = req.body;

    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        transaction: {
          include: {
            buyer: true,
            vendor: true,
            listing: true
          }
        }
      }
    });

    if (!dispute) {
      return res.status(404).json({
        success: false,
        error: 'Dispute not found'
      });
    }

    if (dispute.status === 'RESOLVED') {
      return res.status(400).json({
        success: false,
        error: 'Dispute already resolved'
      });
    }

    // Update dispute
    const updatedDispute = await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'RESOLVED',
        resolution: resolution,
        resolved_by: req.user.id,
        resolved_at: new Date(),
        refund_amount: refund_amount || 0,
        winner: winner,
        admin_notes: admin_notes
      }
    });

    // Update transaction if needed
    if (refund_amount > 0) {
      await prisma.transaction.update({
        where: { id: dispute.transaction_id },
        data: {
          status: 'REFUNDED',
          refund_amount: refund_amount * 100, // Convert to kobo
          refunded_at: new Date()
        }
      });
    }

    // Log admin action
    await logAdminAction({
      admin_id: req.user.id,
      action: 'DISPUTE_RESOLVED',
      target_type: 'DISPUTE',
      target_id: disputeId,
      details: {
        resolution: resolution,
        winner: winner,
        refund_amount: refund_amount,
        transaction_id: dispute.transaction_id
      }
    });

    // Send notifications to involved parties
    await Promise.all([
      createNotification({
        user_id: dispute.transaction.buyer_id,
        type: 'DISPUTE_RESOLVED',
        title: 'Dispute Resolved',
        message: `Your dispute has been resolved. ${resolution}`,
        metadata: { dispute_id: disputeId, resolution, refund_amount }
      }),
      createNotification({
        user_id: dispute.transaction.vendor_id,
        type: 'DISPUTE_RESOLVED',
        title: 'Dispute Resolved',
        message: `The dispute for your transaction has been resolved. ${resolution}`,
        metadata: { dispute_id: disputeId, resolution }
      })
    ]);

    res.json({
      success: true,
      data: { dispute: updatedDispute },
      message: 'Dispute resolved successfully'
    });

  } catch (error) {
    logger.error('Resolve dispute failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resolve dispute',
      message: error.message
    });
  }
};

// ================================
// HELPER FUNCTIONS
// ================================

/**
 * Get user statistics for date range
 */
async function getUserStatistics(startDate, endDate) {
  const [total, newUsers, activeUsers, verifiedUsers] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({
      where: { created_at: { gte: startDate, lte: endDate } }
    }),
    prisma.user.count({
      where: {
        last_login: { gte: startDate, lte: endDate }
      }
    }),
    prisma.user.count({
      where: { email_verified: true }
    })
  ]);

  return {
    total,
    breakdown: {
      new: newUsers,
      active: activeUsers,
      verified: verifiedUsers,
      unverified: total - verifiedUsers
    }
  };
}

/**
 * Get vendor statistics
 */
async function getVendorStatistics(startDate, endDate) {
  const [total, newVendors, verifiedVendors, activeVendors] = await Promise.all([
    prisma.user.count({ where: { role: 'VENDOR' } }),
    prisma.user.count({
      where: {
        role: 'VENDOR',
        created_at: { gte: startDate, lte: endDate }
      }
    }),
    prisma.user.count({
      where: {
        role: 'VENDOR',
        vendor_verified: true
      }
    }),
    prisma.user.count({
      where: {
        role: 'VENDOR',
        listings: { some: { status: 'ACTIVE' } }
      }
    })
  ]);

  return {
    total,
    breakdown: {
      new: newVendors,
      verified: verifiedVendors,
      active: activeVendors,
      pending: total - verifiedVendors
    }
  };
}

/**
 * Get listing statistics
 */
async function getListingStatistics(startDate, endDate) {
  const [total, newListings, activeListings, featuredListings] = await Promise.all([
    prisma.listing.count(),
    prisma.listing.count({
      where: { created_at: { gte: startDate, lte: endDate } }
    }),
    prisma.listing.count({
      where: { status: 'ACTIVE' }
    }),
    prisma.listing.count({
      where: { is_featured: true }
    })
  ]);

  return {
    total,
    breakdown: {
      new: newListings,
      active: activeListings,
      featured: featuredListings,
      inactive: total - activeListings
    }
  };
}

/**
 * Get transaction statistics
 */
async function getTransactionStatistics(startDate, endDate) {
  const [total, newTransactions, completedTransactions, disputedTransactions] = await Promise.all([
    prisma.transaction.count(),
    prisma.transaction.count({
      where: { created_at: { gte: startDate, lte: endDate } }
    }),
    prisma.transaction.count({
      where: { status: 'COMPLETED' }
    }),
    prisma.transaction.count({
      where: {
        disputes: { some: { status: 'OPEN' } }
      }
    })
  ]);

  return {
    total,
    breakdown: {
      new: newTransactions,
      completed: completedTransactions,
      disputed: disputedTransactions,
      pending: total - completedTransactions
    }
  };
}

/**
 * Get revenue statistics
 */
async function getRevenueStatistics(startDate, endDate) {
  const result = await prisma.transaction.aggregate({
    _sum: { amount: true },
    where: {
      status: 'COMPLETED',
      created_at: { gte: startDate, lte: endDate }
    }
  });

  const totalRevenue = fromKobo(result._sum.amount || 0);

  // Get commission earned (assuming 2.5% commission)
  const commissionEarned = totalRevenue * 0.025;

  return {
    total: totalRevenue,
    breakdown: {
      commission: commissionEarned,
      gross: totalRevenue
    }
  };
}

/**
 * Get dispute statistics
 */
async function getDisputeStatistics(startDate, endDate) {
  const [total, newDisputes, openDisputes, resolvedDisputes] = await Promise.all([
    prisma.dispute.count(),
    prisma.dispute.count({
      where: { created_at: { gte: startDate, lte: endDate } }
    }),
    prisma.dispute.count({
      where: { status: 'OPEN' }
    }),
    prisma.dispute.count({
      where: { status: 'RESOLVED' }
    })
  ]);

  return {
    total,
    breakdown: {
      new: newDisputes,
      open: openDisputes,
      resolved: resolvedDisputes
    }
  };
}

/**
 * Get top categories
 */
async function getTopCategories(startDate, endDate) {
  return await prisma.listing.groupBy({
    by: ['category'],
    _count: { category: true },
    where: {
      created_at: { gte: startDate, lte: endDate }
    },
    orderBy: {
      _count: { category: 'desc' }
    },
    take: 10
  });
}

/**
 * Get top locations
 */
async function getTopLocations(startDate, endDate) {
  return await prisma.user.groupBy({
    by: ['location'],
    _count: { location: true },
    where: {
      location: { not: null },
      created_at: { gte: startDate, lte: endDate }
    },
    orderBy: {
      _count: { location: 'desc' }
    },
    take: 10
  });
}

/**
 * Get recent admin activity
 */
async function getRecentActivity(limit = 10) {
  return await prisma.adminAction.findMany({
    include: {
      admin: {
        select: { first_name: true, last_name: true }
      }
    },
    orderBy: { created_at: 'desc' },
    take: limit
  });
}

/**
 * Calculate growth rates
 */
function calculateGrowthRates(currentStats, previousStats) {
  const calculateGrowth = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  return {
    users: calculateGrowth(currentStats.users, previousStats.users),
    transactions: calculateGrowth(currentStats.transactions, previousStats.transactions),
    revenue: calculateGrowth(currentStats.revenue, previousStats.revenue)
  };
}

/**
 * Get previous period statistics
 */
async function getPreviousPeriodStats(startDate, endDate) {
  const [users, transactions, revenue] = await Promise.all([
    prisma.user.count({
      where: { created_at: { gte: startDate, lte: endDate } }
    }),
    prisma.transaction.count({
      where: { created_at: { gte: startDate, lte: endDate } }
    }),
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: {
        status: 'COMPLETED',
        created_at: { gte: startDate, lte: endDate }
      }
    }).then(result => fromKobo(result._sum.amount || 0))
  ]);

  return { users, transactions, revenue };
}

/**
 * Log admin action
 */
async function logAdminAction(actionData) {
  try {
    return await prisma.adminAction.create({
      data: {
        ...actionData,
        ip_address: actionData.ip_address || 'unknown',
        user_agent: actionData.user_agent || 'unknown'
      }
    });
  } catch (error) {
    logger.error('Failed to log admin action:', error);
  }
}

/**
 * Create notification
 */
async function createNotification(notificationData) {
  try {
    return await prisma.notification.create({
      data: notificationData
    });
  } catch (error) {
    logger.error('Failed to create notification:', error);
  }
}

// ================================
// EXPORTS
// ================================

module.exports = {
  // Dashboard
  getDashboardOverview,
  
  // User Management
  getUsers,
  getUserDetails,
  updateUserRole,
  verifyVendor,
  
  // Listing Management
  getListings,
  updateListingStatus,
  
  // Transaction Monitoring
  getTransactions,
  forceReleaseEscrow,
  
  // Dispute Resolution
  getDisputes,
  resolveDispute
};