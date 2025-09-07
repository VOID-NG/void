// apps/backend/src/services/SocketChatService.js
// Complete real-time chat system with Socket.IO

const { dbRouter, QueryOptimizer } = require('../config/db');
const logger = require('../utils/logger');
const { emitToUser, emitToRoom } = require('../utils/socketUtils');

class SocketChatService {
  constructor(io) {
    this.io = io;
    this.activeUsers = new Map(); // userId -> socketId
    this.userSockets = new Map(); // socketId -> userId
    this.typingUsers = new Map(); // chatId -> Set of userIds
    this.setupSocketHandlers();
  }

  // ================================
  // SOCKET SETUP
  // ================================

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      logger.debug(`Socket connected: ${socket.id}`);

      // Authentication
      socket.on('authenticate', (data) => this.handleAuthentication(socket, data));
      
      // Chat management
      socket.on('join_chat', (data) => this.handleJoinChat(socket, data));
      socket.on('leave_chat', (data) => this.handleLeaveChat(socket, data));
      
      // Messaging
      socket.on('send_message', (data) => this.handleSendMessage(socket, data));
      socket.on('mark_read', (data) => this.handleMarkRead(socket, data));
      
      // Typing indicators
      socket.on('typing_start', (data) => this.handleTypingStart(socket, data));
      socket.on('typing_stop', (data) => this.handleTypingStop(socket, data));
      
      // Offers and negotiations
      socket.on('send_offer', (data) => this.handleSendOffer(socket, data));
      socket.on('accept_offer', (data) => this.handleAcceptOffer(socket, data));
      socket.on('reject_offer', (data) => this.handleRejectOffer(socket, data));
      socket.on('counter_offer', (data) => this.handleCounterOffer(socket, data));
      
      // File sharing
      socket.on('share_file', (data) => this.handleFileShare(socket, data));
      
      // Presence
      socket.on('update_presence', (data) => this.handleUpdatePresence(socket, data));
      
      // Disconnection
      socket.on('disconnect', () => this.handleDisconnection(socket));
      
