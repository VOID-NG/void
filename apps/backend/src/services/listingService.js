// apps/backend/src/services/listingService.js
// Listing service layer for VOID Marketplace

const { prisma } = require('../config/db');
const { 
  LISTING_STATUS, 
  LISTING_CONDITION, 
  USER_ROLES, 
  BUSINESS_RULES,
  SUBSCRIPTION_FEATURES,
  ERROR_CODES 
} = require('../config/constants');
const { 
  NotFoundError, 
  ValidationError, 
  BusinessLogicError, 
  AuthorizationError 
} = require('../middleware/errorMiddleware');
const { organizeUploadedFiles, deleteFile } = require('../middleware/uploadMiddleware');
const logger = require('../utils/logger');
const { generateListingEmbeddings: generateListingEmbeddingsAI } = require('../utils/imageEmbeddingUtils');

// ================================
// LISTING CREATION
// ================================

/**
 * Create a new listing with media uploads
 * @param {Object} listingData - Listing data
 * @param {Object} user - Current user
 * @param {Array} files - Uploaded files
 * @returns {Object} Created listing
 */
const createListing = async (listingData, user, files = []) => {
  try {
    const {
      title,
      description,
      price,
      condition,
      category_id,
      quantity = 1,
      sku,
      tags = [],
      weight,
      dimensions,
      location,
      is_negotiable = true
    } = listingData;

    // Validate vendor permissions
    if (user.role !== USER_ROLES.VENDOR && !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      throw new AuthorizationError('Only vendors can create listings');
    }

    // Check vendor verification
    if (user.role === USER_ROLES.VENDOR && !user.vendor_verified) {
      throw new BusinessLogicError(
        'Vendor verification required to create listings',
        ERROR_CODES.BUSINESS_LISTING_LIMIT_EXCEEDED
      );
    }

    // Check listing limits based on subscription
    await checkListingLimits(user.id);

    // Validate category exists
    const category = await prisma.category.findUnique({
      where: { id: category_id }
    });

    if (!category) {
      throw new NotFoundError('Category not found');
    }

    // Validate price limits
    const priceValue = parseFloat(price);
    if (priceValue < BUSINESS_RULES.MIN_LISTING_PRICE || priceValue > BUSINESS_RULES.MAX_LISTING_PRICE) {
      throw new ValidationError(
        `Price must be between $${BUSINESS_RULES.MIN_LISTING_PRICE} and $${BUSINESS_RULES.MAX_LISTING_PRICE}`
      );
    }

    // Process uploaded files
    let organizedFiles = { images: [], videos: [], models: [] };
    if (files && files.length > 0) {
      organizedFiles = await organizeUploadedFiles(files, user.id);
    }

    // Create listing in transaction
    const listing = await prisma.$transaction(async (tx) => {
      // Create the listing
      const newListing = await tx.listing.create({
        data: {
          title: title.trim(),
          description: description.trim(),
          price: priceValue,
          condition,
          category_id,
          vendor_id: user.id,
          quantity,
          sku: sku?.trim() || null,
          tags: tags.slice(0, BUSINESS_RULES.MAX_TAGS_PER_LISTING),
          weight: weight ? parseFloat(weight) : null,
          dimensions: dimensions || null,
          location: location?.trim() || null,
          is_negotiable,
          status: user.role === USER_ROLES.VENDOR ? LISTING_STATUS.PENDING_APPROVAL : LISTING_STATUS.ACTIVE
        }
      });

      // Create image records
      if (organizedFiles.images.length > 0) {
        await tx.listingImage.createMany({
          data: organizedFiles.images.map((image, index) => ({
            listing_id: newListing.id,
            url: image.processedUrl || image.url,
            alt_text: `${title} - Image ${index + 1}`,
            is_primary: index === 0,
            order_pos: index,
            file_size: image.size
          }))
        });
      }

      // Create video records
      if (organizedFiles.videos.length > 0) {
        await tx.listingVideo.createMany({
          data: organizedFiles.videos.map((video) => ({
            listing_id: newListing.id,
            url: video.url,
            thumbnail_url: null, // TODO: Generate video thumbnail
            file_size: video.size
          }))
        });
      }

      // Create 3D model records
      if (organizedFiles.models.length > 0) {
        await tx.listing3DModel.createMany({
          data: organizedFiles.models.map((model) => ({
            listing_id: newListing.id,
            url: model.url,
            file_type: model.mimeType,
            file_size: model.size
          }))
        });
      }

      return newListing;
    });

    // Generate embeddings asynchronously (don't wait for completion)
    try {
      const imagesForAI = (organizedFiles.images || []).map((img, index) => ({
        url: img.processedUrl || img.url,
        is_primary: index === 0
      }));
      generateListingEmbeddingsAI(listing.id, { title, description, tags, images: imagesForAI })
        .catch(error => {
          logger.error('Failed to generate AI embeddings for listing:', error);
        });
    } catch (e) {
      logger.warn('Skipped AI embeddings due to preparation error', { error: e.message });
    }

    // Log the creation
    logger.info('Listing created successfully', {
      listingId: listing.id,
      vendorId: user.id,
      title,
      mediaCount: {
        images: organizedFiles.images.length,
        videos: organizedFiles.videos.length,
        models: organizedFiles.models.length
      }
    });

    // Return listing with relations
    return await getListingById(listing.id, user);

  } catch (error) {
    logger.error('Listing creation failed:', error);
    throw error;
  }
};

