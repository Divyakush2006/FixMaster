const express = require('express');
const router = express.Router();
const auth = require('../controllers/authController');
const {
    loginLimiters,
    registerLimiter,
    verifyEmailLimiters,
    resendCodeLimiter,
    forgotPasswordLimiters,
    resetPasswordLimiter,
} = require('../middleware/rateLimiters');
const {
    registerValidators,
    verifyEmailValidators,
    resendCodeValidators,
    loginValidators,
    forgotPasswordValidators,
    resetPasswordValidators,
} = require('../middleware/validators');
const { authenticateOnboarding } = require('../middleware/auth');

// Three independent sign-in portals (see src/config/portals.js). Each login
// endpoint only accepts its own account types.
router.post('/student/register', registerLimiter, registerValidators, auth.registerStudent);
router.post('/student/verify-email', verifyEmailLimiters, verifyEmailValidators, auth.verifyStudentEmail);
router.post('/student/resend-code', resendCodeLimiter, resendCodeValidators, auth.resendVerificationCode);
router.post('/student/login', loginLimiters.student, loginValidators, auth.loginFor('student'));
router.post('/staff/login', loginLimiters.staff, loginValidators, auth.loginFor('staff'));
router.post('/admin/login', loginLimiters.admin, loginValidators, auth.loginFor('admin'));

router.get('/capabilities', auth.capabilities);
router.post('/forgot-password', forgotPasswordLimiters, forgotPasswordValidators, auth.forgotPassword);
router.post('/reset-password', resetPasswordLimiter, resetPasswordValidators, auth.resetPassword);

// Ends the calling session on the server (any portal).
router.post('/logout', authenticateOnboarding, auth.logout);

module.exports = router;
