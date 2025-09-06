// apps/backend/src/utils/imageEmbeddingUtils.js
// AI-powered image embedding generation for search functionality

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const FormData = require('form-data');
const { prisma } = require('../config/db');
const logger = require('./logger');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { tryConsume } = require('./rateLimiter');

// ================================
// CONFIGURATION
// ================================

const EMBEDDING_CONFIG = {
  // OpenAI CLIP model configuration
  OPENAI_API_URL: 'https://api.openai.com/v1/embeddings',
  MODEL: 'text-embedding-ada-002', // Can also use CLIP when available
  MAX_IMAGE_SIZE: 4 * 1024 * 1024, // 4MB
  SUPPORTED_FORMATS: ['jpg', 'jpeg', 'png', 'webp'],
  EMBEDDING_DIMENSIONS: 1536,
  
  // Alternative embedding services
  HUGGINGFACE_API_URL: 'https://api-inference.huggingface.co/models/sentence-transformers/clip-ViT-B-32',
  
  // Local embedding model (for offline mode)
  LOCAL_MODEL_ENABLED: process.env.LOCAL_EMBEDDING_MODEL === 'true',
  
  // Batch processing
  BATCH_SIZE: 10,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  // Gemini free-tier friendly settings
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  GEMINI_RPM: parseInt(process.env.GEMINI_RPM || '15', 10)
};

// ================================
// IMAGE PREPROCESSING
// ================================

/**
 * Preprocess image for embedding generation
 * @param {string} imagePath - Path to the image file
 * @param {Object} options - Processing options
 * @returns {Promise<Buffer>} Processed image buffer
 */
const preprocessImage = async (imagePath, options = {}) => {
  try {
    const {
      width = 224,
      height = 224,
      quality = 90,
      format = 'jpeg'
    } = options;

    logger.debug('Preprocessing image for embedding', { imagePath, options });

    // Read and process image with Sharp
    const processedImage = await sharp(imagePath)
      .resize(width, height, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality })
      .toBuffer();

    logger.debug('Image preprocessed successfully', {
      originalPath: imagePath,
      newSize: processedImage.length
    });

    return processedImage;

  } catch (error) {
    logger.error('Image preprocessing failed:', error);
    throw new Error(`Failed to preprocess image: ${error.message}`);
  }
};

/**
 * Extract image features for text description
 * @param {string} imagePath - Path to the image
 * @returns {Promise<string>} Generated description
 */
const extractImageFeatures = async (imagePath) => {
  try {
    // Try Gemini first for a concise product-oriented description
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (apiKey) {
      // Respect free-tier rate limit
      const rl = tryConsume('gemini', EMBEDDING_CONFIG.GEMINI_RPM);
      if (rl.allowed) {
        try {
          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({ model: EMBEDDING_CONFIG.GEMINI_MODEL });

          const imageBuffer = await sharp(imagePath).jpeg({ quality: 90 }).toBuffer();
          const base64 = imageBuffer.toString('base64');
          const prompt = 'Describe this product in one concise sentence for marketplace search. Include: product type, brand (if visible), color, and one key feature. Keep it under 50 words.';
          const imagePart = { inlineData: { data: base64, mimeType: 'image/jpeg' } };
          const result = await model.generateContent([prompt, imagePart]);
          const description = (result.response && result.response.text ? result.response.text() : '').trim();
          if (description) {
            return description;
          }
        } catch (gemErr) {
          logger.warn('Gemini description failed, falling back to metadata', { error: gemErr.message });
        }
      } else {
        logger.debug('Gemini rate limited, using metadata fallback', { waitMs: rl.waitMs });
      }
    }

    // Fallback: extract basic features from filename and metadata
    const filename = path.basename(imagePath, path.extname(imagePath));
    const metadata = await sharp(imagePath).metadata();
    const features = [
      filename.replace(/[-_]/g, ' '),
      `${metadata.width}x${metadata.height}`,
      metadata.format,
      metadata.density ? `${metadata.density}dpi` : null
    ].filter(Boolean).join(' ');

    return features;

  } catch (error) {
    logger.error('Feature extraction failed:', error);
    return path.basename(imagePath, path.extname(imagePath)).replace(/[-_]/g, ' ');
  }
};

