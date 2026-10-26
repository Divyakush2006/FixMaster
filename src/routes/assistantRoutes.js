const express = require('express');
const router = express.Router();
const ai = require('../controllers/aiController');
const { authenticate, authorize } = require('../middleware/auth');
const { assistantLimiter } = require('../middleware/rateLimiters');
const { assistantDraftValidators } = require('../middleware/validators');

// Students describe a problem in their own words and get ticket drafts back.
router.post('/draft', authenticate, authorize('STUDENT'), assistantLimiter, assistantDraftValidators, ai.draftFromText);

module.exports = router;
