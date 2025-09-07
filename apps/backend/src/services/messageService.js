// apps/backend/src/services/messageService.js
// Real-time message service with Socket.IO integration

const { prisma } = require('../config/db-original');
const logger = require('../utils/logger');
const { createMessage } = require('./chatService');

// ================================
// REAL-TIME MESSAGE HANDLING
// ================================

/**
 * Send message with real-time updates
 * @param {Object} messageData - Message data
 * @param {Object} io - Socket.IO instance
 * @returns {Object} Created message with real-time events
 */
const sendMessageRealtime = async (messageData, io) => {
  try {
    const { chatId, senderId, recipientId } = messageData;

    // Create message using chat service
    const newMessage = await createMessage(messageData);

    // Get chat details for context
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            images: {
              where: { is_primary: true },
              take: 1,
              select: { url: true }
            }
          }
        }
      }
    });

    // Emit to chat room (all participants)
    io.to(`chat_${chatId}`).emit('new_message', {
      message: newMessage,
      chat_id: chatId,
      chat_type: chat.listing_id ? 'product' : 'vendor'
    });

    // Send notification to recipient (if not in chat room)
    const notificationData = {
      type: 'new_message',
      chat_id: chatId,
      sender: newMessage.sender,
      message_preview: getMessagePreview(newMessage),
      chat_context: chat.listing_id ? {
        product: chat.listing.title,
        price: chat.listing.price,
        image: chat.listing.images[0]?.url
      } : null,
      timestamp: new Date().toISOString()
    };

    // Send to user's notification room
    io.to(`user_${recipientId}`).emit('message_notification', notificationData);

    // Special handling for offer messages
    if (['OFFER', 'COUNTER_OFFER'].includes(newMessage.type)) {
      io.to(`user_${recipientId}`).emit('offer_received', {
        chat_id: chatId,
        offer_amount: newMessage.offer_amount,
        message_type: newMessage.type,
        sender: newMessage.sender,
        product: chat.listing_id ? chat.listing : null
      });
    }

    logger.info('Real-time message sent', {
      messageId: newMessage.id,
      chatId,
      senderId,
      recipientId,
      messageType: newMessage.type
    });

    return {
      message: newMessage,
      realtime_sent: true,
      notification_sent: true
    };

  } catch (error) {
    logger.error('Real-time message send failed:', error);
    throw error;
  }
};

/**
 * Handle typing indicators
 * @param {string} chatId - Chat ID
 * @param {string} userId - User who is typing
 * @param {boolean} isTyping - Whether user is typing
 * @param {Object} io - Socket.IO instance
 */
const handleTypingIndicator = (chatId, userId, isTyping, io) => {
  try {
    // Emit typing status to all other participants in the chat
    io.to(`chat_${chatId}`).emit('user_typing', {
      user_id: userId,
      chat_id: chatId,
      is_typing: isTyping,
      timestamp: new Date().toISOString()
    });

    logger.debug('Typing indicator sent', {
      chatId,
      userId,
      isTyping
    });

  } catch (error) {
    logger.error('Typing indicator failed:', error);
  }
};

/**
 * Handle message read receipts
 * @param {string} chatId - Chat ID
 * @param {string} userId - User who read messages
 * @param {Array} messageIds - Message IDs that were read
 * @param {Object} io - Socket.IO instance
 */
const markMessagesAsRead = async (chatId, userId, messageIds, io) => {
  try {
    // Update messages as read
    const updateResult = await prisma.message.updateMany({
      where: {
        id: { in: messageIds },
        chat_id: chatId,
        sender_id: { not: userId }, // Don't mark own messages as read
        is_read: false
      },
      data: {
        is_read: true,
        read_at: new Date()
      }
    });

    // Emit read receipts to chat room
    if (updateResult.count > 0) {
      io.to(`chat_${chatId}`).emit('messages_read', {
        chat_id: chatId,
        reader_id: userId,
        message_ids: messageIds,
        read_at: new Date().toISOString()
      });
    }

    logger.info('Messages marked as read', {
      chatId,
      userId,
      messagesRead: updateResult.count
    });

    return { messagesRead: updateResult.count };

  } catch (error) {
    logger.error('Mark messages as read failed:', error);
    throw error;
  }
};

