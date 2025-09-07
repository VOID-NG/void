// apps/backend/src/services/chatService.js
// Complete chat service layer for VOID Marketplace

const { prisma } = require('../config/db-original');
const { CHAT_STATUS, MESSAGE_TYPE, USER_ROLES } = require('../config/constants');
const logger = require('../utils/logger');
const notificationService = require('./notificationService');

// ================================
// CUSTOM ERROR CLASSES
// ================================

class ChatError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ChatError';
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

class UnauthorizedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnauthorizedError';
    this.statusCode = 403;
  }
}

// ================================
// CHAT MANAGEMENT
// ================================

/**
 * Create a new chat between buyer and vendor for a listing
 * @param {Object} chatData - Chat creation data
 * @returns {Object} Created chat
 */
const createChat = async (chatData) => {
  try {
    const { listing_id, buyer_id, vendor_id, initial_message } = chatData;

    // Validate required fields
    if (!listing_id || !buyer_id || !vendor_id) {
      throw new ChatError('Missing required fields: listing_id, buyer_id, vendor_id');
    }

    // Prevent users from chatting with themselves
    if (buyer_id === vendor_id) {
      throw new ChatError('Cannot create chat with yourself');
    }

    // Verify listing exists and get vendor info
    const listing = await prisma.listing.findUnique({
      where: { id: listing_id },
      include: {
        vendor: {
          select: { id: true, role: true }
        }
      }
    });

    if (!listing) {
      throw new NotFoundError('Listing not found');
    }

    // Verify vendor_id matches listing vendor
    if (listing.vendor_id !== vendor_id) {
      throw new ChatError('Invalid vendor for this listing');
    }

    // Check if chat already exists for this listing-buyer combination
    const existingChat = await prisma.chat.findFirst({
      where: {
        listing_id,
        buyer_id,
        vendor_id
      }
    });

    if (existingChat) {
      // Reactivate if archived
      if (existingChat.status === CHAT_STATUS.ARCHIVED) {
        const reactivatedChat = await prisma.chat.update({
          where: { id: existingChat.id },
          data: {
            status: CHAT_STATUS.ACTIVE,
            updated_at: new Date()
          },
          include: {
            listing: {
              select: {
                title: true,
                price: true,
                images: {
                  where: { is_primary: true },
                  take: 1,
                  select: { url: true }
                }
              }
            },
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
                first_name: true,
                last_name: true,
                business_name: true,
                avatar_url: true
              }
            }
          }
        });

        return reactivatedChat;
      }

      return existingChat;
    }

    // Create new chat
    const chat = await prisma.chat.create({
      data: {
        listing_id,
        buyer_id,
        vendor_id,
        status: CHAT_STATUS.ACTIVE
      },
      include: {
        listing: {
          select: {
            title: true,
            price: true,
            images: {
              where: { is_primary: true },
              take: 1,
              select: { url: true }
            }
          }
        },
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
            first_name: true,
            last_name: true,
            business_name: true,
            avatar_url: true
          }
        }
      }
    });

    // Send initial message if provided
    if (initial_message && initial_message.trim()) {
      await createMessage({
        chatId: chat.id,
        senderId: buyer_id,
        content: initial_message.trim(),
        messageType: MESSAGE_TYPE.TEXT
      });
    }

    // Send notification to vendor
    await notificationService.createNotification({
      user_id: vendor_id,
      type: 'NEW_CHAT',
      title: 'New chat started',
      message: `${chat.buyer.first_name} started a chat about ${listing.title}`,
      metadata: {
        chat_id: chat.id,
        listing_id,
        buyer_id
      },
      send_push: true
    });

    logger.info('Chat created successfully', {
      chatId: chat.id,
      listingId: listing_id,
      buyerId: buyer_id,
      vendorId: vendor_id
    });

    return chat;
  } catch (error) {
    logger.error('Create chat failed:', error);
    throw error;
  }
};

/**
 * Get chat by ID with participant verification
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID
 * @returns {Object} Chat data
 */
