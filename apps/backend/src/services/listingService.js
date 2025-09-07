// apps/backend/src/services/listingService.js
// Complete Listing service layer for VOID Marketplace

const { prisma } = require('../config/db-original');
const { LISTING_STATUS, USER_ROLES, BUSINESS_RULES } = require('../config/constants');
const { generateImageEmbedding } = require('../utils/imageEmbeddingUtils');
const logger = require('../utils/logger');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

// ================================
// CUSTOM ERROR CLASSES
// ================================

class ListingError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ListingError';
    this.statusCode = statusCode;
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

class UnauthorizedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnauthorizedError';
    this.statusCode = 403;
  }
}

// ================================
// LISTING CREATION
// ================================

/**
 * Create a new listing
 * @param {Object} listingData - Listing data
 * @param {Object} files - Uploaded files
 * @param {string} userId - User ID
 * @returns {Object} Created listing
 */
const createListing = async (listingData, files = {}, userId) => {
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

    // Validate required fields
    if (!title || !description || !price || !condition || !category_id) {
      throw new ListingError('Missing required fields: title, description, price, condition, category_id');
    }

    // Validate price
    if (price <= 0) {
      throw new ListingError('Price must be greater than 0');
    }

    // Validate quantity
    if (quantity < 1) {
      throw new ListingError('Quantity must be at least 1');
    }

    // Check if category exists
    const category = await prisma.category.findUnique({
      where: { id: category_id }
    });

    if (!category) {
      throw new ListingError('Invalid category ID');
    }

    // Create listing
    const listing = await prisma.listing.create({
      data: {
        title: title.trim(),
        description: description.trim(),
        price: parseFloat(price),
        condition,
        category_id,
        vendor_id: userId,
        quantity: parseInt(quantity),
        sku: sku?.trim() || null,
        tags: Array.isArray(tags) ? tags : [],
        weight: weight ? parseFloat(weight) : null,
        dimensions: dimensions || null,
        location: location?.trim() || null,
        is_negotiable: Boolean(is_negotiable),
        status: LISTING_STATUS.DRAFT
      },
      include: {
        category: true,
        vendor: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            business_name: true,
            vendor_verified: true
          }
        }
      }
    });

    // Process uploaded files
    if (files) {
      await processListingFiles(listing.id, files);
    }

    // Generate search embeddings for text content
    await generateListingEmbeddings(listing.id, {
      title,
      description,
      tags,
      category: category.name
    });

    logger.info('Listing created successfully', {
      listingId: listing.id,
      vendorId: userId,
      title: title.substring(0, 50)
    });

    return listing;
  } catch (error) {
    logger.error('Create listing failed:', error);
    throw error;
  }
};

/**
 * Process uploaded files for listing
 * @param {string} listingId - Listing ID
 * @param {Object} files - Uploaded files
 */
const processListingFiles = async (listingId, files) => {
  try {
    const { images = [], videos = [], models_3d = [] } = files;

    // Process images
    if (images && images.length > 0) {
      if (images.length > BUSINESS_RULES.MAX_IMAGES_PER_LISTING) {
        throw new ListingError(`Maximum ${BUSINESS_RULES.MAX_IMAGES_PER_LISTING} images allowed per listing`);
      }

      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        const processedImage = await processAndSaveImage(image, listingId);
        
        await prisma.listingImage.create({
          data: {
            listing_id: listingId,
            url: processedImage.url,
            alt_text: processedImage.alt_text,
            is_primary: i === 0, // First image is primary
            order_pos: i,
            file_size: processedImage.file_size
          }
        });

        // Generate image embeddings for search
        if (i === 0) { // Only for primary image
          await generateImageEmbedding(processedImage.buffer, listingId);
        }
      }
    }

    // Process videos
    if (videos && videos.length > 0) {
      if (videos.length > BUSINESS_RULES.MAX_VIDEOS_PER_LISTING) {
        throw new ListingError(`Maximum ${BUSINESS_RULES.MAX_VIDEOS_PER_LISTING} video allowed per listing`);
      }

      for (const video of videos) {
        const processedVideo = await processAndSaveVideo(video, listingId);
        
        await prisma.listingVideo.create({
          data: {
            listing_id: listingId,
            url: processedVideo.url,
            thumbnail_url: processedVideo.thumbnail_url,
            duration: processedVideo.duration,
            file_size: processedVideo.file_size
          }
        });
      }
    }

    // Process 3D models
    if (models_3d && models_3d.length > 0) {
      if (models_3d.length > BUSINESS_RULES.MAX_3D_MODELS_PER_LISTING) {
        throw new ListingError(`Maximum ${BUSINESS_RULES.MAX_3D_MODELS_PER_LISTING} 3D models allowed per listing`);
      }

      for (const model of models_3d) {
        const processedModel = await processAndSave3DModel(model, listingId);
        
        await prisma.listing3DModel.create({
          data: {
            listing_id: listingId,
            url: processedModel.url,
            file_type: processedModel.file_type,
            file_size: processedModel.file_size
          }
        });
      }
    }
  } catch (error) {
    logger.error('Process listing files failed:', error);
    throw error;
  }
};

