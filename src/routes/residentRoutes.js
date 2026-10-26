const express = require('express');
const router = express.Router();
const org = require('../controllers/organisationController');
const { authenticate, authorize } = require('../middleware/auth');
const { MANAGER_ROLES } = require('../config/roles');
const { userIdOnlyValidators } = require('../middleware/validators');

// A resident's record for the people who look after them (scoped by block).
router.get('/:user_id/profile', authenticate, authorize(...MANAGER_ROLES), userIdOnlyValidators, org.getResidentProfile);

module.exports = router;
