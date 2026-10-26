const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { authenticate, authorize } = require('../middleware/auth');

// Students draft tickets; staff never do. Allocation previews expose staff
// names and workloads, so they are for the people who dispatch.
router.post('/parse-and-triage', authenticate, authorize('STUDENT', 'SUPERVISOR', 'ADMIN'), aiController.parseAndTriage);
router.post('/allocate-technician', authenticate, authorize('SUPERVISOR', 'ADMIN'), aiController.allocateTechnician);

// AI health status — supervisor and admin use this to check if AI is up
router.get('/health', authenticate, authorize('SUPERVISOR', 'ADMIN'), aiController.getAiHealth);
router.post('/simulate-outage', authenticate, authorize('SUPERVISOR', 'ADMIN'), aiController.simulateOutage);

module.exports = router;