// ================================
// EMBEDDING GENERATION
// ================================

/**
 * Generate embedding using OpenAI API
 * @param {string} content - Text content or image description
 * @param {string} type - 'text' or 'image'
 * @returns {Promise<number[]>} Embedding vector
 */
const generateOpenAIEmbedding = async (content, type = 'text') => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    logger.debug('Generating OpenAI embedding', { contentLength: content.length, type });

    const response = await axios.post(
      EMBEDDING_CONFIG.OPENAI_API_URL,
      {
        model: EMBEDDING_CONFIG.MODEL,
        input: content,
        encoding_format: 'float'
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const embedding = response.data.data[0].embedding;
    
    logger.debug('OpenAI embedding generated successfully', {
      dimensions: embedding.length,
      usage: response.data.usage
    });

    return embedding;

  } catch (error) {
    logger.error('OpenAI embedding generation failed:', error);
    throw new Error(`OpenAI embedding failed: ${error.message}`);
  }
};

/**
 * Generate embedding using Hugging Face
 * @param {string} content - Content to embed
 * @returns {Promise<number[]>} Embedding vector
 */
const generateHuggingFaceEmbedding = async (content) => {
  try {
    const apiKey = process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) {
      throw new Error('Hugging Face API key not configured');
    }

    const response = await axios.post(
      EMBEDDING_CONFIG.HUGGINGFACE_API_URL,
      { inputs: content },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    return response.data;

  } catch (error) {
    logger.error('Hugging Face embedding generation failed:', error);
    throw new Error(`Hugging Face embedding failed: ${error.message}`);
  }
};

/**
 * Generate local embedding (for offline mode)
 * @param {string} content - Content to embed
 * @returns {Promise<number[]>} Embedding vector
 */
const generateLocalEmbedding = async (content) => {
  try {
    // This would use a local model like sentence-transformers
    // For now, return a mock embedding for development
    logger.warn('Using mock local embedding - implement with actual local model');
    
    // Generate a consistent but fake embedding based on content hash
    const hash = require('crypto').createHash('md5').update(content).digest('hex');
    const embedding = [];
    
    for (let i = 0; i < EMBEDDING_CONFIG.EMBEDDING_DIMENSIONS; i++) {
      const char = hash[i % hash.length];
      embedding.push((parseInt(char, 16) - 7.5) / 7.5); // Normalize to [-1, 1]
    }
    
    return embedding;

  } catch (error) {
    logger.error('Local embedding generation failed:', error);
    throw new Error(`Local embedding failed: ${error.message}`);
  }
};

/**
 * Generate embedding with automatic fallback
 * @param {string} content - Content to embed
 * @param {string} type - 'text' or 'image'
 * @returns {Promise<number[]>} Embedding vector
 */
const generateEmbedding = async (content, type = 'text') => {
  const strategies = [
    () => generateOpenAIEmbedding(content, type),
    () => generateHuggingFaceEmbedding(content),
    () => generateLocalEmbedding(content)
  ];

  for (let i = 0; i < strategies.length; i++) {
    try {
      const embedding = await strategies[i]();
      
      if (embedding && embedding.length > 0) {
        logger.info('Embedding generated successfully', {
          strategy: i === 0 ? 'OpenAI' : i === 1 ? 'HuggingFace' : 'Local',
          dimensions: embedding.length,
          type
        });
        return embedding;
      }
    } catch (error) {
      logger.warn(`Embedding strategy ${i} failed:`, error.message);
      if (i === strategies.length - 1) {
        throw error;
      }
    }
  }

  throw new Error('All embedding strategies failed');
};

// ================================
// MAIN EMBEDDING FUNCTIONS
// ================================

/**
 * Generate and store text embedding for a listing
 * @param {string} listingId - Listing ID
 * @param {Object} textContent - Text content object
 * @returns {Promise<string>} Embedding ID
 */
