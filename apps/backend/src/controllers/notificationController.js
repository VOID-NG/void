// apps/backend/src/controllers/notificationController.js
// Complete notification management: in-app, email, push, SMS notifications

const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');
const { emitToUser } = require('../utils/socketUtils');

// ================================
// USER NOTIFICATION ENDPOINTS
// ================================

/**
 * Get user notifications with pagination
 */
const getUserNotifications = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      type,
      status = 'all', // all, read, unread
      category
    } = req.query;

    const notifications = await notificationService.getUserNotifications({
      user_id: req.user.id,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
      filters: {
        type,
        status: status === 'all' ? undefined : status,
        category
      }
    });

    res.json({
      success: true,
      data: notifications.data,
      pagination: notifications.pagination,
      unread_count: notifications.unread_count
    });

  } catch (error) {
    logger.error('Get user notifications failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get notifications',
      message: error.message
    });
  }
};

/**
 * Get unread notification count
 */
const getUnreadCount = async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.user.id);

    res.json({
      success: true,
      data: { unread_count: count }
    });

  } catch (error) {
    logger.error('Get unread count failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get unread count',
      message: error.message
    });
  }
};

/**
 * Mark notification as read
 */
const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    await notificationService.markAsRead({
      notification_id: notificationId,
      user_id: req.user.id
    });

    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    logger.error('Mark notification as read failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notification as read',
      message: error.message
    });
  }
};

/**
 * Mark all notifications as read
 */
const markAllAsRead = async (req, res) => {
  try {
    const { category, type } = req.body;

    const result = await notificationService.markAllAsRead({
      user_id: req.user.id,
      category,
      type
    });

    res.json({
      success: true,
      data: { updated_count: result.updated_count },
      message: 'Notifications marked as read'
    });

  } catch (error) {
    logger.error('Mark all notifications as read failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notifications as read',
      message: error.message
    });
  }
};

/**
 * Delete notification
 */
const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;

    await notificationService.deleteNotification({
      notification_id: notificationId,
      user_id: req.user.id
    });

    res.json({
      success: true,
      message: 'Notification deleted'
    });

  } catch (error) {
    logger.error('Delete notification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete notification',
      message: error.message
    });
  }
};

/**
 * Delete all notifications
 */
const deleteAllNotifications = async (req, res) => {
  try {
    const { category, type, older_than_days } = req.body;

    const result = await notificationService.deleteAllNotifications({
      user_id: req.user.id,
      category,
      type,
      older_than_days: older_than_days ? parseInt(older_than_days) : undefined
    });

    res.json({
      success: true,
      data: { deleted_count: result.deleted_count },
      message: 'Notifications deleted'
    });

  } catch (error) {
    logger.error('Delete all notifications failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete notifications',
      message: error.message
    });
  }
};

// ================================
// NOTIFICATION PREFERENCES
// ================================

/**
 * Get user notification preferences
 */
const getNotificationPreferences = async (req, res) => {
  try {
    const preferences = await notificationService.getUserPreferences(req.user.id);

    res.json({
      success: true,
      data: preferences
    });

  } catch (error) {
    logger.error('Get notification preferences failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get preferences',
      message: error.message
    });
  }
};

/**
 * Update notification preferences
 */
const updateNotificationPreferences = async (req, res) => {
  try {
    const {
      email_notifications = {},
      push_notifications = {},
      sms_notifications = {},
      in_app_notifications = {},
      quiet_hours = {},
      frequency_settings = {}
    } = req.body;

    const preferences = await notificationService.updateUserPreferences({
      user_id: req.user.id,
      preferences: {
        email_notifications,
        push_notifications,
        sms_notifications,
        in_app_notifications,
        quiet_hours,
        frequency_settings
      }
    });

    res.json({
      success: true,
      data: preferences,
      message: 'Notification preferences updated'
    });

  } catch (error) {
    logger.error('Update notification preferences failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update preferences',
      message: error.message
    });
  }
};

// ================================
// PUSH NOTIFICATION MANAGEMENT
// ================================

