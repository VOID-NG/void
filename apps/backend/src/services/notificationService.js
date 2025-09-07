// apps/backend/src/services/notificationService.js
// Complete notification service for VOID Marketplace

const { prisma } = require('../config/db-original');
const { NOTIFICATION_TYPE } = require('../config/constants');
const logger = require('../utils/logger');
const nodemailer = require('nodemailer');

// ================================
// EMAIL CONFIGURATION
// ================================

// Email transporter setup
let emailTransporter = null;

const initializeEmailTransporter = () => {
  try {
    if (process.env.EMAIL_SERVICE && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      emailTransporter = nodemailer.createTransporter({
        service: process.env.EMAIL_SERVICE, // Gmail, Outlook, etc.
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });
      logger.info('Email transporter initialized');
    } else {
      logger.warn('Email configuration not found, email notifications disabled');
    }
  } catch (error) {
    logger.error('Failed to initialize email transporter:', error);
  }
};

// Initialize email on service load
initializeEmailTransporter();

// ================================
// CUSTOM ERROR CLASSES
// ================================

class NotificationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'NotificationError';
    this.statusCode = statusCode;
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

// ================================
// CORE NOTIFICATION FUNCTIONS
// ================================

/**
 * Create a new notification
 * @param {Object} notificationData - Notification data
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
      send_push = false,
      send_sms = false,
      priority = 'normal'
    } = notificationData;

    // Validate required fields
    if (!user_id || !type || !title || !message) {
      throw new NotificationError('Missing required fields: user_id, type, title, message');
    }

    // Validate notification type
    if (!Object.values(NOTIFICATION_TYPE).includes(type)) {
      throw new NotificationError('Invalid notification type');
    }

    // Get user preferences
    const user = await prisma.user.findUnique({
      where: { id: user_id },
      select: {
        email: true,
        phone: true,
        notification_preferences: true
      }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Check user preferences (if they exist)
    const preferences = user.notification_preferences || {};
    const shouldSendEmail = send_email && (preferences.email !== false);
    const shouldSendPush = send_push && (preferences.push !== false);
    const shouldSendSms = send_sms && (preferences.sms !== false);

    // Create notification record
    const notification = await prisma.notification.create({
      data: {
        user_id,
        type,
        title,
        message,
        metadata: JSON.stringify(metadata),
        priority,
        created_at: new Date()
      }
    });

    // Send notifications through various channels
    const deliveryResults = {};

    // Send email notification
    if (shouldSendEmail && user.email) {
      try {
        deliveryResults.email = await sendEmailNotification({
          email: user.email,
          title,
          message,
          type,
          metadata
        });
      } catch (error) {
        logger.error('Email notification failed:', error);
        deliveryResults.email = { success: false, error: error.message };
      }
    }

    // Send push notification
    if (shouldSendPush) {
      try {
        deliveryResults.push = await sendPushNotification({
          user_id,
          title,
          message,
          type,
          metadata
        });
      } catch (error) {
        logger.error('Push notification failed:', error);
        deliveryResults.push = { success: false, error: error.message };
      }
    }

    // Send SMS notification
    if (shouldSendSms && user.phone) {
      try {
        deliveryResults.sms = await sendSmsNotification({
          phone: user.phone,
          message: `${title}: ${message}`,
          type
        });
      } catch (error) {
        logger.error('SMS notification failed:', error);
        deliveryResults.sms = { success: false, error: error.message };
      }
    }

    // Update notification with delivery status
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        delivery_status: JSON.stringify(deliveryResults),
        updated_at: new Date()
      }
    });

    logger.info('Notification created and sent', {
      notificationId: notification.id,
      userId: user_id,
      type,
      channels: Object.keys(deliveryResults)
    });

    return {
      ...notification,
      delivery_results: deliveryResults
    };
  } catch (error) {
    logger.error('Create notification failed:', error);
    throw error;
  }
};

/**
 * Get user notifications with pagination
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Object} Notifications and pagination data
 */
