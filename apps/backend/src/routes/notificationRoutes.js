// apps/backend/src/routes/notificationRoutes.js
// Complete notification routes: in-app, email, push, SMS notifications

const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validateMiddleware');
const notificationController = require('../controllers/notificationController');

const router = express.Router();

// ================================
// USER NOTIFICATION ROUTES
// ================================

/**
 * @route   GET /api/v1/notifications
 * @desc    Get user notifications with pagination and filters
 * @access  Private
 * @query   {
 *   page?: number,
 *   limit?: number,
 *   type?: string,
 *   status?: string, // all, read, unread
 *   category?: string
 * }
 */
router.get('/', verifyToken, notificationController.getUserNotifications);

/**
 * @route   GET /api/v1/notifications/unread-count
 * @desc    Get count of unread notifications
 * @access  Private
 */
router.get('/unread-count', verifyToken, notificationController.getUnreadCount);

/**
 * @route   PATCH /api/v1/notifications/:notificationId/read
 * @desc    Mark specific notification as read
 * @access  Private
 */
router.patch('/:notificationId/read', verifyToken, notificationController.markAsRead);

/**
 * @route   PATCH /api/v1/notifications/mark-all-read
 * @desc    Mark all notifications as read (with optional filters)
 * @access  Private
 * @body    { category?: string, type?: string }
 */
router.patch('/mark-all-read', verifyToken, notificationController.markAllAsRead);

/**
 * @route   DELETE /api/v1/notifications/:notificationId
 * @desc    Delete specific notification
 * @access  Private
 */
router.delete('/:notificationId', verifyToken, notificationController.deleteNotification);

/**
 * @route   DELETE /api/v1/notifications/all
 * @desc    Delete all notifications (with optional filters)
 * @access  Private
 * @body    { 
 *   category?: string, 
 *   type?: string, 
 *   older_than_days?: number 
 * }
 */
router.delete('/all', verifyToken, notificationController.deleteAllNotifications);

// ================================
// NOTIFICATION PREFERENCES
// ================================

/**
 * @route   GET /api/v1/notifications/preferences
 * @desc    Get user notification preferences
 * @access  Private
 */
router.get('/preferences', verifyToken, notificationController.getNotificationPreferences);

/**
 * @route   PUT /api/v1/notifications/preferences
 * @desc    Update notification preferences
 * @access  Private
 * @body    {
 *   email_notifications?: object,
 *   push_notifications?: object,
 *   sms_notifications?: object,
 *   in_app_notifications?: object,
 *   quiet_hours?: object,
 *   frequency_settings?: object
 * }
 */
router.put('/preferences', verifyToken, notificationController.updateNotificationPreferences);

// ================================
// PUSH NOTIFICATION ROUTES
// ================================

/**
 * @route   POST /api/v1/notifications/devices/register
 * @desc    Register device for push notifications
 * @access  Private
 * @body    {
 *   device_token: string (required),
 *   device_type: string (required), // ios, android, web
 *   device_name?: string,
 *   app_version?: string
 * }
 */
router.post('/devices/register', verifyToken, notificationController.registerDevice);

/**
 * @route   POST /api/v1/notifications/devices/unregister
 * @desc    Unregister device from push notifications
 * @access  Private
 * @body    { device_token: string (required) }
 */
router.post('/devices/unregister', verifyToken, notificationController.unregisterDevice);

/**
 * @route   POST /api/v1/notifications/test-push
 * @desc    Send test push notification to user's devices
 * @access  Private
 * @body    { message?: string }
 */
router.post('/test-push', verifyToken, notificationController.sendTestPushNotification);

// ================================
// EMAIL SUBSCRIPTION ROUTES
// ================================

/**
 * @route   POST /api/v1/notifications/email/subscribe
 * @desc    Subscribe to email notifications
 * @access  Public (can be used without auth for newsletter signup)
 * @body    {
 *   email: string (required),
 *   subscription_types?: string[],
 *   frequency?: string
 * }
 */
router.post('/email/subscribe', notificationController.subscribeToEmail);

/**
 * @route   GET /api/v1/notifications/email/unsubscribe
 * @desc    Unsubscribe from email notifications (usually from email link)
 * @access  Public
 * @query   {
 *   token?: string,
 *   email?: string,
 *   subscription_type?: string
 * }
 */
router.get('/email/unsubscribe', notificationController.unsubscribeFromEmail);

/**
 * @route   POST /api/v1/notifications/email/unsubscribe
 * @desc    Unsubscribe from email notifications (API endpoint)
 * @access  Public
 * @body    {
 *   token?: string,
 *   email?: string,
 *   subscription_type?: string
 * }
 */
