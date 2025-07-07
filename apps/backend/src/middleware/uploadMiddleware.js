// apps/backend/src/middleware/uploadMiddleware.js
// File upload middleware for VOID Marketplace - handles images, videos, 3D models

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const { UPLOAD_LIMITS, ERROR_CODES } = require('../config/constants');
const { ValidationError } = require('./errorMiddleware');
const logger = require('../utils/logger');

// ================================
// UPLOAD DIRECTORIES
// ================================

const uploadPaths = {
  images: 'uploads/images',
  videos: 'uploads/videos',
  models: 'uploads/models',
  avatars: 'uploads/avatars',
  temp: 'uploads/temp'
};

// Create upload directories if they don't exist
const createUploadDirs = async () => {
  try {
    for (const dir of Object.values(uploadPaths)) {
      await fs.mkdir(dir, { recursive: true });
    }
    logger.info('Upload directories created/verified');
  } catch (error) {
    logger.error('Error creating upload directories:', error);
  }
};

// Initialize directories on module load
createUploadDirs();

// ================================
// FILE VALIDATION FUNCTIONS
// ================================

const validateFileType = (file, allowedTypes, allowedExtensions) => {
  const fileExtension = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype;

  if (!allowedTypes.includes(mimeType)) {
    throw new ValidationError(
      `Invalid file type. Allowed types: ${allowedTypes.join(', ')}`,
      { code: ERROR_CODES.UPLOAD_INVALID_TYPE, allowedTypes }
    );
  }

  if (!allowedExtensions.includes(fileExtension)) {
    throw new ValidationError(
      `Invalid file extension. Allowed extensions: ${allowedExtensions.join(', ')}`,
      { code: ERROR_CODES.UPLOAD_INVALID_TYPE, allowedExtensions }
    );
  }

  return true;
};

const validateFileSize = (file, maxSize) => {
  if (file.size > maxSize) {
    throw new ValidationError(
      `File too large. Maximum size: ${Math.round(maxSize / 1024 / 1024)}MB`,
      { 
        code: ERROR_CODES.UPLOAD_FILE_TOO_LARGE, 
        maxSize, 
        actualSize: file.size 
      }
    );
  }
  return true;
};

const generateUniqueFilename = (originalname, userId = null) => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const extension = path.extname(originalname);
  const baseName = path.basename(originalname, extension)
    .replace(/[^a-zA-Z0-9]/g, '_')
    .substring(0, 20);
  
  const userPrefix = userId ? `${userId}_` : '';
  return `${userPrefix}${timestamp}_${random}_${baseName}${extension}`;
};

// ================================
// STORAGE CONFIGURATIONS
// ================================

const createStorage = (uploadPath, options = {}) => {
  return multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        await fs.mkdir(uploadPath, { recursive: true });
        cb(null, uploadPath);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      try {
        const userId = req.user?.id;
        const filename = generateUniqueFilename(file.originalname, userId);
        cb(null, filename);
      } catch (error) {
        cb(error);
      }
    }
  });
};

// ================================
// FILE FILTERS
// ================================

const createFileFilter = (config) => {
  return (req, file, cb) => {
    try {
      validateFileType(file, config.ALLOWED_TYPES, config.ALLOWED_EXTENSIONS);
      cb(null, true);
    } catch (error) {
      cb(error, false);
    }
  };
};

// ================================
// MULTER CONFIGURATIONS
// ================================

const imageUpload = multer({
  storage: createStorage(uploadPaths.images),
  limits: {
    fileSize: UPLOAD_LIMITS.IMAGES.MAX_SIZE,
    files: UPLOAD_LIMITS.IMAGES.MAX_COUNT
  },
  fileFilter: createFileFilter(UPLOAD_LIMITS.IMAGES)
});

const videoUpload = multer({
  storage: createStorage(uploadPaths.videos),
  limits: {
    fileSize: UPLOAD_LIMITS.VIDEOS.MAX_SIZE,
    files: UPLOAD_LIMITS.VIDEOS.MAX_COUNT
  },
  fileFilter: createFileFilter(UPLOAD_LIMITS.VIDEOS)
});

const modelUpload = multer({
  storage: createStorage(uploadPaths.models),
  limits: {
    fileSize: UPLOAD_LIMITS.MODELS_3D.MAX_SIZE,
    files: UPLOAD_LIMITS.MODELS_3D.MAX_COUNT
  },
  fileFilter: createFileFilter(UPLOAD_LIMITS.MODELS_3D)
});