const getUserNotifications = async (userId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 50,
      type = null,
      status = 'all', // 'all', 'read', 'unread'
      category = null
    } = options;

    const offset = (page - 1) * limit;

    // Build where clause
    const where = {
      user_id: userId
    };

    if (type) {
      where.type = type;
    }

    if (status === 'read') {
      where.is_read = true;
    } else if (status === 'unread') {
      where.is_read = false;
    }

    if (category) {
      // Category-based filtering
      const categoryTypes = getCategoryTypes(category);
      if (categoryTypes.length > 0) {
        where.type = { in: categoryTypes };
      }
    }

    // Get notifications and total count
    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          user_id: userId,
          is_read: false
        }
      })
    ]);

    return {
      data: notifications.map(notification => ({
        ...notification,
        metadata: notification.metadata ? JSON.parse(notification.metadata) : {}
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
        has_more: offset + notifications.length < total
      },
      unread_count: unreadCount
    };
  } catch (error) {
    logger.error('Get user notifications failed:', error);
    throw error;
  }
};

/**
 * Get unread notification count
 * @param {string} userId - User ID
 * @returns {number} Unread count
 */
const getUnreadCount = async (userId) => {
  try {
    const count = await prisma.notification.count({
      where: {
        user_id: userId,
        is_read: false
      }
    });

    return count;
  } catch (error) {
    logger.error('Get unread count failed:', error);
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
    const notification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        user_id: userId
      }
    });

    if (!notification) {
      throw new NotFoundError('Notification not found');
    }

    if (notification.is_read) {
      return notification; // Already read
    }

    const updatedNotification = await prisma.notification.update({
      where: { id: notificationId },
      data: {
        is_read: true,
        read_at: new Date()
      }
    });

    return updatedNotification;
  } catch (error) {
    logger.error('Mark notification as read failed:', error);
    throw error;
  }
};

/**
 * Mark all notifications as read for a user
 * @param {string} userId - User ID
 * @param {Object} filters - Optional filters
 * @returns {Object} Update result
 */
const markAllAsRead = async (userId, filters = {}) => {
  try {
    const where = {
      user_id: userId,
      is_read: false
    };

    if (filters.category) {
      const categoryTypes = getCategoryTypes(filters.category);
      if (categoryTypes.length > 0) {
        where.type = { in: categoryTypes };
      }
    }

    if (filters.type) {
      where.type = filters.type;
    }

    const result = await prisma.notification.updateMany({
      where,
      data: {
        is_read: true,
        read_at: new Date()
      }
    });

    logger.info('Marked all notifications as read', {
      userId,
      count: result.count,
      filters
    });

    return result;
  } catch (error) {
    logger.error('Mark all as read failed:', error);
    throw error;
  }
};

/**
 * Delete notification
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID
 * @returns {Object} Delete result
 */
const deleteNotification = async (notificationId, userId) => {
  try {
    const notification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        user_id: userId
      }
    });

    if (!notification) {
      throw new NotFoundError('Notification not found');
    }

    await prisma.notification.delete({
      where: { id: notificationId }
    });

    return { success: true };
  } catch (error) {
    logger.error('Delete notification failed:', error);
    throw error;
  }
};

/**
 * Delete all notifications for a user
 * @param {string} userId - User ID
 * @param {Object} filters - Optional filters
 * @returns {Object} Delete result
 */
const deleteAllNotifications = async (userId, filters = {}) => {
  try {
    const where = {
      user_id: userId
    };

    if (filters.category) {
      const categoryTypes = getCategoryTypes(filters.category);
      if (categoryTypes.length > 0) {
        where.type = { in: categoryTypes };
      }
    }

    if (filters.type) {
      where.type = filters.type;
    }

    if (filters.older_than_days) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(filters.older_than_days));
      where.created_at = { lt: cutoffDate };
    }

    const result = await prisma.notification.deleteMany({
      where
    });

    logger.info('Deleted notifications', {
      userId,
      count: result.count,
      filters
    });

    return result;
  } catch (error) {
    logger.error('Delete all notifications failed:', error);
    throw error;
  }
};

