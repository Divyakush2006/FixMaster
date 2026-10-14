const express = require('express');
const router = express.Router();
const me = require('../controllers/meController');
const { authenticate, authorize } = require('../middleware/auth');
const { changePasswordValidators, availabilityValidators, roomRequestValidators } = require('../middleware/validators');

router.get('/', authenticate, me.getMe);
router.get('/allotment', authenticate, me.getMyAllotment);
router.patch('/password', authenticate, changePasswordValidators, me.changePassword);
router.get('/room-request', authenticate, authorize('STUDENT'), me.getMyRoomRequest);
router.post('/room-request', authenticate, authorize('STUDENT'), roomRequestValidators, me.requestRoom);
router.patch('/availability', authenticate, authorize('STAFF'), availabilityValidators, me.setAvailability);

module.exports = router;
