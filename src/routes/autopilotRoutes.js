const express = require('express');
const router = express.Router();
const ap = require('../controllers/autopilotController');
const { authenticate, authorize } = require('../middleware/auth');
const { MANAGER_ROLES } = require('../config/roles');
const v = require('../middleware/validators');

router.use(authenticate, authorize(...MANAGER_ROLES));

router.get('/suggestions/:complaint_id', v.autopilotTicketParamValidators, ap.getSuggestions);
router.post('/dispatch', v.autopilotDispatchValidators, ap.dispatchSuggestion);
router.get('/status', ap.getStatus);
router.post('/sweep', ap.sweepNow);
router.get('/settings', ap.getSettings);
router.put('/settings', v.autopilotSettingValidators, ap.saveSetting);
router.get('/performance', v.autopilotPerformanceValidators, ap.getPerformance);
router.get('/cleaning-plan', v.cleaningPlanValidators, ap.getCleaningPlan);
router.post('/tag-feedback', authorize('CHIEF_WARDEN', 'ADMIN'), ap.tagFeedbackNow);

module.exports = router;
