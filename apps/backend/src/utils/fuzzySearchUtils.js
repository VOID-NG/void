// apps/backend/src/utils/fuzzySearchUtils.js
// Advanced fuzzy search and text matching utilities

const { prisma } = require('../config/db-original');
const logger = require('./logger');

// ================================
// CONFIGURATION
// ================================

const SEARCH_CONFIG = {
  // Similarity thresholds
  MIN_SIMILARITY_SCORE: 0.3,
  EXCELLENT_MATCH_THRESHOLD: 0.8,
  GOOD_MATCH_THRESHOLD: 0.6,
  
  // Search weights
  TITLE_WEIGHT: 0.4,
  DESCRIPTION_WEIGHT: 0.3,
  TAGS_WEIGHT: 0.2,
  CATEGORY_WEIGHT: 0.1,
  
  // Autocomplete settings
  MAX_SUGGESTIONS: 10,
  MIN_QUERY_LENGTH: 2,
  
  // Performance settings
  MAX_RESULTS: 100,
  SEARCH_TIMEOUT: 5000,
  
  // Common words to ignore
  STOP_WORDS: new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have',
    'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should'
  ])
};

// ================================
// STRING SIMILARITY ALGORITHMS
// ================================

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Edit distance
 */
const levenshteinDistance = (str1, str2) => {
  const matrix = [];
  const len1 = str1.length;
  const len2 = str2.length;

  for (let i = 0; i <= len2; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len1; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len2; i++) {
    for (let j = 1; j <= len1; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[len2][len1];
};

/**
 * Calculate similarity ratio based on Levenshtein distance
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity ratio (0-1)
 */
const similarityRatio = (str1, str2) => {
  const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
  const maxLength = Math.max(str1.length, str2.length);
  return maxLength === 0 ? 1 : (maxLength - distance) / maxLength;
};

/**
 * Calculate Jaro-Winkler similarity
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Jaro-Winkler similarity (0-1)
 */
const jaroWinklerSimilarity = (str1, str2) => {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  if (s1 === s2) return 1;
  
  const len1 = s1.length;
  const len2 = s2.length;
  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  
  if (matchWindow < 0) return 0;
  
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  
  let matches = 0;
  let transpositions = 0;
  
  // Identify matches
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  
  if (matches === 0) return 0;
  
  // Count transpositions
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  
  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
  
  // Apply Winkler prefix scaling
  let prefix = 0;
  for (let i = 0; i < Math.min(len1, len2, 4); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  
  return jaro + (0.1 * prefix * (1 - jaro));
};

/**
 * Calculate n-gram similarity
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @param {number} n - N-gram size
 * @returns {number} N-gram similarity (0-1)
 */
const ngramSimilarity = (str1, str2, n = 2) => {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  if (s1 === s2) return 1;
  if (s1.length < n || s2.length < n) return 0;
  
  const ngrams1 = new Set();
  const ngrams2 = new Set();
  
  for (let i = 0; i <= s1.length - n; i++) {
    ngrams1.add(s1.substr(i, n));
  }
  
  for (let i = 0; i <= s2.length - n; i++) {
    ngrams2.add(s2.substr(i, n));
  }
  
  const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)));
  const union = new Set([...ngrams1, ...ngrams2]);
  
  return intersection.size / union.size;
};

// ================================
// QUERY PROCESSING
// ================================

/**
 * Clean and normalize search query
 * @param {string} query - Raw search query
 * @returns {Object} Processed query components
 */
const processSearchQuery = (query) => {
  if (!query || typeof query !== 'string') {
    return {
      original: '',
      cleaned: '',
      tokens: [],
      keywords: [],
      phrases: []
    };
  }

  const original = query.trim();
  
  // Extract quoted phrases
  const phrases = [];
  const phraseRegex = /"([^"]+)"/g;
  let match;
  while ((match = phraseRegex.exec(query)) !== null) {
    phrases.push(match[1].toLowerCase());
  }
  
  // Remove quotes and normalize
  const cleaned = query
    .replace(/"/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Tokenize
  const tokens = cleaned.split(' ').filter(token => 
    token.length > 0 && !SEARCH_CONFIG.STOP_WORDS.has(token)
  );
  
  // Extract meaningful keywords (length > 2)
  const keywords = tokens.filter(token => token.length > 2);
  
  return {
    original,
    cleaned,
    tokens,
    keywords,
    phrases
  };
};