router.post('/email/unsubscribe', notificationController.unsubscribeFromEmail);

// ================================
// ADMIN NOTIFICATION ROUTES
// ================================

/**
 * @route   POST /api/v1/notifications/admin/create
 * @desc    Create custom notification (Admin only)
 * @access  Private (Admin)
 * @body    {
 *   recipient_id?: string,
 *   recipient_type?: string, // user, vendor, admin, all
 *   title: string (required),
 *   message: string (required),
 *   type?: string,
 *   category?: string,
 *   data?: object,
 *   channels?: string[], // in_app, email, push, sms
 *   priority?: string, // low, normal, high, urgent
 *   scheduled_for?: string
 * }
 */
router.post('/admin/create', 
  verifyToken, 
  requireRole(['ADMIN', 'SUPER_ADMIN']), 
  notificationController.createNotification
);

/**
 * @route   POST /api/v1/notifications/admin/bulk
 * @desc    Send bulk notifications (Admin only)
 * @access  Private (Admin)
 * @body    {
 *   recipients: string[] | 'all' (required),
 *   title: string (required),
 *   message: string (required),
 *   type?: string,
 *   category?: string,
 *   data?: object,
 *   channels?: string[],
 *   priority?: string,
 *   scheduled_for?: string
 * }
 */
router.post('/admin/bulk', 
  verifyToken, 
  requireRole(['ADMIN', 'SUPER_ADMIN']), 
  notificationController.sendBulkNotifications
);

/**
 * @route   GET /api/v1/notifications/admin/analytics
 * @desc    Get notification analytics (Admin only)
 * @access  Private (Admin)
 * @query   {
 *   start_date?: string,
 *   end_date?: string,
 *   type?: string,
 *   category?: string,
 *   channel?: string
 * }
 */
router.get('/admin/analytics', 
  verifyToken, 
  requireRole(['ADMIN', 'SUPER_ADMIN']), 
  notificationController.getNotificationAnalytics
);

/**
 * @route   GET /api/v1/notifications/admin/delivery-stats
 * @desc    Get notification delivery statistics (Admin only)
 * @access  Private (Admin)
 * @query   {
 *   period?: string, // 1d, 7d, 30d
 *   channel?: string,
 *   group_by?: string // hour, day, week
 * }
 */
router.get('/admin/delivery-stats', 
  verifyToken, 
  requireRole(['ADMIN', 'SUPER_ADMIN']), 
  notificationController.getDeliveryStats
);

/**
 * @route   GET /api/v1/notifications/admin/queue-status
 * @desc    Get notification queue status (Admin only)
 * @access  Private (Admin)
 */
router.get('/admin/queue-status', 
  verifyToken, 
  requireRole(['ADMIN', 'SUPER_ADMIN']), 
  notificationController.getQueueStatus
);

// ================================
// NOTIFICATION TEMPLATES (Admin)
// ================================

/**
 * @route   GET /api/v1/notifications/templates
 * @desc    Get notification templates (Admin only)
 * @access  Private (Admin)
 * @query   {
 *   category?: string,
 *   type?: string,
 *   active_only?: boolean
 * }
 */
router.get('/templates', 
  verifyToken, 
  requireRole(['ADMIN', 'SUPER_ADMIN']), 
  notificationController.getNotificationTemplates
);

/**
 * @route   POST /api/v1/notifications/templates
 * @desc    Create notification template (Admin only)
 * @access  Private (Admin)
 * @body    {
 *   name: string (required),
 *   type?: string,
 *   category?: string,
 *   title_template: string (required),
 *   message_template: string (required),
 *   variables?: string[],
 *   channels?: string[],
 *   is_active?: boolean
 * }
 */
router.post('/templates', 
  verifyToken, 
  requireRole(['ADMIN', 'SUPER_ADMIN']), 
  notificationController.createNotificationTemplate
);

/**
 * @route   PUT /api/v1/notifications/templates/:templateId
 * @desc    Update notification template (Admin only)
 * @access  Private (Admin)
 */
router.put('/templates/:templateId', 
  verifyToken, 
  requireRole(['ADMIN', 'SUPER_ADMIN']), 
  notificationController.updateNotificationTemplate
);

/**
 * @route   DELETE /api/v1/notifications/templates/:templateId
 * @desc    Delete notification template (Admin only)
 * @access  Private (Admin)
 */
