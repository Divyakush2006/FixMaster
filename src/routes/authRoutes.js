const express = require('express');
const router = express.Router();
const auth = require('../controllers/authController');
const { loginLimiters, registerLimiter, forgotPasswordLimiters, resetPasswordLimiter } = require('../middleware/rateLimiters');
const { registerValidators, loginValidators, forgotPasswordValidators, resetPasswordValidators } = require('../middleware/validators');
const { authenticate } = require('../middleware/auth');

// Three independent sign-in portals (see src/config/portals.js). Each login
// endpoint only accepts its own account types.
router.post('/student/register', registerLimiter, registerValidators, auth.registerStudent);
router.post('/student/login', loginLimiters.student, loginValidators, auth.loginFor('student'));
router.post('/staff/login', loginLimiters.staff, loginValidators, auth.loginFor('staff'));
router.post('/admin/login', loginLimiters.admin, loginValidators, auth.loginFor('admin'));

router.get('/capabilities', auth.capabilities);
router.post('/forgot-password', forgotPasswordLimiters, forgotPasswordValidators, auth.forgotPassword);
router.post('/reset-password', resetPasswordLimiter, resetPasswordValidators, auth.resetPassword);

// Ends the calling session on the server (any portal).
router.post('/logout', authenticate, auth.logout);

module.exports = router;