/**
 * Register device for push notifications
 */
const registerDevice = async (req, res) => {
  try {
    const {
      device_token,
      device_type, // ios, android, web
      device_name,
      app_version
    } = req.body;

    if (!device_token || !device_type) {
      return res.status(400).json({
        success: false,
        error: 'Device token and type are required'
      });
    }

    const device = await notificationService.registerDevice({
      user_id: req.user.id,
      device_token,
      device_type,
      device_name,
      app_version
    });

    res.json({
      success: true,
      data: { device },
      message: 'Device registered for push notifications'
    });

  } catch (error) {
    logger.error('Register device failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register device',
      message: error.message
    });
  }
};

/**
 * Unregister device from push notifications
 */
const unregisterDevice = async (req, res) => {
  try {
    const { device_token } = req.body;

    if (!device_token) {
      return res.status(400).json({
        success: false,
        error: 'Device token is required'
      });
    }

    await notificationService.unregisterDevice({
      user_id: req.user.id,
      device_token
    });

    res.json({
      success: true,
      message: 'Device unregistered from push notifications'
    });

  } catch (error) {
    logger.error('Unregister device failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unregister device',
      message: error.message
    });
  }
};

/**
 * Send test push notification
 */
const sendTestPushNotification = async (req, res) => {
  try {
    const { message = 'Test notification from Void Marketplace' } = req.body;

    const result = await notificationService.sendTestPushNotification({
      user_id: req.user.id,
      message
    });

    res.json({
      success: true,
      data: result,
      message: 'Test notification sent'
    });

  } catch (error) {
    logger.error('Send test push notification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send test notification',
      message: error.message
    });
  }
};

// ================================
// NOTIFICATION CREATION (Internal/Admin)
// ================================

/**
 * Create custom notification (Admin only)
 */
const createNotification = async (req, res) => {
  try {
    if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    const {
      recipient_id,
      recipient_type = 'user', // user, vendor, admin, all
      title,
      message,
      type = 'general',
      category = 'announcement',
      data = {},
      channels = ['in_app'], // in_app, email, push, sms
      priority = 'normal', // low, normal, high, urgent
      scheduled_for
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        error: 'Title and message are required'
      });
    }

    const notification = await notificationService.createNotification({
      sender_id: req.user.id,
      recipient_id,
      recipient_type,
      title,
      message,
      type,
      category,
      data,
      channels,
      priority,
      scheduled_for: scheduled_for ? new Date(scheduled_for) : undefined
    });

    res.status(201).json({
      success: true,
      data: { notification },
      message: 'Notification created successfully'
    });

  } catch (error) {
    logger.error('Create notification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create notification',
      message: error.message
    });
  }
};

/**
 * Send bulk notifications (Admin only)
 */
const sendBulkNotifications = async (req, res) => {
  try {
    if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    const {
      recipients, // Array of user IDs or 'all'
      title,
      message,
      type = 'announcement',
      category = 'general',
      data = {},
      channels = ['in_app'],
      priority = 'normal',
      scheduled_for
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        error: 'Title and message are required'
      });
    }

    const result = await notificationService.sendBulkNotifications({
      sender_id: req.user.id,
      recipients,
      title,
      message,
      type,
      category,
      data,
      channels,
      priority,
      scheduled_for: scheduled_for ? new Date(scheduled_for) : undefined
    });

    res.json({
      success: true,
      data: result,
      message: 'Bulk notifications queued successfully'
    });

  } catch (error) {
    logger.error('Send bulk notifications failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send bulk notifications',
      message: error.message
    });
  }
};

// ================================
// NOTIFICATION ANALYTICS (Admin)
// ================================

/**
 * Get notification analytics (Admin only)
 */
const getNotificationAnalytics = async (req, res) => {
  try {
    if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    const {
      start_date,
      end_date,
      type,
      category,
      channel
    } = req.query;

    const analytics = await notificationService.getNotificationAnalytics({
      start_date: start_date ? new Date(start_date) : undefined,
      end_date: end_date ? new Date(end_date) : undefined,
      type,
      category,
      channel
    });

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    logger.error('Get notification analytics failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get analytics',
      message: error.message
    });
  }
};

