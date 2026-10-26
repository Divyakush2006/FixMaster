const express = require('express');
const router = express.Router();
const me = require('../controllers/meController');
const { authenticate, authenticateOnboarding, authorize } = require('../middleware/auth');
const privacy = require('../controllers/privacyController');
const { privacyLimiter } = require('../middleware/rateLimiters');
const { changePasswordValidators, availabilityValidators, roomRequestValidators, profileValidators, erasureRequestValidators } = require('../middleware/validators');

// Usable before onboarding is finished (a new student's first screens): the
// account itself, the profile, the room request and the password.
router.get('/', authenticateOnboarding, me.getMe);
router.get('/profile', authenticateOnboarding, authorize('STUDENT'), me.getMyProfile);
router.put('/profile', authenticateOnboarding, authorize('STUDENT'), profileValidators, me.saveMyProfile);
router.get('/allotment', authenticateOnboarding, me.getMyAllotment);
router.patch('/password', authenticateOnboarding, changePasswordValidators, me.changePassword);
router.get('/room-request', authenticateOnboarding, authorize('STUDENT'), me.getMyRoomRequest);
router.post('/room-request', authenticateOnboarding, authorize('STUDENT'), roomRequestValidators, me.requestRoom);
router.delete('/room-request', authenticateOnboarding, authorize('STUDENT'), me.withdrawRoomRequest);

// Data-subject rights (DPDP Act): a copy of one's data, and a request for erasure.
router.get('/data-export', authenticateOnboarding, privacyLimiter, privacy.exportMyData);
router.post('/erasure-request', authenticate, authorize('STUDENT'), privacyLimiter, erasureRequestValidators, privacy.requestErasure);
router.delete('/erasure-request', authenticate, authorize('STUDENT'), privacy.cancelErasure);

router.patch('/availability',authenticate, authorize('STAFF'), availabilityValidators, me.setAvailability);

module.exports = router;