const avatarUpload = multer({
  storage: createStorage(uploadPaths.avatars),
  limits: {
    fileSize: UPLOAD_LIMITS.AVATARS.MAX_SIZE,
    files: 1
  },
  fileFilter: createFileFilter(UPLOAD_LIMITS.AVATARS)
});

// ================================
// LISTING MEDIA UPLOAD (COMBINED)
// ================================

const listingMediaUpload = multer({
  storage: createStorage(uploadPaths.temp),
  limits: {
    fileSize: Math.max(
      UPLOAD_LIMITS.IMAGES.MAX_SIZE,
      UPLOAD_LIMITS.VIDEOS.MAX_SIZE,
      UPLOAD_LIMITS.MODELS_3D.MAX_SIZE
    ),
    files: UPLOAD_LIMITS.IMAGES.MAX_COUNT + 
           UPLOAD_LIMITS.VIDEOS.MAX_COUNT + 
           UPLOAD_LIMITS.MODELS_3D.MAX_COUNT
  },
  fileFilter: (req, file, cb) => {
    try {
      const fieldName = file.fieldname;
      
      switch (fieldName) {
        case 'images':
          validateFileType(file, UPLOAD_LIMITS.IMAGES.ALLOWED_TYPES, UPLOAD_LIMITS.IMAGES.ALLOWED_EXTENSIONS);
          validateFileSize(file, UPLOAD_LIMITS.IMAGES.MAX_SIZE);
          break;
        case 'videos':
          validateFileType(file, UPLOAD_LIMITS.VIDEOS.ALLOWED_TYPES, UPLOAD_LIMITS.VIDEOS.ALLOWED_EXTENSIONS);
          validateFileSize(file, UPLOAD_LIMITS.VIDEOS.MAX_SIZE);
          break;
        case 'models':
          validateFileType(file, UPLOAD_LIMITS.MODELS_3D.ALLOWED_TYPES, UPLOAD_LIMITS.MODELS_3D.ALLOWED_EXTENSIONS);
          validateFileSize(file, UPLOAD_LIMITS.MODELS_3D.MAX_SIZE);
          break;
        default:
          throw new ValidationError('Invalid field name for file upload');
      }
      
      cb(null, true);
    } catch (error) {
      cb(error, false);
    }
  }
});

// ================================
// IMAGE PROCESSING
// ================================

const processImage = async (filePath, options = {}) => {
  try {
    const {
      width = 1200,
      height = 1200,
      quality = 85,
      format = 'jpeg',
      createThumbnail = true,
      thumbnailSize = 300
    } = options;

    const processedPath = filePath.replace(/\.[^/.]+$/, `_processed.${format}`);
    const thumbnailPath = filePath.replace(/\.[^/.]+$/, `_thumb.${format}`);

    // Process main image
    await sharp(filePath)
      .resize(width, height, { 
        fit: 'inside',
        withoutEnlargement: true 
      })
      .jpeg({ quality })
      .toFile(processedPath);

    // Create thumbnail if requested
    if (createThumbnail) {
      await sharp(filePath)
        .resize(thumbnailSize, thumbnailSize, { 
          fit: 'cover' 
        })
        .jpeg({ quality: 70 })
        .toFile(thumbnailPath);
    }

    // Remove original file
    await fs.unlink(filePath);

    return {
      processedPath,
      thumbnailPath: createThumbnail ? thumbnailPath : null
    };
  } catch (error) {
    logger.error('Image processing failed:', error);
    throw new Error('Image processing failed');
  }
};

// ================================
// VIDEO VALIDATION
// ================================

const validateVideo = async (filePath) => {
  try {
    // Basic video validation
    const stats = await fs.stat(filePath);
    
    if (stats.size > UPLOAD_LIMITS.VIDEOS.MAX_SIZE) {
      throw new ValidationError('Video file too large');
    }

    // TODO: Add ffprobe integration for duration validation
    // For now, we'll do basic file validation
    
    return {
      size: stats.size,
      valid: true
    };
  } catch (error) {
    logger.error('Video validation failed:', error);
    throw error;
  }
};

// ================================
// 3D MODEL VALIDATION
// ================================

const validate3DModel = async (filePath) => {
  try {
    const stats = await fs.stat(filePath);
    const extension = path.extname(filePath).toLowerCase();
    
    if (stats.size > UPLOAD_LIMITS.MODELS_3D.MAX_SIZE) {
      throw new ValidationError('3D model file too large');
    }

    // Basic format validation
    if (!['.glb', '.obj', '.gltf'].includes(extension)) {
      throw new ValidationError('Invalid 3D model format');
    }

    return {
      size: stats.size,
      format: extension,
      valid: true
    };
  } catch (error) {
    logger.error('3D model validation failed:', error);
    throw error;
  }
};