// ================================
// NOTIFICATION CHANNELS
// ================================

/**
 * Send email notification
 * @param {Object} emailData - Email data
 * @returns {Object} Send result
 */
const sendEmailNotification = async (emailData) => {
  try {
    if (!emailTransporter) {
      return { success: false, error: 'Email service not configured' };
    }

    const { email, title, message, type, metadata } = emailData;

    // Generate email template based on type
    const emailContent = generateEmailTemplate(title, message, type, metadata);

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: title,
      html: emailContent.html,
      text: emailContent.text
    };

    const result = await emailTransporter.sendMail(mailOptions);

    return {
      success: true,
      message_id: result.messageId,
      sent_at: new Date()
    };
  } catch (error) {
    logger.error('Send email notification failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Send push notification
 * @param {Object} pushData - Push notification data
 * @returns {Object} Send result
 */
const sendPushNotification = async (pushData) => {
  try {
    // TODO: Integrate with Firebase Cloud Messaging (FCM) or similar
    // For now, return placeholder
    
    const { user_id, title, message, type, metadata } = pushData;

    // In a real implementation, you would:
    // 1. Get user's device tokens from database
    // 2. Send push notification via FCM/APNS
    // 3. Handle delivery status and retries

    logger.info('Push notification sent (placeholder)', {
      user_id,
      title,
      type
    });

    return {
      success: true,
      sent_at: new Date(),
      platform: 'placeholder'
    };
  } catch (error) {
    logger.error('Send push notification failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Send SMS notification
 * @param {Object} smsData - SMS data
 * @returns {Object} Send result
 */
const sendSmsNotification = async (smsData) => {
  try {
    // TODO: Integrate with Twilio or similar SMS service
    // For now, return placeholder
    
    const { phone, message, type } = smsData;

    logger.info('SMS notification sent (placeholder)', {
      phone: phone.replace(/\d(?=\d{4})/g, '*'), // Mask phone number
      type
    });

    return {
      success: true,
      sent_at: new Date(),
      provider: 'placeholder'
    };
  } catch (error) {
    logger.error('Send SMS notification failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// ================================
// SPECIALIZED NOTIFICATION FUNCTIONS
// ================================

/**
 * Send transaction notification
 * @param {Object} transactionData - Transaction data
 */
const sendTransactionNotification = async (transactionData) => {
  try {
    const {
      buyerId,
      vendorId,
      transactionId,
      amount,
      listingTitle,
      status
    } = transactionData;

    // Notification for buyer
    await createNotification({
      user_id: buyerId,
      type: NOTIFICATION_TYPE.TRANSACTION_UPDATE,
      title: 'Transaction Update',
      message: `Your transaction for ${listingTitle} has been ${status}`,
      metadata: {
        transaction_id: transactionId,
        amount,
        status
      },
      send_email: true,
      send_push: true
    });

    // Notification for vendor
    await createNotification({
      user_id: vendorId,
      type: NOTIFICATION_TYPE.PAYMENT_RECEIVED,
      title: 'Payment Update',
      message: `Payment of $${amount} for ${listingTitle} has been ${status}`,
      metadata: {
        transaction_id: transactionId,
        amount,
        status
      },
      send_email: true,
      send_push: true
    });
  } catch (error) {
    logger.error('Send transaction notification failed:', error);
  }
};

/**
 * Send listing notification
 * @param {Object} listingData - Listing data
 */
const sendListingNotification = async (listingData) => {
  try {
    const {
      vendorId,
      listingId,
      listingTitle,
      status,
      reason = null
    } = listingData;

    const notificationType = status === 'ACTIVE' 
      ? NOTIFICATION_TYPE.LISTING_APPROVED 
      : NOTIFICATION_TYPE.LISTING_REJECTED;

    const message = status === 'ACTIVE'
      ? `Your listing "${listingTitle}" has been approved and is now live`
      : `Your listing "${listingTitle}" has been rejected${reason ? `: ${reason}` : ''}`;

    await createNotification({
      user_id: vendorId,
      type: notificationType,
      title: `Listing ${status === 'ACTIVE' ? 'Approved' : 'Rejected'}`,
      message,
      metadata: {
        listing_id: listingId,
        listing_title: listingTitle,
        status,
        reason
      },
      send_email: true,
      send_push: true
    });
  } catch (error) {
    logger.error('Send listing notification failed:', error);
  }
};

/**
 * Send vendor verification notification
 * @param {Object} vendorData - Vendor data
 */
const sendVendorVerificationNotification = async (vendorData) => {
  try {
    const {
      vendorId,
      status, // 'approved' or 'rejected'
      reason = null
    } = vendorData;

    const message = status === 'approved'
      ? 'Congratulations! Your vendor account has been verified'
      : `Your vendor verification has been rejected${reason ? `: ${reason}` : ''}`;

    await createNotification({
      user_id: vendorId,
      type: NOTIFICATION_TYPE.VENDOR_VERIFIED,
      title: `Vendor Verification ${status === 'approved' ? 'Approved' : 'Rejected'}`,
      message,
      metadata: {
        verification_status: status,
        reason
      },
      send_email: true,
      send_push: true
    });
  } catch (error) {
    logger.error('Send vendor verification notification failed:', error);
  }
};

/**
 * Handle chat notification
 * @param {Object} chatData - Chat data
 */
const handleChatNotification = async (chatData) => {
  try {
    const {
      chatId,
      senderId,
      recipientId,
      messageType,
      content,
      listingTitle
    } = chatData;

    let message = '';
    let type = NOTIFICATION_TYPE.CHAT_MESSAGE;

    switch (messageType) {
      case 'OFFER':
        message = `New offer received for ${listingTitle}`;
        type = NOTIFICATION_TYPE.OFFER_RECEIVED;
        break;
      case 'COUNTER_OFFER':
        message = `Counter offer received for ${listingTitle}`;
        type = NOTIFICATION_TYPE.OFFER_RECEIVED;
        break;
      case 'OFFER_ACCEPTED':
        message = `Your offer for ${listingTitle} was accepted`;
        type = NOTIFICATION_TYPE.OFFER_ACCEPTED;
        break;
      case 'OFFER_REJECTED':
        message = `Your offer for ${listingTitle} was declined`;
        type = NOTIFICATION_TYPE.OFFER_REJECTED;
        break;
      default:
        message = `New message about ${listingTitle}`;
    }

    await createNotification({
      user_id: recipientId,
      type,
      title: 'New Message',
      message,
      metadata: {
        chat_id: chatId,
        sender_id: senderId,
        message_type: messageType,
        listing_title: listingTitle
      },
      send_push: true
    });
  } catch (error) {
    logger.error('Handle chat notification failed:', error);
  }
};

// ================================
// UTILITY FUNCTIONS
// ================================

/**
 * Get notification types by category
 * @param {string} category - Category name
 * @returns {Array} Notification types
 */
const getCategoryTypes = (category) => {
  const categories = {
    'transactions': [
      NOTIFICATION_TYPE.PAYMENT_RECEIVED,
      NOTIFICATION_TYPE.TRANSACTION_UPDATE
    ],
    'listings': [
      NOTIFICATION_TYPE.LISTING_APPROVED,
      NOTIFICATION_TYPE.LISTING_REJECTED,
      NOTIFICATION_TYPE.PRODUCT_SOLD
    ],
    'chats': [
      NOTIFICATION_TYPE.CHAT_MESSAGE,
      NOTIFICATION_TYPE.OFFER_RECEIVED,
      NOTIFICATION_TYPE.OFFER_ACCEPTED,
      NOTIFICATION_TYPE.OFFER_REJECTED
    ],
    'system': [
      NOTIFICATION_TYPE.ADMIN_ALERT,
      NOTIFICATION_TYPE.SYSTEM_UPDATE,
      NOTIFICATION_TYPE.VENDOR_VERIFIED
    ]
  };

  return categories[category] || [];
};

/**
 * Generate email template
 * @param {string} title - Email title
 * @param {string} message - Email message
 * @param {string} type - Notification type
 * @param {Object} metadata - Additional data
 * @returns {Object} Email content
 */
const generateEmailTemplate = (title, message, type, metadata) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f4f4f4; }
            .container { max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 8px; }
            .header { text-align: center; margin-bottom: 30px; }
            .logo { font-size: 24px; font-weight: bold; color: #333; }
            .content { margin-bottom: 30px; }
            .footer { text-align: center; color: #666; font-size: 12px; }
            .button { display: inline-block; background-color: #007bff; color: white; text-decoration: none; padding: 10px 20px; border-radius: 4px; margin: 10px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">VOID Marketplace</div>
            </div>
            <div class="content">
                <h2>${title}</h2>
                <p>${message}</p>
                ${getActionButton(type, metadata, baseUrl)}
            </div>
            <div class="footer">
                <p>This email was sent by VOID Marketplace. If you no longer wish to receive these emails, you can unsubscribe in your account settings.</p>
            </div>
        </div>
    </body>
    </html>
  `;

  const text = `${title}\n\n${message}\n\nVOID Marketplace`;

  return { html, text };
};

/**
 * Get action button for email template
 * @param {string} type - Notification type
 * @param {Object} metadata - Metadata
 * @param {string} baseUrl - Base URL
 * @returns {string} Button HTML
 */
const getActionButton = (type, metadata, baseUrl) => {
  switch (type) {
    case NOTIFICATION_TYPE.CHAT_MESSAGE:
    case NOTIFICATION_TYPE.OFFER_RECEIVED:
      if (metadata.chat_id) {
        return `<a href="${baseUrl}/chat/${metadata.chat_id}" class="button">View Message</a>`;
      }
      break;
    case NOTIFICATION_TYPE.TRANSACTION_UPDATE:
      if (metadata.transaction_id) {
        return `<a href="${baseUrl}/transactions/${metadata.transaction_id}" class="button">View Transaction</a>`;
      }
      break;
    case NOTIFICATION_TYPE.LISTING_APPROVED:
      if (metadata.listing_id) {
        return `<a href="${baseUrl}/listings/${metadata.listing_id}" class="button">View Listing</a>`;
      }
      break;
    default:
      return `<a href="${baseUrl}" class="button">Visit Marketplace</a>`;
  }
  return '';
};

// ================================
// NOTIFICATION PREFERENCES
// ================================

/**
 * Get user notification preferences
 * @param {string} userId - User ID
 * @returns {Object} User preferences
 */
const getNotificationPreferences = async (userId) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        notification_preferences: true
      }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Default preferences if none set
    const defaultPreferences = {
      email: true,
      push: true,
      sms: false,
      categories: {
        transactions: true,
        listings: true,
        chats: true,
        system: true
      },
      quiet_hours: {
        enabled: false,
        start: '22:00',
        end: '08:00'
      }
    };

    return user.notification_preferences || defaultPreferences;
  } catch (error) {
    logger.error('Get notification preferences failed:', error);
    throw error;
  }
};

/**
 * Update user notification preferences
 * @param {string} userId - User ID
 * @param {Object} preferences - New preferences
 * @returns {Object} Updated preferences
 */
const updateNotificationPreferences = async (userId, preferences) => {
  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        notification_preferences: preferences
      },
      select: {
        notification_preferences: true
      }
    });

    logger.info('Notification preferences updated', { userId });

    return updatedUser.notification_preferences;
  } catch (error) {
    logger.error('Update notification preferences failed:', error);
    throw error;
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Core functions
  createNotification,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,

  // Specialized notifications
  sendTransactionNotification,
  sendListingNotification,
  sendVendorVerificationNotification,
  handleChatNotification,

  // Channel functions
  sendEmailNotification,
  sendPushNotification,
  sendSmsNotification,

  // Preferences
  getNotificationPreferences,
  updateNotificationPreferences,

  // Utility functions
  getCategoryTypes,
  generateEmailTemplate,

  // Initialization
  initializeEmailTransporter,

  // Error classes
  NotificationError,
  NotFoundError
};