// ================================
// LISTING RETRIEVAL
// ================================

/**
 * Get listing by ID with full details
 * @param {string} listingId - Listing ID
 * @param {Object} user - Current user (optional)
 * @returns {Object} Listing details
 */
const getListingById = async (listingId, user = null) => {
  try {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        vendor: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            avatar_url: true,
            business_name: true,
            vendor_verified: true,
            created_at: true,
            _count: {
              select: {
                listings: true,
                reviews_received: true
              }
            }
          }
        },
        category: true,
        images: {
          orderBy: { order_pos: 'asc' }
        },
        videos: true,
        models_3d: true,
        reviews: {
          include: {
            reviewer: {
              select: {
                id: true,
                username: true,
                first_name: true,
                avatar_url: true
              }
            }
          },
          orderBy: { created_at: 'desc' },
          take: 5
        },
        _count: {
          select: {
            reviews: true,
            interactions: true,
            chats: true
          }
        }
      }
    });

    if (!listing) {
      throw new NotFoundError('Listing not found');
    }

    // Check visibility permissions
    if (listing.status === LISTING_STATUS.DRAFT && listing.vendor_id !== user?.id && !['ADMIN', 'SUPER_ADMIN'].includes(user?.role)) {
      throw new NotFoundError('Listing not found');
    }

    // Increment view count if not the owner
    if (user && user.id !== listing.vendor_id) {
      await incrementViewCount(listingId, user.id);
    }

    // Calculate average rating
    const avgRating = await prisma.review.aggregate({
      where: { listing_id: listingId },
      _avg: { rating: true },
      _count: { rating: true }
    });

    return {
      ...listing,
      average_rating: avgRating._avg.rating || 0,
      review_count: avgRating._count.rating || 0,
      is_owner: user?.id === listing.vendor_id,
      can_edit: user?.id === listing.vendor_id || ['ADMIN', 'SUPER_ADMIN'].includes(user?.role)
    };

  } catch (error) {
    logger.error('Get listing failed:', error);
    throw error;
  }
};

/**
 * Get paginated listings with filters
 * @param {Object} filters - Search filters
 * @param {Object} pagination - Pagination options
 * @param {Object} user - Current user (optional)
 * @returns {Object} Paginated listings
 */
