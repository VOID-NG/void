// apps/backend/src/services/notificationService.js
// Comprehensive notification system for Void Marketplace

const { prisma } = require('../config/db');
const logger = require('../utils/logger');
const { NOTIFICATION_TYPE, NOTIFICATION_TEMPLATES } = require('../config/constants');
const nodemailer = require('nodemailer');

// ================================
// EMAIL CONFIGURATION
// ================================

let emailTransporter = null;

const initializeEmailTransporter = () => {
  if (!emailTransporter) {
    emailTransporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return emailTransporter;
};

// ================================
// CORE NOTIFICATION FUNCTIONS
// ================================

/**
 * Create a new notification
 * @param {Object} notificationData - Notification details
 * @returns {Object} Created notification
 */
const createNotification = async (notificationData) => {
  try {
    const {
      user_id,
      type,
      title,
      message,
      metadata = {},
      send_email = false,
      send_push = false
    } = notificationData;

    // Validate required fields
    if (!user_id || !type || !title || !message) {
      throw new Error('Missing required notification fields');
    }

    // Create notification in database
    const notification = await prisma.notification.create({
      data: {
        user_id,
        type,
        title,
        message,
        metadata: JSON.stringify(metadata),
        is_read: false
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
            notification_preferences: true
          }
        }
      }
    });

    logger.info('Notification created', {
      notificationId: notification.id,
      userId: user_id,
      type
    });

    // Send email if requested and user allows it
    if (send_email) {
      await sendEmailNotification(notification);
    }

    // Send push notification if requested and user allows it
    if (send_push) {
      await sendPushNotification(notification);
    }

    return notification;

  } catch (error) {
    logger.error('Create notification failed:', error);
    throw error;
  }
};

/**
 * Send bulk notifications to multiple users
 * @param {Array} userIds - Array of user IDs
 * @param {Object} notificationData - Notification details
 * @returns {Array} Created notifications
 */
const createBulkNotifications = async (userIds, notificationData) => {
  try {
    const notifications = [];

    for (const userId of userIds) {
      const notification = await createNotification({
        ...notificationData,
        user_id: userId
      });
      notifications.push(notification);
    }

    logger.info('Bulk notifications created', {
      count: notifications.length,
      type: notificationData.type
    });

    return notifications;

  } catch (error) {
    logger.error('Bulk notification creation failed:', error);
    throw error;
  }
};

/**
 * Get user notifications with pagination
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Object} Notifications and metadata
 */
const getUserNotifications = async (userId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 20,
      unread_only = false,
      type_filter = null
    } = options;

    const offset = (page - 1) * limit;
    
    const whereClause = { user_id: userId };
    
    if (unread_only) {
      whereClause.is_read = false;
    }
    
    if (type_filter) {
      whereClause.type = type_filter;
    }

    const [notifications, totalCount, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: whereClause,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.notification.count({ where: whereClause }),
      prisma.notification.count({
        where: { user_id: userId, is_read: false }
      })
    ]);

    return {
      notifications: notifications.map(notification => ({
        ...notification,
        metadata: notification.metadata ? JSON.parse(notification.metadata) : {}
      })),
      pagination: {
        current_page: page,
        total_pages: Math.ceil(totalCount / limit),
        total_count: totalCount,
        per_page: limit
      },
      unread_count: unreadCount
    };

  } catch (error) {
    logger.error('Get user notifications failed:', error);
    throw error;
  }
};

/**
 * Mark notification as read
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID
 * @returns {Object} Updated notification
 */
const markAsRead = async (notificationId, userId) => {
  try {
    const notification = await prisma.notification.update({
      where: {
        id: notificationId,
        user_id: userId
      },
      data: {
        is_read: true,
        read_at: new Date()
      }
    });

    logger.info('Notification marked as read', {
      notificationId,
      userId
    });

    return notification;

  } catch (error) {
    logger.error('Mark notification as read failed:', error);
    throw error;
  }
};

/**
 * Mark all notifications as read for a user
 * @param {string} userId - User ID
 * @returns {Object} Update result
 */