const getChatById = async (chatId, userId) => {
  try {
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            status: true,
            images: {
              where: { is_primary: true },
              take: 1,
              select: { url: true }
            }
          }
        },
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
            first_name: true,
            last_name: true,
            business_name: true,
            avatar_url: true,
            vendor_verified: true
          }
        },
        messages: {
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                first_name: true,
                avatar_url: true
              }
            }
          },
          orderBy: { created_at: 'desc' },
          take: 50 // Last 50 messages
        },
        _count: {
          select: {
            messages: true
          }
        }
      }
    });

    if (!chat) {
      throw new NotFoundError('Chat not found');
    }

    // Verify user is participant
    if (chat.buyer_id !== userId && chat.vendor_id !== userId) {
      throw new UnauthorizedError('You are not a participant in this chat');
    }

    // Mark messages as read for the current user
    await markMessagesAsRead(chatId, userId);

    return chat;
  } catch (error) {
    logger.error('Get chat by ID failed:', error);
    throw error;
  }
};

/**
 * Get user's chats with pagination
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Object} Chats and pagination data
 */
const getUserChats = async (userId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = CHAT_STATUS.ACTIVE,
      search
    } = options;

    const offset = (page - 1) * limit;

    // Build where clause
    const where = {
      OR: [
        { buyer_id: userId },
        { vendor_id: userId }
      ],
      status
    };

    if (search) {
      where.listing = {
        title: {
          contains: search,
          mode: 'insensitive'
        }
      };
    }

    // Get chats and total count
    const [chats, total] = await Promise.all([
      prisma.chat.findMany({
        where,
        include: {
          listing: {
            select: {
              id: true,
              title: true,
              price: true,
              status: true,
              images: {
                where: { is_primary: true },
                take: 1,
                select: { url: true }
              }
            }
          },
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
              first_name: true,
              last_name: true,
              business_name: true,
              avatar_url: true
            }
          },
          messages: {
            select: {
              id: true,
              content: true,
              type: true,
              created_at: true,
              is_read: true,
              sender: {
                select: {
                  id: true,
                  first_name: true
                }
              }
            },
            orderBy: { created_at: 'desc' },
            take: 1 // Latest message
          },
          _count: {
            select: {
              messages: {
                where: {
                  is_read: false,
                  sender_id: { not: userId }
                }
              }
            }
          }
        },
        orderBy: { updated_at: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.chat.count({ where })
    ]);

    // Format chats with additional metadata
    const formattedChats = chats.map(chat => {
      const isUserBuyer = chat.buyer_id === userId;
      const otherParticipant = isUserBuyer ? chat.vendor : chat.buyer;
      const lastMessage = chat.messages[0] || null;
      const unreadCount = chat._count.messages;

      return {
        ...chat,
        other_participant: otherParticipant,
        last_message: lastMessage,
        unread_count: unreadCount,
        is_user_buyer: isUserBuyer
      };
    });

    return {
      data: formattedChats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
        has_more: offset + chats.length < total
      }
    };
  } catch (error) {
    logger.error('Get user chats failed:', error);
    throw error;
  }
};

// ================================
// MESSAGE MANAGEMENT
// ================================

/**
 * Create a new message in a chat
 * @param {Object} messageData - Message data
 * @returns {Object} Created message
 */
