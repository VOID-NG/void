// apps/backend/src/utils/socketHandlers.js
// Socket.IO event handlers for real-time chat functionality

const logger = require('./logger');
const { 
  sendMessageRealtime,
  handleTypingIndicator,
  markMessagesAsRead 
} = require('../services/messageService');
const { getChatDetails } = require('../services/chatService');

// ================================
// SOCKET CONNECTION MANAGEMENT
// ================================

/**
 * Handle new socket connection
 * @param {Object} socket - Socket.IO socket instance
 * @param {Object} io - Socket.IO server instance
 */
const handleConnection = (socket, io) => {
  logger.info(`Socket connected: ${socket.id}`);

  // ================================
  // USER AUTHENTICATION & ROOMS
  // ================================

  /**
   * Join user-specific room for notifications
   */
  socket.on('join_user_room', (data) => {
    try {
      const { userId, userToken } = data;

      // TODO: Verify user token here for security
      // For now, we'll trust the frontend authentication

      socket.userId = userId;
      socket.join(`user_${userId}`);
      
      logger.info(`User ${userId} joined their notification room`, {
        socketId: socket.id,
        userId
      });

      socket.emit('user_room_joined', {
        success: true,
        user_id: userId,
        room: `user_${userId}`
      });

    } catch (error) {
      logger.error('Join user room failed:', error);
      socket.emit('error', {
        type: 'join_user_room_failed',
        message: 'Failed to join user room'
      });
    }
  });

  /**
   * Join specific chat room
   */
  socket.on('join_chat', async (data) => {
    try {
      const { chatId, userId } = data;

      if (!chatId || !userId) {
        socket.emit('error', {
          type: 'invalid_data',
          message: 'Chat ID and User ID are required'
        });
        return;
      }

      // Verify user has access to this chat
      try {
        await getChatDetails(chatId, userId);
        
        socket.join(`chat_${chatId}`);
        socket.currentChatId = chatId;
        
        logger.info(`User ${userId} joined chat ${chatId}`, {
          socketId: socket.id,
          chatId,
          userId
        });

        socket.emit('chat_joined', {
          success: true,
          chat_id: chatId,
          room: `chat_${chatId}`
        });

        // Notify other participants that user joined
        socket.to(`chat_${chatId}`).emit('user_joined_chat', {
          user_id: userId,
          chat_id: chatId,
          timestamp: new Date().toISOString()
        });

      } catch (accessError) {
        socket.emit('error', {
          type: 'access_denied',
          message: 'Access denied to this chat'
        });
      }

    } catch (error) {
      logger.error('Join chat failed:', error);
      socket.emit('error', {
        type: 'join_chat_failed',
        message: 'Failed to join chat'
      });
    }
  });

  /**
   * Leave chat room
   */
  socket.on('leave_chat', (data) => {
    try {
      const { chatId, userId } = data;

      if (socket.currentChatId === chatId) {
        socket.leave(`chat_${chatId}`);
        socket.currentChatId = null;

        logger.info(`User ${userId} left chat ${chatId}`, {
          socketId: socket.id,
          chatId,
          userId
        });

        // Notify other participants that user left
        socket.to(`chat_${chatId}`).emit('user_left_chat', {
          user_id: userId,
          chat_id: chatId,
          timestamp: new Date().toISOString()
        });

        socket.emit('chat_left', {
          success: true,
          chat_id: chatId
        });
      }

    } catch (error) {
      logger.error('Leave chat failed:', error);
      socket.emit('error', {
        type: 'leave_chat_failed',
        message: 'Failed to leave chat'
      });
    }
  });

  // ================================
  // REAL-TIME MESSAGING
  // ================================

  /**
   * Send message in real-time
   */
  socket.on('send_message', async (data) => {
    try {
      const {
        chatId,
        content,
        messageType = 'TEXT',
        metadata
      } = data;

      if (!socket.userId) {
        socket.emit('error', {
          type: 'authentication_required',
          message: 'Must join user room first'
        });
        return;
      }

      if (!chatId || !content) {
        socket.emit('error', {
          type: 'invalid_data',
          message: 'Chat ID and content are required'
        });
        return;
      }

      // Get chat to determine recipient
      const { dbRouter, QueryOptimizer } = require('../config/db');
      const chat = await dbRouter.chat.findUnique({
        where: { id: chatId },
        select: {
          buyer_id: true,
          vendor_id: true,
          status: true
        }
      });

      if (!chat || chat.status !== 'ACTIVE') {
        socket.emit('error', {
          type: 'chat_not_available',
          message: 'Chat is not available'
        });
        return;
      }

      const recipientId = chat.buyer_id === socket.userId ? 
                         chat.vendor_id : chat.buyer_id;

      // Send message with real-time updates
      const result = await sendMessageRealtime({
        chatId,
        senderId: socket.userId,
        recipientId,
        content: content.trim(),
        messageType,
        metadata
      }, io);

      // Confirm to sender
      socket.emit('message_sent', {
        success: true,
        message: result.message,
        temp_id: data.temp_id // For frontend optimistic updates
      });

    } catch (error) {
      logger.error('Socket send message failed:', error);
      socket.emit('error', {
        type: 'send_message_failed',
        message: 'Failed to send message',
        temp_id: data.temp_id
      });
    }
  });

  /**
   * Handle typing indicators
   */
  socket.on('typing_start', (data) => {
    try {
      const { chatId } = data;

      if (!socket.userId || !chatId) {
        return;
      }

      handleTypingIndicator(chatId, socket.userId, true, io);

    } catch (error) {
      logger.error('Typing start failed:', error);
    }
  });

  socket.on('typing_stop', (data) => {
    try {
      const { chatId } = data;

      if (!socket.userId || !chatId) {
        return;
      }

      handleTypingIndicator(chatId, socket.userId, false, io);

    } catch (error) {
      logger.error('Typing stop failed:', error);
    }
  });

  /**
   * Mark messages as read
   */
  socket.on('mark_messages_read', async (data) => {
    try {
      const { chatId, messageIds } = data;

      if (!socket.userId || !chatId || !Array.isArray(messageIds)) {
        socket.emit('error', {
          type: 'invalid_data',
          message: 'Chat ID and message IDs are required'
        });
        return;
      }

      await markMessagesAsRead(chatId, socket.userId, messageIds, io);

      socket.emit('messages_marked_read', {
        success: true,
        chat_id: chatId,
        message_ids: messageIds
      });

    } catch (error) {
      logger.error('Mark messages read failed:', error);
      socket.emit('error', {
        type: 'mark_read_failed',
        message: 'Failed to mark messages as read'
      });
    }
  });

  // ================================
  // OFFER MANAGEMENT
  // ================================

  /**
   * Send offer in real-time
   */
  socket.on('send_offer', async (data) => {
    try {
      const {
        chatId,
        offerAmount,
        messageType = 'OFFER',
        notes = ''
      } = data;

      if (!socket.userId || !chatId || !offerAmount) {
        socket.emit('error', {
          type: 'invalid_data',
          message: 'Chat ID and offer amount are required'
        });
        return;
      }

      const { createOfferMessage } = require('../services/messageService');

      const offerMessage = await createOfferMessage({
        chatId,
        senderId: socket.userId,
        offerAmount: parseFloat(offerAmount),
        messageType,
        notes
      }, io);

      socket.emit('offer_sent', {
        success: true,
        message: offerMessage,
        temp_id: data.temp_id
      });

    } catch (error) {
      logger.error('Socket send offer failed:', error);
      socket.emit('error', {
        type: 'send_offer_failed',
        message: 'Failed to send offer',
        temp_id: data.temp_id
      });
    }
  });

  /**
   * Respond to offer in real-time
   */
  socket.on('respond_to_offer', async (data) => {
    try {
      const {
        chatId,
        messageId,
        response,
        notes = ''
      } = data;

      if (!socket.userId || !chatId || !messageId || !response) {
        socket.emit('error', {
          type: 'invalid_data',
          message: 'Chat ID, message ID, and response are required'
        });
        return;
      }

      const { handleOfferResponse } = require('../services/messageService');

      const result = await handleOfferResponse({
        messageId,
        chatId,
        userId: socket.userId,
        response: response.toUpperCase(),
        notes
      }, io);

      socket.emit('offer_response_sent', {
        success: true,
        response_message: result.response_message,
        original_offer: result.original_offer,
        action_required: result.action_required
      });

    } catch (error) {
      logger.error('Socket offer response failed:', error);
      socket.emit('error', {
        type: 'offer_response_failed',
        message: 'Failed to respond to offer'
      });
    }
  });

  // ================================
  // USER PRESENCE
  // ================================

  /**
   * Update user online status
   */
  socket.on('update_presence', (data) => {
    try {
      const { status = 'online' } = data;

      if (!socket.userId) {
        return;
      }

      socket.userStatus = status;

      // Broadcast presence to all user's chats
      if (socket.currentChatId) {
        socket.to(`chat_${socket.currentChatId}`).emit('user_presence_updated', {
          user_id: socket.userId,
          status,
          timestamp: new Date().toISOString()
        });
      }

      logger.debug('User presence updated', {
        userId: socket.userId,
        status
      });

    } catch (error) {
      logger.error('Update presence failed:', error);
    }
  });

  // ================================
  // ERROR HANDLING & DISCONNECTION
  // ================================

  /**
   * Handle socket errors
   */
  socket.on('error', (error) => {
    logger.error('Socket error:', error);
  });

  /**
   * Handle socket disconnection
   */
  socket.on('disconnect', (reason) => {
    logger.info(`Socket disconnected: ${socket.id}`, {
      reason,
      userId: socket.userId,
      currentChatId: socket.currentChatId
    });

    // Notify current chat that user went offline
    if (socket.currentChatId && socket.userId) {
      socket.to(`chat_${socket.currentChatId}`).emit('user_presence_updated', {
        user_id: socket.userId,
        status: 'offline',
        timestamp: new Date().toISOString()
      });
    }
  });
};

