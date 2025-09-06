// apps/backend/src/utils/socketChatSystem.js
// Complete Socket.IO chat system with real-time messaging, typing indicators, file sharing

const jwt = require('jsonwebtoken');
const chatService = require('../services/chatService');
const messageService = require('../services/messageService');
const notificationService = require('../services/notificationService');
const logger = require('./logger');

class SocketChatSystem {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map(); // userId -> socketId mapping
    this.userSockets = new Map(); // socketId -> user data mapping
    this.typingUsers = new Map(); // chatId -> Set of typing users
    this.activeChats = new Map(); // chatId -> Set of connected users
    
    this.setupSocketHandlers();
    this.setupHeartbeat();
  }

  // ================================
  // SOCKET CONNECTION MANAGEMENT
  // ================================

  setupSocketHandlers() {
    this.io.use(this.authenticateSocket.bind(this));

    this.io.on('connection', (socket) => {
      logger.info('Socket connected', { 
        socketId: socket.id, 
        userId: socket.user?.id 
      });

      this.handleUserConnection(socket);
      this.setupSocketEventHandlers(socket);
    });
  }

  /**
   * Authenticate socket connection using JWT
   */
  async authenticateSocket(socket, next) {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        // Allow anonymous connections for public features
        socket.user = null;
        return next();
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      
      next();
    } catch (error) {
      logger.error('Socket authentication failed:', error);
      next(new Error('Authentication failed'));
    }
  }

  /**
   * Handle user connection and setup presence
   */
  handleUserConnection(socket) {
    if (!socket.user) return;

    const userId = socket.user.id;
    
    // Store user connection
    this.connectedUsers.set(userId, socket.id);
    this.userSockets.set(socket.id, {
      userId,
      connectedAt: new Date(),
      lastActivity: new Date()
    });

    // Join user to their personal room for notifications
    socket.join(`user:${userId}`);

    // Emit user online status to their contacts
    this.broadcastUserStatus(userId, 'online');

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleUserDisconnection(socket);
    });
  }

  /**
   * Handle user disconnection
   */
  handleUserDisconnection(socket) {
    if (!socket.user) return;

    const userId = socket.user.id;
    
    // Remove from active chats
    this.activeChats.forEach((users, chatId) => {
      if (users.has(userId)) {
        users.delete(userId);
        socket.to(`chat:${chatId}`).emit('user_left_chat', { userId, chatId });
      }
    });

    // Remove from typing indicators
    this.typingUsers.forEach((typingSet, chatId) => {
      if (typingSet.has(userId)) {
        typingSet.delete(userId);
        socket.to(`chat:${chatId}`).emit('user_stopped_typing', { userId, chatId });
      }
    });

    // Clean up user connection data
    this.connectedUsers.delete(userId);
    this.userSockets.delete(socket.id);

    // Broadcast user offline status
    this.broadcastUserStatus(userId, 'offline');

    logger.info('Socket disconnected', { 
      socketId: socket.id, 
      userId 
    });
  }

  // ================================
  // CHAT EVENT HANDLERS
  // ================================

  setupSocketEventHandlers(socket) {
    // Join chat room
    socket.on('join_chat', this.handleJoinChat.bind(this, socket));
    
    // Leave chat room
    socket.on('leave_chat', this.handleLeaveChat.bind(this, socket));
    
    // Send message
    socket.on('send_message', this.handleSendMessage.bind(this, socket));
    
    // Typing indicators
    socket.on('start_typing', this.handleStartTyping.bind(this, socket));
    socket.on('stop_typing', this.handleStopTyping.bind(this, socket));
    
    // Message actions
    socket.on('mark_messages_read', this.handleMarkMessagesRead.bind(this, socket));
    socket.on('delete_message', this.handleDeleteMessage.bind(this, socket));
    socket.on('edit_message', this.handleEditMessage.bind(this, socket));
    
    // File sharing
    socket.on('upload_file', this.handleFileUpload.bind(this, socket));
    
    // Offers and negotiations
    socket.on('send_offer', this.handleSendOffer.bind(this, socket));
    socket.on('respond_to_offer', this.handleRespondToOffer.bind(this, socket));
    
    // Activity tracking
    socket.on('user_activity', this.handleUserActivity.bind(this, socket));
    
    // Error handling
    socket.on('error', this.handleSocketError.bind(this, socket));
  }

  // ================================
  // CHAT MANAGEMENT
  // ================================

  /**
   * Handle user joining a chat
   */
  async handleJoinChat(socket, data) {
    try {
      if (!socket.user) {
        socket.emit('error', { message: 'Authentication required to join chat' });
        return;
      }

      const { chatId } = data;
      const userId = socket.user.id;

      // Verify user has access to this chat
      const hasAccess = await chatService.verifyUserChatAccess(userId, chatId);
      if (!hasAccess) {
        socket.emit('error', { message: 'Access denied to this chat' });
        return;
      }

      // Join the chat room
      socket.join(`chat:${chatId}`);

      // Track active users in chat
      if (!this.activeChats.has(chatId)) {
        this.activeChats.set(chatId, new Set());
      }
      this.activeChats.get(chatId).add(userId);

      // Get recent messages
      const messages = await messageService.getChatMessages({
        chatId,
        limit: 50,
        userId
      });

      // Send chat data to user
      socket.emit('chat_joined', {
        chatId,
        messages: messages.data,
        activeUsers: Array.from(this.activeChats.get(chatId))
      });

      // Notify other users in chat
      socket.to(`chat:${chatId}`).emit('user_joined_chat', {
        userId,
        username: socket.user.username,
        chatId
      });

      logger.info('User joined chat', { userId, chatId });

    } catch (error) {
      logger.error('Join chat failed:', error);
      socket.emit('error', { message: 'Failed to join chat' });
    }
  }

  /**
   * Handle user leaving a chat
   */
  async handleLeaveChat(socket, data) {
    try {
      const { chatId } = data;
      const userId = socket.user?.id;

      if (!userId) return;

      // Leave the chat room
      socket.leave(`chat:${chatId}`);

      // Remove from active users
      if (this.activeChats.has(chatId)) {
        this.activeChats.get(chatId).delete(userId);
      }

      // Remove from typing users
      if (this.typingUsers.has(chatId)) {
        this.typingUsers.get(chatId).delete(userId);
        socket.to(`chat:${chatId}`).emit('user_stopped_typing', { userId, chatId });
      }

      // Notify other users
      socket.to(`chat:${chatId}`).emit('user_left_chat', { userId, chatId });

      socket.emit('chat_left', { chatId });

      logger.info('User left chat', { userId, chatId });

    } catch (error) {
      logger.error('Leave chat failed:', error);
      socket.emit('error', { message: 'Failed to leave chat' });
    }
  }

  // ================================
  // MESSAGE HANDLING
  // ================================

  /**
   * Handle sending a message
   */
  async handleSendMessage(socket, data) {
    try {
      if (!socket.user) {
        socket.emit('error', { message: 'Authentication required to send messages' });
        return;
      }

      const {
        chatId,
        content,
        messageType = 'text',
        replyToId,
        attachments = []
      } = data;

      const userId = socket.user.id;

      // Verify user has access to chat
      const hasAccess = await chatService.verifyUserChatAccess(userId, chatId);
      if (!hasAccess) {
        socket.emit('error', { message: 'Access denied to this chat' });
        return;
      }

      // Create message
      const message = await messageService.createMessage({
        chatId,
        senderId: userId,
        content,
        messageType,
        replyToId,
        attachments
      });

      // Get full message data with sender info
      const fullMessage = await messageService.getMessageById(message.id);

      // Emit message to all users in chat
      this.io.to(`chat:${chatId}`).emit('new_message', {
        message: fullMessage,
        chatId
      });

      // Send push notifications to offline users
      const chatParticipants = await chatService.getChatParticipants(chatId);
      const offlineUsers = chatParticipants.filter(participant => 
        participant.id !== userId && !this.connectedUsers.has(participant.id)
      );

      for (const user of offlineUsers) {
        await notificationService.handleChatNotification({
          chatId,
          senderId: userId,
          recipientId: user.id,
          messagePreview: content.substring(0, 100),
          messageType
        });
      }

      // Update chat last activity
      await chatService.updateChatActivity(chatId);

      logger.info('Message sent', { 
        messageId: message.id, 
        chatId, 
        senderId: userId,
        messageType 
      });

    } catch (error) {
      logger.error('Send message failed:', error);
      socket.emit('error', { 
        message: 'Failed to send message',
        details: error.message 
      });
    }
  }

  /**
   * Handle message editing
   */
  async handleEditMessage(socket, data) {
    try {
      if (!socket.user) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }

      const { messageId, newContent } = data;
      const userId = socket.user.id;

      // Update message
      const updatedMessage = await messageService.editMessage({
        messageId,
        userId,
        newContent
      });

      // Emit update to chat participants
      const chatId = updatedMessage.chatId;
      this.io.to(`chat:${chatId}`).emit('message_edited', {
        messageId,
        newContent,
        editedAt: updatedMessage.editedAt,
        chatId
      });

      logger.info('Message edited', { messageId, userId });

    } catch (error) {
      logger.error('Edit message failed:', error);
      socket.emit('error', { message: 'Failed to edit message' });
    }
  }

  /**
   * Handle message deletion
   */
  async handleDeleteMessage(socket, data) {
    try {
      if (!socket.user) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }

      const { messageId } = data;
      const userId = socket.user.id;

      // Delete message
      const result = await messageService.deleteMessage({
        messageId,
        userId
      });

      // Emit deletion to chat participants
      const chatId = result.chatId;
      this.io.to(`chat:${chatId}`).emit('message_deleted', {
        messageId,
        chatId
      });

      logger.info('Message deleted', { messageId, userId });

    } catch (error) {
      logger.error('Delete message failed:', error);
      socket.emit('error', { message: 'Failed to delete message' });
    }
  }

  /**
   * Handle marking messages as read
   */
  async handleMarkMessagesRead(socket, data) {
    try {
      if (!socket.user) return;

      const { chatId, messageIds } = data;
      const userId = socket.user.id;

      await messageService.markMessagesAsRead({
        chatId,
        messageIds,
        userId
      });

      // Notify other participants about read status
      socket.to(`chat:${chatId}`).emit('messages_read', {
        chatId,
        messageIds,
        readBy: userId,
        readAt: new Date()
      });

    } catch (error) {
      logger.error('Mark messages read failed:', error);
    }
  }

  // ================================
  // TYPING INDICATORS
  // ================================

  /**
   * Handle user starting to type
   */
  handleStartTyping(socket, data) {
    if (!socket.user) return;

    const { chatId } = data;
    const userId = socket.user.id;

    // Add user to typing list
    if (!this.typingUsers.has(chatId)) {
      this.typingUsers.set(chatId, new Set());
    }
    this.typingUsers.get(chatId).add(userId);

    // Notify other users in chat
    socket.to(`chat:${chatId}`).emit('user_started_typing', {
      userId,
      username: socket.user.username,
      chatId
    });

    // Auto-stop typing after 10 seconds
    setTimeout(() => {
      if (this.typingUsers.has(chatId) && this.typingUsers.get(chatId).has(userId)) {
        this.handleStopTyping(socket, { chatId });
      }
    }, 10000);
  }

  /**
   * Handle user stopping typing
   */
  handleStopTyping(socket, data) {
    if (!socket.user) return;

    const { chatId } = data;
    const userId = socket.user.id;

    // Remove user from typing list
    if (this.typingUsers.has(chatId)) {
      this.typingUsers.get(chatId).delete(userId);
    }

    // Notify other users in chat
    socket.to(`chat:${chatId}`).emit('user_stopped_typing', {
      userId,
      chatId
    });
  }

  // ================================
  // OFFERS AND NEGOTIATIONS
  // ================================

  /**
   * Handle sending an offer
   */
  async handleSendOffer(socket, data) {
    try {
      if (!socket.user) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }

      const {
        chatId,
        amount,
        message,
        expiresIn = 24 // hours
      } = data;

      const userId = socket.user.id;

      // Create offer message
      const offer = await messageService.createOfferMessage({
        chatId,
        senderId: userId,
        amount,
        message,
        expiresIn
      });

      // Emit offer to chat participants
      this.io.to(`chat:${chatId}`).emit('new_offer', {
        offer,
        chatId
      });

      // Send notification to recipient
      const chatParticipants = await chatService.getChatParticipants(chatId);
      const recipient = chatParticipants.find(p => p.id !== userId);
      
      if (recipient) {
        await notificationService.createNotification({
          recipientId: recipient.id,
          title: 'New Offer Received',
          message: `You received an offer of $${amount}`,
          type: 'offer_received',
          data: { chatId, offerId: offer.id, amount }
        });
      }

      logger.info('Offer sent', { 
        offerId: offer.id, 
        chatId, 
        senderId: userId, 
        amount 
      });

    } catch (error) {
      logger.error('Send offer failed:', error);
      socket.emit('error', { message: 'Failed to send offer' });
    }
  }

  /**
   * Handle responding to an offer
   */
  async handleRespondToOffer(socket, data) {
    try {
      if (!socket.user) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }

      const {
        offerId,
        response, // 'accept', 'reject', 'counter'
        counterAmount,
        message
      } = data;

      const userId = socket.user.id;

      // Process offer response
      const result = await messageService.respondToOffer({
        offerId,
        userId,
        response,
        counterAmount,
        message
      });

      // Emit response to chat participants
      const chatId = result.chatId;
      this.io.to(`chat:${chatId}`).emit('offer_response', {
        offerId,
        response,
        counterAmount,
        message,
        chatId
      });

      // Send notification to offer sender
      await notificationService.createNotification({
        recipientId: result.originalSenderId,
        title: `Offer ${response}`,
        message: `Your offer was ${response}${counterAmount ? ` with counter offer of $${counterAmount}` : ''}`,
        type: `offer_${response}`,
        data: { chatId, offerId }
      });

      logger.info('Offer response sent', { 
        offerId, 
        response, 
        userId,
        counterAmount 
      });

    } catch (error) {
      logger.error('Respond to offer failed:', error);
      socket.emit('error', { message: 'Failed to respond to offer' });
    }
  }

  // ================================
  // FILE SHARING
  // ================================

  /**
   * Handle file upload in chat
   */
  async handleFileUpload(socket, data) {
    try {
      if (!socket.user) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }

      const {
        chatId,
        fileName,
        fileSize,
        fileType,
        fileData // Base64 encoded file data
      } = data;

      const userId = socket.user.id;

      // Verify file size and type
      if (fileSize > 10 * 1024 * 1024) { // 10MB limit
        socket.emit('error', { message: 'File too large. Maximum size is 10MB.' });
        return;
      }

      // Process file upload
      const fileMessage = await messageService.createFileMessage({
        chatId,
        senderId: userId,
        fileName,
        fileSize,
        fileType,
        fileData
      });

      // Emit file message to chat participants
      this.io.to(`chat:${chatId}`).emit('new_message', {
        message: fileMessage,
        chatId
      });

      logger.info('File uploaded in chat', { 
        chatId, 
        userId, 
        fileName, 
        fileSize 
      });

    } catch (error) {
      logger.error('File upload failed:', error);
      socket.emit('error', { message: 'Failed to upload file' });
    }
  }

  // ================================
  // USER ACTIVITY & PRESENCE
  // ================================

  /**
   * Handle user activity updates
   */
  handleUserActivity(socket, data) {
    if (!socket.user) return;

    const socketData = this.userSockets.get(socket.id);
    if (socketData) {
      socketData.lastActivity = new Date();
    }
  }

  /**
   * Broadcast user status to their contacts
   */
  async broadcastUserStatus(userId, status) {
    try {
      // Get user's active chats
      const userChats = await chatService.getUserActiveChats(userId);
      
      // Broadcast status to all chat rooms user is part of
      userChats.forEach(chat => {
        this.io.to(`chat:${chat.id}`).emit('user_status_changed', {
          userId,
          status,
          timestamp: new Date()
        });
      });

    } catch (error) {
      logger.error('Broadcast user status failed:', error);
    }
  }

  // ================================
  // ERROR HANDLING
  // ================================

  /**
   * Handle socket errors
   */
  handleSocketError(socket, error) {
    logger.error('Socket error:', {
      socketId: socket.id,
      userId: socket.user?.id,
      error: error.message
    });

    socket.emit('error', {
      message: 'An error occurred',
      code: error.code || 'UNKNOWN_ERROR'
    });
  }

  // ================================
  // UTILITY METHODS
  // ================================

  /**
   * Setup heartbeat to monitor connection health
   */
  setupHeartbeat() {
    setInterval(() => {
      this.io.emit('ping');
    }, 30000); // 30 seconds

    this.io.on('connection', (socket) => {
      socket.on('pong', () => {
        const socketData = this.userSockets.get(socket.id);
        if (socketData) {
          socketData.lastActivity = new Date();
        }
      });
    });
  }

  /**
   * Emit event to specific user
   */
  emitToUser(userId, event, data) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
      return true;
    }
    return false;
  }

  /**
   * Emit event to chat room
   */
  emitToChat(chatId, event, data) {
    this.io.to(`chat:${chatId}`).emit(event, data);
  }

  /**
   * Get online users count
   */
  getOnlineUsersCount() {
    return this.connectedUsers.size;
  }

  /**
   * Get users in specific chat
   */
  getChatUsers(chatId) {
    return Array.from(this.activeChats.get(chatId) || []);
  }

  /**
   * Check if user is online
   */
  isUserOnline(userId) {
    return this.connectedUsers.has(userId);
  }
}

module.exports = SocketChatSystem;