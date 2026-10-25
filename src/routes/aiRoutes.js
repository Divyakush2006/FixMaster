const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { authenticate, authorize } = require('../middleware/auth');

router.post('/parse-and-triage', authenticate, aiController.parseAndTriage);
router.post('/allocate-technician', authenticate, aiController.allocateTechnician);

// AI health status — supervisor and admin use this to check if AI is up
router.get('/health', authenticate, authorize('SUPERVISOR', 'ADMIN'), aiController.getAiHealth);
router.post('/simulate-outage', authenticate, authorize('SUPERVISOR', 'ADMIN'), aiController.simulateOutage);

module.exports = router;
