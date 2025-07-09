-- Fixed Search Indexes SQL for VOID Marketplace
-- Run this AFTER prisma db push

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Full-text search indexes for listings
CREATE INDEX IF NOT EXISTS idx_listings_title_fulltext 
ON "listings" USING gin(to_tsvector('english', title));

CREATE INDEX IF NOT EXISTS idx_listings_description_fulltext 
ON "listings" USING gin(to_tsvector('english', description));

CREATE INDEX IF NOT EXISTS idx_listings_tags_gin 
ON "listings" USING gin(tags);

-- Performance indexes for search
CREATE INDEX IF NOT EXISTS idx_listings_search_composite 
ON "listings"(status, price, created_at DESC) 
WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_listings_featured_search 
ON "listings"(is_featured, created_at DESC) 
WHERE status = 'ACTIVE' AND is_featured = true;

-- Search analytics indexes  
CREATE INDEX IF NOT EXISTS idx_search_analytics_query_text_trgm 
ON "search_analytics" USING gin(query_text gin_trgm_ops);

-- Search suggestions indexes
CREATE INDEX IF NOT EXISTS idx_search_suggestions_text_trgm 
ON "search_suggestions" USING gin(suggestion_text gin_trgm_ops);

-- Additional performance indexes
CREATE INDEX IF NOT EXISTS idx_search_analytics_user_id 
ON "search_analytics"(user_id);

CREATE INDEX IF NOT EXISTS idx_search_analytics_created_at 
ON "search_analytics"(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_suggestions_trending 
ON "search_suggestions"(is_trending, search_count DESC);

CREATE INDEX IF NOT EXISTS idx_listing_embeddings_listing_id 
ON "listing_embeddings"(listing_id);

CREATE INDEX IF NOT EXISTS idx_listing_embeddings_type 
ON "listing_embeddings"(embedding_type);

-- Similarity function for search scoring
CREATE OR REPLACE FUNCTION calculate_text_similarity(
    search_query TEXT,
    title TEXT,
    description TEXT,
    tags TEXT[]
) RETURNS FLOAT AS $$
DECLARE
    title_score FLOAT := 0;
    description_score FLOAT := 0;
    tags_score FLOAT := 0;
    total_score FLOAT := 0;
BEGIN
    -- Title similarity (weighted more heavily)
    title_score := similarity(search_query, title) * 0.5;
    
    -- Description similarity
    description_score := similarity(search_query, description) * 0.3;
    
    -- Tags exact match bonus
    IF tags && string_to_array(lower(search_query), ' ') THEN
        tags_score := 0.2;
    END IF;
    
    total_score := title_score + description_score + tags_score;
    
    RETURN GREATEST(total_score, 0);
END;
$$ LANGUAGE plpgsql;

-- Additional helper function for search ranking
CREATE OR REPLACE FUNCTION calculate_search_rank(
    base_score FLOAT,
    view_count INT,
    click_count INT,
    is_featured BOOLEAN,
    created_at TIMESTAMP
) RETURNS FLOAT AS $$
DECLARE
    final_score FLOAT := base_score;
    recency_bonus FLOAT := 0;
    popularity_bonus FLOAT := 0;
BEGIN
    -- Recency bonus (newer items get slight boost)
    recency_bonus := GREATEST(0, 0.1 - (EXTRACT(EPOCH FROM (now() - created_at)) / 2592000)); -- 30 days
    
    -- Popularity bonus based on engagement
    popularity_bonus := LEAST(0.2, (view_count + click_count * 2) * 0.001);
    
    -- Featured item bonus
    IF is_featured THEN
        final_score := final_score + 0.15;
    END IF;
    
    final_score := final_score + recency_bonus + popularity_bonus;
    
    RETURN LEAST(1.0, final_score); -- Cap at 1.0
END;
$$ LANGUAGE plpgsql;

COMMIT;