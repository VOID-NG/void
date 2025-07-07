// apps/backend/src/controllers/listingController.js
// Listing controller for VOID Marketplace HTTP endpoints

const listingService = require('../services/listingService');
const { asyncHandler } = require('../middleware/errorMiddleware');
const { API_CONFIG } = require('../config/constants');
const logger = require('../utils/logger');

// ================================
// LISTING CREATION
// ================================

/**
 * @desc    Create new listing with media upload
 * @route   POST /api/v1/listings
 * @access  Private (Vendors only)
 */
const createListing = asyncHandler(async (req, res) => {
  // Files are available from upload middleware
  const files = req.files ? Object.values(req.files).flat() : [];
  
  // Create listing
  const listing = await listingService.createListing(req.body, req.user, files);

  res.status(201).json({
    success: true,
    message: 'Listing created successfully',
    data: { listing }
  });

  // Log the creation
  logger.info('Listing created via API', {
    listingId: listing.id,
    vendorId: req.user.id,
    title: listing.title,
    mediaCount: files.length,
    ip: req.ip
  });
});

/**
 * @desc    Create draft listing
 * @route   POST /api/v1/listings/draft
 * @access  Private (Vendors only)
 */
const createDraftListing = asyncHandler(async (req, res) => {
  const files = req.files ? Object.values(req.files).flat() : [];
  
  // Set status to draft
  const listingData = { ...req.body, status: 'DRAFT' };
  
  const listing = await listingService.createListing(listingData, req.user, files);

  res.status(201).json({
    success: true,
    message: 'Draft listing saved successfully',
    data: { listing }
  });
});

// ================================
// LISTING RETRIEVAL
// ================================

/**
 * @desc    Get all listings with filters and pagination
 * @route   GET /api/v1/listings
 * @access  Public
 */
const getListings = asyncHandler(async (req, res) => {
  const filters = {
    search: req.query.search,
    category_id: req.query.category,
    vendor_id: req.query.vendor,
    condition: req.query.condition,
    min_price: req.query.minPrice,
    max_price: req.query.maxPrice,
    location: req.query.location,
    is_negotiable: req.query.negotiable,
    is_featured: req.query.featured,
    tags: req.query.tags
  };

  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: Math.min(parseInt(req.query.limit) || API_CONFIG.DEFAULT_PAGE_SIZE, API_CONFIG.MAX_PAGE_SIZE),
    sort_by: req.query.sortBy || 'created_at',
    sort_order: req.query.sortOrder || 'desc'
  };

  const result = await listingService.getListings(filters, pagination, req.user);

  res.json({
    success: true,
    data: result
  });
});

/**
 * @desc    Get single listing by ID
 * @route   GET /api/v1/listings/:id
 * @access  Public
 */
const getListingById = asyncHandler(async (req, res) => {
  const listing = await listingService.getListingById(req.params.id, req.user);

  res.json({
    success: true,
    data: { listing }
  });
});

/**
 * @desc    Get vendor's own listings
 * @route   GET /api/v1/listings/my
 * @access  Private (Vendors only)
 */
const getMyListings = asyncHandler(async (req, res) => {
  const filters = {
    vendor_id: req.user.id,
    status: req.query.status,
    search: req.query.search
  };

  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: Math.min(parseInt(req.query.limit) || API_CONFIG.DEFAULT_PAGE_SIZE, API_CONFIG.MAX_PAGE_SIZE),
    sort_by: req.query.sortBy || 'updated_at',
    sort_order: req.query.sortOrder || 'desc'
  };

  const result = await listingService.getListings(filters, pagination, req.user);

  res.json({
    success: true,
    data: result
  });
});

/**
 * @desc    Get trending/featured listings
 * @route   GET /api/v1/listings/trending
 * @access  Public
 */
const getTrendingListings = asyncHandler(async (req, res) => {
  const filters = {
    is_featured: true
  };

  const pagination = {
    page: 1,
    limit: parseInt(req.query.limit) || 20,
    sort_by: 'views_count',
    sort_order: 'desc'
  };

  const result = await listingService.getListings(filters, pagination, req.user);

  res.json({
    success: true,
    data: {
      listings: result.listings,
      total: result.pagination.total
    }
  });
});

/**
 * @desc    Get recent listings
 * @route   GET /api/v1/listings/recent
 * @access  Public
 */
const getRecentListings = asyncHandler(async (req, res) => {
  const filters = {};

  const pagination = {
    page: 1,
    limit: parseInt(req.query.limit) || 20,
    sort_by: 'created_at',
    sort_order: 'desc'
  };

  const result = await listingService.getListings(filters, pagination, req.user);

  res.json({
    success: true,
    data: {
      listings: result.listings,
      total: result.pagination.total
    }
  });
});

