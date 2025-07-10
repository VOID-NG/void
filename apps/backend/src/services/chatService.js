// apps/backend/src/services/chatService.js
// Complete chat service with product-based and vendor-profile chat support

const { prisma } = require('../config/db');
const logger = require('../utils/logger');
const { ERROR_CODES } = require('../config/constants');

// ================================
// CHAT CREATION LOGIC
// ================================

/**
 * Create or get existing product-based chat
 * @param {string} listingId - Product listing ID
 * @param {string} buyerId - Buyer user ID
 * @param {string} initialMessage - Optional initial message
 * @returns {Object} Chat with participants and product info
 */
const createProductChat = async (listingId, buyerId, initialMessage = null) => {
  try {
    // Verify listing exists and is active
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        vendor: {
          select: {
            id: true,
            username: true,
            business_name: true,
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        images: {
          where: { is_primary: true },
          take: 1,
          select: { url: true, alt_text: true }
        }
      }
    });

    if (!listing) {
      throw new Error('Product listing not found');
    }

    if (listing.status !== 'ACTIVE') {
      throw new Error('Product is not available for chat');
    }

    if (listing.vendor_id === buyerId) {
      throw new Error('Cannot start chat with your own product');
    }

    // Check if chat already exists
    let existingChat = await prisma.chat.findFirst({
      where: {
        listing_id: listingId,
        buyer_id: buyerId,
        vendor_id: listing.vendor_id
      },
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
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            condition: true,
            images: {
              where: { is_primary: true },
              take: 1,
              select: { url: true, alt_text: true }
            }
          }
        },
        _count: {
          select: { messages: true }
        }
      }
    });

    // If chat exists, return it
    if (existingChat) {
      logger.info('Existing product chat found', {
        chatId: existingChat.id,
        listingId,
        buyerId
      });

      return {
        chat: existingChat,
        isNew: false,
        chatType: 'product'
      };
    }

    // Create new product-based chat
    const newChat = await prisma.chat.create({
      data: {
        listing_id: listingId,
        buyer_id: buyerId,
        vendor_id: listing.vendor_id,
        status: 'ACTIVE',
        last_message_at: new Date()
      },
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
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            condition: true,
            images: {
              where: { is_primary: true },
              take: 1,
              select: { url: true, alt_text: true }
            }
          }
        }
      }
    });

    // Send initial message if provided
    if (initialMessage) {
      await createMessage({
        chatId: newChat.id,
        senderId: buyerId,
        content: initialMessage,
        messageType: 'TEXT'
      });
    }

    logger.info('New product chat created', {
      chatId: newChat.id,
      listingId,
      buyerId,
      vendorId: listing.vendor_id
    });

    return {
      chat: newChat,
      isNew: true,
      chatType: 'product'
    };

  } catch (error) {
    logger.error('Product chat creation failed:', error);
    throw error;
  }
};

/**
 * Create vendor-profile chat (no product context)
 * @param {string} vendorId - Vendor user ID
 * @param {string} buyerId - Buyer user ID
 * @param {string} initialMessage - Optional initial message
 * @returns {Object} Chat with participants (no product info)
 */
const createVendorChat = async (vendorId, buyerId, initialMessage = null) => {
  try {
    // Verify vendor exists and is active
    const vendor = await prisma.user.findUnique({
      where: { id: vendorId },
      select: {
        id: true,
        username: true,
        business_name: true,
        first_name: true,
        last_name: true,
        avatar_url: true,
        role: true,
        status: true
      }
    });

    if (!vendor) {
      throw new Error('Vendor not found');
    }

    if (vendor.role !== 'VENDOR') {
      throw new Error('User is not a vendor');
    }

    if (vendor.status !== 'ACTIVE') {
      throw new Error('Vendor is not available for chat');
    }

    if (vendorId === buyerId) {
      throw new Error('Cannot start chat with yourself');
    }

    // Check if vendor-profile chat already exists
    let existingChat = await prisma.chat.findFirst({
      where: {
        listing_id: null, // Key difference: no product context
        buyer_id: buyerId,
        vendor_id: vendorId
      },
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
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        _count: {
          select: { messages: true }
        }
      }
    });

    // If chat exists, return it
    if (existingChat) {
      logger.info('Existing vendor chat found', {
        chatId: existingChat.id,
        vendorId,
        buyerId
      });

      return {
        chat: existingChat,
        isNew: false,
        chatType: 'vendor'
      };
    }

    // Create new vendor-profile chat
    const newChat = await prisma.chat.create({
      data: {
        listing_id: null, // No product context
        buyer_id: buyerId,
        vendor_id: vendorId,
        status: 'ACTIVE',
        last_message_at: new Date()
      },
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
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        }
      }
    });

    // Send initial message if provided
    if (initialMessage) {
      await createMessage({
        chatId: newChat.id,
        senderId: buyerId,
        content: initialMessage,
        messageType: 'TEXT'
      });
    }

    logger.info('New vendor chat created', {
      chatId: newChat.id,
      vendorId,
      buyerId
    });

    return {
      chat: newChat,
      isNew: true,
      chatType: 'vendor'
    };

  } catch (error) {
    logger.error('Vendor chat creation failed:', error);
    throw error;
  }
};