// ================================
// OFFER MANAGEMENT
// ================================

/**
 * Create offer message with special handling
 * @param {Object} offerData - Offer data
 * @param {Object} io - Socket.IO instance
 * @returns {Object} Created offer message
 */
const createOfferMessage = async (offerData, io) => {
  try {
    const {
      chatId,
      senderId,
      offerAmount,
      messageType = 'OFFER', // OFFER or COUNTER_OFFER
      notes = ''
    } = offerData;

    // Get chat and listing details
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            vendor_id: true
          }
        },
        buyer: { select: { id: true, username: true } },
        vendor: { select: { id: true, username: true } }
      }
    });

    if (!chat) {
      throw new Error('Chat not found');
    }

    // Validate offer amount
    if (!offerAmount || offerAmount <= 0) {
      throw new Error('Valid offer amount is required');
    }

    // Create offer message
    const offerMessage = await createMessage({
      chatId,
      senderId,
      content: notes,
      messageType,
      offerAmount,
      metadata: {
        original_price: chat.listing?.price,
        offer_percentage: chat.listing ? 
          Math.round((offerAmount / chat.listing.price) * 100) : null
      }
    });

    // Determine recipient
    const recipientId = chat.buyer_id === senderId ? chat.vendor_id : chat.buyer_id;

    // Send real-time updates
    io.to(`chat_${chatId}`).emit('offer_message', {
      message: offerMessage,
      chat_id: chatId,
      offer_type: messageType,
      product: chat.listing
    });

    // Send offer notification
    io.to(`user_${recipientId}`).emit('offer_notification', {
      type: messageType.toLowerCase(),
      chat_id: chatId,
      offer_amount: offerAmount,
      sender: offerMessage.sender,
      product: chat.listing,
      timestamp: new Date().toISOString()
    });

    logger.info('Offer message created', {
      messageId: offerMessage.id,
      chatId,
      senderId,
      offerAmount,
      messageType
    });

    return offerMessage;

  } catch (error) {
    logger.error('Offer message creation failed:', error);
    throw error;
  }
};

/**
 * Handle offer response (accept/reject)
 * @param {Object} responseData - Response data
 * @param {Object} io - Socket.IO instance
 * @returns {Object} Response result
 */
const handleOfferResponse = async (responseData, io) => {
  try {
    const {
      messageId,
      chatId,
      userId,
      response, // 'ACCEPT' or 'REJECT'
      notes = ''
    } = responseData;

    // Validate response
    if (!['ACCEPT', 'REJECT'].includes(response)) {
      throw new Error('Invalid offer response');
    }

    // Get original offer message
    const offerMessage = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        chat: {
          include: {
            listing: true,
            buyer: { select: { id: true, username: true } },
            vendor: { select: { id: true, username: true } }
          }
        }
      }
    });

    if (!offerMessage) {
      throw new Error('Offer message not found');
    }

    if (!['OFFER', 'COUNTER_OFFER'].includes(offerMessage.type)) {
      throw new Error('Message is not an offer');
    }

    // Verify user can respond to this offer
    const chat = offerMessage.chat;
    if (chat.buyer_id !== userId && chat.vendor_id !== userId) {
      throw new Error('Access denied');
    }

    // Create response message
    const responseMessageType = response === 'ACCEPT' ? 'OFFER_ACCEPTED' : 'OFFER_REJECTED';
    
    const responseMessage = await createMessage({
      chatId,
      senderId: userId,
      content: notes,
      messageType: responseMessageType,
      metadata: {
        original_offer_id: messageId,
        offer_amount: offerMessage.offer_amount,
        response_type: response
      }
    });

    // Determine recipient
    const recipientId = chat.buyer_id === userId ? chat.vendor_id : chat.buyer_id;

    // Send real-time updates
    io.to(`chat_${chatId}`).emit('offer_response', {
      message: responseMessage,
      chat_id: chatId,
      response_type: response,
      original_offer: offerMessage,
      product: chat.listing
    });

    // Send notification
    io.to(`user_${recipientId}`).emit('offer_response_notification', {
      type: `offer_${response.toLowerCase()}`,
      chat_id: chatId,
      responder: responseMessage.sender,
      offer_amount: offerMessage.offer_amount,
      product: chat.listing,
      notes,
      timestamp: new Date().toISOString()
    });

    // If offer accepted, potentially create transaction
    if (response === 'ACCEPT' && chat.listing_id) {
      // TODO: Create transaction (will be implemented in transaction service)
      logger.info('Offer accepted - transaction should be created', {
        chatId,
        listingId: chat.listing_id,
        offerAmount: offerMessage.offer_amount
      });
    }

    logger.info('Offer response handled', {
      originalOfferId: messageId,
      responseMessageId: responseMessage.id,
      response,
      chatId
    });

    return {
      response_message: responseMessage,
      original_offer: offerMessage,
      action_required: response === 'ACCEPT' ? 'create_transaction' : null
    };

  } catch (error) {
    logger.error('Offer response handling failed:', error);
    throw error;
  }
};