const createMessage = async (messageData) => {
  try {
    const {
      chatId,
      senderId,
      content,
      messageType = MESSAGE_TYPE.TEXT,
      offerAmount = null,
      metadata = null,
      replyToId = null
    } = messageData;

    // Validate required fields
    if (!chatId || !senderId) {
      throw new ChatError('Missing required fields: chatId, senderId');
    }

    if (messageType === MESSAGE_TYPE.TEXT && (!content || !content.trim())) {
      throw new ChatError('Message content is required for text messages');
    }

    if ([MESSAGE_TYPE.OFFER, MESSAGE_TYPE.COUNTER_OFFER].includes(messageType) && !offerAmount) {
      throw new ChatError('Offer amount is required for offer messages');
    }

    // Get chat and verify user is participant
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        listing: {
          select: { title: true, price: true }
        }
      }
    });

    if (!chat) {
      throw new NotFoundError('Chat not found');
    }

    if (chat.buyer_id !== senderId && chat.vendor_id !== senderId) {
      throw new UnauthorizedError('You are not a participant in this chat');
    }

    if (chat.status === CHAT_STATUS.BLOCKED) {
      throw new ChatError('Cannot send messages in blocked chat');
    }

    // Reactivate archived chat
    if (chat.status === CHAT_STATUS.ARCHIVED) {
      await prisma.chat.update({
        where: { id: chatId },
        data: { status: CHAT_STATUS.ACTIVE }
      });
    }

    // Create message
    const message = await prisma.message.create({
      data: {
        chat_id: chatId,
        sender_id: senderId,
        type: messageType,
        content: content?.trim() || null,
        offer_amount: offerAmount ? parseFloat(offerAmount) : null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        reply_to_id: replyToId
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        reply_to: {
          select: {
            id: true,
            content: true,
            type: true,
            sender: {
              select: {
                first_name: true
              }
            }
          }
        }
      }
    });

    // Update chat timestamp
    await prisma.chat.update({
      where: { id: chatId },
      data: { updated_at: new Date() }
    });

    // Send notification to recipient
    const recipientId = senderId === chat.buyer_id ? chat.vendor_id : chat.buyer_id;
    await notificationService.createNotification({
      user_id: recipientId,
      type: 'CHAT_MESSAGE',
      title: 'New message',
      message: getMessagePreview(message, chat.listing.title),
      metadata: {
        chat_id: chatId,
        message_id: message.id,
        sender_id: senderId
      },
      send_push: true
    });

    logger.info('Message created successfully', {
      messageId: message.id,
      chatId,
      senderId,
      messageType
    });

    return message;
  } catch (error) {
    logger.error('Create message failed:', error);
    throw error;
  }
};

/**
 * Get messages for a chat with pagination
 * @param {Object} options - Query options
 * @returns {Object} Messages and pagination data
 */
const getChatMessages = async (options) => {
  try {
    const {
      chatId,
      userId,
      page = 1,
      limit = 50,
      beforeMessageId = null
    } = options;

    // Verify user access to chat
    const hasAccess = await verifyUserChatAccess(userId, chatId);
    if (!hasAccess) {
      throw new UnauthorizedError('Access denied to this chat');
    }

    // Build where clause
    const where = { chat_id: chatId };
    
    if (beforeMessageId) {
      // Get messages before specific message (for pagination)
      const beforeMessage = await prisma.message.findUnique({
        where: { id: beforeMessageId },
        select: { created_at: true }
      });
      
      if (beforeMessage) {
        where.created_at = { lt: beforeMessage.created_at };
      }
    }

    const offset = (page - 1) * limit;

    // Get messages
    const messages = await prisma.message.findMany({
      where,
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        reply_to: {
          select: {
            id: true,
            content: true,
            type: true,
            sender: {
              select: {
                first_name: true
              }
            }
          }
        }
      },
      orderBy: { created_at: 'desc' },
      skip: offset,
      take: limit
    });

    // Get total count
    const total = await prisma.message.count({ where: { chat_id: chatId } });

    // Mark messages as read
    await markMessagesAsRead(chatId, userId);

    return {
      data: messages.reverse(), // Reverse to show oldest first
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
        has_more: offset + messages.length < total
      }
    };
  } catch (error) {
    logger.error('Get chat messages failed:', error);
    throw error;
  }
};

/**
 * Mark messages as read for a user
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID
 * @returns {Object} Update result
 */