const generateListingTextEmbedding = async (listingId, textContent) => {
  try {
    const { title, description, tags = [] } = textContent;
    
    // Combine all text content
    const combinedText = [
      title,
      description,
      tags.join(' ')
    ].filter(Boolean).join(' ');

    if (!combinedText.trim()) {
      throw new Error('No text content provided for embedding');
    }

    logger.info('Generating text embedding for listing', { listingId });

    // Generate embedding
    const embedding = await generateEmbedding(combinedText, 'text');

    // Store in database
    const embeddingRecord = await prisma.listingEmbedding.upsert({
      where: {
        listing_id_embedding_type_source_url: {
          listing_id: listingId,
          embedding_type: 'text',
          source_url: null
        }
      },
      update: {
        embedding_vector: JSON.stringify(embedding),
        source_content: combinedText,
        updated_at: new Date()
      },
      create: {
        listing_id: listingId,
        embedding_type: 'text',
        embedding_vector: JSON.stringify(embedding),
        source_content: combinedText,
        confidence_score: 1.0
      }
    });

    logger.info('Text embedding stored successfully', {
      listingId,
      embeddingId: embeddingRecord.id
    });

    return embeddingRecord.id;

  } catch (error) {
    logger.error('Text embedding generation failed:', error);
    throw error;
  }
};

/**
 * Generate and store image embedding for a listing
 * @param {string} listingId - Listing ID
 * @param {string} imageUrl - Image URL or path
 * @returns {Promise<string>} Embedding ID
 */
const generateListingImageEmbedding = async (listingId, imageUrl) => {
  try {
    logger.info('Generating image embedding for listing', { listingId, imageUrl });

    // Extract image features as text description
    const imagePath = imageUrl.startsWith('http') 
      ? await downloadImage(imageUrl)
      : imageUrl;

    const imageFeatures = await extractImageFeatures(imagePath);
    
    // Generate embedding from image features
    const embedding = await generateEmbedding(imageFeatures, 'image');

    // Store in database
    const embeddingRecord = await prisma.listingEmbedding.upsert({
      where: {
        listing_id_embedding_type_source_url: {
          listing_id: listingId,
          embedding_type: 'image',
          source_url: imageUrl
        }
      },
      update: {
        embedding_vector: JSON.stringify(embedding),
        source_content: imageFeatures,
        updated_at: new Date()
      },
      create: {
        listing_id: listingId,
        embedding_type: 'image',
        embedding_vector: JSON.stringify(embedding),
        source_content: imageFeatures,
        source_url: imageUrl,
        confidence_score: 0.8 // Lower confidence for image-derived text
      }
    });

    logger.info('Image embedding stored successfully', {
      listingId,
      imageUrl,
      embeddingId: embeddingRecord.id
    });

    return embeddingRecord.id;

  } catch (error) {
    logger.error('Image embedding generation failed:', error);
    throw error;
  }
};

/**
 * Generate embeddings for all listing content
 * @param {string} listingId - Listing ID
 * @param {Object} content - Listing content
 * @returns {Promise<Object>} Generated embedding IDs
 */
const generateListingEmbeddings = async (listingId, content) => {
  try {
    const { title, description, tags, images = [] } = content;
    const results = {};

    // Generate text embedding
    if (title || description || (tags && tags.length > 0)) {
      results.textEmbeddingId = await generateListingTextEmbedding(listingId, {
        title,
        description,
        tags
      });
    }

    // Generate image embeddings for primary image
    if (images.length > 0) {
      const primaryImage = images.find(img => img.is_primary) || images[0];
      if (primaryImage) {
        results.imageEmbeddingId = await generateListingImageEmbedding(
          listingId,
          primaryImage.url
        );
      }
    }

    logger.info('All embeddings generated for listing', {
      listingId,
      textEmbedding: !!results.textEmbeddingId,
      imageEmbedding: !!results.imageEmbeddingId
    });

    return results;

  } catch (error) {
    logger.error('Listing embeddings generation failed:', error);
    throw error;
  }
};

// ================================
// SIMILARITY SEARCH
// ================================

/**
 * Find similar listings using vector similarity
 * @param {string} queryEmbedding - Query embedding vector
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Similar listings
 */
