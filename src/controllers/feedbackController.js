const db = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');

// POST /api/feedback - closed-loop verification by whoever raised the ticket.
//
// sp_confirm_resolution enforces everything: the complaint exists, the caller
// raised it, and it is actually PENDING_VERIFICATION (it locks the row, so a
// double-submit can't verify twice). There is deliberately no "feedback
// already exists" pre-check here any more: a rejected ticket is reworked and
// verified again, so one complaint can legitimately have several rounds.
exports.submitResolutionFeedback = asyncHandler(async (req, res) => {
    const { complaint_id, is_satisfied, rating, comments } = req.body;
    const userId = req.user.userId;

    await db.withTransaction(async (client) => {
        await client.query('CALL sp_confirm_resolution($1, $2, $3, $4, $5)', [
            complaint_id,
            userId,
            is_satisfied,
            is_satisfied ? rating || null : null,
            comments || null,
        ]);
    }, userId);

    res.status(200).json({
        message: is_satisfied
            ? 'Complaint closed and marked COMPLETED.'
            : 'Complaint ESCALATED for re-inspection.',
    });
});
