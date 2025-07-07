// apps/backend/src/routes/listingRoutes.js
// Listing routes for VOID Marketplace

const express = require('express');
const listingController = require('../controllers/listingController');
const listingValidator = require('../validators/listingValidator');
const { 
  authenticate, 
  authenticateOptional, 
  requireVerifiedVendor,
  requireOwnership 
} = require('../middleware/authMiddleware');
const { 
  requireRole, 
  requireMinRole, 
  requireOwnerOrAdmin 
} = require('../middleware/roleMiddleware');
const { 
  uploadListingMedia, 
  handleUploadError 
} = require('../middleware/uploadMiddleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

// ================================
// PUBLIC ROUTES (No Authentication Required)
// ================================

/**
 * @route   GET /api/v1/listings
 * @desc    Get all active listings with search and filters
 * @access  Public
 */
router.get('/',
  authenticateOptional,
  listingValidator.validateSearchListings,
  listingController.getListings
);

/**
 * @route   GET /api/v1/listings/trending
 * @desc    Get trending/featured listings
 * @access  Public
 */
router.get('/trending',
  authenticateOptional,
  listingValidator.validatePagination,
  listingController.getTrendingListings
);

/**
 * @route   GET /api/v1/listings/recent
 * @desc    Get recently added listings
 * @access  Public
 */
router.get('/recent',
  authenticateOptional,
  listingValidator.validatePagination,
  listingController.getRecentListings
);

/**
 * @route   GET /api/v1/listings/:id
 * @desc    Get single listing by ID
 * @access  Public
 */
router.get('/:id',
  authenticateOptional,
  listingValidator.validateListingId,
  listingController.getListingById
);

// ================================
// AUTHENTICATED USER ROUTES
// ================================

/**
 * @route   POST /api/v1/listings/:id/like
 * @desc    Like or unlike a listing
 * @access  Private
 */
router.post('/:id/like',
  authenticate,
  listingValidator.validateListingId,
  listingController.toggleListingLike
);

/**
 * @route   POST /api/v1/listings/:id/share
 * @desc    Share listing (track interaction)
 * @access  Private
 */
router.post('/:id/share',
  authenticate,
  listingValidator.validateListingId,
  listingValidator.validateShareListing,
  listingController.shareListing
);

// ================================
// VENDOR ROUTES (Vendor Role Required)
// ================================

/**
 * @route   GET /api/v1/listings/my
 * @desc    Get vendor's own listings
 * @access  Private (Vendors only)
 */
router.get('/my',
  authenticate,
  requireRole(USER_ROLES.VENDOR),
  listingValidator.validateSearchListings,
  listingController.getMyListings
);

/**
 * @route   POST /api/v1/listings
 * @desc    Create new listing
 * @access  Private (Verified Vendors only)
 */
router.post('/',
  authenticate,
  requireRole(USER_ROLES.VENDOR),
  requireVerifiedVendor,
  uploadListingMedia,
  handleUploadError,
  listingValidator.validateCreateListing,
  listingController.createListing
);

/**
 * @route   POST /api/v1/listings/draft
 * @desc    Create draft listing
 * @access  Private (Verified Vendors only)
 */
router.post('/draft',
  authenticate,
  requireRole(USER_ROLES.VENDOR),
  requireVerifiedVendor,
  uploadListingMedia,
  handleUploadError,
  listingValidator.validateCreateListing,
  listingController.createDraftListing
);

// ================================
// LISTING OWNER ROUTES (Owner or Admin)
// ================================

/**
 * @route   PUT /api/v1/listings/:id
 * @desc    Update listing
 * @access  Private (Owner or Admin)
 */
router.put('/:id',
  authenticate,
  listingValidator.validateListingId,
  requireOwnerOrAdmin('id', 'vendor_id', 'listing'),
  uploadListingMedia,
  handleUploadError,
  listingValidator.validateUpdateListing,
  listingController.updateListing
);

/**
 * @route   DELETE /api/v1/listings/:id
 * @desc    Delete listing
 * @access  Private (Owner or Admin)
 */
router.delete('/:id',
  authenticate,
  listingValidator.validateListingId,
  requireOwnerOrAdmin('id', 'vendor_id', 'listing'),
  listingController.deleteListing
);

/**
 * @route   GET /api/v1/listings/:id/analytics
 * @desc    Get listing analytics
 * @access  Private (Owner or Admin)
 */
router.get('/:id/analytics',
  authenticate,
  listingValidator.validateListingId,
  listingValidator.validateAnalyticsQuery,
  requireOwnerOrAdmin('id', 'vendor_id', 'listing'),
  listingController.getListingAnalytics
);

// ================================
// MEDIA MANAGEMENT ROUTES (Owner or Admin)
// ================================

/**
 * @route   POST /api/v1/listings/:id/media
 * @desc    Add media to existing listing
 * @access  Private (Owner or Admin)
 */
router.post('/:id/media',
  authenticate,
  listingValidator.validateListingId,
  requireOwnerOrAdmin('id', 'vendor_id', 'listing'),
  uploadListingMedia,
  handleUploadError,
  listingValidator.validateAddMedia,
  listingController.addListingMedia
);

/**
 * @route   DELETE /api/v1/listings/:id/media/:mediaId
 * @desc    Remove media from listing
 * @access  Private (Owner or Admin)
 */
router.delete('/:id/media/:mediaId',
  authenticate,
  listingValidator.validateRemoveMedia,
  requireOwnerOrAdmin('id', 'vendor_id', 'listing'),
  listingController.removeListingMedia
);

// ================================
// ADMIN ROUTES (Admin/Moderator Access)
// ================================

/**
 * @route   GET /api/v1/listings/admin/pending
 * @desc    Get pending listings for approval
 * @access  Private (Moderator+)
 */
router.get('/admin/pending',
  authenticate,
  requireMinRole(USER_ROLES.MODERATOR),
  listingValidator.validateSearchListings,
  (req, res, next) => {
    // Force status filter to pending
    req.query.status = 'PENDING_APPROVAL';
    next();
  },
  listingController.getListings
);

/**
 * @route   PATCH /api/v1/listings/:id/status
 * @desc    Update listing status (approve/reject/etc)
 * @access  Private (Moderator+)
 */
router.patch('/:id/status',
  authenticate,
  requireMinRole(USER_ROLES.MODERATOR),
  listingValidator.validateListingId,
  listingValidator.validateUpdateListingStatus,
  listingController.updateListingStatus
);

/**
 * @route   PATCH /api/v1/listings/:id/feature
 * @desc    Toggle featured status
 * @access  Private (Admin+)
 */
router.patch('/:id/feature',
  authenticate,
  requireMinRole(USER_ROLES.ADMIN),
  listingValidator.validateListingId,
  (req, res, next) => {
    // Validate featured toggle request
    const { error } = require('joi').object({
      is_featured: require('joi').boolean().required()
    }).validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        message: error.details[0].message
      });
    }
    next();
  },
  listingController.toggleFeaturedStatus
);