const getListings = async (filters = {}, pagination = {}, user = null) => {
  try {
    const {
      search,
      category_id,
      vendor_id,
      condition,
      min_price,
      max_price,
      location,
      is_negotiable,
      is_featured,
      status,
      tags
    } = filters;

    const {
      page = 1,
      limit = 20,
      sort_by = 'created_at',
      sort_order = 'desc'
    } = pagination;

    const skip = (page - 1) * limit;

    // Build where clause
    const where = {
      AND: [
        // Status filter (public only sees active listings)
        status ? { status } : (
          ['ADMIN', 'SUPER_ADMIN'].includes(user?.role) 
            ? {} 
            : { status: LISTING_STATUS.ACTIVE }
        ),
        
        // Search in title and description
        search ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { tags: { has: search } }
          ]
        } : {},

        // Category filter
        category_id ? { category_id } : {},

        // Vendor filter
        vendor_id ? { vendor_id } : {},

        // Condition filter
        condition ? { condition } : {},

        // Price range
        min_price ? { price: { gte: parseFloat(min_price) } } : {},
        max_price ? { price: { lte: parseFloat(max_price) } } : {},

        // Location filter
        location ? { location: { contains: location, mode: 'insensitive' } } : {},

        // Negotiable filter
        is_negotiable !== undefined ? { is_negotiable: Boolean(is_negotiable) } : {},

        // Featured filter
        is_featured !== undefined ? { is_featured: Boolean(is_featured) } : {},

        // Tags filter
        tags ? { tags: { hasSome: Array.isArray(tags) ? tags : [tags] } } : {}
      ]
    };

    // Build order by clause
    const orderBy = {};
    orderBy[sort_by] = sort_order;

    // Execute query
    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        include: {
          vendor: {
            select: {
              id: true,
              username: true,
              business_name: true,
              avatar_url: true,
              vendor_verified: true
            }
          },
          category: {
            select: {
              id: true,
              name: true
            }
          },
          images: {
            where: { is_primary: true },
            take: 1
          },
          _count: {
            select: {
              reviews: true,
              interactions: true
            }
          }
        },
        orderBy,
        skip,
        take: limit
      }),
      prisma.listing.count({ where })
    ]);

    // Calculate average ratings for each listing
    const listingsWithRatings = await Promise.all(
      listings.map(async (listing) => {
        const avgRating = await prisma.review.aggregate({
          where: { listing_id: listing.id },
          _avg: { rating: true }
        });

        return {
          ...listing,
          average_rating: avgRating._avg.rating || 0,
          primary_image: listing.images[0]?.url || null
        };
      })
    );

    return {
      listings: listingsWithRatings,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        has_next: page < Math.ceil(total / limit),
        has_prev: page > 1
      },
      filters: filters
    };

  } catch (error) {
    logger.error('Get listings failed:', error);
    throw error;
  }
};

// ================================
// LISTING UPDATES
// ================================

/**
 * Update listing
 * @param {string} listingId - Listing ID
 * @param {Object} updateData - Update data
 * @param {Object} user - Current user
 * @param {Array} files - New uploaded files
 * @returns {Object} Updated listing
 */
const updateListing = async (listingId, updateData, user, files = []) => {
  try {
    // Get existing listing
    const existingListing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        images: true,
        videos: true,
        models_3d: true
      }
    });

    if (!existingListing) {
      throw new NotFoundError('Listing not found');
    }

    // Check permissions
    if (existingListing.vendor_id !== user.id && !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      throw new AuthorizationError('You can only edit your own listings');
    }

    // Filter allowed update fields
    const allowedFields = [
      'title', 'description', 'price', 'condition', 'category_id',
      'quantity', 'sku', 'tags', 'weight', 'dimensions', 'location',
      'is_negotiable', 'is_featured'
    ];

    const filteredData = {};
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        filteredData[field] = updateData[field];
      }
    }

    // Validate price if provided
    if (filteredData.price) {
      const priceValue = parseFloat(filteredData.price);
      if (priceValue < BUSINESS_RULES.MIN_LISTING_PRICE || priceValue > BUSINESS_RULES.MAX_LISTING_PRICE) {
        throw new ValidationError(
          `Price must be between $${BUSINESS_RULES.MIN_LISTING_PRICE} and $${BUSINESS_RULES.MAX_LISTING_PRICE}`
        );
      }
      filteredData.price = priceValue;
    }

    // Validate category if provided
    if (filteredData.category_id) {
      const category = await prisma.category.findUnique({
        where: { id: filteredData.category_id }
      });
      if (!category) {
        throw new NotFoundError('Category not found');
      }
    }

    // Handle featured listing (admin only)
    if (filteredData.is_featured !== undefined && !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      delete filteredData.is_featured;
    }

    // Limit tags
    if (filteredData.tags) {
      filteredData.tags = filteredData.tags.slice(0, BUSINESS_RULES.MAX_TAGS_PER_LISTING);
    }

    // Process new uploaded files
    let organizedFiles = { images: [], videos: [], models: [] };
    if (files && files.length > 0) {
      organizedFiles = await organizeUploadedFiles(files, user.id, listingId);
    }

    // Update listing in transaction
    const updatedListing = await prisma.$transaction(async (tx) => {
      // Update listing data
      const updated = await tx.listing.update({
        where: { id: listingId },
        data: {
          ...filteredData,
          updated_at: new Date(),
          // Reset to pending approval if content changed significantly
          status: (filteredData.title || filteredData.description) && user.role === USER_ROLES.VENDOR
            ? LISTING_STATUS.PENDING_APPROVAL
            : existingListing.status
        }
      });

      // Add new images
      if (organizedFiles.images.length > 0) {
        await tx.listingImage.createMany({
          data: organizedFiles.images.map((image, index) => ({
            listing_id: listingId,
            url: image.processedUrl || image.url,
            alt_text: `${filteredData.title || existingListing.title} - Image ${existingListing.images.length + index + 1}`,
            is_primary: existingListing.images.length === 0 && index === 0,
            order_pos: existingListing.images.length + index,
            file_size: image.size
          }))
        });
      }

      // Add new videos
      if (organizedFiles.videos.length > 0) {
        await tx.listingVideo.createMany({
          data: organizedFiles.videos.map((video) => ({
            listing_id: listingId,
            url: video.url,
            file_size: video.size
          }))
        });
      }

      // Add new 3D models
      if (organizedFiles.models.length > 0) {
        await tx.listing3DModel.createMany({
          data: organizedFiles.models.map((model) => ({
            listing_id: listingId,
            url: model.url,
            file_type: model.mimeType,
            file_size: model.size
          }))
        });
      }

      return updated;
    });

    // Regenerate embeddings if content changed
    if (filteredData.title || filteredData.description || filteredData.tags) {
      try {
        const primaryImage = existingListing.images?.[0];
        const imagesForAI = primaryImage ? [{ url: primaryImage.url, is_primary: true }] : [];
        generateListingEmbeddingsAI(listingId, {
          title: filteredData.title || existingListing.title,
          description: filteredData.description || existingListing.description,
          tags: filteredData.tags || existingListing.tags,
          images: imagesForAI
        }).catch(error => {
          logger.error('Failed to regenerate AI embeddings:', error);
        });
      } catch (e) {
        logger.warn('Skipped AI embedding regeneration due to preparation error', { error: e.message });
      }
    }

    logger.info('Listing updated successfully', {
      listingId,
      vendorId: user.id,
      updatedFields: Object.keys(filteredData)
    });

    return await getListingById(listingId, user);

  } catch (error) {
    logger.error('Listing update failed:', error);
    throw error;
  }
};

