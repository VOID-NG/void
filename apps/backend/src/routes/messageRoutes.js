// apps/backend/src/routes/messageRoutes.js
// Message management routes for chat system

const express = require('express');
const { authenticateToken } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validateMiddleware');
const logger = require('../utils/logger');

const router = express.Router();

// All message routes require authentication
router.use(authenticateToken);

// ================================
// MESSAGE ROUTES
// ================================

/**
 * @route   GET /api/v1/messages/:chatId
 * @desc    Get messages for a specific chat
 * @access  Private
 */
router.get('/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const { prisma } = require('../config/db');

    // Verify user has access to this chat
    const chat = await prisma.chat.findUnique({
      where: { id: chatId }
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Chat not found'
      });
    }

    if (chat.buyer_id !== req.user.id && chat.vendor_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Get messages
    const messages = await prisma.message.findMany({
      where: { chat_id: chatId },
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
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    });

    // Mark messages as read
    await prisma.message.updateMany({
      where: {
        chat_id: chatId,
        sender_id: { not: req.user.id },
        read_at: null
      },
      data: {
        read_at: new Date()
      }
    });

    // Reverse to show oldest first
    const sortedMessages = messages.reverse();

    res.json({
      success: true,
      data: {
        messages: sortedMessages,
        chat_id: chatId,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: messages.length
        }
      }
    });

  } catch (error) {
    logger.error('Get messages failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get messages',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/v1/messages
 * @desc    Send a new message
 * @access  Private
 */
router.post('/', async (req, res) => {
  try {
    const { 
      chat_id, 
      content, 
      message_type = 'TEXT',
      offer_amount,
      metadata 
    } = req.body;
    const { prisma } = require('../config/db');

    // Validate message type
    const validTypes = ['TEXT', 'IMAGE', 'OFFER', 'COUNTER_OFFER', 'OFFER_ACCEPTED', 'OFFER_REJECTED'];
    if (!validTypes.includes(message_type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid message type',
        valid_types: validTypes
      });
    }

    // Verify chat exists and user has access
    const chat = await prisma.chat.findUnique({
      where: { id: chat_id },
      include: {
        buyer: true,
        vendor: true,
        listing: true
      }
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Chat not found'
      });
    }

    if (chat.buyer_id !== req.user.id && chat.vendor_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Validate content based on message type
    if (['TEXT', 'IMAGE'].includes(message_type) && !content) {
      return res.status(400).json({
        success: false,
        error: 'Content is required for text and image messages'
      });
    }

    if (['OFFER', 'COUNTER_OFFER'].includes(message_type) && !offer_amount) {
      return res.status(400).json({
        success: false,
        error: 'Offer amount is required for offer messages'
      });
    }

    // Create message
    const messageData = {
      chat_id,
      sender_id: req.user.id,
      content: content || '',
      message_type,
      metadata: metadata ? JSON.stringify(metadata) : null
    };

    // Add offer amount if it's an offer
    if (offer_amount) {
      messageData.metadata = JSON.stringify({
        ...JSON.parse(messageData.metadata || '{}'),
        offer_amount: parseFloat(offer_amount)
      });
    }

    const newMessage = await prisma.message.create({
      data: messageData,
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

    // Update chat timestamp
    await prisma.chat.update({
      where: { id: chat_id },
      data: { updated_at: new Date() }
    });

    // Determine recipient
    const recipientId = chat.buyer_id === req.user.id ? chat.vendor_id : chat.buyer_id;

    // Emit real-time message
    const io = req.app.get('io');
    if (io) {
      io.to(`chat_${chat_id}`).emit('new_message', {
        message: newMessage,
        chat_id
      });

      // Send notification to recipient
      io.to(`user_${recipientId}`).emit('message_notification', {
        chat_id,
        sender: newMessage.sender,
        message_type,
        preview: message_type === 'TEXT' ? content.substring(0, 50) : `Sent a ${message_type.toLowerCase()}`
      });
    }

    res.status(201).json({
      success: true,
      data: { message: newMessage },
      message: 'Message sent successfully'
    });

  } catch (error) {
    logger.error('Send message failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message',
      message: error.message
    });
  }
});

/**
 * @route   PUT /api/v1/messages/:messageId
 * @desc    Update a message (edit content, mark as read, etc.)
 * @access  Private
 */
router.put('/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content, read_at } = req.body;
    const { prisma } = require('../config/db');

    // Find message
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { chat: true }
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    // Check permissions
    const canEdit = message.sender_id === req.user.id;
    const canMarkRead = message.chat.buyer_id === req.user.id || message.chat.vendor_id === req.user.id;

    if (content && !canEdit) {
      return res.status(403).json({
        success: false,
        error: 'Cannot edit messages from other users'
      });
    }

    if (read_at && !canMarkRead) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Update message
    const updateData = {};
    if (content && canEdit) {
      updateData.content = content;
      updateData.edited_at = new Date();
    }
    if (read_at && canMarkRead) {
      updateData.read_at = new Date();
    }

    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: updateData,
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

    // Emit real-time update if content was edited
    if (content) {
      const io = req.app.get('io');
      if (io) {
        io.to(`chat_${message.chat_id}`).emit('message_updated', {
          message: updatedMessage
        });
      }
    }

    res.json({
      success: true,
      data: { message: updatedMessage },
      message: 'Message updated successfully'
    });

  } catch (error) {
    logger.error('Update message failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update message',
      message: error.message
    });
  }
});

/**
 * @route   DELETE /api/v1/messages/:messageId
 * @desc    Delete a message
 * @access  Private
 */
router.delete('/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { prisma } = require('../config/db');

    // Find message
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { chat: true }
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    // Only sender can delete their own messages
    if (message.sender_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Can only delete your own messages'
      });
    }

    // Soft delete - mark as deleted instead of removing
    await prisma.message.update({
      where: { id: messageId },
      data: {
        content: '[Message deleted]',
        deleted_at: new Date()
      }
    });

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`chat_${message.chat_id}`).emit('message_deleted', {
        message_id: messageId
      });
    }

    res.json({
      success: true,
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
});

/**
 * @route   POST /api/v1/messages/mark-read
 * @desc    Mark multiple messages as read
 * @access  Private
 */
router.post('/mark-read', async (req, res) => {
  try {
    const { chat_id, message_ids } = req.body;
    const { prisma } = require('../config/db');

    // Verify chat access
    const chat = await prisma.chat.findUnique({
      where: { id: chat_id }
    });

    if (!chat || (chat.buyer_id !== req.user.id && chat.vendor_id !== req.user.id)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Mark messages as read
    const whereClause = {
      chat_id,
      sender_id: { not: req.user.id },
      read_at: null
    };

    if (message_ids && Array.isArray(message_ids)) {
      whereClause.id = { in: message_ids };
    }

    const result = await prisma.message.updateMany({
      where: whereClause,
      data: {
        read_at: new Date()
      }
    });

    res.json({
      success: true,
      data: {
        messages_marked: result.count
      },
      message: 'Messages marked as read'
    });

  } catch (error) {
    logger.error('Mark messages read failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark messages as read',
      message: error.message
    });
  }
});

module.exports = router;