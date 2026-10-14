const { asyncHandler } = require('../middleware/errorHandler');
const { getFeed } = require('../services/notificationFeed');
const { studentCanSee } = require('./complaintController');

// GET /api/notifications?since=<ISO time>&limit=&offset=
// In-app notifications derived from ticket history, assignments and SLA
// deadlines (services/notificationFeed.js). The `X-Unread-Count` header is the
// number of items newer than `since`, the moment the browser last opened the
// bell; without `since` every item in the window counts.
exports.list = asyncHandler(async (req, res) => {
    const { items, unread } = await getFeed(
        req.user,
        { limit: req.query.limit || 30, offset: req.query.offset || 0, since: req.query.since ? new Date(req.query.since) : null },
        studentCanSee
    );
    res.set('X-Unread-Count', String(unread));
    res.json(items);
});