/**
 * Process and save image with optimization
 * @param {Object} imageFile - Image file
 * @param {string} listingId - Listing ID
 * @returns {Object} Processed image data
 */
const processAndSaveImage = async (imageFile, listingId) => {
  try {
    const { buffer, mimetype, originalname } = imageFile;
    
    // Validate image type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(mimetype)) {
      throw new ListingError('Only JPEG, PNG, and WebP images are allowed');
    }

    // Generate unique filename
    const timestamp = Date.now();
    const extension = path.extname(originalname);
    const filename = `${listingId}_${timestamp}${extension}`;
    const relativePath = `/uploads/images/${filename}`;
    const fullPath = path.join(process.cwd(), 'uploads', 'images', filename);

    // Optimize image with Sharp
    const optimizedBuffer = await sharp(buffer)
      .resize(1200, 1200, { 
        fit: 'inside',
        withoutEnlargement: true 
      })
      .jpeg({ 
        quality: 85,
        progressive: true 
      })
      .toBuffer();

    // Save to disk
    await fs.writeFile(fullPath, optimizedBuffer);

    // Generate thumbnail
    const thumbnailBuffer = await sharp(buffer)
      .resize(300, 300, { 
        fit: 'cover' 
      })
      .jpeg({ 
        quality: 80 
      })
      .toBuffer();

    const thumbnailFilename = `thumb_${filename}`;
    const thumbnailPath = path.join(process.cwd(), 'uploads', 'images', thumbnailFilename);
    await fs.writeFile(thumbnailPath, thumbnailBuffer);

    return {
      url: relativePath,
      thumbnail_url: `/uploads/images/${thumbnailFilename}`,
      alt_text: originalname,
      file_size: optimizedBuffer.length,
      buffer: optimizedBuffer
    };
  } catch (error) {
    logger.error('Process image failed:', error);
    throw error;
  }
};

/**
 * Process and save video
 * @param {Object} videoFile - Video file
 * @param {string} listingId - Listing ID
 * @returns {Object} Processed video data
 */
const processAndSaveVideo = async (videoFile, listingId) => {
  try {
    const { buffer, mimetype, originalname } = videoFile;
    
    // Validate video type
    const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (!allowedTypes.includes(mimetype)) {
      throw new ListingError('Only MP4, WebM, and QuickTime videos are allowed');
    }

    // Check file size (max 100MB)
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (buffer.length > maxSize) {
      throw new ListingError('Video file size must be less than 100MB');
    }

    // Generate unique filename
    const timestamp = Date.now();
    const extension = path.extname(originalname);
    const filename = `${listingId}_${timestamp}${extension}`;
    const relativePath = `/uploads/videos/${filename}`;
    const fullPath = path.join(process.cwd(), 'uploads', 'videos', filename);

    // Save to disk
    await fs.writeFile(fullPath, buffer);

    // TODO: Generate video thumbnail using ffmpeg
    // For now, return placeholder thumbnail
    const thumbnailUrl = '/uploads/images/video-placeholder.jpg';

    return {
      url: relativePath,
      thumbnail_url: thumbnailUrl,
      duration: null, // TODO: Extract duration with ffmpeg
      file_size: buffer.length
    };
  } catch (error) {
    logger.error('Process video failed:', error);
    throw error;
  }
};