/**
 * @route   POST /api/v1/listings/admin/bulk-update
 * @desc    Bulk update multiple listings
 * @access  Private (Admin+)
 */
router.post('/admin/bulk-update',
  authenticate,
  requireMinRole(USER_ROLES.ADMIN),
  listingValidator.validateBulkUpdateListings,
  async (req, res) => {
    try {
      const { listing_ids, action, reason } = req.body;
      const { prisma } = require('../config/db');
      const logger = require('../utils/logger');
      
      let updateData = {};
      let successMessage = '';

      switch (action) {
        case 'activate':
          updateData = { status: 'ACTIVE', updated_at: new Date() };
          successMessage = 'Listings activated successfully';
          break;
        case 'deactivate':
          updateData = { status: 'REMOVED', updated_at: new Date() };
          successMessage = 'Listings deactivated successfully';
          break;
        case 'feature':
          updateData = { is_featured: true, updated_at: new Date() };
          successMessage = 'Listings featured successfully';
          break;
        case 'unfeature':
          updateData = { is_featured: false, updated_at: new Date() };
          successMessage = 'Listings unfeatured successfully';
          break;
        case 'delete':
          // For delete, we'll handle it separately
          await prisma.listing.deleteMany({
            where: { id: { in: listing_ids } }
          });
          successMessage = 'Listings deleted successfully';
          break;
        default:
          return res.status(400).json({
            success: false,
            error: 'Invalid action',
            message: 'Action must be one of: activate, deactivate, feature, unfeature, delete'
          });
      }

      if (action !== 'delete') {
        await prisma.listing.updateMany({
          where: { id: { in: listing_ids } },
          data: updateData
        });
      }

      // Log admin action
      await prisma.adminAction.create({
        data: {
          admin_id: req.user.id,
          action_type: `bulk_${action}_listings`,
          target_type: 'listings',
          target_id: listing_ids.join(','),
          reason,
          metadata: JSON.stringify({
            listing_count: listing_ids.length,
            action,
            listing_ids
          })
        }
      });

      logger.info('Bulk listing operation completed', {
        adminId: req.user.id,
        action,
        listingCount: listing_ids.length,
        reason
      });

      res.json({
        success: true,
        message: successMessage,
        data: {
          affected_listings: listing_ids.length,
          action,
          reason
        }
      });

    } catch (error) {
      logger.error('Bulk listing operation failed:', error);
      res.status(500).json({
        success: false,
        error: 'Bulk operation failed',
        message: error.message
      });
    }
  }
);

// ================================
// ADMIN ANALYTICS ROUTES
// ================================

/**
 * @route   GET /api/v1/listings/admin/stats
 * @desc    Get overall listing statistics
 * @access  Private (Admin+)
 */
router.get('/admin/stats',
  authenticate,
  requireMinRole(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const { prisma } = require('../config/db');
      
      const [
        totalListings,
        activeListings,
        pendingListings,
        featuredListings,
        listingsByStatus,
        listingsByCategory,
        recentListings
      ] = await Promise.all([
        prisma.listing.count(),
        prisma.listing.count({ where: { status: 'ACTIVE' } }),
        prisma.listing.count({ where: { status: 'PENDING_APPROVAL' } }),
        prisma.listing.count({ where: { is_featured: true } }),
        
        prisma.listing.groupBy({
          by: ['status'],
          _count: { status: true }
        }),
        
        prisma.listing.groupBy({
          by: ['category_id'],
          _count: { category_id: true },
          orderBy: { _count: { category_id: 'desc' } },
          take: 10
        }),
        
        prisma.listing.count({
          where: {
            created_at: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
            }
          }
        })
      ]);

      const stats = {
        overview: {
          total_listings: totalListings,
          active_listings: activeListings,
          pending_approval: pendingListings,
          featured_listings: featuredListings,
          recent_listings: recentListings
        },
        by_status: listingsByStatus.reduce((acc, item) => {
          acc[item.status] = item._count.status;
          return acc;
        }, {}),
        by_category: listingsByCategory,
        generated_at: new Date().toISOString()
      };

      res.json({
        success: true,
        data: { stats }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch listing statistics',
        message: error.message
      });
    }
  }
);

// ================================
// ERROR HANDLING
// ================================

// Handle file upload errors specifically for listing routes
router.use((error, req, res, next) => {
  if (error.code && error.code.startsWith('LIMIT_')) {
    return res.status(400).json({
      success: false,
      error: 'File upload error',
      message: error.message,
      code: error.code
    });
  }
  next(error);
});

module.exports = router;