const express = require('express');
const router = express.Router();
const auth = require('../controllers/authController');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimiters');
const { registerValidators, loginValidators } = require('../middleware/validators');

router.post('/register', registerLimiter, registerValidators, auth.register);
router.post('/login', loginLimiter, loginValidators, auth.login);

module.exports = router;
