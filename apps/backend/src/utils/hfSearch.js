// Simple Hugging Face search using official API
const axios = require('axios');

class HFSearch {
  constructor() {
    this.token = process.env.HF_TOKEN;
    this.apiUrl = 'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/sentence-similarity';
  }

  // Search listings using HF sentence similarity
  async searchListings(searchQuery, listings) {
    try {
      if (!this.token) {
        throw new Error('HF_TOKEN not configured');
      }

      // Prepare listing texts for comparison
      const listingTexts = listings.map(listing => 
        `${listing.title} ${listing.description}`.substring(0, 300)
      );

      // Call HF API for similarity scores
      const response = await axios.post(this.apiUrl, {
        inputs: {
          source_sentence: searchQuery,
          sentences: listingTexts
        }
      }, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      // HF returns array of similarity scores
      const similarities = response.data;

      // Combine listings with similarity scores
      const rankedListings = listings
        .map((listing, index) => ({
          ...listing,
          similarity_score: similarities[index] || 0,
          search_method: 'huggingface_similarity'
        }))
        .filter(item => item.similarity_score > 0.3) // Filter low similarity
        .sort((a, b) => b.similarity_score - a.similarity_score);

      console.log(`🔍 HF Search: "${searchQuery}" found ${rankedListings.length} results`);
      return rankedListings;

    } catch (error) {
      console.error('HF search failed:', error.message);
      
      // Fallback to simple text search
      return this.fallbackSearch(searchQuery, listings);
    }
  }

  // Simple fallback search
  fallbackSearch(query, listings) {
    const queryWords = query.toLowerCase().split(' ');
    
    return listings
      .map(listing => {
        const text = `${listing.title} ${listing.description}`.toLowerCase();
        const matches = queryWords.filter(word => text.includes(word));
        
        return {
          ...listing,
          similarity_score: matches.length / queryWords.length,
          search_method: 'fallback_text_match'
        };
      })
      .filter(item => item.similarity_score > 0.2)
      .sort((a, b) => b.similarity_score - a.similarity_score);
  }

  // Generate autocomplete suggestions
  async generateSuggestions(partialQuery, existingSuggestions) {
    try {
      if (existingSuggestions.length === 0) return [];

      const suggestionTexts = existingSuggestions.map(s => s.suggestion_text);
      
      const response = await axios.post(this.apiUrl, {
        inputs: {
          source_sentence: partialQuery,
          sentences: suggestionTexts
        }
      }, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        }
      });

      const similarities = response.data;

      return existingSuggestions
        .map((suggestion, index) => ({
          ...suggestion,
          similarity: similarities[index] || 0
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10);

    } catch (error) {
      console.error('HF suggestions failed:', error.message);
      return existingSuggestions.slice(0, 10);
    }
  }
}

module.exports = { HFSearch };