/**
 * Process and save 3D model
 * @param {Object} modelFile - 3D model file
 * @param {string} listingId - Listing ID
 * @returns {Object} Processed model data
 */
const processAndSave3DModel = async (modelFile, listingId) => {
  try {
    const { buffer, mimetype, originalname } = modelFile;
    
    // Validate model type
    const allowedTypes = ['model/gltf-binary', 'application/octet-stream'];
    const allowedExtensions = ['.glb', '.obj', '.gltf'];
    const extension = path.extname(originalname).toLowerCase();
    
    if (!allowedExtensions.includes(extension)) {
      throw new ListingError('Only GLB, OBJ, and GLTF 3D models are allowed');
    }

    // Check file size (max 50MB)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (buffer.length > maxSize) {
      throw new ListingError('3D model file size must be less than 50MB');
    }

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `${listingId}_${timestamp}${extension}`;
    const relativePath = `/uploads/models/${filename}`;
    const fullPath = path.join(process.cwd(), 'uploads', 'models', filename);

    // Save to disk
    await fs.writeFile(fullPath, buffer);

    return {
      url: relativePath,
      file_type: extension.substring(1), // Remove dot
      file_size: buffer.length
    };
  } catch (error) {
    logger.error('Process 3D model failed:', error);
    throw error;
  }
};

/**
 * Generate embeddings for listing search
 * @param {string} listingId - Listing ID
 * @param {Object} textData - Text data for embedding
 */
const generateListingEmbeddings = async (listingId, textData) => {
  try {
    const { title, description, tags, category } = textData;
    
    // Combine text for embedding
    const combinedText = `${title} ${description} ${tags.join(' ')} ${category}`;
    
    // Generate embedding (placeholder - implement with OpenAI or HuggingFace)
    const embedding = await generateTextEmbedding(combinedText);
    
    if (embedding) {
      await prisma.listingEmbedding.create({
        data: {
          listing_id: listingId,
          embedding_type: 'text',
          embedding_vector: JSON.stringify(embedding),
          source_content: combinedText,
          confidence_score: 1.0,
          model_version: 'text-embedding-ada-002'
        }
      });
    }
  } catch (error) {
    logger.error('Generate listing embeddings failed:', error);
    // Don't throw error - embeddings are optional
  }
};

// ================================
// LISTING RETRIEVAL
// ================================

/**
 * Get listing by ID
 * @param {string} listingId - Listing ID
 * @param {string} userId - User ID (optional)
 * @returns {Object} Listing data
 */
const getListingById = async (listingId, userId = null) => {
  try {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        category: true,
        vendor: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            business_name: true,
            vendor_verified: true,
            avatar_url: true,
            location: true,
            created_at: true
          }
        },
        images: {
          orderBy: { order_pos: 'asc' }
        },
        videos: true,
        models_3d: true,
        reviews: {
          include: {
            reviewer: {
              select: {
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
            interactions: true
          }
        }
      }
    });

    if (!listing) {
      throw new NotFoundError('Listing not found');
    }

    // Check if user can view this listing
    if (listing.status !== LISTING_STATUS.ACTIVE && listing.vendor_id !== userId) {
      // Only vendor and admins can view non-active listings
      throw new UnauthorizedError('You cannot view this listing');
    }

    // Increment view count if not the vendor
    if (userId && userId !== listing.vendor_id) {
      await prisma.listing.update({
        where: { id: listingId },
        data: { 
          views_count: { increment: 1 }
        }
      });

      // Track user interaction
      await prisma.userInteraction.create({
        data: {
          user_id: userId,
          listing_id: listingId,
          interaction_type: 'VIEW'
        }
      }).catch(() => {}); // Ignore duplicate errors
    }

    // Calculate average rating
    const avgRating = listing.reviews.length > 0 
      ? listing.reviews.reduce((sum, review) => sum + review.rating, 0) / listing.reviews.length
      : 0;

    return {
      ...listing,
      average_rating: parseFloat(avgRating.toFixed(1)),
      review_count: listing._count.reviews,
      view_count: listing.views_count
    };
  } catch (error) {
    logger.error('Get listing by ID failed:', error);
    throw error;
  }
};