// ================================
// CHAT MANAGEMENT
// ================================

/**
 * Get user's chats with pagination
 * @param {string} userId - User ID
 * @param {Object} options - Pagination and filter options
 * @returns {Array} User's chats
 */
const getUserChats = async (userId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = 'ACTIVE'
    } = options;

    const chats = await prisma.chat.findMany({
      where: {
        OR: [
          { buyer_id: userId },
          { vendor_id: userId }
        ],
        status: status
      },
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
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            condition: true,
            status: true,
            images: {
              where: { is_primary: true },
              take: 1,
              select: { url: true, alt_text: true }
            }
          }
        },
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: {
            id: true,
            content: true,
            type: true,
            created_at: true,
            sender_id: true,
            is_read: true
          }
        },
        _count: {
          select: { 
            messages: {
              where: {
                sender_id: { not: userId },
                is_read: false
              }
            }
          }
        }
      },
      orderBy: {
        last_message_at: 'desc'
      },
      skip: (page - 1) * limit,
      take: limit
    });

    // Add helper fields for frontend
    const enrichedChats = chats.map(chat => {
      const isUserBuyer = chat.buyer_id === userId;
      const otherParticipant = isUserBuyer ? chat.vendor : chat.buyer;
      const lastMessage = chat.messages[0] || null;
      const unreadCount = chat._count.messages;

      return {
        ...chat,
        chatType: chat.listing_id ? 'product' : 'vendor',
        otherParticipant,
        lastMessage,
        unreadCount,
        isUserBuyer
      };
    });

    logger.info('User chats retrieved', {
      userId,
      chatCount: enrichedChats.length,
      page,
      limit
    });

    return enrichedChats;

  } catch (error) {
    logger.error('Get user chats failed:', error);
    throw error;
  }
};

/**
 * Get chat details with participants and product info
 * @param {string} chatId - Chat ID
 * @param {string} userId - Requesting user ID
 * @returns {Object} Chat details
 */
const getChatDetails = async (chatId, userId) => {
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
            business_name: true,
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        },
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            condition: true,
            status: true,
            description: true,
            images: {
              where: { is_primary: true },
              take: 1,
              select: { url: true, alt_text: true }
            }
          }
        }
      }
    });

    if (!chat) {
      throw new Error('Chat not found');
    }

    // Verify user has access to this chat
    if (chat.buyer_id !== userId && chat.vendor_id !== userId) {
      throw new Error('Access denied to this chat');
    }

    // Add helper fields
    const isUserBuyer = chat.buyer_id === userId;
    const otherParticipant = isUserBuyer ? chat.vendor : chat.buyer;

    const chatDetails = {
      ...chat,
      chatType: chat.listing_id ? 'product' : 'vendor',
      otherParticipant,
      isUserBuyer
    };

    logger.info('Chat details retrieved', {
      chatId,
      userId,
      chatType: chatDetails.chatType
    });

    return chatDetails;

  } catch (error) {
    logger.error('Get chat details failed:', error);
    throw error;
  }
};

// ================================
// MESSAGE MANAGEMENT
// ================================

/**
 * Create a new message
 * @param {Object} messageData - Message data
 * @returns {Object} Created message
 */