/**
 * Get notification delivery stats (Admin only)
 */
const getDeliveryStats = async (req, res) => {
  try {
    if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    const {
      period = '7d', // 1d, 7d, 30d
      channel,
      group_by = 'day' // hour, day, week
    } = req.query;

    const stats = await notificationService.getDeliveryStats({
      period,
      channel,
      group_by
    });

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Get delivery stats failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get delivery stats',
      message: error.message
    });
  }
};

// ================================
// AUTOMATED NOTIFICATION TRIGGERS
// ================================

/**
 * Handle transaction notifications (Internal)
 */
const handleTransactionNotification = async (req, res) => {
  try {
    const {
      transaction_id,
      event_type, // created, paid, shipped, delivered, disputed, etc.
      user_id,
      vendor_id,
      amount,
      listing_title
    } = req.body;

    await notificationService.handleTransactionNotification({
      transaction_id,
      event_type,
      user_id,
      vendor_id,
      amount,
      listing_title
    });

    // Emit real-time notification
    const io = req.app.get('io');
    if (io) {
      if (user_id) {
        emitToUser(io, user_id, 'transaction_notification', {
          event_type,
          transaction_id,
          title: `Transaction ${event_type.replace('_', ' ')}`
        });
      }
      
      if (vendor_id && vendor_id !== user_id) {
        emitToUser(io, vendor_id, 'transaction_notification', {
          event_type,
          transaction_id,
          title: `Transaction ${event_type.replace('_', ' ')}`
        });
      }
    }

    res.json({
      success: true,
      message: 'Transaction notification handled'
    });

  } catch (error) {
    logger.error('Handle transaction notification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to handle transaction notification',
      message: error.message
    });
  }
};

/**
 * Handle chat message notifications (Internal)
 */
const handleChatNotification = async (req, res) => {
  try {
    const {
      chat_id,
      sender_id,
      recipient_id,
      message_preview,
      message_type = 'text'
    } = req.body;

    await notificationService.handleChatNotification({
      chat_id,
      sender_id,
      recipient_id,
      message_preview,
      message_type
    });

    // Emit real-time notification
    const io = req.app.get('io');
    if (io) {
      emitToUser(io, recipient_id, 'new_message', {
        chat_id,
        sender_id,
        message_preview,
        message_type
      });
    }

    res.json({
      success: true,
      message: 'Chat notification handled'
    });

  } catch (error) {
    logger.error('Handle chat notification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to handle chat notification',
      message: error.message
    });
  }
};

/**
 * Handle listing notifications (Internal)
 */
const handleListingNotification = async (req, res) => {
  try {
    const {
      listing_id,
      vendor_id,
      event_type, // approved, rejected, featured, sold, etc.
      listing_title,
      admin_message
    } = req.body;

    await notificationService.handleListingNotification({
      listing_id,
      vendor_id,
      event_type,
      listing_title,
      admin_message
    });

    // Emit real-time notification
    const io = req.app.get('io');
    if (io && vendor_id) {
      emitToUser(io, vendor_id, 'listing_notification', {
        event_type,
        listing_id,
        listing_title
      });
    }

    res.json({
      success: true,
      message: 'Listing notification handled'
    });

  } catch (error) {
    logger.error('Handle listing notification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to handle listing notification',
      message: error.message
    });
  }
};

// ================================
// NOTIFICATION TEMPLATES (Admin)
// ================================

/**
 * Get notification templates (Admin only)
 */
const getNotificationTemplates = async (req, res) => {
  try {
    if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    const { category, type, active_only = true } = req.query;

    const templates = await notificationService.getNotificationTemplates({
      category,
      type,
      active_only: active_only === 'true'
    });

    res.json({
      success: true,
      data: templates
    });

  } catch (error) {
    logger.error('Get notification templates failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get templates',
      message: error.message
    });
  }
};

/**
 * Create notification template (Admin only)
 */