// ================================
// LISTING DELETION
// ================================

/**
 * Delete listing
 * @param {string} listingId - Listing ID
 * @param {Object} user - Current user
 * @returns {boolean} Success status
 */
const deleteListing = async (listingId, user) => {
  try {
    // Get existing listing with media
    const existingListing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        images: true,
        videos: true,
        models_3d: true,
        chats: true,
        transactions: {
          where: {
            status: {
              in: ['INITIATED', 'ESCROW_PENDING', 'ESCROW_ACTIVE']
            }
          }
        }
      }
    });

    if (!existingListing) {
      throw new NotFoundError('Listing not found');
    }

    // Check permissions
    if (existingListing.vendor_id !== user.id && !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      throw new AuthorizationError('You can only delete your own listings');
    }

    // Check for active transactions
    if (existingListing.transactions.length > 0) {
      throw new BusinessLogicError(
        'Cannot delete listing with active transactions',
        ERROR_CODES.BUSINESS_TRANSACTION_FAILED
      );
    }

    // Delete in transaction
    await prisma.$transaction(async (tx) => {
      // Delete media records (files will be cleaned up separately)
      await tx.listingImage.deleteMany({ where: { listing_id: listingId } });
      await tx.listingVideo.deleteMany({ where: { listing_id: listingId } });
      await tx.listing3DModel.deleteMany({ where: { listing_id: listingId } });
      await tx.listingEmbedding.deleteMany({ where: { listing_id: listingId } });

      // Archive related chats instead of deleting
      await tx.chat.updateMany({
        where: { listing_id: listingId },
        data: { status: 'ARCHIVED' }
      });

      // Delete user interactions
      await tx.userInteraction.deleteMany({ where: { listing_id: listingId } });

      // Finally delete the listing
      await tx.listing.delete({ where: { id: listingId } });
    });

    // Clean up media files asynchronously
    const allMediaFiles = [
      ...existingListing.images.map(img => img.url),
      ...existingListing.videos.map(vid => vid.url),
      ...existingListing.models_3d.map(model => model.url)
    ];

    allMediaFiles.forEach(filePath => {
      deleteFile(filePath.replace('/uploads/', 'uploads/')).catch(error => {
        logger.error('Failed to delete media file:', error);
      });
    });

    logger.info('Listing deleted successfully', {
      listingId,
      vendorId: user.id,
      mediaFilesCount: allMediaFiles.length
    });

    return true;

  } catch (error) {
    logger.error('Listing deletion failed:', error);
    throw error;
  }
};