// ================================
// SOCKET.IO INITIALIZATION
// ================================

/**
 * Initialize Socket.IO with event handlers
 * @param {Object} io - Socket.IO server instance
 */
const initializeSocketHandlers = (io) => {
  // Middleware for authentication (optional)
  io.use((socket, next) => {
    // You can add JWT verification here if needed
    // For now, we'll rely on the join_user_room event for authentication
    next();
  });

  // Handle new connections
  io.on('connection', (socket) => {
    handleConnection(socket, io);
  });

  logger.info('Socket.IO handlers initialized');
};

// ================================
// UTILITY FUNCTIONS
// ================================

/**
 * Send notification to specific user
 * @param {Object} io - Socket.IO instance
 * @param {string} userId - User ID
 * @param {Object} notification - Notification data
 */
const sendUserNotification = (io, userId, notification) => {
  io.to(`user_${userId}`).emit('notification', {
    ...notification,
    timestamp: new Date().toISOString()
  });
};

/**
 * Send message to specific chat
 * @param {Object} io - Socket.IO instance
 * @param {string} chatId - Chat ID
 * @param {string} event - Event name
 * @param {Object} data - Event data
 */
const sendChatMessage = (io, chatId, event, data) => {
  io.to(`chat_${chatId}`).emit(event, {
    ...data,
    timestamp: new Date().toISOString()
  });
};

/**
 * Get online users in a chat
 * @param {Object} io - Socket.IO instance
 * @param {string} chatId - Chat ID
 * @returns {Array} Online user IDs
 */
const getOnlineUsersInChat = (io, chatId) => {
  const room = io.sockets.adapter.rooms.get(`chat_${chatId}`);
  if (!room) return [];

  const onlineUsers = [];
  for (const socketId of room) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.userId) {
      onlineUsers.push(socket.userId);
    }
  }

  return [...new Set(onlineUsers)]; // Remove duplicates
};

module.exports = {
  initializeSocketHandlers,
  sendUserNotification,
  sendChatMessage,
  getOnlineUsersInChat
};