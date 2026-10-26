const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const autopilot = require('../services/autopilot');
const { staffPerformance } = require('../services/autopilot/performance');
const { cleaningPlan } = require('../services/autopilot/cleaningPlan');
const { tagPending } = require('../services/autopilot/feedbackTagger');
const { normaliseWeights } = require('../services/autopilot/scoring');
const { assertTicketInScope, managedBlocks, inScope } = require('../services/scopeService');
const { recordAudit } = require('../services/auditService');

// GET /api/autopilot/suggestions/:complaint_id (managers, scoped)
// The ranked shortlist with each person's score breakdown, and everyone left
// out with the reason.
exports.getSuggestions = asyncHandler(async (req, res) => {
    await assertTicketInScope(req.user, req.params.complaint_id);
    res.json(await autopilot.suggest(req.params.complaint_id));
});

// POST /api/autopilot/dispatch { complaint_id } (managers, scoped)
// Assigns the autopilot's top suggestion on the manager's say-so.
exports.dispatchSuggestion = asyncHandler(async (req, res) => {
    await assertTicketInScope(req.user, req.body.complaint_id);
    const result = await autopilot.dispatch(req.body.complaint_id, { actorUserId: req.user.userId, source: 'SUGGESTION' });
    res.json(result);
});

// GET /api/autopilot/settings (managers) - every explicit setting in scope
// plus the campus defaults, and what applies when nothing is set.
exports.getSettings = asyncHandler(async (req, res) => {
    const scope = await managedBlocks(req.user);
    const { rows } = await db.query(
        `SELECT s.block_id, s.specialization, s.mode, s.live_job_cap, s.weights, s.updated_at, u.full_name AS updated_by
         FROM autopilot_settings s LEFT JOIN users u ON u.user_id = s.updated_by_user_id
         WHERE s.block_id IS NULL OR $1::varchar[] IS NULL OR s.block_id = ANY($1::varchar[])
         ORDER BY s.block_id NULLS FIRST, s.specialization`,
        [scope]
    );
    res.json({
        defaults: { mode: 'SUGGEST', live_job_cap: 6, weights: normaliseWeights(null) },
        settings: rows.map((r) => ({ ...r, weights: normaliseWeights(r.weights) })),
        can_edit_campus_default: ['CHIEF_WARDEN', 'ADMIN'].includes(req.user.role),
    });
});

// PUT /api/autopilot/settings { block_id|null, specialization, mode, live_job_cap?, weights? }
// Supervisors set it for their own blocks; the campus default (block_id null)
// belongs to chief wardens and administrators. Audited.
exports.saveSetting = asyncHandler(async (req, res) => {
    const { block_id = null, specialization, mode, live_job_cap = 6, weights = null } = req.body;
    if (block_id === null && !['CHIEF_WARDEN', 'ADMIN'].includes(req.user.role)) {
        throw new AppError(403, 'Only a chief warden or administrator can change the campus default.');
    }
    if (block_id !== null && !inScope(await managedBlocks(req.user), block_id)) {
        throw new AppError(403, 'You can only change the autopilot for blocks you manage.', { code: 'OUT_OF_SCOPE' });
    }
    const saved = await db.withTransaction(async (client) => {
        if (block_id) {
            const b = await client.query('SELECT 1 FROM hostel_blocks WHERE block_id = $1', [block_id]);
            if (b.rows.length === 0) throw new AppError(404, 'That block does not exist.');
        }
        const { rows } = await client.query(
            `INSERT INTO autopilot_settings (block_id, specialization, mode, live_job_cap, weights, updated_by_user_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT ((COALESCE(block_id, '*')), specialization) DO UPDATE SET
                 mode = EXCLUDED.mode, live_job_cap = EXCLUDED.live_job_cap, weights = EXCLUDED.weights,
                 updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = NOW()
             RETURNING block_id, specialization, mode, live_job_cap, weights`,
            [block_id, specialization, mode, live_job_cap, weights, req.user.userId]
        );
        await recordAudit(client, req, {
            action: 'autopilot.set',
            targetType: 'block',
            targetId: block_id || 'CAMPUS',
            details: { specialization, mode, live_job_cap, weights },
        });
        return rows[0];
    }, req.user.userId);
    res.json({ ...saved, weights: normaliseWeights(saved.weights) });
});

// GET /api/autopilot/performance?specialization= (managers) - the staff board.
// Block-scoped supervisors see their blocks' staff and the campus pool.
exports.getPerformance = asyncHandler(async (req, res) => {
    res.json(await staffPerformance({ blocks: await managedBlocks(req.user), specialization: req.query.specialization || null }));
});

// GET /api/autopilot/cleaning-plan?block_id=&shift= (managers, scoped)
exports.getCleaningPlan = asyncHandler(async (req, res) => {
    if (!inScope(await managedBlocks(req.user), req.query.block_id)) {
        throw new AppError(403, 'This block is not one you manage.', { code: 'OUT_OF_SCOPE' });
    }
    res.json(await cleaningPlan(req.query.block_id, { shift: req.query.shift }));
});

// POST /api/autopilot/tag-feedback (CHIEF_WARDEN, ADMIN) - tag new review comments now.
exports.tagFeedbackNow = asyncHandler(async (req, res) => {
    res.json(await tagPending({ limit: 500 }));
});
