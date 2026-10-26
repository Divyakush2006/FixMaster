const express = require('express');
const router = express.Router();
const ai = require('../controllers/aiController');
const { authenticate, authorize } = require('../middleware/auth');
const { MANAGER_ROLES } = require('../config/roles');
const { aiDrillValidators } = require('../middleware/validators');

// AI service health for the people who would switch to manual work.
router.get('/health', authenticate, authorize(...MANAGER_ROLES), ai.getAiHealth);
// A campus-wide switch, so only campus-wide roles hold it.
router.post('/drill', authenticate, authorize('CHIEF_WARDEN', 'ADMIN'), aiDrillValidators, ai.setDrill);

module.exports = router;
