const express = require('express');
const router = express.Router();
const notifications = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');
const { listNotificationsValidators } = require('../middleware/validators');

router.get('/', authenticate, listNotificationsValidators, notifications.list);

module.exports = router;