/**
 * Generate search variations and synonyms
 * @param {string} query - Search query
 * @returns {Array} Query variations
 */
const generateQueryVariations = (query) => {
  const variations = new Set([query.toLowerCase()]);
  
  // Add common misspellings and variations
  const commonReplacements = {
    'phone': ['mobile', 'smartphone', 'cellphone'],
    'laptop': ['notebook', 'computer'],
    'tv': ['television', 'monitor'],
    'car': ['vehicle', 'automobile'],
    'bike': ['bicycle', 'motorcycle'],
    'watch': ['timepiece'],
    'book': ['novel', 'textbook'],
    'game': ['gaming'],
    'music': ['audio'],
    'video': ['movie', 'film']
  };
  
  const words = query.toLowerCase().split(' ');
  
  words.forEach(word => {
    if (commonReplacements[word]) {
      commonReplacements[word].forEach(replacement => {
        const variation = query.toLowerCase().replace(word, replacement);
        variations.add(variation);
      });
    }
  });
  
  return Array.from(variations);
};

// ================================
// MAIN SEARCH FUNCTIONS
// ================================

/**
 * Perform fuzzy text search on listings
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Search results with scores
 */
const fuzzyTextSearch = async (query, options = {}) => {
  try {
    const {
      limit = 20,
      offset = 0,
      minScore = SEARCH_CONFIG.MIN_SIMILARITY_SCORE,
      includeInactive = false,
      categoryId = null,
      vendorId = null,
      filters = {}
    } = options;

    if (!query || query.trim().length < SEARCH_CONFIG.MIN_QUERY_LENGTH) {
      return [];
    }

    const processedQuery = processSearchQuery(query);
    const queryVariations = generateQueryVariations(processedQuery.cleaned);

    logger.debug('Performing fuzzy text search', {
      originalQuery: query,
      processedQuery,
      variations: queryVariations.length
    });

    // Build base where conditions
    const whereConditions = [];
    const params = [];
    let paramIndex = 1;

    // Status filter
    if (!includeInactive) {
      whereConditions.push(`l.status = $${paramIndex}`);
      params.push('ACTIVE');
      paramIndex++;
    }

    // Category filter
    if (categoryId) {
      whereConditions.push(`l.category_id = $${paramIndex}`);
      params.push(categoryId);
      paramIndex++;
    }

    // Vendor filter
    if (vendorId) {
      whereConditions.push(`l.vendor_id = $${paramIndex}`);
      params.push(vendorId);
      paramIndex++;
    }

    // Price range filter
    if (filters.minPrice) {
      whereConditions.push(`l.price >= $${paramIndex}`);
      params.push(parseFloat(filters.minPrice));
      paramIndex++;
    }

    if (filters.maxPrice) {
      whereConditions.push(`l.price <= $${paramIndex}`);
      params.push(parseFloat(filters.maxPrice));
      paramIndex++;
    }

    // Build SQL query with similarity scoring
    const sqlQuery = `
      WITH search_results AS (
        SELECT 
          l.*,
          c.name as category_name,
          u.username as vendor_username,
          u.business_name as vendor_business_name,
          
          -- Calculate similarity scores
          GREATEST(
            similarity(l.title, $${paramIndex}),
            similarity(l.title, $${paramIndex + 1}),
            similarity(l.title, $${paramIndex + 2})
          ) * ${SEARCH_CONFIG.TITLE_WEIGHT} as title_score,
          
          GREATEST(
            similarity(l.description, $${paramIndex}),
            similarity(l.description, $${paramIndex + 1}),
            similarity(l.description, $${paramIndex + 2})
          ) * ${SEARCH_CONFIG.DESCRIPTION_WEIGHT} as description_score,
          
          -- Tags matching score
          CASE 
            WHEN l.tags && string_to_array(lower($${paramIndex}), ' ') THEN ${SEARCH_CONFIG.TAGS_WEIGHT}
            ELSE 0
          END as tags_score,
          
          -- Category name matching
          similarity(c.name, $${paramIndex}) * ${SEARCH_CONFIG.CATEGORY_WEIGHT} as category_score,
          
          -- Full-text search score
          CASE 
            WHEN to_tsvector('english', l.title || ' ' || l.description) @@ plainto_tsquery('english', $${paramIndex}) 
            THEN 0.2 
            ELSE 0 
          END as fulltext_score
          
        FROM listings l
        LEFT JOIN categories c ON l.category_id = c.id
        LEFT JOIN users u ON l.vendor_id = u.id
        ${whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : ''}
      )
      SELECT 
        *,
        (title_score + description_score + tags_score + category_score + fulltext_score) as total_score
      FROM search_results
      WHERE (title_score + description_score + tags_score + category_score + fulltext_score) >= $${paramIndex + 3}
      ORDER BY total_score DESC, created_at DESC
      LIMIT $${paramIndex + 4} OFFSET $${paramIndex + 5}
    `;

    // Add query parameters
    params.push(
      processedQuery.cleaned,
      queryVariations[0] || processedQuery.cleaned,
      queryVariations[1] || processedQuery.cleaned,
      minScore,
      limit,
      offset
    );

    const results = await prisma.$queryRawUnsafe(sqlQuery, ...params);

    // Post-process results with additional similarity calculations
    const processedResults = results.map(result => {
      // Calculate individual component scores using JavaScript algorithms
      const titleSimilarity = Math.max(
        similarityRatio(processedQuery.cleaned, result.title),
        jaroWinklerSimilarity(processedQuery.cleaned, result.title),
        ngramSimilarity(processedQuery.cleaned, result.title)
      );

      const descriptionSimilarity = Math.max(
        similarityRatio(processedQuery.cleaned, result.description || ''),
        jaroWinklerSimilarity(processedQuery.cleaned, result.description || ''),
        ngramSimilarity(processedQuery.cleaned, result.description || '')
      );

      // Enhanced score calculation
      const enhancedScore = Math.max(
        result.total_score,
        (titleSimilarity * SEARCH_CONFIG.TITLE_WEIGHT) +
        (descriptionSimilarity * SEARCH_CONFIG.DESCRIPTION_WEIGHT)
      );

      return {
        ...result,
        similarity_details: {
          title_similarity: titleSimilarity,
          description_similarity: descriptionSimilarity,
          enhanced_score: enhancedScore,
          match_quality: enhancedScore >= SEARCH_CONFIG.EXCELLENT_MATCH_THRESHOLD ? 'excellent' :
                        enhancedScore >= SEARCH_CONFIG.GOOD_MATCH_THRESHOLD ? 'good' : 'fair'
        },
        total_score: enhancedScore
      };
    });

    // Re-sort by enhanced score
    processedResults.sort((a, b) => b.total_score - a.total_score);

    logger.info('Fuzzy text search completed', {
      query: processedQuery.original,
      resultsCount: processedResults.length,
      avgScore: processedResults.length > 0 ? 
        processedResults.reduce((sum, r) => sum + r.total_score, 0) / processedResults.length : 0
    });

    return processedResults;

  } catch (error) {
    logger.error('Fuzzy text search failed:', error);
    throw new Error(`Search failed: ${error.message}`);
  }
};