const createMessage = async (messageData) => {
  try {
    const {
      chatId,
      senderId,
      content,
      messageType = 'TEXT',
      offerAmount = null,
      metadata = null
    } = messageData;

    // Verify chat exists and user has access
    const chat = await prisma.chat.findUnique({
      where: { id: chatId }
    });

    if (!chat) {
      throw new Error('Chat not found');
    }

    if (chat.buyer_id !== senderId && chat.vendor_id !== senderId) {
      throw new Error('Access denied to this chat');
    }

    // Validate message content based on type
    if (['TEXT', 'IMAGE'].includes(messageType) && (!content || content.trim() === '')) {
      throw new Error('Content is required for text and image messages');
    }

    if (['OFFER', 'COUNTER_OFFER'].includes(messageType) && !offerAmount) {
      throw new Error('Offer amount is required for offer messages');
    }

    // Create message
    const messageCreateData = {
      chat_id: chatId,
      sender_id: senderId,
      content: content || '',
      type: messageType
    };

    // Add offer amount if present
    if (offerAmount) {
      messageCreateData.offer_amount = parseFloat(offerAmount);
    }

    // Add metadata if present
    if (metadata) {
      messageCreateData.metadata = JSON.stringify(metadata);
    }

    const newMessage = await prisma.message.create({
      data: messageCreateData,
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        }
      }
    });

    // Update chat's last_message_at
    await prisma.chat.update({
      where: { id: chatId },
      data: { 
        last_message_at: new Date(),
        updated_at: new Date()
      }
    });

    logger.info('Message created', {
      messageId: newMessage.id,
      chatId,
      senderId,
      messageType
    });

    return newMessage;

  } catch (error) {
    logger.error('Message creation failed:', error);
    throw error;
  }
};

/**
 * Get messages for a chat with pagination
 * @param {string} chatId - Chat ID
 * @param {string} userId - Requesting user ID
 * @param {Object} options - Pagination options
 * @returns {Array} Messages
 */
const getChatMessages = async (chatId, userId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 50,
      beforeMessageId = null
    } = options;

    // Verify user has access to this chat
    const chat = await prisma.chat.findUnique({
      where: { id: chatId }
    });

    if (!chat) {
      throw new Error('Chat not found');
    }

    if (chat.buyer_id !== userId && chat.vendor_id !== userId) {
      throw new Error('Access denied to this chat');
    }

    // Build where clause
    const whereClause = { chat_id: chatId };

    // If beforeMessageId is provided, get messages before that message (for pagination)
    if (beforeMessageId) {
      const beforeMessage = await prisma.message.findUnique({
        where: { id: beforeMessageId },
        select: { created_at: true }
      });

      if (beforeMessage) {
        whereClause.created_at = {
          lt: beforeMessage.created_at
        };
      }
    }

    const messages = await prisma.message.findMany({
      where: whereClause,
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            avatar_url: true
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: limit
    });

    // Mark messages as read (messages from other participant)
    await prisma.message.updateMany({
      where: {
        chat_id: chatId,
        sender_id: { not: userId },
        is_read: false
      },
      data: {
        is_read: true,
        read_at: new Date()
      }
    });

    // Reverse to show chronological order (oldest first)
    const chronologicalMessages = messages.reverse();

    logger.info('Chat messages retrieved', {
      chatId,
      userId,
      messageCount: chronologicalMessages.length,
      page
    });

    return chronologicalMessages;

  } catch (error) {
    logger.error('Get chat messages failed:', error);
    throw error;
  }
};

// ================================
// CHAT STATUS MANAGEMENT
// ================================

/**
 * Update chat status
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID
 * @param {string} status - New status (ACTIVE, ARCHIVED, BLOCKED)
 * @returns {Object} Updated chat
 */
const updateChatStatus = async (chatId, userId, status) => {
  try {
    const validStatuses = ['ACTIVE', 'ARCHIVED', 'BLOCKED'];
    if (!validStatuses.includes(status)) {
      throw new Error('Invalid chat status');
    }

    // Verify user has access to this chat
    const chat = await prisma.chat.findUnique({
      where: { id: chatId }
    });

    if (!chat) {
      throw new Error('Chat not found');
    }

    if (chat.buyer_id !== userId && chat.vendor_id !== userId) {
      throw new Error('Access denied to this chat');
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
      userId,
      newStatus: status
    });

    return updatedChat;

  } catch (error) {
    logger.error('Chat status update failed:', error);
    throw error;
  }
};

module.exports = {
  createProductChat,
  createVendorChat,
  getUserChats,
  getChatDetails,
  createMessage,
  getChatMessages,
  updateChatStatus
};