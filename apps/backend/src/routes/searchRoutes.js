// apps/backend/src/routes/searchRoutes.js
const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { authenticate, requireMinRole } = require('../middleware/authMiddleware');
const { USER_ROLES } = require('../config/constants');

// Public search routes
router.get('/', searchController.universalSearch);
router.post('/image', searchController.imageSearch);
router.get('/autocomplete', searchController.autocomplete);
router.get('/trending', searchController.getTrendingSearches);
router.get('/popular', searchController.getPopularSearches);
router.get('/recommendations/:listingId', searchController.getSearchRecommendations);
router.post('/analytics/click', searchController.trackSearchClick);

// Admin search routes
router.get('/admin/analytics', 
  authenticate, 
  requireMinRole(USER_ROLES.ADMIN), 
  searchController.getSearchAnalytics
);

router.post('/admin/reindex', 
  authenticate, 
  requireMinRole(USER_ROLES.ADMIN), 
  searchController.reindexListings
);

router.put('/admin/suggestions/:id', 
  authenticate, 
  requireMinRole(USER_ROLES.ADMIN), 
  searchController.updateSearchSuggestion
);

module.exports = router;