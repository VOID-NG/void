// apps/backend/src/routes/chatRoutes.js
// Chat and conversation management routes

const express = require('express');
const { authenticateToken } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validateMiddleware');
const logger = require('../utils/logger');

const router = express.Router();

// All chat routes require authentication
router.use(authenticateToken);

// ================================
// CHAT THREAD ROUTES
// ================================

/**
 * @route   GET /api/v1/chat
 * @desc    Get user's chat threads
 * @access  Private
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'ACTIVE' } = req.query;
    const { prisma } = require('../config/db');

    const chats = await prisma.chat.findMany({
      where: {
        OR: [
          { buyer_id: req.user.id },
          { vendor_id: req.user.id }
        ],
        status: status.toUpperCase()
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
            avatar_url: true
          }
        },
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            images: {
              where: { is_primary: true },
              take: 1
            }
          }
        },
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: {
            id: true,
            content: true,
            message_type: true,
            created_at: true,
            sender_id: true
          }
        }
      },
      orderBy: {
        updated_at: 'desc'
      },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    });

    // Add unread message count
    const chatsWithUnread = await Promise.all(
      chats.map(async (chat) => {
        const unreadCount = await prisma.message.count({
          where: {
            chat_id: chat.id,
            sender_id: { not: req.user.id },
            read_at: null
          }
        });

        return {
          ...chat,
          unread_messages: unreadCount,
          last_message: chat.messages[0] || null
        };
      })
    );

    res.json({
      success: true,
      data: {
        chats: chatsWithUnread,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: chatsWithUnread.length
        }
      }
    });

  } catch (error) {
    logger.error('Get chats failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get chats',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/v1/chat
 * @desc    Start a new chat thread
 * @access  Private
 */
router.post('/', async (req, res) => {
  try {
    const { listing_id, initial_message } = req.body;
    const { prisma } = require('../config/db');

    // Validate listing exists
    const listing = await prisma.listing.findUnique({
      where: { id: listing_id },
      include: { vendor: true }
    });

    if (!listing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    // Prevent vendor from starting chat with themselves
    if (listing.vendor_id === req.user.id) {
      return res.status(400).json({
        success: false,
        error: 'Cannot start chat with your own listing'
      });
    }

    // Check if chat already exists
    const existingChat = await prisma.chat.findFirst({
      where: {
        listing_id,
        buyer_id: req.user.id,
        vendor_id: listing.vendor_id
      }
    });

    if (existingChat) {
      return res.status(409).json({
        success: false,
        error: 'Chat already exists',
        data: { chat_id: existingChat.id }
      });
    }

    // Create new chat
    const newChat = await prisma.chat.create({
      data: {
        listing_id,
        buyer_id: req.user.id,
        vendor_id: listing.vendor_id,
        status: 'ACTIVE'
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
            avatar_url: true
          }
        },
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            images: {
              where: { is_primary: true },
              take: 1
            }
          }
        }
      }
    });

    // Send initial message if provided
    if (initial_message) {
      await prisma.message.create({
        data: {
          chat_id: newChat.id,
          sender_id: req.user.id,
          content: initial_message,
          message_type: 'TEXT'
        }
      });
    }

    // Emit socket event for real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${listing.vendor_id}`).emit('new_chat', {
        chat: newChat,
        initial_message
      });
    }

    res.status(201).json({
      success: true,
      data: { chat: newChat },
      message: 'Chat created successfully'
    });

  } catch (error) {
    logger.error('Create chat failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create chat',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/v1/chat/:chatId
 * @desc    Get specific chat details
 * @access  Private
 */
router.get('/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { prisma } = require('../config/db');

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
            avatar_url: true
          }
        },
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            status: true,
            images: {
              where: { is_primary: true },
              take: 1
            }
          }
        }
      }
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Chat not found'
      });
    }

    // Verify user is part of this chat
    if (chat.buyer_id !== req.user.id && chat.vendor_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: { chat }
    });

  } catch (error) {
    logger.error('Get chat details failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get chat details',
      message: error.message
    });
  }
});

/**
 * @route   PATCH /api/v1/chat/:chatId
 * @desc    Update chat status (archive, block, etc.)
 * @access  Private
 */
router.patch('/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { status } = req.body;
    const { prisma } = require('../config/db');

    // Validate status
    const validStatuses = ['ACTIVE', 'ARCHIVED', 'BLOCKED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status',
        valid_statuses: validStatuses
      });
    }

    // Find chat and verify ownership
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

    // Update chat status
    const updatedChat = await prisma.chat.update({
      where: { id: chatId },
      data: { 
        status,
        updated_at: new Date()
      }
    });

    res.json({
      success: true,
      data: { chat: updatedChat },
      message: `Chat ${status.toLowerCase()} successfully`
    });

  } catch (error) {
    logger.error('Update chat status failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update chat status',
      message: error.message
    });
  }
});

module.exports = router;