const markMessagesAsRead = async (chatId, userId) => {
  try {
    const result = await prisma.message.updateMany({
      where: {
        chat_id: chatId,
        sender_id: { not: userId },
        is_read: false
      },
      data: {
        is_read: true
      }
    });

    if (result.count > 0) {
      logger.info('Messages marked as read', {
        chatId,
        userId,
        count: result.count
      });
    }

    return result;
  } catch (error) {
    logger.error('Mark messages as read failed:', error);
    throw error;
  }
};

/**
 * Edit a message
 * @param {Object} editData - Edit data
 * @returns {Object} Updated message
 */
const editMessage = async (editData) => {
  try {
    const { messageId, userId, newContent } = editData;

    if (!newContent || !newContent.trim()) {
      throw new ChatError('New content is required');
    }

    // Get message and verify ownership
    const message = await prisma.message.findUnique({
      where: { id: messageId }
    });

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    if (message.sender_id !== userId) {
      throw new UnauthorizedError('You can only edit your own messages');
    }

    if (message.type !== MESSAGE_TYPE.TEXT) {
      throw new ChatError('Only text messages can be edited');
    }

    // Check if message is too old to edit (24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (message.created_at < twentyFourHoursAgo) {
      throw new ChatError('Messages older than 24 hours cannot be edited');
    }

    // Update message
    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: {
        content: newContent.trim(),
        edited_at: new Date()
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            first_name: true,
            avatar_url: true
          }
        }
      }
    });

    logger.info('Message edited successfully', {
      messageId,
      userId
    });

    return updatedMessage;
  } catch (error) {
    logger.error('Edit message failed:', error);
    throw error;
  }
};

/**
 * Delete a message (soft delete)
 * @param {Object} deleteData - Delete data
 * @returns {Object} Delete result
 */
const deleteMessage = async (deleteData) => {
  try {
    const { messageId, userId } = deleteData;

    // Get message and verify ownership
    const message = await prisma.message.findUnique({
      where: { id: messageId }
    });

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    if (message.sender_id !== userId) {
      throw new UnauthorizedError('You can only delete your own messages');
    }

    // Soft delete by updating content
    const deletedMessage = await prisma.message.update({
      where: { id: messageId },
      data: {
        content: '[Message deleted]',
        deleted_at: new Date()
      }
    });

    logger.info('Message deleted successfully', {
      messageId,
      userId
    });

    return { success: true, chatId: message.chat_id };
  } catch (error) {
    logger.error('Delete message failed:', error);
    throw error;
  }
};

// ================================
// CHAT STATUS MANAGEMENT
// ================================

/**
 * Update chat status
 * @param {string} chatId - Chat ID
 * @param {string} status - New status
 * @param {string} userId - User ID
 * @returns {Object} Updated chat
 */
const updateChatStatus = async (chatId, status, userId) => {
  try {
    // Verify user access
    const hasAccess = await verifyUserChatAccess(userId, chatId);
    if (!hasAccess) {
      throw new UnauthorizedError('Access denied to this chat');
    }

    const updatedChat = await prisma.chat.update({
      where: { id: chatId },
      data: {
        status,
        updated_at: new Date()
      }
    });

    logger.info('Chat status updated', {
      chatId,
      status,
      userId
    });

    return updatedChat;
  } catch (error) {
    logger.error('Update chat status failed:', error);
    throw error;
  }
};

/**
 * Archive a chat
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID
 * @returns {Object} Updated chat
 */
const archiveChat = async (chatId, userId) => {
  return updateChatStatus(chatId, CHAT_STATUS.ARCHIVED, userId);
};

/**
 * Block a chat
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID
 * @returns {Object} Updated chat
 */
const blockChat = async (chatId, userId) => {
  return updateChatStatus(chatId, CHAT_STATUS.BLOCKED, userId);
};

// ================================
// UTILITY FUNCTIONS
// ================================

/**
 * Verify user has access to chat
 * @param {string} userId - User ID
 * @param {string} chatId - Chat ID
 * @returns {boolean} Has access
 */