// ================================
// FILE ORGANIZATION
// ================================

const organizeUploadedFiles = async (files, userId, listingId = null) => {
  const organized = {
    images: [],
    videos: [],
    models: []
  };

  try {
    for (const file of files) {
      const finalDir = file.fieldname === 'images' ? uploadPaths.images :
                      file.fieldname === 'videos' ? uploadPaths.videos :
                      uploadPaths.models;

      const finalPath = path.join(finalDir, path.basename(file.path));
      
      // Move file from temp to final location
      await fs.rename(file.path, finalPath);

      const fileInfo = {
        originalName: file.originalname,
        filename: path.basename(finalPath),
        path: finalPath,
        url: `/uploads/${file.fieldname}/${path.basename(finalPath)}`,
        size: file.size,
        mimeType: file.mimetype
      };

      // Process based on file type
      if (file.fieldname === 'images') {
        const processed = await processImage(finalPath);
        fileInfo.processedPath = processed.processedPath;
        fileInfo.thumbnailPath = processed.thumbnailPath;
        fileInfo.processedUrl = processed.processedPath.replace('uploads/', '/uploads/');
        fileInfo.thumbnailUrl = processed.thumbnailPath?.replace('uploads/', '/uploads/');
        organized.images.push(fileInfo);
      } else if (file.fieldname === 'videos') {
        await validateVideo(finalPath);
        organized.videos.push(fileInfo);
      } else if (file.fieldname === 'models') {
        await validate3DModel(finalPath);
        organized.models.push(fileInfo);
      }
    }

    return organized;
  } catch (error) {
    // Clean up files on error
    for (const file of files) {
      try {
        await fs.unlink(file.path);
      } catch (unlinkError) {
        logger.error('Failed to clean up file:', unlinkError);
      }
    }
    throw error;
  }
};

// ================================
// MIDDLEWARE WRAPPERS
// ================================

const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large',
        code: ERROR_CODES.UPLOAD_FILE_TOO_LARGE,
        message: `Maximum file size exceeded`
      });
    }
    
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Too many files',
        code: ERROR_CODES.UPLOAD_FILE_TOO_LARGE,
        message: 'Maximum number of files exceeded'
      });
    }
    
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        error: 'Unexpected file field',
        code: ERROR_CODES.UPLOAD_INVALID_TYPE,
        message: `Unexpected field: ${err.field}`
      });
    }
  }
  
  if (err instanceof ValidationError) {
    return res.status(400).json({
      success: false,
      error: err.message,
      code: err.code,
      details: err.details
    });
  }
  
  next(err);
};

// ================================
// CLEANUP UTILITIES
// ================================

const cleanupTempFiles = async (maxAge = 24 * 60 * 60 * 1000) => {
  try {
    const tempDir = uploadPaths.temp;
    const files = await fs.readdir(tempDir);
    const now = Date.now();
    
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stats = await fs.stat(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        await fs.unlink(filePath);
        logger.debug(`Cleaned up temp file: ${file}`);
      }
    }
  } catch (error) {
    logger.error('Error cleaning up temp files:', error);
  }
};

const deleteFile = async (filePath) => {
  try {
    await fs.unlink(filePath);
    logger.debug(`Deleted file: ${filePath}`);
  } catch (error) {
    logger.error(`Error deleting file ${filePath}:`, error);
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Individual upload middleware
  uploadImages: imageUpload.array('images', UPLOAD_LIMITS.IMAGES.MAX_COUNT),
  uploadVideo: videoUpload.single('video'),
  uploadModels: modelUpload.array('models', UPLOAD_LIMITS.MODELS_3D.MAX_COUNT),
  uploadAvatar: avatarUpload.single('avatar'),
  
  // Combined listing media upload
  uploadListingMedia: listingMediaUpload.fields([
    { name: 'images', maxCount: UPLOAD_LIMITS.IMAGES.MAX_COUNT },
    { name: 'videos', maxCount: UPLOAD_LIMITS.VIDEOS.MAX_COUNT },
    { name: 'models', maxCount: UPLOAD_LIMITS.MODELS_3D.MAX_COUNT }
  ]),
  
  // Processing functions
  processImage,
  validateVideo,
  validate3DModel,
  organizeUploadedFiles,
  
  // Error handling
  handleUploadError,
  
  // Utilities
  cleanupTempFiles,
  deleteFile,
  uploadPaths,
  
  // Validation functions
  validateFileType,
  validateFileSize,
  generateUniqueFilename
};