const markAllAsRead = async (userId) => {
  try {
    const result = await prisma.notification.updateMany({
      where: {
        user_id: userId,
        is_read: false
      },
      data: {
        is_read: true,
        read_at: new Date()
      }
    });

    logger.info('All notifications marked as read', {
      userId,
      count: result.count
    });

    return result;

  } catch (error) {
    logger.error('Mark all notifications as read failed:', error);
    throw error;
  }
};

/**
 * Delete notification
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID
 * @returns {Object} Deletion result
 */
const deleteNotification = async (notificationId, userId) => {
  try {
    await prisma.notification.delete({
      where: {
        id: notificationId,
        user_id: userId
      }
    });

    logger.info('Notification deleted', {
      notificationId,
      userId
    });

    return { success: true };

  } catch (error) {
    logger.error('Delete notification failed:', error);
    throw error;
  }
};

// ================================
// SPECIFIC NOTIFICATION TYPES
// ================================

/**
 * Send chat message notification
 * @param {Object} params - Message details
 */
const sendChatMessageNotification = async ({ recipientId, senderId, message, chatId }) => {
  try {
    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { first_name: true, last_name: true }
    });

    const senderName = `${sender.first_name} ${sender.last_name}`;
    
    await createNotification({
      user_id: recipientId,
      type: NOTIFICATION_TYPE.CHAT_MESSAGE,
      title: 'New Message',
      message: `You have a new message from ${senderName}`,
      metadata: {
        sender_id: senderId,
        sender_name: senderName,
        chat_id: chatId,
        message_preview: message.length > 50 ? message.substring(0, 50) + '...' : message
      },
      send_push: true
    });

  } catch (error) {
    logger.error('Send chat message notification failed:', error);
  }
};

/**
 * Send offer received notification
 * @param {Object} params - Offer details
 */
const sendOfferReceivedNotification = async ({ vendorId, buyerId, listingId, amount }) => {
  try {
    const [buyer, listing] = await Promise.all([
      prisma.user.findUnique({
        where: { id: buyerId },
        select: { first_name: true, last_name: true }
      }),
      prisma.listing.findUnique({
        where: { id: listingId },
        select: { title: true }
      })
    ]);

    const buyerName = `${buyer.first_name} ${buyer.last_name}`;
    
    await createNotification({
      user_id: vendorId,
      type: NOTIFICATION_TYPE.OFFER_RECEIVED,
      title: 'New Offer Received',
      message: `${buyerName} made an offer of ${amount} for your ${listing.title}`,
      metadata: {
        buyer_id: buyerId,
        buyer_name: buyerName,
        listing_id: listingId,
        listing_title: listing.title,
        offer_amount: amount
      },
      send_email: true,
      send_push: true
    });

  } catch (error) {
    logger.error('Send offer received notification failed:', error);
  }
};

/**
 * Send offer status notification
 * @param {Object} params - Offer status details
 */
const sendOfferStatusNotification = async ({ buyerId, vendorId, listingId, amount, status }) => {
  try {
    const [vendor, listing] = await Promise.all([
      prisma.user.findUnique({
        where: { id: vendorId },
        select: { first_name: true, last_name: true }
      }),
      prisma.listing.findUnique({
        where: { id: listingId },
        select: { title: true }
      })
    ]);

    const vendorName = `${vendor.first_name} ${vendor.last_name}`;
    const statusText = status === 'ACCEPTED' ? 'accepted' : 'declined';
    
    await createNotification({
      user_id: buyerId,
      type: status === 'ACCEPTED' ? NOTIFICATION_TYPE.OFFER_ACCEPTED : NOTIFICATION_TYPE.OFFER_REJECTED,
      title: `Offer ${statusText.charAt(0).toUpperCase() + statusText.slice(1)}`,
      message: `Your offer of ${amount} for ${listing.title} has been ${statusText}`,
      metadata: {
        vendor_id: vendorId,
        vendor_name: vendorName,
        listing_id: listingId,
        listing_title: listing.title,
        offer_amount: amount,
        offer_status: status
      },
      send_email: true,
      send_push: true
    });

  } catch (error) {
    logger.error('Send offer status notification failed:', error);
  }
};