// ================================
// LISTING UPDATES
// ================================

/**
 * @desc    Update listing
 * @route   PUT /api/v1/listings/:id
 * @access  Private (Owner or Admin)
 */
const updateListing = asyncHandler(async (req, res) => {
  const files = req.files ? Object.values(req.files).flat() : [];
  
  const listing = await listingService.updateListing(
    req.params.id,
    req.body,
    req.user,
    files
  );

  res.json({
    success: true,
    message: 'Listing updated successfully',
    data: { listing }
  });

  logger.info('Listing updated via API', {
    listingId: req.params.id,
    vendorId: req.user.id,
    updatedFields: Object.keys(req.body),
    ip: req.ip
  });
});

/**
 * @desc    Update listing status (admin only)
 * @route   PATCH /api/v1/listings/:id/status
 * @access  Private (Admin only)
 */
const updateListingStatus = asyncHandler(async (req, res) => {
  const { status, reason } = req.body;
  
  const listing = await listingService.updateListingStatus(
    req.params.id,
    status,
    req.user,
    reason
  );

  res.json({
    success: true,
    message: `Listing status updated to ${status}`,
    data: { listing }
  });

  logger.info('Listing status updated by admin', {
    listingId: req.params.id,
    adminId: req.user.id,
    newStatus: status,
    reason,
    ip: req.ip
  });
});

/**
 * @desc    Toggle listing featured status (admin only)
 * @route   PATCH /api/v1/listings/:id/feature
 * @access  Private (Admin only)
 */
const toggleFeaturedStatus = asyncHandler(async (req, res) => {
  const { is_featured } = req.body;
  
  const listing = await listingService.updateListing(
    req.params.id,
    { is_featured: Boolean(is_featured) },
    req.user
  );

  res.json({
    success: true,
    message: `Listing ${is_featured ? 'featured' : 'unfeatured'} successfully`,
    data: { listing }
  });
});

// ================================
// LISTING DELETION
// ================================

/**
 * @desc    Delete listing
 * @route   DELETE /api/v1/listings/:id
 * @access  Private (Owner or Admin)
 */
const deleteListing = asyncHandler(async (req, res) => {
  await listingService.deleteListing(req.params.id, req.user);

  res.json({
    success: true,
    message: 'Listing deleted successfully'
  });

  logger.info('Listing deleted via API', {
    listingId: req.params.id,
    userId: req.user.id,
    userRole: req.user.role,
    ip: req.ip
  });
});

// ================================
// LISTING MEDIA MANAGEMENT
// ================================

/**
 * @desc    Add media to existing listing
 * @route   POST /api/v1/listings/:id/media
 * @access  Private (Owner only)
 */
const addListingMedia = asyncHandler(async (req, res) => {
  const files = req.files ? Object.values(req.files).flat() : [];
  
  if (!files || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No files provided',
      message: 'Please select files to upload'
    });
  }

  const listing = await listingService.updateListing(
    req.params.id,
    {}, // No text updates, just media
    req.user,
    files
  );

  res.json({
    success: true,
    message: `${files.length} media file(s) added successfully`,
    data: { 
      listing,
      addedFiles: files.length
    }
  });
});

/**
 * @desc    Remove media from listing
 * @route   DELETE /api/v1/listings/:id/media/:mediaId
 * @access  Private (Owner only)
 */
const removeListingMedia = asyncHandler(async (req, res) => {
  const { id: listingId, mediaId } = req.params;
  const { type } = req.query; // 'image', 'video', or 'model'

  // Get listing to verify ownership
  const listing = await listingService.getListingById(listingId, req.user);
  
  if (!listing.can_edit) {
    return res.status(403).json({
      success: false,
      error: 'Access denied',
      message: 'You can only edit your own listings'
    });
  }

  const { prisma } = require('../config/db');
  
  let deletedMedia = null;
  
  switch (type) {
    case 'image':
      deletedMedia = await prisma.listingImage.delete({
        where: { 
          id: mediaId,
          listing_id: listingId 
        }
      });
      break;
    case 'video':
      deletedMedia = await prisma.listingVideo.delete({
        where: { 
          id: mediaId,
          listing_id: listingId 
        }
      });
      break;
    case 'model':
      deletedMedia = await prisma.listing3DModel.delete({
        where: { 
          id: mediaId,
          listing_id: listingId 
        }
      });
      break;
    default:
      return res.status(400).json({
        success: false,
        error: 'Invalid media type',
        message: 'Type must be image, video, or model'
      });
  }

  // Clean up physical file
  const { deleteFile } = require('../middleware/uploadMiddleware');
  if (deletedMedia.url) {
    deleteFile(deletedMedia.url.replace('/uploads/', 'uploads/')).catch(error => {
      logger.error('Failed to delete media file:', error);
    });
  }

  res.json({
    success: true,
    message: 'Media removed successfully'
  });

  logger.info('Media removed from listing', {
    listingId,
    mediaId,
    mediaType: type,
    userId: req.user.id
  });
});

