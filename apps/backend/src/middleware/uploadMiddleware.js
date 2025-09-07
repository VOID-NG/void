// apps/backend/src/middleware/uploadMiddleware.js
// Secure file upload middleware for VOID Marketplace

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const fs = require('fs').promises;
const { ALLOWED_FILE_TYPES, BUSINESS_RULES } = require('../config/constants');
const { FileUploadError } = require('./errorMiddleware');
const logger = require('../utils/logger');

// ================================
// SECURITY UTILITIES
// ================================

/**
 * Generate secure filename
 * @param {string} originalName - Original filename
 * @param {string} prefix - File prefix
 * @returns {string} Secure filename
 */
const generateSecureFilename = (originalName, prefix = '') => {
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(8).toString('hex');
  const extension = path.extname(originalName).toLowerCase();
  
  // Sanitize extension
  const sanitizedExtension = extension.replace(/[^a-z0-9.]/gi, '');
  
  return `${prefix}${timestamp}_${randomBytes}${sanitizedExtension}`;
};

/**
 * Validate file type based on magic numbers (file signatures)
 * @param {Buffer} buffer - File buffer
 * @param {string} mimetype - Reported MIME type
 * @returns {Object} Validation result
 */
const validateFileSignature = (buffer, mimetype) => {
  if (!buffer || buffer.length < 4) {
    return { isValid: false, reason: 'File too small or empty' };
  }

  // Common file signatures (magic numbers)
  const signatures = {
    // Images
    'image/jpeg': [
      [0xFF, 0xD8, 0xFF], // JPEG
    ],
    'image/png': [
      [0x89, 0x50, 0x4E, 0x47], // PNG
    ],
    'image/gif': [
      [0x47, 0x49, 0x46, 0x38], // GIF
    ],
    'image/webp': [
      [0x52, 0x49, 0x46, 0x46], // WEBP (RIFF)
    ],
    // Videos
    'video/mp4': [
      [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], // MP4
      [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], // MP4
    ],
    'video/webm': [
      [0x1A, 0x45, 0xDF, 0xA3], // WebM
    ],
    // Documents
    'application/pdf': [
      [0x25, 0x50, 0x44, 0x46], // PDF
    ]
  };

  const fileSignatures = signatures[mimetype];
  if (!fileSignatures) {
    return { isValid: true, reason: 'Unknown type, allowing' };
  }

  // Check if buffer starts with any valid signature
  for (const signature of fileSignatures) {
    let match = true;
    for (let i = 0; i < signature.length; i++) {
      if (buffer[i] !== signature[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      return { isValid: true, reason: 'Valid signature' };
    }
  }

  return { isValid: false, reason: 'Invalid file signature' };
};

/**
 * Scan file for malicious content (placeholder for virus scanning)
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Filename
 * @returns {Promise<Object>} Scan result
 */
const scanFileForThreats = async (buffer, filename) => {
  try {
    // TODO: Integrate with ClamAV or similar antivirus
    // For now, perform basic checks
    
    // Check for suspicious patterns in filename
    const suspiciousPatterns = [
      /\.exe$/i,
      /\.bat$/i,
      /\.cmd$/i,
      /\.scr$/i,
      /\.com$/i,
      /\.pif$/i,
      /\.vbs$/i,
      /\.js$/i,
      /\.jar$/i,
      /\.php$/i,
      /\.asp$/i,
      /\.jsp$/i
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(filename)) {
        return {
          isClean: false,
          threat: 'suspicious_extension',
          reason: `Potentially dangerous file extension`
        };
      }
    }

    // Check for embedded executables in image files
    if (buffer.includes(Buffer.from('MZ'))) { // Windows PE header
      return {
        isClean: false,
        threat: 'embedded_executable',
        reason: 'Executable code detected in file'
      };
    }

    // Check file size against mime type expectations
    const sizeThresholds = {
      'image/jpeg': 20 * 1024 * 1024, // 20MB
      'image/png': 20 * 1024 * 1024,  // 20MB
      'video/mp4': 100 * 1024 * 1024, // 100MB
      'application/pdf': 50 * 1024 * 1024 // 50MB
    };

    // Basic scan passed
    return {
      isClean: true,
      threat: null,
      reason: 'No threats detected'
    };
  } catch (error) {
    logger.error('File threat scan failed:', error);
    return {
      isClean: false,
      threat: 'scan_error',
      reason: 'Unable to scan file for threats'
    };
  }
};

// ================================
// STORAGE CONFIGURATION
// ================================

/**
 * Configure multer storage
 */
const storage = multer.memoryStorage(); // Use memory storage for processing

/**
 * File filter function
 * @param {Object} req - Express request
 * @param {Object} file - Multer file object
 * @param {Function} cb - Callback function
 */
const fileFilter = (req, file, cb) => {
  try {
    const { fieldname, mimetype, originalname } = file;
    
    // Check allowed file types based on field
    let allowedTypes = [];
    
    switch (fieldname) {
      case 'images':
      case 'image':
      case 'avatar':
        allowedTypes = ALLOWED_FILE_TYPES.IMAGES;
        break;
      case 'videos':
      case 'video':
        allowedTypes = ALLOWED_FILE_TYPES.VIDEOS;
        break;
      case 'models_3d':
      case 'model':
        allowedTypes = ALLOWED_FILE_TYPES.MODELS_3D;
        break;
      case 'documents':
      case 'document':
        allowedTypes = ALLOWED_FILE_TYPES.DOCUMENTS;
        break;
      default:
        return cb(new FileUploadError(`Unknown file field: ${fieldname}`));
    }

    // Check MIME type
    if (!allowedTypes.includes(mimetype)) {
      return cb(new FileUploadError(
        `File type ${mimetype} not allowed for field ${fieldname}`
      ));
    }

    // Check filename for path traversal
    if (originalname.includes('..') || originalname.includes('/') || originalname.includes('\\')) {
      return cb(new FileUploadError('Invalid filename'));
    }

    // Check filename length
    if (originalname.length > 255) {
      return cb(new FileUploadError('Filename too long'));
    }

    cb(null, true);
  } catch (error) {
    cb(new FileUploadError('File validation failed'));
  }
};

// ================================
// MULTER CONFIGURATIONS
// ================================

/**
 * General file upload configuration
 */
const uploadConfig = {
  storage,
  fileFilter,
  limits: {
    fileSize: BUSINESS_RULES.MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 20, // Maximum number of files
    fields: 10, // Maximum number of non-file fields
    fieldNameSize: 100, // Maximum field name size
    fieldSize: 1024 * 1024, // Maximum field value size (1MB)
    headerPairs: 2000 // Maximum number of header key-value pairs
  }
};

/**
 * Image upload configuration
 */
const imageUploadConfig = {
  ...uploadConfig,
  limits: {
    ...uploadConfig.limits,
    fileSize: BUSINESS_RULES.MAX_IMAGE_SIZE_MB * 1024 * 1024,
    files: BUSINESS_RULES.MAX_IMAGES_PER_LISTING
  }
};

/**
 * Video upload configuration
 */
const videoUploadConfig = {
  ...uploadConfig,
  limits: {
    ...uploadConfig.limits,
    fileSize: BUSINESS_RULES.MAX_VIDEO_SIZE_MB * 1024 * 1024,
    files: BUSINESS_RULES.MAX_VIDEOS_PER_LISTING
  }
};

/**
 * 3D model upload configuration
 */
const modelUploadConfig = {
  ...uploadConfig,
  limits: {
    ...uploadConfig.limits,
    fileSize: BUSINESS_RULES.MAX_3D_MODEL_SIZE_MB * 1024 * 1024,
    files: BUSINESS_RULES.MAX_3D_MODELS_PER_LISTING
  }
};

// ================================
// MIDDLEWARE FUNCTIONS
// ================================

/**
 * Generic file upload middleware
 */
const uploadFiles = multer(uploadConfig);

/**
 * Image upload middleware
 */
const uploadImages = multer(imageUploadConfig);

/**
 * Video upload middleware
 */
const uploadVideos = multer(videoUploadConfig);

/**
 * 3D model upload middleware
 */
const uploadModels = multer(modelUploadConfig);

/**
 * Single avatar upload
 */
const uploadAvatar = multer({
  ...imageUploadConfig,
  limits: {
    ...imageUploadConfig.limits,
    fileSize: 5 * 1024 * 1024, // 5MB for avatars
    files: 1
  }
}).single('avatar');

/**
 * Multiple listing files upload
 */
const uploadListingFiles = multer(uploadConfig).fields([
  { name: 'images', maxCount: BUSINESS_RULES.MAX_IMAGES_PER_LISTING },
  { name: 'videos', maxCount: BUSINESS_RULES.MAX_VIDEOS_PER_LISTING },
  { name: 'models_3d', maxCount: BUSINESS_RULES.MAX_3D_MODELS_PER_LISTING }
]);

// ================================
// SECURITY VALIDATION MIDDLEWARE
// ================================

/**
 * Advanced file security validation
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const validateFilesSecurity = async (req, res, next) => {
  try {
    if (!req.files && !req.file) {
      return next(); // No files to validate
    }

    const filesToValidate = [];
    
    // Collect all files for validation
    if (req.file) {
      filesToValidate.push(req.file);
    }
    
    if (req.files) {
      if (Array.isArray(req.files)) {
        filesToValidate.push(...req.files);
      } else {
        // req.files is an object with field names as keys
        Object.values(req.files).forEach(fileArray => {
          if (Array.isArray(fileArray)) {
            filesToValidate.push(...fileArray);
          } else {
            filesToValidate.push(fileArray);
          }
        });
      }
    }

    // Validate each file
    for (const file of filesToValidate) {
      // Validate file signature
      const signatureCheck = validateFileSignature(file.buffer, file.mimetype);
      if (!signatureCheck.isValid) {
        throw new FileUploadError(
          `Invalid file signature: ${signatureCheck.reason}`,
          'invalid_signature'
        );
      }

      // Scan for threats
      const threatScan = await scanFileForThreats(file.buffer, file.originalname);
      if (!threatScan.isClean) {
        logger.warn('Malicious file detected:', {
          filename: file.originalname,
          threat: threatScan.threat,
          reason: threatScan.reason,
          userId: req.user?.id,
          ip: req.ip
        });
        
        throw new FileUploadError(
          'File contains malicious content',
          'security_threat'
        );
      }

      // Add security metadata to file object
      file.securityChecked = true;
      file.securityTimestamp = new Date();
      file.secureFilename = generateSecureFilename(file.originalname, `${file.fieldname}_`);
    }

    next();
  } catch (error) {
    logger.error('File security validation failed:', error);
    next(error);
  }
};

/**
 * Image optimization middleware
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const optimizeImages = async (req, res, next) => {
  try {
    if (!req.files && !req.file) {
      return next();
    }

    const imageFiles = [];
    
    // Collect image files
    if (req.file && req.file.mimetype.startsWith('image/')) {
      imageFiles.push(req.file);
    }
    
    if (req.files) {
      Object.values(req.files).forEach(fileArray => {
        if (Array.isArray(fileArray)) {
          imageFiles.push(...fileArray.filter(f => f.mimetype.startsWith('image/')));
        } else if (fileArray.mimetype?.startsWith('image/')) {
          imageFiles.push(fileArray);
        }
      });
    }

    // Optimize each image
    for (const imageFile of imageFiles) {
      if (imageFile.mimetype === 'image/gif') {
        // Skip GIF optimization to preserve animation
        continue;
      }

      try {
        // Optimize with Sharp
        const optimizedBuffer = await sharp(imageFile.buffer)
          .resize(2048, 2048, { 
            fit: 'inside',
            withoutEnlargement: true 
          })
          .jpeg({ 
            quality: 85,
            progressive: true 
          })
          .toBuffer();

        // Update file buffer and size
        imageFile.buffer = optimizedBuffer;
        imageFile.size = optimizedBuffer.length;
        imageFile.optimized = true;
        
      } catch (optimizationError) {
        logger.warn('Image optimization failed:', {
          filename: imageFile.originalname,
          error: optimizationError.message
        });
        // Continue with original file if optimization fails
      }
    }

    next();
  } catch (error) {
    logger.error('Image optimization failed:', error);
    next(error);
  }
};

// ================================
// ERROR HANDLING
// ================================

/**
 * Handle upload errors
 * @param {Error} error - Upload error
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return next(new FileUploadError('File too large'));
      case 'LIMIT_FILE_COUNT':
        return next(new FileUploadError('Too many files'));
      case 'LIMIT_UNEXPECTED_FILE':
        return next(new FileUploadError('Unexpected file field'));
      case 'LIMIT_FIELD_KEY':
        return next(new FileUploadError('Field name too long'));
      case 'LIMIT_FIELD_VALUE':
        return next(new FileUploadError('Field value too long'));
      case 'LIMIT_FIELD_COUNT':
        return next(new FileUploadError('Too many fields'));
      case 'LIMIT_PART_COUNT':
        return next(new FileUploadError('Too many parts'));
      default:
        return next(new FileUploadError('Upload failed'));
    }
  }
  
  next(error);
};

// ================================
// CLEANUP UTILITIES
// ================================

/**
 * Clean up temporary files
 * @param {Array} files - Files to clean up
 */
const cleanupTempFiles = async (files = []) => {
  try {
    const cleanupPromises = files.map(async (file) => {
      if (file.path) {
        try {
          await fs.unlink(file.path);
        } catch (error) {
          // File might already be deleted, ignore error
        }
      }
    });
    
    await Promise.all(cleanupPromises);
  } catch (error) {
    logger.error('Cleanup temp files failed:', error);
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Multer configurations
  uploadFiles,
  uploadImages,
  uploadVideos,
  uploadModels,
  uploadAvatar,
  uploadListingFiles,
  
  // Security middleware
  validateFilesSecurity,
  optimizeImages,
  handleUploadError,
  
  // Utility functions
  generateSecureFilename,
  validateFileSignature,
  scanFileForThreats,
  cleanupTempFiles
};