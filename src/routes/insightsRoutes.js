const express = require('express');
const router = express.Router();
const insights = require('../controllers/insightsController');
const { authenticate, authorize } = require('../middleware/auth');
const { MANAGER_ROLES } = require('../config/roles');
const v = require('../middleware/validators');

router.use(authenticate, authorize(...MANAGER_ROLES));

router.get('/overview', v.insightsQueryValidators, insights.getOverview);
router.get('/breach-risk', v.insightsQueryValidators, insights.getBreachRisk);
router.get('/recurring', v.insightsQueryValidators, insights.getRecurring);
router.get('/briefing', insights.getBriefing);
router.post('/briefing/refresh', insights.refreshBriefing);
router.post('/ask', v.insightsAskValidators, insights.askQuestion);

module.exports = router;
