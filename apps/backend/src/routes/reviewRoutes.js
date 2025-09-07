// =================================================================
// apps/backend/src/routes/reviewRoutes.js
// Review and rating system routes
// =================================================================

const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const logger = require('../utils/logger');

const reviewRouter = express.Router();

reviewRouter.get('/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    const reviews = await dbRouter.review.findMany({
      where: { listing_id: listingId },
      include: {
        reviewer: {
          select: { id: true, username: true, avatar_url: true }
        }
      },
      orderBy: { created_at: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    });

    res.json({ success: true, data: { reviews } });
  } catch (error) {
    logger.error('Get reviews failed:', error);
    res.status(500).json({ success: false, error: 'Failed to get reviews' });
  }
});

reviewRouter.post('/', verifyToken, async (req, res) => {
  try {
    const { listing_id, rating, comment } = req.body;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    const review = await dbRouter.review.create({
      data: {
        listing_id,
        reviewer_id: req.user.id,
        reviewed_user_id: req.body.reviewed_user_id,
        rating: parseInt(rating),
        comment,
        review_type: 'LISTING'
      }
    });

    res.status(201).json({ success: true, data: { review } });
  } catch (error) {
    logger.error('Create review failed:', error);
    res.status(500).json({ success: false, error: 'Failed to create review' });
  }
});

// =================================================================
// apps/backend/src/routes/notificationRoutes.js
// Notification management routes
// =================================================================

const notificationRouter = express.Router();
notificationRouter.use(verifyToken);

notificationRouter.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, unread_only = false } = req.query;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    const whereClause = { user_id: req.user.id };
    if (unread_only === 'true') whereClause.read_at = null;

    const notifications = await dbRouter.notification.findMany({
      where: whereClause,
      orderBy: { created_at: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    });

    res.json({ success: true, data: { notifications } });
  } catch (error) {
    logger.error('Get notifications failed:', error);
    res.status(500).json({ success: false, error: 'Failed to get notifications' });
  }
});

notificationRouter.patch('/:notificationId/read', async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    await dbRouter.notification.update({
      where: { id: notificationId, user_id: req.user.id },
      data: { read_at: new Date() }
    });

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    logger.error('Mark notification read failed:', error);
    res.status(500).json({ success: false, error: 'Failed to mark notification as read' });
  }
});

// =================================================================
// apps/backend/src/routes/promotionRoutes.js
// Promotion and discount management routes
// =================================================================

const promotionRouter = express.Router();

promotionRouter.get('/', async (req, res) => {
  try {
    const { dbRouter, QueryOptimizer } = require('../config/db');
    
    const promotions = await dbRouter.promotion.findMany({
      where: {
        is_active: true,
        start_date: { lte: new Date() },
        end_date: { gte: new Date() }
      },
      orderBy: { created_at: 'desc' }
    });

    res.json({ success: true, data: { promotions } });
  } catch (error) {
    logger.error('Get promotions failed:', error);
    res.status(500).json({ success: false, error: 'Failed to get promotions' });
  }
});

promotionRouter.post('/validate', async (req, res) => {
  try {
    const { code, listing_id } = req.body;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    const promotion = await dbRouter.promotion.findFirst({
      where: {
        code: code.toUpperCase(),
        is_active: true,
        start_date: { lte: new Date() },
        end_date: { gte: new Date() }
      }
    });

    if (!promotion) {
      return res.status(404).json({ success: false, error: 'Invalid or expired promotion code' });
    }

    res.json({ success: true, data: { promotion, valid: true } });
  } catch (error) {
    logger.error('Validate promotion failed:', error);
    res.status(500).json({ success: false, error: 'Failed to validate promotion' });
  }
});

// =================================================================
// apps/backend/src/routes/subscriptionRoutes.js
// Vendor subscription management routes
// =================================================================

const subscriptionRouter = express.Router();
subscriptionRouter.use(verifyToken);

subscriptionRouter.get('/plans', async (req, res) => {
  try {
    const plans = [
      { id: 'FREE', name: 'Free', price: 0, max_listings: 5, features: ['Basic support'] },
      { id: 'BASIC', name: 'Basic', price: 29.99, max_listings: 50, features: ['Email support', 'Analytics'] },
      { id: 'PREMIUM', name: 'Premium', price: 99.99, max_listings: 200, features: ['Priority support', 'Advanced analytics'] },
      { id: 'ENTERPRISE', name: 'Enterprise', price: 299.99, max_listings: -1, features: ['Dedicated support', 'Custom branding'] }
    ];

    res.json({ success: true, data: { plans } });
  } catch (error) {
    logger.error('Get subscription plans failed:', error);
    res.status(500).json({ success: false, error: 'Failed to get subscription plans' });
  }
});

subscriptionRouter.get('/current', async (req, res) => {
  try {
    const { dbRouter, QueryOptimizer } = require('../config/db');
    
    const subscription = await dbRouter.subscription.findUnique({
      where: { user_id: req.user.id }
    });

    res.json({ success: true, data: { subscription: subscription || { plan: 'FREE', status: 'ACTIVE' } } });
  } catch (error) {
    logger.error('Get current subscription failed:', error);
    res.status(500).json({ success: false, error: 'Failed to get current subscription' });
  }
});