// ================================
// UTILITY FUNCTIONS
// ================================

/**
 * Check if user can create more listings based on subscription
 * @param {string} userId - User ID
 */
const checkListingLimits = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      subscription: true,
      _count: {
        select: {
          listings: {
            where: {
              status: {
                in: [LISTING_STATUS.ACTIVE, LISTING_STATUS.PENDING_APPROVAL, LISTING_STATUS.DRAFT]
              }
            }
          }
        }
      }
    }
  });

  const plan = user.subscription?.plan || 'FREE';
  const features = SUBSCRIPTION_FEATURES[plan];
  const currentListings = user._count.listings;

  if (features.max_listings !== -1 && currentListings >= features.max_listings) {
    throw new BusinessLogicError(
      `Listing limit reached. Your ${plan} plan allows ${features.max_listings} active listings.`,
      ERROR_CODES.BUSINESS_LISTING_LIMIT_EXCEEDED
    );
  }
};

/**
 * Increment view count and track user interaction
 * @param {string} listingId - Listing ID
 * @param {string} userId - User ID
 */
const incrementViewCount = async (listingId, userId) => {
  try {
    await prisma.$transaction([
      // Increment view count
      prisma.listing.update({
        where: { id: listingId },
        data: { views_count: { increment: 1 } }
      }),
      
      // Track user interaction
      prisma.userInteraction.create({
        data: {
          user_id: userId,
          listing_id: listingId,
          interaction_type: 'VIEW'
        }
      })
    ]);
  } catch (error) {
    // Don't throw error for view counting failures
    logger.error('Failed to increment view count:', error);
  }
};

/**
 * Generate AI embeddings for listing (async)
 * @param {string} listingId - Listing ID
 * @param {Object} content - Text content for embedding
 */
const generateListingEmbeddings = async (listingId, content) => {
  try {
    // This will be implemented when AI search is built
    // For now, just create a placeholder
    const textContent = `${content.title} ${content.description} ${content.tags?.join(' ') || ''}`;
    
    await prisma.listingEmbedding.upsert({
      where: { listing_id: listingId },
      create: {
        listing_id: listingId,
        text_embedding: null, // Will be populated by AI service
        embedding_model: 'placeholder',
        created_at: new Date(),
        updated_at: new Date()
      },
      update: {
        text_embedding: null, // Will be populated by AI service
        updated_at: new Date()
      }
    });

    logger.debug('Embedding placeholder created for listing', { listingId });
  } catch (error) {
    logger.error('Failed to create embedding placeholder:', error);
  }
};

/**
 * Update listing status (admin function)
 * @param {string} listingId - Listing ID
 * @param {string} status - New status
 * @param {Object} user - Admin user
 * @param {string} reason - Reason for status change
 * @returns {Object} Updated listing
 */
const updateListingStatus = async (listingId, status, user, reason = null) => {
  try {
    // Check admin permissions
    if (!['ADMIN', 'SUPER_ADMIN', 'MODERATOR'].includes(user.role)) {
      throw new AuthorizationError('Admin access required');
    }

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { vendor: true }
    });

    if (!listing) {
      throw new NotFoundError('Listing not found');
    }

    // Update listing status
    const updatedListing = await prisma.listing.update({
      where: { id: listingId },
      data: { 
        status,
        updated_at: new Date()
      }
    });

    // Create admin action record
    await prisma.adminAction.create({
      data: {
        admin_id: user.id,
        action_type: `listing_status_${status.toLowerCase()}`,
        target_type: 'listing',
        target_id: listingId,
        reason,
        metadata: JSON.stringify({
          old_status: listing.status,
          new_status: status,
          vendor_id: listing.vendor_id
        })
      }
    });

    // TODO: Send notification to vendor
    
    logger.info('Listing status updated by admin', {
      listingId,
      adminId: user.id,
      oldStatus: listing.status,
      newStatus: status,
      reason
    });

    return updatedListing;

  } catch (error) {
    logger.error('Listing status update failed:', error);
    throw error;
  }
};

module.exports = {
  createListing,
  getListingById,
  getListings,
  updateListing,
  deleteListing,
  updateListingStatus,
  checkListingLimits,
  incrementViewCount,
  generateListingEmbeddings
};