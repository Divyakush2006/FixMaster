const bcrypt = require('bcrypt');
const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const privacy = require('../services/privacyService');
const { removePhoto } = require('../services/attachmentService');
const { recordAudit } = require('../services/auditService');

// GET /api/me/data-export (any signed-in account) - everything held about the
// caller, as a downloadable JSON file. Audited, because it is a bulk read of
// personal data.
exports.exportMyData = asyncHandler(async (req, res) => {
    const data = await privacy.exportData(db, req.user.userId);
    await recordAudit(null, req, { action: 'privacy.exported', targetType: 'user', targetId: req.user.userId });
    res.setHeader('Content-Disposition', `attachment; filename="fixmaster-my-data-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
});

// POST /api/me/erasure-request { password } (STUDENT) - asks for personal data
// to be erased. The password is asked for again so a borrowed session cannot
// start it. An administrator carries it out.
exports.requestErasure = asyncHandler(async (req, res) => {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE user_id = $1', [req.user.userId]);
    if (!rows[0] || !(await bcrypt.compare(req.body.password, rows[0].password_hash))) {
        // 400, not 401: clients sign the user out on 401, and the session itself is fine.
        throw new AppError(400, 'Password is incorrect.');
    }
    const requestedAt = await db.withTransaction((client) => privacy.requestErasure(client, req, req.user.userId), req.user.userId);
    res.status(202).json({
        message: 'Your request has been recorded. The hostel office will erase your data once you have vacated your room and have no open tickets.',
        erasure_requested_at: requestedAt,
        blockers: await privacy.erasureBlockers(db, req.user.userId),
    });
});

// DELETE /api/me/erasure-request (STUDENT) - changes their mind.
exports.cancelErasure = asyncHandler(async (req, res) => {
    await db.withTransaction((client) => privacy.cancelErasure(client, req, req.user.userId), req.user.userId);
    res.status(204).end();
});

// GET /api/admin/erasure-requests (ADMIN) - who has asked, and what is in the way.
exports.listErasureRequests = asyncHandler(async (req, res) => {
    const { rows } = await db.query(
        `SELECT user_id, reg_or_emp_id, full_name, email, erasure_requested_at
         FROM users WHERE erasure_requested_at IS NOT NULL AND erased_at IS NULL ORDER BY erasure_requested_at`
    );
    const out = [];
    for (const r of rows) out.push({ ...r, blockers: await privacy.erasureBlockers(db, r.user_id) });
    res.json(out);
});

// POST /api/admin/users/:user_id/erase (ADMIN) - removes the person's data.
exports.eraseUser = asyncHandler(async (req, res) => {
    const { photoComplaintIds } = await db.withTransaction((client) => privacy.eraseStudent(client, req, req.params.user_id), req.user.userId);
    for (const id of photoComplaintIds) await removePhoto(id).catch(() => {});
    res.json({ message: 'Personal data erased. Tickets and ratings remain, without anything that identifies the resident.' });
});