subscriptionRouter.post('/upgrade', async (req, res) => {
  try {
    const { plan } = req.body;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    // TODO: Integrate with payment processor
    
    const subscription = await dbRouter.subscription.upsert({
      where: { user_id: req.user.id },
      update: { plan, status: 'ACTIVE', updated_at: new Date() },
      create: { user_id: req.user.id, plan, status: 'ACTIVE' }
    });

    res.json({ success: true, data: { subscription }, message: 'Subscription upgraded successfully' });
  } catch (error) {
    logger.error('Upgrade subscription failed:', error);
    res.status(500).json({ success: false, error: 'Failed to upgrade subscription' });
  }
});

// =================================================================
// apps/backend/src/routes/adminRoutes.js
// Admin dashboard and management routes
// =================================================================

const { requireMinRole } = require('../middleware/roleMiddleware');
const adminRouter = express.Router();
adminRouter.use(verifyToken);
adminRouter.use(requireMinRole('ADMIN'));

// Dashboard stats
adminRouter.get('/dashboard', async (req, res) => {
  try {
    const { dbRouter, QueryOptimizer } = require('../config/db');
    
    const stats = await Promise.all([
      dbRouter.user.count(),
      dbRouter.listing.count(),
      dbRouter.transaction.count(),
      dbRouter.transaction.aggregate({ _sum: { total_amount: true } })
    ]);

    res.json({
      success: true,
      data: {
        total_users: stats[0],
        total_listings: stats[1],
        total_transactions: stats[2],
        total_revenue: stats[3]._sum.total_amount || 0
      }
    });
  } catch (error) {
    logger.error('Get admin dashboard failed:', error);
    res.status(500).json({ success: false, error: 'Failed to get dashboard stats' });
  }
});

// User management
adminRouter.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 50, role, status } = req.query;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    const whereClause = {};
    if (role) whereClause.role = role.toUpperCase();
    if (status) whereClause.status = status.toUpperCase();

    const users = await dbRouter.user.findMany({
      where: whereClause,
      select: {
        id: true,
        email: true,
        username: true,
        first_name: true,
        last_name: true,
        role: true,
        status: true,
        created_at: true,
        last_login: true
      },
      orderBy: { created_at: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    });

    res.json({ success: true, data: { users } });
  } catch (error) {
    logger.error('Get admin users failed:', error);
    res.status(500).json({ success: false, error: 'Failed to get users' });
  }
});

// Update user status/role
adminRouter.patch('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, role } = req.body;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    const updateData = {};
    if (status) updateData.status = status.toUpperCase();
    if (role) updateData.role = role.toUpperCase();

    const user = await dbRouter.user.update({
      where: { id: userId },
      data: updateData
    });

    // Log admin action
    await dbRouter.adminAction.create({
      data: {
        admin_id: req.user.id,
        action_type: `user_${status ? 'status' : 'role'}_update`,
        target_type: 'user',
        target_id: userId,
        metadata: JSON.stringify({ old_status: user.status, new_status: status, old_role: user.role, new_role: role })
      }
    });

    res.json({ success: true, data: { user }, message: 'User updated successfully' });
  } catch (error) {
    logger.error('Update user failed:', error);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

// Listing management
adminRouter.get('/listings', async (req, res) => {
  try {
    const { page = 1, limit = 50, status = 'PENDING_APPROVAL' } = req.query;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    const listings = await dbRouter.listing.findMany({
      where: { status: status.toUpperCase() },
      include: {
        vendor: {
          select: { id: true, username: true, business_name: true }
        },
        images: {
          where: { is_primary: true },
          take: 1
        }
      },
      orderBy: { created_at: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    });

    res.json({ success: true, data: { listings } });
  } catch (error) {
    logger.error('Get admin listings failed:', error);
    res.status(500).json({ success: false, error: 'Failed to get listings' });
  }
});

// Approve/reject listing
adminRouter.patch('/listings/:listingId/status', async (req, res) => {
  try {
    const { listingId } = req.params;
    const { status, reason } = req.body;
    const { dbRouter, QueryOptimizer } = require('../config/db');

    const listing = await dbRouter.listing.update({
      where: { id: listingId },
      data: { status: status.toUpperCase(), updated_at: new Date() }
    });

    // Log admin action
    await dbRouter.adminAction.create({
      data: {
        admin_id: req.user.id,
        action_type: `listing_${status.toLowerCase()}`,
        target_type: 'listing',
        target_id: listingId,
        reason,
        metadata: JSON.stringify({ status: status.toUpperCase() })
      }
    });

    res.json({ success: true, data: { listing }, message: `Listing ${status.toLowerCase()} successfully` });
  } catch (error) {
    logger.error('Update listing status failed:', error);
    res.status(500).json({ success: false, error: 'Failed to update listing status' });
  }
});

// =================================================================
// EXPORT ALL ROUTERS
// =================================================================

module.exports = {
  reviewRoutes: reviewRouter,
  notificationRoutes: notificationRouter,
  promotionRoutes: promotionRouter,
  subscriptionRoutes: subscriptionRouter,
  adminRoutes: adminRouter
};