// ================================
// UTILITY FUNCTIONS
// ================================

/**
 * Get message preview for notifications
 * @param {Object} message - Message object
 * @returns {string} Preview text
 */
const getMessagePreview = (message) => {
  switch (message.type) {
    case 'TEXT':
      return message.content.length > 50 
        ? `${message.content.substring(0, 50)}...` 
        : message.content;
    
    case 'IMAGE':
      return '📷 Sent an image';
    
    case 'OFFER':
      return `💰 Made an offer: $${message.offer_amount}`;
    
    case 'COUNTER_OFFER':
      return `🔄 Counter offer: $${message.offer_amount}`;
    
    case 'OFFER_ACCEPTED':
      return '✅ Offer accepted';
    
    case 'OFFER_REJECTED':
      return '❌ Offer declined';
    
    default:
      return 'New message';
  }
};

/**
 * Get unread message count for user
 * @param {string} userId - User ID
 * @returns {number} Unread message count
 */
const getUnreadMessageCount = async (userId) => {
  try {
    const unreadCount = await prisma.message.count({
      where: {
        sender_id: { not: userId },
        is_read: false,
        chat: {
          OR: [
            { buyer_id: userId },
            { vendor_id: userId }
          ],
          status: 'ACTIVE'
        }
      }
    });

    return unreadCount;

  } catch (error) {
    logger.error('Get unread count failed:', error);
    return 0;
  }
};

/**
 * Search messages in chats
 * @param {string} userId - User ID
 * @param {string} searchQuery - Search query
 * @param {Object} options - Search options
 * @returns {Array} Matching messages
 */
const searchMessages = async (userId, searchQuery, options = {}) => {
  try {
    const { limit = 20, chatId = null } = options;

    const whereClause = {
      content: {
        contains: searchQuery,
        mode: 'insensitive'
      },
      chat: {
        OR: [
          { buyer_id: userId },
          { vendor_id: userId }
        ],
        status: 'ACTIVE'
      }
    };

    // If specific chat provided
    if (chatId) {
      whereClause.chat_id = chatId;
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
        },
        chat: {
          include: {
            listing: {
              select: {
                id: true,
                title: true,
                images: {
                  where: { is_primary: true },
                  take: 1,
                  select: { url: true }
                }
              }
            }
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: limit
    });

    logger.info('Message search completed', {
      userId,
      searchQuery,
      resultCount: messages.length
    });

    return messages;

  } catch (error) {
    logger.error('Message search failed:', error);
    return [];
  }
};

module.exports = {
  sendMessageRealtime,
  handleTypingIndicator,
  markMessagesAsRead,
  createOfferMessage,
  handleOfferResponse,
  getMessagePreview,
  getUnreadMessageCount,
  searchMessages
};