router.delete('/templates/:templateId', 
  verifyToken, 
  requireRole(['ADMIN', 'SUPER_ADMIN']), 
  async (req, res) => {
    try {
      const { templateId } = req.params;
      const notificationService = require('../services/notificationService');

      await notificationService.deleteNotificationTemplate({
        template_id: templateId,
        deleted_by: req.user.id
      });

      res.json({
        success: true,
        message: 'Notification template deleted'
      });

    } catch (error) {
      const logger = require('../utils/logger');
      logger.error('Notification route error:', error);
      res.status(500).json({
        success: false,
        error: 'Notification service error',
        message: 'An error occurred while processing your notification request'
      });
    }
  }
);

// ================================
// ROUTE DOCUMENTATION
// ================================

/**
 * @route   GET /api/v1/notifications/docs
 * @desc    Get notification API documentation
 * @access  Public
 */
router.get('/docs', (req, res) => {
  res.json({
    success: true,
    data: {
      version: '1.0.0',
      description: 'Void Marketplace Notification API',
      endpoints: {
        user_notifications: {
          'GET /notifications': 'Get user notifications with pagination',
          'GET /notifications/unread-count': 'Get unread notification count',
          'PATCH /notifications/:id/read': 'Mark notification as read',
          'PATCH /notifications/mark-all-read': 'Mark all notifications as read',
          'DELETE /notifications/:id': 'Delete specific notification',
          'DELETE /notifications/all': 'Delete all notifications'
        },
        preferences: {
          'GET /notifications/preferences': 'Get notification preferences',
          'PUT /notifications/preferences': 'Update notification preferences'
        },
        push_notifications: {
          'POST /notifications/devices/register': 'Register device for push',
          'POST /notifications/devices/unregister': 'Unregister device',
          'POST /notifications/test-push': 'Send test push notification'
        },
        email_notifications: {
          'POST /notifications/email/subscribe': 'Subscribe to email notifications',
          'GET /notifications/email/unsubscribe': 'Unsubscribe from emails',
          'POST /notifications/email/unsubscribe': 'Unsubscribe from emails (API)'
        },
        admin_endpoints: {
          'POST /notifications/admin/create': 'Create custom notification',
          'POST /notifications/admin/bulk': 'Send bulk notifications',
          'GET /notifications/admin/analytics': 'Get notification analytics',
          'GET /notifications/admin/delivery-stats': 'Get delivery statistics',
          'GET /notifications/admin/queue-status': 'Get queue status'
        },
        templates: {
          'GET /notifications/templates': 'Get notification templates',
          'POST /notifications/templates': 'Create notification template',
          'PUT /notifications/templates/:id': 'Update notification template',
          'DELETE /notifications/templates/:id': 'Delete notification template'
        },
        webhooks: {
          'POST /notifications/webhooks/transaction': 'Transaction notifications',
          'POST /notifications/webhooks/chat': 'Chat message notifications',
          'POST /notifications/webhooks/listing': 'Listing notifications'
        },
        monitoring: {
          'GET /notifications/health': 'Service health check'
        }
      },
      notification_types: [
        'chat_message',
        'offer_received',
        'offer_accepted',
        'offer_rejected',
        'payment_received',
        'product_sold',
        'listing_approved',
        'listing_rejected',
        'transaction_update',
        'system_announcement',
        'promotion_alert',
        'review_received'
      ],
      notification_channels: [
        'in_app',
        'email',
        'push',
        'sms'
      ],
      notification_priorities: [
        'low',
        'normal',
        'high',
        'urgent'
      ],
      features: [
        'Real-time in-app notifications',
        'Email notifications with templates',
        'Push notifications (iOS, Android, Web)',
        'SMS notifications (Nigerian networks)',
        'Notification preferences management',
        'Bulk notification system',
        'Analytics and delivery tracking',
        'Template management system',
        'Webhook integration',
        'Rate limiting and spam protection'
      ],
      authentication: {
        required_for: [
          'User notification management',
          'Preference updates',
          'Device registration',
          'Admin functions',
          'Template management'
        ],
        not_required_for: [
          'Email subscription/unsubscription',
          'Webhook endpoints',
          'Health check',
          'Documentation'
        ]
      },
      rate_limits: {
        notification_creation: '100 per 15 minutes per user',
        bulk_notifications: '10 per hour per admin',
        device_registration: '10 per minute per user',
        preference_updates: '20 per hour per user'
      }
    }
  });
});

// ================================
// INTERNAL/WEBHOOK ROUTES (No auth needed)
// ================================

/**
 * @route   POST /api/v1/notifications/webhooks/transaction
 * @desc    Handle transaction-related notifications (Internal webhook)
 * @access  Internal (No auth - secured by webhook signature)
 * @body    {
 *   transaction_id: string,
 *   event_type: string,
 *   user_id: string,
 *   vendor_id: string,
 *   amount?: number,
 *   listing_title?: string
 * }
 */
