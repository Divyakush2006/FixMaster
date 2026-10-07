const express = require('express');
const router = express.Router();
const auth = require('../controllers/authController');
const { loginLimiters, registerLimiter } = require('../middleware/rateLimiters');
const { registerValidators, loginValidators } = require('../middleware/validators');

// Three independent sign-in portals (see src/config/portals.js). Each login
// endpoint only accepts its own account types.
router.post('/student/register', registerLimiter, registerValidators, auth.registerStudent);
router.post('/student/login', loginLimiters.student, loginValidators, auth.loginFor('student'));
router.post('/staff/login', loginLimiters.staff, loginValidators, auth.loginFor('staff'));
router.post('/admin/login', loginLimiters.admin, loginValidators, auth.loginFor('admin'));

module.exports = router;