const findSimilarListings = async (queryEmbedding, options = {}) => {
  try {
    const {
      limit = 20,
      threshold = 0.7,
      embeddingType = 'text',
      excludeListingId = null
    } = options;

    const embeddingStr = JSON.stringify(queryEmbedding);

    // Use raw SQL for vector similarity search
    const query = `
      SELECT 
        le.listing_id,
        le.confidence_score,
        (le.embedding_vector <=> $1::vector) as similarity_distance,
        (1 - (le.embedding_vector <=> $1::vector)) as similarity_score,
        l.title,
        l.price,
        l.status
      FROM listing_embeddings le
      JOIN listings l ON le.listing_id = l.id
      WHERE le.embedding_type = $2
        AND l.status = 'ACTIVE'
        ${excludeListingId ? 'AND le.listing_id != $4' : ''}
        AND (1 - (le.embedding_vector <=> $1::vector)) >= $3
      ORDER BY le.embedding_vector <=> $1::vector ASC
      LIMIT $${excludeListingId ? '5' : '4'}
    `;

    const params = [
      embeddingStr,
      embeddingType,
      threshold,
      ...(excludeListingId ? [limit, excludeListingId] : [limit])
    ];

    const results = await prisma.$queryRawUnsafe(query, ...params);

    logger.debug('Vector similarity search completed', {
      queryDimensions: queryEmbedding.length,
      resultsCount: results.length,
      threshold,
      embeddingType
    });

    return results;

  } catch (error) {
    logger.error('Vector similarity search failed:', error);
    throw error;
  }
};

// ================================
// UTILITY FUNCTIONS
// ================================

/**
 * Download image from URL for processing
 * @param {string} imageUrl - Image URL
 * @returns {Promise<string>} Local file path
 */
const downloadImage = async (imageUrl) => {
  try {
    const response = await axios.get(imageUrl, { responseType: 'stream' });
    const filename = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
    const filepath = path.join(process.cwd(), 'uploads', 'temp', filename);
    
    // Ensure temp directory exists
    const tempDir = path.dirname(filepath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const writer = fs.createWriteStream(filepath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(filepath));
      writer.on('error', reject);
    });

  } catch (error) {
    logger.error('Image download failed:', error);
    throw error;
  }
};

/**
 * Clean up temporary files
 * @param {string} filePath - Path to temporary file
 */
const cleanupTempFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.debug('Temporary file cleaned up', { filePath });
    }
  } catch (error) {
    logger.warn('Failed to cleanup temporary file:', error);
  }
};

// ================================
// BATCH PROCESSING
// ================================

/**
 * Process embeddings for multiple listings in batch
 * @param {Array} listings - Array of listing objects
 * @returns {Promise<Object>} Batch processing results
 */
const batchProcessEmbeddings = async (listings) => {
  try {
    logger.info('Starting batch embedding processing', { count: listings.length });

    const results = {
      successful: 0,
      failed: 0,
      errors: []
    };

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < listings.length; i += EMBEDDING_CONFIG.BATCH_SIZE) {
      const batch = listings.slice(i, i + EMBEDDING_CONFIG.BATCH_SIZE);
      
      await Promise.allSettled(
        batch.map(async (listing) => {
          try {
            await generateListingEmbeddings(listing.id, listing);
            results.successful++;
          } catch (error) {
            results.failed++;
            results.errors.push({
              listingId: listing.id,
              error: error.message
            });
          }
        })
      );

      // Rate limiting pause
      if (i + EMBEDDING_CONFIG.BATCH_SIZE < listings.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    logger.info('Batch embedding processing completed', results);
    return results;

  } catch (error) {
    logger.error('Batch embedding processing failed:', error);
    throw error;
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Main functions
  generateListingEmbeddings,
  generateListingTextEmbedding,
  generateListingImageEmbedding,
  
  // Search functions
  findSimilarListings,
  generateEmbedding,
  
  // Utility functions
  preprocessImage,
  extractImageFeatures,
  batchProcessEmbeddings,
  
  // Configuration
  EMBEDDING_CONFIG
};