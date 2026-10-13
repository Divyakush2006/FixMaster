const express = require('express');
const router = express.Router();
const notifications = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');
const v = require('../middleware/validators');

router.use(authenticate);
router.get('/', v.listNotificationsValidators, notifications.list);
router.get('/unread-count', notifications.unreadCount);
router.post('/read-all', notifications.markAllRead);
router.post('/:id/read', v.notificationIdValidators, notifications.markRead);

module.exports = router;