/**
 * Send payment notification
 * @param {Object} params - Payment details
 */
const sendPaymentNotification = async ({ vendorId, buyerId, transactionId, amount, listingTitle }) => {
  try {
    await createNotification({
      user_id: vendorId,
      type: NOTIFICATION_TYPE.PAYMENT_RECEIVED,
      title: 'Payment Received',
      message: `You received ${amount} for ${listingTitle}`,
      metadata: {
        buyer_id: buyerId,
        transaction_id: transactionId,
        amount: amount,
        listing_title: listingTitle
      },
      send_email: true,
      send_push: true
    });

  } catch (error) {
    logger.error('Send payment notification failed:', error);
  }
};

/**
 * Send product sold notification
 * @param {Object} params - Sale details
 */
const sendProductSoldNotification = async ({ vendorId, buyerId, listingId, amount }) => {
  try {
    const [buyer, listing] = await Promise.all([
      prisma.user.findUnique({
        where: { id: buyerId },
        select: { first_name: true, last_name: true }
      }),
      prisma.listing.findUnique({
        where: { id: listingId },
        select: { title: true }
      })
    ]);

    const buyerName = `${buyer.first_name} ${buyer.last_name}`;
    
    await createNotification({
      user_id: vendorId,
      type: NOTIFICATION_TYPE.PRODUCT_SOLD,
      title: 'Product Sold',
      message: `Your listing "${listing.title}" has been sold to ${buyerName} for ${amount}`,
      metadata: {
        buyer_id: buyerId,
        buyer_name: buyerName,
        listing_id: listingId,
        listing_title: listing.title,
        sale_amount: amount
      },
      send_email: true,
      send_push: true
    });

  } catch (error) {
    logger.error('Send product sold notification failed:', error);
  }
};

/**
 * Send admin notification
 * @param {Object} params - Admin notification details
 */
const sendAdminNotification = async ({ userId, title, message, metadata = {} }) => {
  try {
    await createNotification({
      user_id: userId,
      type: NOTIFICATION_TYPE.ADMIN_ALERT,
      title,
      message,
      metadata,
      send_email: true
    });

  } catch (error) {
    logger.error('Send admin notification failed:', error);
  }
};

/**
 * Send system maintenance notification
 * @param {Object} params - Maintenance details
 */
const sendMaintenanceNotification = async ({ title, message, startTime, endTime }) => {
  try {
    // Get all active users
    const users = await prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true }
    });

    const userIds = users.map(user => user.id);

    await createBulkNotifications(userIds, {
      type: NOTIFICATION_TYPE.SYSTEM_UPDATE,
      title,
      message,
      metadata: {
        maintenance_start: startTime,
        maintenance_end: endTime
      },
      send_email: true
    });

  } catch (error) {
    logger.error('Send maintenance notification failed:', error);
  }
};

// ================================
// EMAIL NOTIFICATIONS
// ================================

/**
 * Send email notification
 * @param {Object} notification - Notification object
 */
const sendEmailNotification = async (notification) => {
  try {
    const transporter = initializeEmailTransporter();
    
    if (!transporter || !process.env.SMTP_USER) {
      logger.warn('Email transporter not configured, skipping email notification');
      return;
    }

    // Check user's email preferences
    const userPrefs = notification.user.notification_preferences 
      ? JSON.parse(notification.user.notification_preferences) 
      : {};
    
    if (userPrefs.email === false) {
      logger.info('User has disabled email notifications', { userId: notification.user_id });
      return;
    }

    const emailTemplate = getEmailTemplate(notification);
    
    const mailOptions = {
      from: `"Void Marketplace" <${process.env.SMTP_USER}>`,
      to: notification.user.email,
      subject: notification.title,
      html: emailTemplate
    };

    await transporter.sendMail(mailOptions);

    logger.info('Email notification sent', {
      notificationId: notification.id,
      email: notification.user.email,
      type: notification.type
    });

  } catch (error) {
    logger.error('Send email notification failed:', error);
  }
};