const createNotificationTemplate = async (req, res) => {
  try {
    if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    const {
      name,
      type,
      category,
      title_template,
      message_template,
      variables = [],
      channels = ['in_app'],
      is_active = true
    } = req.body;

    if (!name || !title_template || !message_template) {
      return res.status(400).json({
        success: false,
        error: 'Name, title template, and message template are required'
      });
    }

    const template = await notificationService.createNotificationTemplate({
      name,
      type,
      category,
      title_template,
      message_template,
      variables,
      channels,
      is_active,
      created_by: req.user.id
    });

    res.status(201).json({
      success: true,
      data: { template },
      message: 'Notification template created'
    });

  } catch (error) {
    logger.error('Create notification template failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create template',
      message: error.message
    });
  }
};

/**
 * Update notification template (Admin only)
 */
const updateNotificationTemplate = async (req, res) => {
  try {
    if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    const { templateId } = req.params;
    const updateData = req.body;

    const template = await notificationService.updateNotificationTemplate({
      template_id: templateId,
      updates: updateData,
      updated_by: req.user.id
    });

    res.json({
      success: true,
      data: { template },
      message: 'Notification template updated'
    });

  } catch (error) {
    logger.error('Update notification template failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update template',
      message: error.message
    });
  }
};

// ================================
// EMAIL SUBSCRIPTION MANAGEMENT
// ================================

/**
 * Subscribe to email notifications
 */
const subscribeToEmail = async (req, res) => {
  try {
    const {
      email,
      subscription_types = ['announcements', 'promotions'],
      frequency = 'immediate'
    } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required'
      });
    }

    const subscription = await notificationService.subscribeToEmail({
      user_id: req.user?.id,
      email,
      subscription_types,
      frequency
    });

    res.json({
      success: true,
      data: { subscription },
      message: 'Email subscription created'
    });

  } catch (error) {
    logger.error('Subscribe to email failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to subscribe to email',
      message: error.message
    });
  }
};

/**
 * Unsubscribe from email notifications
 */
const unsubscribeFromEmail = async (req, res) => {
  try {
    const { token, email, subscription_type } = req.query;

    if (!token && !email) {
      return res.status(400).json({
        success: false,
        error: 'Unsubscribe token or email is required'
      });
    }

    await notificationService.unsubscribeFromEmail({
      token,
      email,
      subscription_type,
      user_id: req.user?.id
    });

    res.json({
      success: true,
      message: 'Successfully unsubscribed from email notifications'
    });

  } catch (error) {
    logger.error('Unsubscribe from email failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unsubscribe',
      message: error.message
    });
  }
};

// ================================
// NOTIFICATION HEALTH & MONITORING
// ================================

/**
 * Check notification service health
 */
const healthCheck = async (req, res) => {
  try {
    const health = await notificationService.healthCheck();

    res.json({
      success: true,
      data: health
    });

  } catch (error) {
    logger.error('Notification health check failed:', error);
    res.status(503).json({
      success: false,
      error: 'Notification service unhealthy',
      message: error.message
    });
  }
};

/**
 * Get notification queue status (Admin only)
 */
const getQueueStatus = async (req, res) => {
  try {
    if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    const status = await notificationService.getQueueStatus();

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('Get queue status failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get queue status',
      message: error.message
    });
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // User notifications
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,

  // Preferences
  getNotificationPreferences,
  updateNotificationPreferences,

  // Push notifications
  registerDevice,
  unregisterDevice,
  sendTestPushNotification,

  // Admin notification creation
  createNotification,
  sendBulkNotifications,

  // Analytics
  getNotificationAnalytics,
  getDeliveryStats,

  // Automated triggers
  handleTransactionNotification,
  handleChatNotification,
  handleListingNotification,

  // Templates
  getNotificationTemplates,
  createNotificationTemplate,
  updateNotificationTemplate,

  // Email subscriptions
  subscribeToEmail,
  unsubscribeFromEmail,

  // Health & monitoring
  healthCheck,
  getQueueStatus
};