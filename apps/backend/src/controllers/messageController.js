// apps/backend/src/controllers/messageController.js
// Message controller for real-time messaging

const {
    sendMessageRealtime,
    handleTypingIndicator,
    markMessagesAsRead
  } = require('../services/messageService');
  
  const {
    getChatMessages,
    createMessage
  } = require('../services/chatService');
  
  const logger = require('../utils/logger');
  const { ValidationError } = require('../middleware/errorMiddleware');
  
  // ================================
  // MESSAGE SENDING ENDPOINTS
  // ================================
  
  /**
   * @route   POST /api/v1/messages
   * @desc    Send a message in a chat
   * @access  Private
   * @body    { chat_id, content, message_type?, metadata? }
   */
  const sendMessageEndpoint = async (req, res) => {
    try {
      const {
        chat_id,
        content,
        message_type = 'TEXT',
        metadata
      } = req.body;
      const senderId = req.user.id;
  
      // Validation
      if (!chat_id) {
        throw new ValidationError('Chat ID is required');
      }
  
      // Validate message type
      const validTypes = ['TEXT', 'IMAGE'];
      if (!validTypes.includes(message_type)) {
        throw new ValidationError('Invalid message type', {
          valid_types: validTypes
        });
      }
  
      // Validate content based on type
      if (message_type === 'TEXT' && (!content || content.trim() === '')) {
        throw new ValidationError('Content is required for text messages');
      }
  
      if (message_type === 'IMAGE' && !content) {
        throw new ValidationError('Image URL is required for image messages');
      }
  
      // Get chat to determine recipient
      const { dbRouter, QueryOptimizer } = require('../config/db');
      const chat = await dbRouter.chat.findUnique({
        where: { id: chat_id },
        select: {
          id: true,
          buyer_id: true,
          vendor_id: true,
          status: true
        }
      });
  
      if (!chat) {
        return res.status(404).json({
          success: false,
          error: 'Chat not found'
        });
      }
  
      if (chat.status !== 'ACTIVE') {
        return res.status(400).json({
          success: false,
          error: 'Cannot send messages to inactive chat'
        });
      }
  
      // Verify user has access
      if (chat.buyer_id !== senderId && chat.vendor_id !== senderId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this chat'
        });
      }
  
      // Determine recipient
      const recipientId = chat.buyer_id === senderId ? chat.vendor_id : chat.buyer_id;
  
      // Get Socket.IO instance
      const io = req.app.get('io');
  
      // Send message with real-time updates
      const result = await sendMessageRealtime({
        chatId: chat_id,
        senderId,
        recipientId,
        content: content?.trim(),
        messageType: message_type,
        metadata
      }, io);
  
      res.status(201).json({
        success: true,
        data: {
          message: result.message,
          chat_id: chat_id,
          real_time_sent: result.realtime_sent
        },
        message: 'Message sent successfully'
      });
  
    } catch (error) {
      logger.error('Send message failed:', error);
      
      if (error.message.includes('required') || error.message.includes('Invalid')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
  
      if (error.message.includes('Access denied')) {
        return res.status(403).json({
          success: false,
          error: error.message
        });
      }
  
      res.status(500).json({
        success: false,
        error: 'Failed to send message',
        message: error.message
      });
    }
  };
  
  // ================================
  // MESSAGE RETRIEVAL ENDPOINTS
  // ================================
  
  /**
   * @route   GET /api/v1/messages/:chatId
   * @desc    Get messages for a specific chat
   * @access  Private
   * @query   { page?, limit?, before_message_id? }
   */
  const getMessagesEndpoint = async (req, res) => {
    try {
      const { chatId } = req.params;
      const {
        page = 1,
        limit = 50,
        before_message_id
      } = req.query;
      const userId = req.user.id;
  
      if (!chatId) {
        throw new ValidationError('Chat ID is required');
      }
  
      // Get messages
      const messages = await getChatMessages(chatId, userId, {
        page: parseInt(page),
        limit: parseInt(limit),
        beforeMessageId: before_message_id
      });
  
      res.json({
        success: true,
        data: {
          messages,
          chat_id: chatId,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            message_count: messages.length,
            has_more: messages.length === parseInt(limit)
          }
        }
      });
  
    } catch (error) {
      logger.error('Get messages failed:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Chat not found'
        });
      }
  
      if (error.message.includes('Access denied')) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this chat'
        });
      }
  
      res.status(500).json({
        success: false,
        error: 'Failed to get messages',
        message: error.message
      });
    }
  };
  
  // ================================
  // REAL-TIME INTERACTION ENDPOINTS
  // ================================
  
  /**
   * @route   POST /api/v1/messages/:chatId/typing
   * @desc    Send typing indicator
   * @access  Private
   * @body    { is_typing }
   */
  const sendTypingIndicatorEndpoint = async (req, res) => {
    try {
      const { chatId } = req.params;
      const { is_typing } = req.body;
      const userId = req.user.id;
  
      if (!chatId) {
        throw new ValidationError('Chat ID is required');
      }
  
      if (typeof is_typing !== 'boolean') {
        throw new ValidationError('is_typing must be a boolean');
      }
  
      // Verify user has access to chat
      const { dbRouter, QueryOptimizer } = require('../config/db');
      const chat = await dbRouter.chat.findUnique({
        where: { id: chatId },
        select: {
          buyer_id: true,
          vendor_id: true,
          status: true
        }
      });
  
      if (!chat) {
        return res.status(404).json({
          success: false,
          error: 'Chat not found'
        });
      }
  
      if (chat.buyer_id !== userId && chat.vendor_id !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this chat'
        });
      }
  
      // Get Socket.IO instance
      const io = req.app.get('io');
  
      // Send typing indicator
      handleTypingIndicator(chatId, userId, is_typing, io);
  
      res.json({
        success: true,
        data: {
          chat_id: chatId,
          user_id: userId,
          is_typing
        },
        message: 'Typing indicator sent'
      });
  
    } catch (error) {
      logger.error('Send typing indicator failed:', error);
      
      if (error.message.includes('required') || error.message.includes('boolean')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
  
      res.status(500).json({
        success: false,
        error: 'Failed to send typing indicator',
        message: error.message
      });
    }
  };
  
  /**
   * @route   POST /api/v1/messages/:chatId/read
   * @desc    Mark messages as read
   * @access  Private
   * @body    { message_ids }
   */
  const markMessagesAsReadEndpoint = async (req, res) => {
    try {
      const { chatId } = req.params;
      const { message_ids } = req.body;
      const userId = req.user.id;
  
      if (!chatId) {
        throw new ValidationError('Chat ID is required');
      }
  
      if (!Array.isArray(message_ids) || message_ids.length === 0) {
        throw new ValidationError('message_ids must be a non-empty array');
      }
  
      // Get Socket.IO instance
      const io = req.app.get('io');
  
      // Mark messages as read
      const result = await markMessagesAsRead(chatId, userId, message_ids, io);
  
      res.json({
        success: true,
        data: {
          chat_id: chatId,
          messages_read: result.messagesRead,
          message_ids: message_ids
        },
        message: `${result.messagesRead} messages marked as read`
      });
  
    } catch (error) {
      logger.error('Mark messages as read failed:', error);
      
      if (error.message.includes('required') || error.message.includes('array')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
  
      res.status(500).json({
        success: false,
        error: 'Failed to mark messages as read',
        message: error.message
      });
    }
  };
  
  // ================================
  // MESSAGE MANAGEMENT ENDPOINTS
  // ================================
  
  /**
   * @route   DELETE /api/v1/messages/:messageId
   * @desc    Delete a message (soft delete)
   * @access  Private
   */
  const deleteMessageEndpoint = async (req, res) => {
    try {
      const { messageId } = req.params;
      const userId = req.user.id;
  
      if (!messageId) {
        throw new ValidationError('Message ID is required');
      }
  
      const { dbRouter, QueryOptimizer } = require('../config/db');
  
      // Get message to verify ownership
      const message = await dbRouter.message.findUnique({
        where: { id: messageId },
        include: {
          chat: {
            select: {
              id: true,
              buyer_id: true,
              vendor_id: true
            }
          }
        }
      });
  
      if (!message) {
        return res.status(404).json({
          success: false,
          error: 'Message not found'
        });
      }
  
      // Verify user can delete this message
      if (message.sender_id !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Can only delete your own messages'
        });
      }
  
      // Soft delete the message
      const deletedMessage = await dbRouter.message.update({
        where: { id: messageId },
        data: {
          content: '[Message deleted]',
          metadata: JSON.stringify({
            deleted: true,
            deleted_at: new Date().toISOString(),
            deleted_by: userId,
            original_type: message.type
          }),
          type: 'TEXT'
        }
      });
  
      // Send real-time update
      const io = req.app.get('io');
      if (io) {
        io.to(`chat_${message.chat.id}`).emit('message_deleted', {
          message_id: messageId,
          chat_id: message.chat.id,
          deleted_by: userId,
          timestamp: new Date().toISOString()
        });
      }
  
      res.json({
        success: true,
        data: {
          message_id: messageId,
          deleted: true
        },
        message: 'Message deleted successfully'
      });
  
    } catch (error) {
      logger.error('Delete message failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete message',
        message: error.message
      });
    }
  };
  
  /**
   * @route   PUT /api/v1/messages/:messageId
   * @desc    Edit a message
   * @access  Private
   * @body    { content }
   */
  const editMessageEndpoint = async (req, res) => {
    try {
      const { messageId } = req.params;
      const { content } = req.body;
      const userId = req.user.id;
  
      if (!messageId) {
        throw new ValidationError('Message ID is required');
      }
  
      if (!content || content.trim() === '') {
        throw new ValidationError('Content is required');
      }
  
      const { dbRouter, QueryOptimizer } = require('../config/db');
  
      // Get message to verify ownership
      const message = await dbRouter.message.findUnique({
        where: { id: messageId },
        include: {
          chat: {
            select: {
              id: true,
              buyer_id: true,
              vendor_id: true
            }
          }
        }
      });
  
      if (!message) {
        return res.status(404).json({
          success: false,
          error: 'Message not found'
        });
      }
  
      // Verify user can edit this message
      if (message.sender_id !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Can only edit your own messages'
        });
      }
  
      // Only allow editing text messages
      if (message.type !== 'TEXT') {
        return res.status(400).json({
          success: false,
          error: 'Can only edit text messages'
        });
      }
  
      // Check if message is too old to edit (5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (message.created_at < fiveMinutesAgo) {
        return res.status(400).json({
          success: false,
          error: 'Cannot edit messages older than 5 minutes'
        });
      }
  
      // Update the message
      const updatedMessage = await dbRouter.message.update({
        where: { id: messageId },
        data: {
          content: content.trim(),
          metadata: JSON.stringify({
            edited: true,
            edited_at: new Date().toISOString(),
            original_content: message.content
          }),
          updated_at: new Date()
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
          }
        }
      });
  
      // Send real-time update
      const io = req.app.get('io');
      if (io) {
        io.to(`chat_${message.chat.id}`).emit('message_edited', {
          message: updatedMessage,
          chat_id: message.chat.id,
          edited_by: userId,
          timestamp: new Date().toISOString()
        });
      }
  
      res.json({
        success: true,
        data: {
          message: updatedMessage
        },
        message: 'Message edited successfully'
      });
  
    } catch (error) {
      logger.error('Edit message failed:', error);
      
      if (error.message.includes('required')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
  
      res.status(500).json({
        success: false,
        error: 'Failed to edit message',
        message: error.message
      });
    }
  };
  
  module.exports = {
    // Message sending
    sendMessageEndpoint,
    
    // Message retrieval
    getMessagesEndpoint,
    
    // Real-time interactions
    sendTypingIndicatorEndpoint,
    markMessagesAsReadEndpoint,
    
    // Message management
    deleteMessageEndpoint,
    editMessageEndpoint
  };