/**
 * Generate autocomplete suggestions
 * @param {string} query - Partial query
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Suggestion list
 */
const generateAutocompleteSuggestions = async (query, options = {}) => {
  try {
    const {
      limit = SEARCH_CONFIG.MAX_SUGGESTIONS,
      includePopular = true,
      includeTrending = true,
      categoryId = null
    } = options;

    if (!query || query.length < SEARCH_CONFIG.MIN_QUERY_LENGTH) {
      return [];
    }

    const cleanQuery = query.toLowerCase().trim();
    const suggestions = new Set();

    // Get suggestions from search_suggestions table
    if (includePopular) {
      const popularSuggestions = await prisma.searchSuggestion.findMany({
        where: {
          suggestion_text: {
            contains: cleanQuery,
            mode: 'insensitive'
          },
          ...(categoryId ? { category_id: categoryId } : {})
        },
        orderBy: {
          search_count: 'desc'
        },
        take: Math.floor(limit * 0.6),
        select: {
          suggestion_text: true,
          search_count: true,
          is_trending: true
        }
      });

      popularSuggestions.forEach(suggestion => {
        suggestions.add({
          text: suggestion.suggestion_text,
          type: 'popular',
          count: suggestion.search_count,
          is_trending: suggestion.is_trending
        });
      });
    }

    // Get suggestions from listing titles
    const titleSuggestions = await prisma.listing.findMany({
      where: {
        status: 'ACTIVE',
        title: {
          contains: cleanQuery,
          mode: 'insensitive'
        },
        ...(categoryId ? { category_id: categoryId } : {})
      },
      select: {
        title: true
      },
      take: Math.floor(limit * 0.4),
      orderBy: {
        created_at: 'desc'
      }
    });

    titleSuggestions.forEach(listing => {
      suggestions.add({
        text: listing.title,
        type: 'listing',
        count: 1
      });
    });

    // Get trending suggestions
    if (includeTrending) {
      const trendingSuggestions = await prisma.searchSuggestion.findMany({
        where: {
          is_trending: true,
          suggestion_text: {
            contains: cleanQuery,
            mode: 'insensitive'
          }
        },
        orderBy: {
          search_count: 'desc'
        },
        take: 3
      });

      trendingSuggestions.forEach(suggestion => {
        suggestions.add({
          text: suggestion.suggestion_text,
          type: 'trending',
          count: suggestion.search_count,
          is_trending: true
        });
      });
    }

    // Convert to array and sort
    const suggestionArray = Array.from(suggestions)
      .filter(s => s.text.toLowerCase().includes(cleanQuery))
      .sort((a, b) => {
        // Prioritize trending, then by count, then alphabetically
        if (a.is_trending && !b.is_trending) return -1;
        if (!a.is_trending && b.is_trending) return 1;
        if (a.count !== b.count) return b.count - a.count;
        return a.text.localeCompare(b.text);
      })
      .slice(0, limit);

    logger.debug('Autocomplete suggestions generated', {
      query: cleanQuery,
      suggestionsCount: suggestionArray.length
    });

    return suggestionArray;

  } catch (error) {
    logger.error('Autocomplete generation failed:', error);
    throw new Error(`Autocomplete failed: ${error.message}`);
  }
};