const verifyUserChatAccess = async (userId, chatId) => {
  try {
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      select: {
        buyer_id: true,
        vendor_id: true
      }
    });

    if (!chat) {
      return false;
    }

    return chat.buyer_id === userId || chat.vendor_id === userId;
  } catch (error) {
    logger.error('Verify chat access failed:', error);
    return false;
  }
};

/**
 * Get chat participants
 * @param {string} chatId - Chat ID
 * @returns {Array} Participants
 */
const getChatParticipants = async (chatId) => {
  try {
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
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
            first_name: true,
            last_name: true,
            business_name: true,
            avatar_url: true
          }
        }
      }
    });

    if (!chat) {
      return [];
    }

    return [chat.buyer, chat.vendor];
  } catch (error) {
    logger.error('Get chat participants failed:', error);
    return [];
  }
};

/**
 * Update chat activity timestamp
 * @param {string} chatId - Chat ID
 */
const updateChatActivity = async (chatId) => {
  try {
    await prisma.chat.update({
      where: { id: chatId },
      data: { updated_at: new Date() }
    });
  } catch (error) {
    logger.error('Update chat activity failed:', error);
  }
};

/**
 * Get message preview for notifications
 * @param {Object} message - Message object
 * @param {string} listingTitle - Listing title
 * @returns {string} Preview text
 */
const getMessagePreview = (message, listingTitle) => {
  switch (message.type) {
    case MESSAGE_TYPE.TEXT:
      return message.content.length > 50 
        ? `${message.content.substring(0, 50)}...`
        : message.content;
    
    case MESSAGE_TYPE.OFFER:
      return `Made an offer of $${message.offer_amount} for ${listingTitle}`;
    
    case MESSAGE_TYPE.COUNTER_OFFER:
      return `Made a counter offer of $${message.offer_amount} for ${listingTitle}`;
    
    case MESSAGE_TYPE.OFFER_ACCEPTED:
      return `Accepted your offer for ${listingTitle}`;
    
    case MESSAGE_TYPE.OFFER_REJECTED:
      return `Declined your offer for ${listingTitle}`;
    
    case MESSAGE_TYPE.IMAGE:
      return 'Sent an image';
    
    case MESSAGE_TYPE.FILE:
      return 'Sent a file';
    
    default:
      return 'Sent a message';
  }
};

// ================================
// CHAT ANALYTICS
// ================================

/**
 * Get chat statistics for user
 * @param {string} userId - User ID
 * @returns {Object} Chat statistics
 */
const getChatStatistics = async (userId) => {
  try {
    const [
      totalChats,
      activeChats,
      unreadMessages,
      totalMessages
    ] = await Promise.all([
      prisma.chat.count({
        where: {
          OR: [
            { buyer_id: userId },
            { vendor_id: userId }
          ]
        }
      }),
      prisma.chat.count({
        where: {
          OR: [
            { buyer_id: userId },
            { vendor_id: userId }
          ],
          status: CHAT_STATUS.ACTIVE
        }
      }),
      prisma.message.count({
        where: {
          chat: {
            OR: [
              { buyer_id: userId },
              { vendor_id: userId }
            ]
          },
          sender_id: { not: userId },
          is_read: false
        }
      }),
      prisma.message.count({
        where: {
          chat: {
            OR: [
              { buyer_id: userId },
              { vendor_id: userId }
            ]
          }
        }
      })
    ]);

    return {
      total_chats: totalChats,
      active_chats: activeChats,
      unread_messages: unreadMessages,
      total_messages: totalMessages
    };
  } catch (error) {
    logger.error('Get chat statistics failed:', error);
    throw error;
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Chat management
  createChat,
  getChatById,
  getUserChats,
  updateChatStatus,
  archiveChat,
  blockChat,

  // Message management
  createMessage,
  getChatMessages,
  markMessagesAsRead,
  editMessage,
  deleteMessage,

  // Utility functions
  verifyUserChatAccess,
  getChatParticipants,
  updateChatActivity,
  getMessagePreview,
  getChatStatistics,

  // Error classes
  ChatError,
  NotFoundError,
  UnauthorizedError
};