/**
 * Get listings with filters and pagination
 * @param {Object} filters - Search filters
 * @param {Object} pagination - Pagination options
 * @returns {Object} Listings and pagination data
 */
const getListings = async (filters = {}, pagination = {}) => {
  try {
    const {
      category_id,
      vendor_id,
      condition,
      min_price,
      max_price,
      location,
      search_query,
      status = LISTING_STATUS.ACTIVE,
      is_featured
    } = filters;

    const {
      page = 1,
      limit = 24,
      sort_by = 'created_at',
      sort_order = 'desc'
    } = pagination;

    // Build where clause
    const where = {
      status
    };

    if (category_id) {
      where.category_id = category_id;
    }

    if (vendor_id) {
      where.vendor_id = vendor_id;
    }

    if (condition) {
      where.condition = condition;
    }

    if (min_price || max_price) {
      where.price = {};
      if (min_price) where.price.gte = parseFloat(min_price);
      if (max_price) where.price.lte = parseFloat(max_price);
    }

    if (location) {
      where.location = {
        contains: location,
        mode: 'insensitive'
      };
    }

    if (search_query) {
      where.OR = [
        {
          title: {
            contains: search_query,
            mode: 'insensitive'
          }
        },
        {
          description: {
            contains: search_query,
            mode: 'insensitive'
          }
        },
        {
          tags: {
            hasSome: [search_query]
          }
        }
      ];
    }

    if (is_featured !== undefined) {
      where.is_featured = Boolean(is_featured);
    }

    // Calculate offset
    const offset = (page - 1) * limit;

    // Get listings and total count
    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        include: {
          category: {
            select: { name: true }
          },
          vendor: {
            select: {
              username: true,
              business_name: true,
              vendor_verified: true
            }
          },
          images: {
            where: { is_primary: true },
            take: 1
          },
          _count: {
            select: {
              reviews: true
            }
          }
        },
        orderBy: {
          [sort_by]: sort_order
        },
        skip: offset,
        take: limit
      }),
      prisma.listing.count({ where })
    ]);

    return {
      data: listings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
        has_more: offset + listings.length < total
      }
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
 * @param {string} userId - User ID
 * @returns {Object} Updated listing
 */
const updateListing = async (listingId, updateData, userId) => {
  try {
    // Get existing listing
    const listing = await prisma.listing.findUnique({
      where: { id: listingId }
    });

    if (!listing) {
      throw new NotFoundError('Listing not found');
    }

    // Check ownership
    if (listing.vendor_id !== userId) {
      throw new UnauthorizedError('You can only update your own listings');
    }

    // Filter allowed update fields
    const allowedFields = [
      'title',
      'description',
      'price',
      'condition',
      'quantity',
      'tags',
      'weight',
      'dimensions',
      'location',
      'is_negotiable'
    ];

    const filteredData = {};
    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        filteredData[key] = updateData[key];
      }
    });

    if (Object.keys(filteredData).length === 0) {
      throw new ListingError('No valid fields to update');
    }

    // Update listing
    const updatedListing = await prisma.listing.update({
      where: { id: listingId },
      data: {
        ...filteredData,
        updated_at: new Date()
      },
      include: {
        category: true,
        vendor: {
          select: {
            username: true,
            business_name: true,
            vendor_verified: true
          }
        },
        images: true,
        videos: true,
        models_3d: true
      }
    });

    // Regenerate embeddings if text content changed
    if (filteredData.title || filteredData.description || filteredData.tags) {
      await generateListingEmbeddings(listingId, {
        title: updatedListing.title,
        description: updatedListing.description,
        tags: updatedListing.tags,
        category: updatedListing.category.name
      });
    }

    logger.info('Listing updated successfully', {
      listingId,
      vendorId: userId,
      updatedFields: Object.keys(filteredData)
    });

    return updatedListing;
  } catch (error) {
    logger.error('Update listing failed:', error);
    throw error;
  }
};