/**
 * Update search suggestion popularity
 * @param {string} query - Search query that was used
 * @param {string} categoryId - Category context (optional)
 * @returns {Promise<void>}
 */
const updateSearchSuggestion = async (query, categoryId = null) => {
  try {
    if (!query || query.length < SEARCH_CONFIG.MIN_QUERY_LENGTH) {
      return;
    }

    const cleanQuery = query.toLowerCase().trim();

    await prisma.searchSuggestion.upsert({
      where: {
        suggestion_text: cleanQuery
      },
      update: {
        search_count: {
          increment: 1
        },
        updated_at: new Date()
      },
      create: {
        suggestion_text: cleanQuery,
        search_count: 1,
        category_id: categoryId,
        is_trending: false
      }
    });

    logger.debug('Search suggestion updated', { query: cleanQuery });

  } catch (error) {
    logger.error('Failed to update search suggestion:', error);
  }
};

// ================================
// SEARCH ANALYTICS
// ================================

/**
 * Log search analytics
 * @param {Object} searchData - Search data to log
 * @returns {Promise<void>}
 */
const logSearchAnalytics = async (searchData) => {
  try {
    const {
      userId,
      queryText,
      queryType = 'text',
      filtersApplied = {},
      resultsCount = 0,
      clickedResultId = null,
      sessionId,
      ipAddress,
      userAgent,
      responseTimeMs
    } = searchData;

    await prisma.searchAnalytics.create({
      data: {
        user_id: userId,
        query_text: queryText,
        query_type: queryType,
        filters_applied: filtersApplied,
        results_count: resultsCount,
        clicked_result_id: clickedResultId,
        session_id: sessionId,
        ip_address: ipAddress,
        user_agent: userAgent,
        response_time_ms: responseTimeMs
      }
    });

  } catch (error) {
    logger.error('Failed to log search analytics:', error);
  }
};

// ================================
// EXPORTS
// ================================

module.exports = {
  // Main search functions
  fuzzyTextSearch,
  generateAutocompleteSuggestions,
  updateSearchSuggestion,
  
  // Analytics
  logSearchAnalytics,
  
  // Utility functions
  processSearchQuery,
  generateQueryVariations,
  
  // Similarity algorithms
  similarityRatio,
  jaroWinklerSimilarity,
  ngramSimilarity,
  levenshteinDistance,
  
  // Configuration
  SEARCH_CONFIG
};