const express = require('express');
const router = express.Router();
const me = require('../controllers/meController');
const { authenticate, authenticateOnboarding, authorize } = require('../middleware/auth');
const { changePasswordValidators, availabilityValidators, roomRequestValidators, profileValidators } = require('../middleware/validators');

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

router.patch('/availability', authenticate, authorize('STAFF'), availabilityValidators, me.setAvailability);

module.exports = router;
