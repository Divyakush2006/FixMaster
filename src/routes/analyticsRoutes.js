const express = require('express');
const router = express.Router();
const analytics = require('../controllers/analyticsController');
const { authenticate, authorize } = require('../middleware/auth');
const { MANAGER_ROLES } = require('../config/roles');

router.get('/kpi', authenticate, authorize(...MANAGER_ROLES), analytics.getBlockSummary);
router.get('/hotspots', authenticate, authorize(...MANAGER_ROLES), analytics.getDefectHotspots);

module.exports = router;