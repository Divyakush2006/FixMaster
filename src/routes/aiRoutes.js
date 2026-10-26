const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { authenticate, authorize } = require('../middleware/auth');
const { MANAGER_ROLES } = require('../config/roles');

// Students draft tickets; staff never do. Allocation previews expose staff
// names and workloads, so they are for the people who dispatch.
router.post('/parse-and-triage', authenticate, authorize('STUDENT', ...MANAGER_ROLES), aiController.parseAndTriage);
router.post('/allocate-technician', authenticate, authorize(...MANAGER_ROLES), aiController.allocateTechnician);

// AI health status — supervisor and admin use this to check if AI is up
router.get('/health', authenticate, authorize(...MANAGER_ROLES), aiController.getAiHealth);
router.post('/simulate-outage', authenticate, authorize(...MANAGER_ROLES), aiController.simulateOutage);

module.exports = router;