/**
 * Update listing status
 * @param {string} listingId - Listing ID
 * @param {string} status - New status
 * @param {string} userId - User ID
 * @returns {Object} Updated listing
 */
const updateListingStatus = async (listingId, status, userId, userRole) => {
  try {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId }
    });

    if (!listing) {
      throw new NotFoundError('Listing not found');
    }

    // Check permissions
    const isOwner = listing.vendor_id === userId;
    const isAdmin = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(userRole);

    if (!isOwner && !isAdmin) {
      throw new UnauthorizedError('You cannot update this listing status');
    }

    // Validate status transitions
    const allowedTransitions = {
      [LISTING_STATUS.DRAFT]: [LISTING_STATUS.PENDING_APPROVAL, LISTING_STATUS.REMOVED],
      [LISTING_STATUS.PENDING_APPROVAL]: [LISTING_STATUS.ACTIVE, LISTING_STATUS.REJECTED, LISTING_STATUS.REMOVED],
      [LISTING_STATUS.ACTIVE]: [LISTING_STATUS.SOLD, LISTING_STATUS.REMOVED],
      [LISTING_STATUS.SOLD]: [LISTING_STATUS.ACTIVE],
      [LISTING_STATUS.REJECTED]: [LISTING_STATUS.DRAFT, LISTING_STATUS.REMOVED],
      [LISTING_STATUS.REMOVED]: [LISTING_STATUS.DRAFT]
    };

    if (!allowedTransitions[listing.status]?.includes(status)) {
      throw new ListingError(`Cannot change status from ${listing.status} to ${status}`);
    }

    // Update status
    const updatedListing = await prisma.listing.update({
      where: { id: listingId },
      data: {
        status,
        updated_at: new Date()
      }
    });

    logger.info('Listing status updated', {
      listingId,
      oldStatus: listing.status,
      newStatus: status,
      updatedBy: userId
    });

    return updatedListing;
  } catch (error) {
    logger.error('Update listing status failed:', error);
    throw error;
  }
};

// ================================
// LISTING DELETION
// ================================

/**
 * Delete listing (soft delete)
 * @param {string} listingId - Listing ID
 * @param {string} userId - User ID
 * @returns {Object} Deletion result
 */
const deleteListing = async (listingId, userId, userRole) => {
  try {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId }
    });

    if (!listing) {
      throw new NotFoundError('Listing not found');
    }

    // Check permissions
    const isOwner = listing.vendor_id === userId;
    const isAdmin = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(userRole);

    if (!isOwner && !isAdmin) {
      throw new UnauthorizedError('You cannot delete this listing');
    }

    // Soft delete by updating status
    await prisma.listing.update({
      where: { id: listingId },
      data: {
        status: LISTING_STATUS.REMOVED,
        updated_at: new Date()
      }
    });

    logger.info('Listing deleted (soft)', {
      listingId,
      deletedBy: userId
    });

    return { success: true };
  } catch (error) {
    logger.error('Delete listing failed:', error);
    throw error;
  }
};

// ================================
// PLACEHOLDER FUNCTIONS
// ================================

/**
 * Generate text embedding (placeholder)
 * @param {string} text - Text to embed
 * @returns {Array|null} Embedding vector
 */
const generateTextEmbedding = async (text) => {
  try {
    // TODO: Implement with OpenAI or HuggingFace API
    // For now, return null to skip embedding generation
    return null;
  } catch (error) {
    logger.error('Generate text embedding failed:', error);
    return null;
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Core CRUD operations
  createListing,
  getListingById,
  getListings,
  updateListing,
  updateListingStatus,
  deleteListing,

  // File processing
  processListingFiles,
  processAndSaveImage,
  processAndSaveVideo,
  processAndSave3DModel,

  // Search and embeddings
  generateListingEmbeddings,

  // Error classes
  ListingError,
  NotFoundError,
  UnauthorizedError
};