const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// In-app notifications (migrations 012-013). Everyone sees only their own.

// GET /api/notifications?unread=true&limit=&offset=  (X-Total-Count, X-Unread-Count)
exports.list = asyncHandler(async (req, res) => {
    const { userId } = req.user;
    const limit = req.query.limit || 30;
    const offset = req.query.offset || 0;
    const unreadOnly = req.query.unread === true || req.query.unread === 'true';
    const where = `user_id = $1${unreadOnly ? ' AND read_at IS NULL' : ''}`;
    const [count, unread, rows] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS n FROM notifications WHERE ${where}`, [userId]),
        db.query('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]),
        db.query(
            `SELECT notification_id, kind, title, body, complaint_id, created_at, read_at
             FROM notifications WHERE ${where}
             ORDER BY created_at DESC, notification_id DESC LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        ),
    ]);
    res.set('X-Total-Count', String(count.rows[0].n));
    res.set('X-Unread-Count', String(unread.rows[0].n));
    res.json(rows.rows);
});

// GET /api/notifications/unread-count - cheap, polled by the bell.
exports.unreadCount = asyncHandler(async (req, res) => {
    const { rows } = await db.query('SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL', [
        req.user.userId,
    ]);
    res.json(rows[0]);
});

// POST /api/notifications/:id/read
exports.markRead = asyncHandler(async (req, res) => {
    const { rows } = await db.query(
        `UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
         WHERE notification_id = $1 AND user_id = $2 RETURNING notification_id`,
        [req.params.id, req.user.userId]
    );
    if (rows.length === 0) throw new AppError(404, 'Notification not found.');
    res.json({ message: 'Marked as read.' });
});

// POST /api/notifications/read-all
exports.markAllRead = asyncHandler(async (req, res) => {
    const { rowCount } = await db.query(
        'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND read_at IS NULL',
        [req.user.userId]
    );
    res.json({ marked: rowCount });
});