// ================================
// LISTING INTERACTIONS
// ================================

/**
 * @desc    Like/Unlike listing
 * @route   POST /api/v1/listings/:id/like
 * @access  Private
 */
const toggleListingLike = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/db');
  const listingId = req.params.id;
  const userId = req.user.id;

  // Check if already liked
  const existingLike = await prisma.userInteraction.findFirst({
    where: {
      user_id: userId,
      listing_id: listingId,
      interaction_type: 'LIKE'
    }
  });

  if (existingLike) {
    // Unlike - remove interaction
    await prisma.$transaction([
      prisma.userInteraction.delete({
        where: { id: existingLike.id }
      }),
      prisma.listing.update({
        where: { id: listingId },
        data: { likes_count: { decrement: 1 } }
      })
    ]);

    res.json({
      success: true,
      message: 'Listing unliked',
      data: { liked: false }
    });
  } else {
    // Like - add interaction
    await prisma.$transaction([
      prisma.userInteraction.create({
        data: {
          user_id: userId,
          listing_id: listingId,
          interaction_type: 'LIKE'
        }
      }),
      prisma.listing.update({
        where: { id: listingId },
        data: { likes_count: { increment: 1 } }
      })
    ]);

    res.json({
      success: true,
      message: 'Listing liked',
      data: { liked: true }
    });
  }
});

/**
 * @desc    Share listing (track interaction)
 * @route   POST /api/v1/listings/:id/share
 * @access  Private
 */
const shareListing = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/db');
  const { platform, method } = req.body; // e.g., 'social', 'email', 'copy_link'

  // Track share interaction
  await prisma.userInteraction.create({
    data: {
      user_id: req.user.id,
      listing_id: req.params.id,
      interaction_type: 'SHARE',
      metadata: JSON.stringify({ platform, method })
    }
  });

  res.json({
    success: true,
    message: 'Share tracked successfully',
    data: {
      shareUrl: `${process.env.FRONTEND_URL}/listings/${req.params.id}`,
      platform,
      method
    }
  });
});

// ================================
// LISTING STATISTICS
// ================================

/**
 * @desc    Get listing analytics (owner/admin only)
 * @route   GET /api/v1/listings/:id/analytics
 * @access  Private (Owner or Admin)
 */
const getListingAnalytics = asyncHandler(async (req, res) => {
  const listing = await listingService.getListingById(req.params.id, req.user);
  
  if (!listing.can_edit) {
    return res.status(403).json({
      success: false,
      error: 'Access denied',
      message: 'You can only view analytics for your own listings'
    });
  }

  const { prisma } = require('../config/db');
  
  // Get interaction statistics
  const interactions = await prisma.userInteraction.groupBy({
    by: ['interaction_type'],
    where: { listing_id: req.params.id },
    _count: { interaction_type: true }
  });

  // Get views over time (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dailyViews = await prisma.userInteraction.groupBy({
    by: ['created_at'],
    where: {
      listing_id: req.params.id,
      interaction_type: 'VIEW',
      created_at: { gte: thirtyDaysAgo }
    },
    _count: { interaction_type: true }
  });

  const analytics = {
    listing_id: req.params.id,
    total_views: listing.views_count,
    total_likes: listing.likes_count,
    total_chats: listing._count.chats,
    interactions: interactions.reduce((acc, item) => {
      acc[item.interaction_type.toLowerCase()] = item._count.interaction_type;
      return acc;
    }, {}),
    daily_views: dailyViews,
    created_at: listing.created_at,
    status: listing.status
  };

  res.json({
    success: true,
    data: { analytics }
  });
});

module.exports = {
  // CRUD operations
  createListing,
  createDraftListing,
  getListings,
  getListingById,
  getMyListings,
  updateListing,
  deleteListing,
  
  // Specialized getters
  getTrendingListings,
  getRecentListings,
  
  // Admin functions
  updateListingStatus,
  toggleFeaturedStatus,
  
  // Media management
  addListingMedia,
  removeListingMedia,
  
  // Interactions
  toggleListingLike,
  shareListing,
  
  // Analytics
  getListingAnalytics
};