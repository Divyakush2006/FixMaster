const express = require('express');
const router = express.Router();
const me = require('../controllers/meController');
const { authenticate, authorize } = require('../middleware/auth');
const { changePasswordValidators, availabilityValidators } = require('../middleware/validators');

router.get('/', authenticate, me.getMe);
router.get('/allotment', authenticate, me.getMyAllotment);
router.patch('/password', authenticate, changePasswordValidators, me.changePassword);
router.patch('/availability', authenticate, authorize('STAFF'), availabilityValidators, me.setAvailability);

module.exports = router;