/**
 * Generate email template
 * @param {Object} notification - Notification object
 * @returns {string} HTML email template
 */
const getEmailTemplate = (notification) => {
  const metadata = notification.metadata ? JSON.parse(notification.metadata) : {};
  const userName = `${notification.user.first_name} ${notification.user.last_name}`;

  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${notification.title}</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; }
            .footer { background: #333; color: white; padding: 20px; text-align: center; font-size: 12px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
            .notification-content { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Void Marketplace</h1>
                <h2>${notification.title}</h2>
            </div>
            <div class="content">
                <div class="notification-content">
                    <p>Hello ${userName},</p>
                    <p>${notification.message}</p>
                    ${metadata.listing_id ? `
                        <p><a href="${process.env.FRONTEND_URL}/listings/${metadata.listing_id}" class="button">View Listing</a></p>
                    ` : ''}
                    ${metadata.chat_id ? `
                        <p><a href="${process.env.FRONTEND_URL}/messages/${metadata.chat_id}" class="button">View Message</a></p>
                    ` : ''}
                </div>
                <p>This notification was sent because you have an active account on Void Marketplace. You can manage your notification preferences in your account settings.</p>
            </div>
            <div class="footer">
                <p>&copy; 2024 Void Marketplace. All rights reserved.</p>
                <p><a href="${process.env.FRONTEND_URL}/settings/notifications" style="color: #ccc;">Notification Preferences</a> | <a href="${process.env.FRONTEND_URL}/support" style="color: #ccc;">Support</a></p>
            </div>
        </div>
    </body>
    </html>
  `;
};

// ================================
// PUSH NOTIFICATIONS
// ================================

/**
 * Send push notification
 * @param {Object} notification - Notification object
 */
const sendPushNotification = async (notification) => {
  try {
    // Check user's push notification preferences
    const userPrefs = notification.user.notification_preferences 
      ? JSON.parse(notification.user.notification_preferences) 
      : {};
    
    if (userPrefs.push === false) {
      logger.info('User has disabled push notifications', { userId: notification.user_id });
      return;
    }

    // Get user's push tokens (if implemented)
    const pushTokens = await prisma.pushToken.findMany({
      where: { user_id: notification.user_id }
    }).catch(() => []); // Ignore if table doesn't exist

    if (pushTokens.length === 0) {
      logger.info('No push tokens found for user', { userId: notification.user_id });
      return;
    }

    // TODO: Implement actual push notification sending
    // This would integrate with Firebase FCM, Apple Push Notifications, etc.
    logger.info('Push notification would be sent', {
      notificationId: notification.id,
      userId: notification.user_id,
      tokenCount: pushTokens.length
    });

  } catch (error) {
    logger.error('Send push notification failed:', error);
  }
};

// ================================
// NOTIFICATION CLEANUP
// ================================

/**
 * Clean up old notifications
 * @param {number} daysOld - Delete notifications older than this many days
 * @returns {Object} Cleanup result
 */
const cleanupOldNotifications = async (daysOld = 30) => {
  try {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const result = await prisma.notification.deleteMany({
      where: {
        created_at: { lt: cutoffDate },
        is_read: true
      }
    });

    logger.info('Old notifications cleaned up', {
      deletedCount: result.count,
      cutoffDate
    });

    return result;

  } catch (error) {
    logger.error('Notification cleanup failed:', error);
    throw error;
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Core functions
  createNotification,
  createBulkNotifications,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,

  // Specific notification types
  sendChatMessageNotification,
  sendOfferReceivedNotification,
  sendOfferStatusNotification,
  sendPaymentNotification,
  sendProductSoldNotification,
  sendAdminNotification,
  sendMaintenanceNotification,

  // Utility functions
  sendEmailNotification,
  sendPushNotification,
  cleanupOldNotifications
};