      // Error handling
      socket.on('error', (error) => this.handleSocketError(socket, error));
    });
  }

  // ================================
  // AUTHENTICATION
  // ================================

  async handleAuthentication(socket, data) {
    try {
      const { token, userId } = data;

      if (!token || !userId) {
        socket.emit('auth_error', { message: 'Token and userId required' });
        return;
      }

      // Verify token (implement your JWT verification here)
      const isValid = await this.verifyToken(token, userId);
      
      if (!isValid) {
        socket.emit('auth_error', { message: 'Invalid token' });
        return;
      }

      // Store user-socket mapping
      this.activeUsers.set(userId, socket.id);
      this.userSockets.set(socket.id, userId);
      socket.userId = userId;

      // Join user's personal room for direct notifications
      socket.join(`user:${userId}`);

      // Update user's online status
      await this.updateUserPresence(userId, 'online');

      // Get user's active chats and join rooms
      const userChats = await this.getUserActiveChats(userId);
      userChats.forEach(chat => {
        socket.join(`chat:${chat.id}`);
      });

      socket.emit('authenticated', { 
        success: true, 
        activeChats: userChats.length,
        onlineUsers: this.getOnlineUsers()
      });

      // Notify contacts that user is online
      this.broadcastPresenceUpdate(userId, 'online');

      logger.debug(`User ${userId} authenticated on socket ${socket.id}`);

    } catch (error) {
      logger.error('Socket authentication failed:', error);
      socket.emit('auth_error', { message: 'Authentication failed' });
    }
  }

  // ================================
  // CHAT MANAGEMENT
  // ================================

  async handleJoinChat(socket, data) {
    try {
      const { chatId } = data;
      const userId = socket.userId;

      if (!userId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }

      // Verify user has access to this chat
      const chat = await dbRouter.chat.findFirst({
        where: {
          id: chatId,
          OR: [
            { buyer_id: userId },
            { vendor_id: userId }
          ]
        },
        include: {
          buyer: { select: { id: true, username: true, avatar_url: true } },
          vendor: { select: { id: true, username: true, avatar_url: true } },
          listing: { select: { id: true, title: true, images: true } }
        }
      });

      if (!chat) {
        socket.emit('error', { message: 'Chat not found or access denied' });
        return;
      }

      // Join chat room
      socket.join(`chat:${chatId}`);

      // Get recent messages
      const messages = await this.getChatMessages(chatId, 50);

      // Mark messages as read
      await this.markMessagesAsRead(chatId, userId);

      socket.emit('chat_joined', {
        chat,
        messages,
        timestamp: new Date().toISOString()
      });

      // Notify other users in chat
      socket.to(`chat:${chatId}`).emit('user_joined_chat', {
        userId,
        username: socket.username,
        timestamp: new Date().toISOString()
      });

      logger.debug(`User ${userId} joined chat ${chatId}`);

    } catch (error) {
      logger.error('Join chat failed:', error);
      socket.emit('error', { message: 'Failed to join chat' });
    }
  }

  async handleLeaveChat(socket, data) {
    try {
      const { chatId } = data;
      const userId = socket.userId;

      if (!userId) return;

      socket.leave(`chat:${chatId}`);

      // Stop typing if user was typing
      this.stopTyping(chatId, userId);

      socket.to(`chat:${chatId}`).emit('user_left_chat', {
        userId,
        timestamp: new Date().toISOString()
      });

      socket.emit('chat_left', { chatId });

      logger.debug(`User ${userId} left chat ${chatId}`);

    } catch (error) {
      logger.error('Leave chat failed:', error);
    }
  }

  // ================================
  // MESSAGING
  // ================================

  async handleSendMessage(socket, data) {
    try {
      const {
        chatId,
        content,
        messageType = 'TEXT',
        replyToId = null,
        attachments = []
      } = data;
      
      const userId = socket.userId;

      if (!userId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }

      if (!content && attachments.length === 0) {
        socket.emit('error', { message: 'Message content or attachments required' });
        return;
      }

      // Verify chat access
      const chat = await dbRouter.chat.findFirst({
        where: {
          id: chatId,
          OR: [
            { buyer_id: userId },
            { vendor_id: userId }
          ]
        }
      });

      if (!chat) {
        socket.emit('error', { message: 'Chat not found or access denied' });
        return;
      }

      // Create message
      const message = await dbRouter.message.create({
        data: {
          chat_id: chatId,
          sender_id: userId,
          content,
          message_type: messageType,
          reply_to_id: replyToId,
          attachments: attachments.length > 0 ? JSON.stringify(attachments) : null
        },
        include: {
          sender: { select: { id: true, username: true, avatar_url: true } },
          reply_to: {
            include: {
              sender: { select: { id: true, username: true } }
            }
          }
        }
      });

      // Update chat's last message
      await dbRouter.chat.update({
        where: { id: chatId },
        data: {
          last_message_id: message.id,
          last_message_at: new Date(),
          updated_at: new Date()
        }
      });

      // Stop typing indicator for sender
      this.stopTyping(chatId, userId);

      // Emit to chat room
      this.io.to(`chat:${chatId}`).emit('new_message', {
        message,
        chatId,
        timestamp: new Date().toISOString()
      });

      // Send push notification to offline users
      await this.sendMessageNotification(chat, message);

      socket.emit('message_sent', { success: true, messageId: message.id });

      logger.debug(`Message sent in chat ${chatId} by user ${userId}`);

    } catch (error) {
      logger.error('Send message failed:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  }

  async handleMarkRead(socket, data) {
    try {
      const { chatId, messageId = null } = data;
      const userId = socket.userId;

      if (!userId) return;

      await this.markMessagesAsRead(chatId, userId, messageId);

      // Notify other users in chat
      socket.to(`chat:${chatId}`).emit('messages_read', {
        userId,
        chatId,
        messageId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Mark read failed:', error);
    }
  }

  // ================================
  // TYPING INDICATORS
  // ================================

  handleTypingStart(socket, data) {
    try {
      const { chatId } = data;
      const userId = socket.userId;

      if (!userId) return;

      if (!this.typingUsers.has(chatId)) {
        this.typingUsers.set(chatId, new Set());
      }

      this.typingUsers.get(chatId).add(userId);

      // Notify other users in chat
      socket.to(`chat:${chatId}`).emit('user_typing', {
        userId,
        username: socket.username,
        chatId,
        isTyping: true
      });

    } catch (error) {
      logger.error('Typing start failed:', error);
    }
  }

  handleTypingStop(socket, data) {
    try {
      const { chatId } = data;
      const userId = socket.userId;

      if (!userId) return;

      this.stopTyping(chatId, userId);

      // Notify other users in chat
      socket.to(`chat:${chatId}`).emit('user_typing', {
        userId,
        username: socket.username,
        chatId,
        isTyping: false
      });

    } catch (error) {
      logger.error('Typing stop failed:', error);
    }
  }

  stopTyping(chatId, userId) {
    if (this.typingUsers.has(chatId)) {
      this.typingUsers.get(chatId).delete(userId);
      
      if (this.typingUsers.get(chatId).size === 0) {
        this.typingUsers.delete(chatId);
      }
    }
  }

  // ================================
  // OFFERS AND NEGOTIATIONS
  // ================================

  async handleSendOffer(socket, data) {
    try {
      const {
        chatId,
        offerAmount,
        currency = 'NGN',
        notes = '',
        expiresAt = null
      } = data;
      
      const userId = socket.userId;

      if (!userId || !offerAmount) {
        socket.emit('error', { message: 'Missing required offer data' });
        return;
      }

      // Verify chat and listing
      const chat = await dbRouter.chat.findFirst({
        where: {
          id: chatId,
          OR: [
            { buyer_id: userId },
            { vendor_id: userId }
          ]
        },
        include: {
          listing: { select: { id: true, title: true, price: true, vendor_id: true } }
        }
      });

      if (!chat || !chat.listing) {
        socket.emit('error', { message: 'Chat or listing not found' });
        return;
      }

      // Create offer message
      const offerMessage = await dbRouter.message.create({
        data: {
          chat_id: chatId,
          sender_id: userId,
          content: notes || `Offer: ${currency} ${offerAmount.toLocaleString()}`,
          message_type: 'OFFER',
          offer_amount: offerAmount,
          offer_currency: currency,
          offer_expires_at: expiresAt ? new Date(expiresAt) : null
        },
        include: {
          sender: { select: { id: true, username: true, avatar_url: true } }
        }
      });

      // Update chat
      await dbRouter.chat.update({
        where: { id: chatId },
        data: {
          last_message_id: offerMessage.id,
          last_message_at: new Date()
        }
      });

      // Emit to chat room
      this.io.to(`chat:${chatId}`).emit('new_offer', {
        message: offerMessage,
        chatId,
        listingTitle: chat.listing.title,
        originalPrice: chat.listing.price,
        timestamp: new Date().toISOString()
      });

      socket.emit('offer_sent', { success: true, messageId: offerMessage.id });

      logger.debug(`Offer sent in chat ${chatId}: ${currency} ${offerAmount}`);

    } catch (error) {
      logger.error('Send offer failed:', error);
      socket.emit('error', { message: 'Failed to send offer' });
    }
  }

  async handleAcceptOffer(socket, data) {
    try {
      const { chatId, messageId } = data;
      const userId = socket.userId;

      const acceptanceMessage = await this.handleOfferResponse(
        chatId, messageId, userId, 'OFFER_ACCEPTED', 'Offer accepted!'
      );

      this.io.to(`chat:${chatId}`).emit('offer_accepted', {
        message: acceptanceMessage,
        chatId,
        originalMessageId: messageId,
        timestamp: new Date().toISOString()
      });

      socket.emit('offer_response_sent', { success: true, messageId: acceptanceMessage.id });

    } catch (error) {
      logger.error('Accept offer failed:', error);
      socket.emit('error', { message: 'Failed to accept offer' });
    }
  }

  async handleRejectOffer(socket, data) {
    try {
      const { chatId, messageId, reason = '' } = data;
      const userId = socket.userId;

      const rejectionMessage = await this.handleOfferResponse(
        chatId, messageId, userId, 'OFFER_REJECTED', 
        reason || 'Offer rejected'
      );

      this.io.to(`chat:${chatId}`).emit('offer_rejected', {
        message: rejectionMessage,
        chatId,
        originalMessageId: messageId,
        timestamp: new Date().toISOString()
      });

      socket.emit('offer_response_sent', { success: true, messageId: rejectionMessage.id });

    } catch (error) {
      logger.error('Reject offer failed:', error);
      socket.emit('error', { message: 'Failed to reject offer' });
    }
  }

  async handleCounterOffer(socket, data) {
    try {
      const {
        chatId,
        messageId,
        counterAmount,
        currency = 'NGN',
        notes = ''
      } = data;
      
      const userId = socket.userId;

      const counterMessage = await dbRouter.message.create({
        data: {
          chat_id: chatId,
          sender_id: userId,
          content: notes || `Counter offer: ${currency} ${counterAmount.toLocaleString()}`,
          message_type: 'COUNTER_OFFER',
          reply_to_id: messageId,
          offer_amount: counterAmount,
          offer_currency: currency
        },
        include: {
          sender: { select: { id: true, username: true, avatar_url: true } }
        }
      });

      await dbRouter.chat.update({
        where: { id: chatId },
        data: {
          last_message_id: counterMessage.id,
          last_message_at: new Date()
        }
      });

      this.io.to(`chat:${chatId}`).emit('counter_offer', {
        message: counterMessage,
        chatId,
        originalMessageId: messageId,
        timestamp: new Date().toISOString()
      });

      socket.emit('counter_offer_sent', { success: true, messageId: counterMessage.id });

    } catch (error) {
      logger.error('Counter offer failed:', error);
      socket.emit('error', { message: 'Failed to send counter offer' });
    }
  }

  // ================================
  // FILE SHARING
  // ================================

  async handleFileShare(socket, data) {
    try {
      const {
        chatId,
        fileName,
        fileUrl,
        fileType,
        fileSize,
        caption = ''
      } = data;
      
      const userId = socket.userId;

      if (!fileName || !fileUrl) {
        socket.emit('error', { message: 'File name and URL required' });
        return;
      }

      const fileMessage = await dbRouter.message.create({
        data: {
          chat_id: chatId,
          sender_id: userId,
          content: caption || `Shared file: ${fileName}`,
          message_type: 'IMAGE', // or 'FILE' based on fileType
          attachments: JSON.stringify([{
            name: fileName,
            url: fileUrl,
            type: fileType,
            size: fileSize
          }])
        },
        include: {
          sender: { select: { id: true, username: true, avatar_url: true } }
        }
      });

      await dbRouter.chat.update({
        where: { id: chatId },
        data: {
          last_message_id: fileMessage.id,
          last_message_at: new Date()
        }
      });

      this.io.to(`chat:${chatId}`).emit('file_shared', {
        message: fileMessage,
        chatId,
        timestamp: new Date().toISOString()
      });

      socket.emit('file_share_sent', { success: true, messageId: fileMessage.id });

    } catch (error) {
      logger.error('File share failed:', error);
      socket.emit('error', { message: 'Failed to share file' });
    }
  }

  // ================================
  // PRESENCE AND STATUS
  // ================================

  async handleUpdatePresence(socket, data) {
    try {
      const { status } = data; // 'online', 'away', 'busy', 'offline'
      const userId = socket.userId;

      if (!userId) return;

      await this.updateUserPresence(userId, status);
      this.broadcastPresenceUpdate(userId, status);

      socket.emit('presence_updated', { status });

    } catch (error) {
      logger.error('Update presence failed:', error);
    }
  }

  // ================================
  // DISCONNECTION
  // ================================

  handleDisconnection(socket) {
    try {
      const userId = socket.userId;
      
      if (userId) {
        // Remove from active users
        this.activeUsers.delete(userId);
        this.userSockets.delete(socket.id);

        // Stop all typing indicators for this user
        for (const [chatId, typingSet] of this.typingUsers.entries()) {
          if (typingSet.has(userId)) {
            typingSet.delete(userId);
            socket.to(`chat:${chatId}`).emit('user_typing', {
              userId,
              chatId,
              isTyping: false
            });
          }
        }

        // Update presence to offline (with delay to handle reconnections)
        setTimeout(async () => {
          if (!this.activeUsers.has(userId)) {
            await this.updateUserPresence(userId, 'offline');
            this.broadcastPresenceUpdate(userId, 'offline');
          }
        }, 5000); // 5 second delay

        logger.debug(`User ${userId} disconnected from socket ${socket.id}`);
      }

    } catch (error) {
      logger.error('Disconnection handling failed:', error);
    }
  }

  handleSocketError(socket, error) {
    logger.error('Socket error:', error);
    socket.emit('error', { message: 'Socket error occurred' });
  }

  // ================================
  // HELPER METHODS
  // ================================

  async verifyToken(token, userId) {
    try {
      // Implement JWT verification here
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return decoded.userId === userId;
    } catch (error) {
      return false;
    }
  }

  async getUserActiveChats(userId) {
    return await dbRouter.chat.findMany({
      where: {
        OR: [
          { buyer_id: userId },
          { vendor_id: userId }
        ],
        status: 'ACTIVE'
      },
      include: {
        listing: { select: { id: true, title: true, images: true } }
      },
      orderBy: { last_message_at: 'desc' }
    });
  }

  async getChatMessages(chatId, limit = 50) {
    return await dbRouter.message.findMany({
      where: { chat_id: chatId },
      include: {
        sender: { select: { id: true, username: true, avatar_url: true } },
        reply_to: {
          include: {
            sender: { select: { id: true, username: true } }
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: limit
    });
  }

  async markMessagesAsRead(chatId, userId, upToMessageId = null) {
    const whereClause = {
      chat_id: chatId,
      sender_id: { not: userId },
      read_at: null
    };

    if (upToMessageId) {
      whereClause.id = { lte: upToMessageId };
    }

    await dbRouter.message.updateMany({
      where: whereClause,
      data: { read_at: new Date() }
    });
  }

  async handleOfferResponse(chatId, messageId, userId, messageType, content) {
    return await dbRouter.message.create({
      data: {
        chat_id: chatId,
        sender_id: userId,
        content,
        message_type: messageType,
        reply_to_id: messageId
      },
      include: {
        sender: { select: { id: true, username: true, avatar_url: true } }
      }
    });
  }

  async updateUserPresence(userId, status) {
    try {
      await dbRouter.user.update({
        where: { id: userId },
        data: { 
          last_seen: new Date(),
          // You can add a presence status field to your User model
          // presence_status: status
        }
      });
    } catch (error) {
      logger.error('Failed to update user presence:', error);
    }
  }

  broadcastPresenceUpdate(userId, status) {
    // Broadcast to user's contacts/chats
    this.io.to(`user:${userId}`).emit('presence_updated', {
      userId,
      status,
      timestamp: new Date().toISOString()
    });
  }

  async sendMessageNotification(chat, message) {
    try {
      // Determine recipient (the user who didn't send the message)
      const recipientId = message.sender_id === chat.buyer_id 
        ? chat.vendor_id 
        : chat.buyer_id;

      // Check if recipient is online
      if (!this.activeUsers.has(recipientId)) {
        // Send push notification for offline users
        const notificationService = require('./notificationService');
        await notificationService.sendChatNotification({
          userId: recipientId,
          chatId: chat.id,
          senderName: message.sender.username,
          messagePreview: message.content.substring(0, 100),
          messageType: message.message_type
        });
      }
    } catch (error) {
      logger.error('Failed to send message notification:', error);
    }
  }

  getOnlineUsers() {
    return Array.from(this.activeUsers.keys());
  }

  // ================================
  // ADMIN METHODS
  // ================================

  getSocketStats() {
    return {
      total_connections: this.io.engine.clientsCount,
      authenticated_users: this.activeUsers.size,
      active_chats: this.typingUsers.size,
      total_typing_users: Array.from(this.typingUsers.values())
        .reduce((sum, set) => sum + set.size, 0)
    };
  }

  // Force disconnect user (admin function)
  disconnectUser(userId, reason = 'Admin action') {
    const socketId = this.activeUsers.get(userId);
    if (socketId) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('force_disconnect', { reason });
        socket.disconnect(true);
      }
    }
  }

  // Broadcast system message to all users
  broadcastSystemMessage(message, type = 'info') {
    this.io.emit('system_message', {
      type,
      message,
      timestamp: new Date().toISOString()
    });
  }

  // Send message to specific chat (admin function)
  async sendAdminMessage(chatId, content, adminId) {
    try {
      const message = await dbRouter.message.create({
        data: {
          chat_id: chatId,
          sender_id: adminId,
          content,
          message_type: 'TEXT',
          is_admin_message: true
        },
        include: {
          sender: { select: { id: true, username: true, avatar_url: true } }
        }
      });

      this.io.to(`chat:${chatId}`).emit('admin_message', {
        message,
        chatId,
        timestamp: new Date().toISOString()
      });

      return message;
    } catch (error) {
      logger.error('Failed to send admin message:', error);
      throw error;
    }
  }
}

// ================================
// SOCKET UTILITY FUNCTIONS
// ================================

/**
 * Emit event to specific user across all their sockets
 */
const emitToUser = (io, userId, event, data) => {
  io.to(`user:${userId}`).emit(event, data);
};

/**
 * Emit event to specific chat room
 */
const emitToRoom = (io, roomId, event, data) => {
  io.to(`chat:${roomId}`).emit(event, data);
};

/**
 * Emit event to all authenticated users
 */
const emitToAllUsers = (io, event, data) => {
  io.emit(event, data);
};

/**
 * Get user's socket instance
 */
const getUserSocket = (io, userId) => {
  const socketService = io.socketService;
  if (socketService && socketService.activeUsers.has(userId)) {
    const socketId = socketService.activeUsers.get(userId);
    return io.sockets.sockets.get(socketId);
  }
  return null;
};

// ================================
// EXPORTS
// ================================

module.exports = {
  SocketChatService,
  emitToUser,
  emitToRoom,
  emitToAllUsers,
  getUserSocket
};