router.post('/webhooks/transaction', notificationController.handleTransactionNotification);

/**
 * @route   POST /api/v1/notifications/webhooks/chat
 * @desc    Handle chat message notifications (Internal webhook)
 * @access  Internal (No auth - secured by webhook signature)
 * @body    {
 *   chat_id: string,
 *   sender_id: string,
 *   recipient_id: string,
 *   message_preview: string,
 *   message_type?: string
 * }
 */
router.post('/webhooks/chat', notificationController.handleChatNotification);

/**
 * @route   POST /api/v1/notifications/webhooks/listing
 * @desc    Handle listing-related notifications (Internal webhook)
 * @access  Internal (No auth - secured by webhook signature)
 * @body    {
 *   listing_id: string,
 *   vendor_id: string,
 *   event_type: string,
 *   listing_title: string,
 *   admin_message?: string
 * }
 */
router.post('/webhooks/listing', notificationController.handleListingNotification);

// ================================
// HEALTH & MONITORING
// ================================

/**
 * @route   GET /api/v1/notifications/health
 * @desc    Check notification service health
 * @access  Public
 */
router.get('/health', notificationController.healthCheck);

// ================================
// VALIDATION MIDDLEWARE
// ================================

/**
 * Validation for device registration
 */
const validateDeviceRegistration = (req, res, next) => {
  const { device_token, device_type } = req.body;

  if (!device_token || typeof device_token !== 'string' || device_token.length < 10) {
    return res.status(400).json({
      success: false,
      error: 'Valid device token is required'
    });
  }

  if (!device_type || !['ios', 'android', 'web'].includes(device_type)) {
    return res.status(400).json({
      success: false,
      error: 'Device type must be ios, android, or web'
    });
  }

  next();
};

/**
 * Validation for bulk notifications
 */
const validateBulkNotification = (req, res, next) => {
  const { recipients, title, message } = req.body;

  if (!title || title.trim().length < 1 || title.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'Title must be between 1 and 100 characters'
    });
  }

  if (!message || message.trim().length < 1 || message.length > 500) {
    return res.status(400).json({
      success: false,
      error: 'Message must be between 1 and 500 characters'
    });
  }

  if (!recipients || (recipients !== 'all' && (!Array.isArray(recipients) || recipients.length === 0))) {
    return res.status(400).json({
      success: false,
      error: 'Recipients must be "all" or an array of user IDs'
    });
  }

  // Limit bulk notifications to 10,000 recipients at once
  if (Array.isArray(recipients) && recipients.length > 10000) {
    return res.status(400).json({
      success: false,
      error: 'Maximum 10,000 recipients allowed per bulk notification'
    });
  }

  next();
};

// Apply validation middleware
router.use('/devices/register', validateDeviceRegistration);
router.use('/admin/bulk', validateBulkNotification);

// ================================
// RATE LIMITING MIDDLEWARE
// ================================

/**
 * Rate limiting for notification creation
 */
const rateLimit = require('express-rate-limit');

const notificationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each user to 100 notifications per windowMs
  keyGenerator: (req) => req.user?.id || req.ip,
  message: {
    success: false,
    error: 'Too many notification requests',
    message: 'Please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const bulkNotificationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit bulk notifications to 10 per hour
  keyGenerator: (req) => req.user?.id || req.ip,
  message: {
    success: false,
    error: 'Bulk notification limit exceeded',
    message: 'Maximum 10 bulk notifications per hour'
  }
});

// Apply rate limiting
router.use('/admin/create', notificationRateLimit);
router.use('/admin/bulk', bulkNotificationRateLimit);

// ================================
// ERROR HANDLING MIDDLEWARE
// ================================

/**
 * Notification-specific error handling
 */
router.use((error, req, res, next) => {
  const logger = require('../utils/logger');
  
  // Handle specific notification errors
  if (error.name === 'NotificationServiceError') {
    return res.status(503).json({
      success: false,
      error: 'Notification service temporarily unavailable',
      message: 'Please try again later'
    });
  }

  if (error.name === 'InvalidDeviceTokenError') {
    return res.status(400).json({
      success: false,
      error: 'Invalid device token',
      message: 'Please register your device again'
    });
  }

  if (error.name === 'TemplateNotFoundError') {
    return res.status(404).json({
      success: false,
      error: 'Notification template not found',
      message: 'The requested template does not exist'
    });
  }

  logger.error('Notification route error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  });
});

module.exports = router;