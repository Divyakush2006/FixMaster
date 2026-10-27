const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const autopilot = require('../services/autopilot');
const { staffPerformance } = require('../services/autopilot/performance');
const { cleaningPlan } = require('../services/autopilot/cleaningPlan');
const { tagPending } = require('../services/autopilot/feedbackTagger');
const { normaliseWeights } = require('../services/autopilot/scoring');
const { assertTicketInScope, managedBlocks, inScope } = require('../services/scopeService');
const { recordAudit } = require('../services/auditService');
const cache = require('../services/cache');
const { scopeKey } = cache;

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
// The campus default reaches both hostels, so only someone who runs the whole campus may change it:
// an administrator, or a chief warden who is not attached to one hostel. A hostel's chief warden
// sets "every block of my hostel" instead.
const canEditCampusDefault = (user, scope) => scope === null && ['CHIEF_WARDEN', 'ADMIN'].includes(user.role);

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
        can_edit_campus_default: canEditCampusDefault(req.user, scope),
    });
});

// PUT /api/autopilot/settings { block_id|null, hostel?, specialization, mode, live_job_cap?, weights? }
// Supervisors set it for their own blocks. { hostel: 'MENS'|'LADIES' } sets it for every block of that
// hostel the caller runs (a chief warden: the whole hostel). The campus default (no block, no hostel)
// belongs to whoever runs the whole campus. Audited.
exports.saveSetting = asyncHandler(async (req, res) => {
    const { block_id = null, hostel = null, specialization, mode, live_job_cap = 6, weights = null } = req.body;
    if (block_id !== null && hostel !== null) throw new AppError(400, 'Give either a block or a hostel, not both.');
    const scope = await managedBlocks(req.user);
    if (block_id === null && hostel === null && !canEditCampusDefault(req.user, scope)) {
        throw new AppError(
            403,
            ['CHIEF_WARDEN', 'ADMIN'].includes(req.user.role)
                ? 'The campus default reaches both hostels. Choose "every block" of your hostel instead.'
                : 'Only a chief warden or administrator can change the campus default.',
            { code: 'OUT_OF_SCOPE' }
        );
    }
    if (block_id !== null && !inScope(scope, block_id)) {
        throw new AppError(403, 'You can only change the autopilot for blocks you manage.', { code: 'OUT_OF_SCOPE' });
    }
    const upsert = (client, blockId) =>
        client.query(
            `INSERT INTO autopilot_settings (block_id, specialization, mode, live_job_cap, weights, updated_by_user_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT ((COALESCE(block_id, '*')), specialization) DO UPDATE SET
                 mode = EXCLUDED.mode, live_job_cap = EXCLUDED.live_job_cap, weights = EXCLUDED.weights,
                 updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = NOW()
             RETURNING block_id, specialization, mode, live_job_cap, weights`,
            [blockId, specialization, mode, live_job_cap, weights, req.user.userId]
        );
    const saved = await db.withTransaction(async (client) => {
        if (hostel) {
            const targets = (
                await client.query(
                    `SELECT block_id FROM hostel_blocks
                     WHERE hostel_type = $1 AND ($2::varchar[] IS NULL OR block_id = ANY($2::varchar[]))
                     ORDER BY block_id`,
                    [hostel, scope]
                )
            ).rows.map((r) => r.block_id);
            if (targets.length === 0) {
                throw new AppError(403, 'You do not run any block of that hostel.', { code: 'OUT_OF_SCOPE' });
            }
            let last;
            for (const id of targets) last = (await upsert(client, id)).rows[0];
            await recordAudit(client, req, {
                action: 'autopilot.set',
                targetType: 'hostel',
                targetId: hostel,
                details: { specialization, mode, live_job_cap, weights, blocks: targets },
            });
            return { ...last, block_id: null, hostel, block_ids: targets };
        }
        if (block_id) {
            const b = await client.query('SELECT 1 FROM hostel_blocks WHERE block_id = $1', [block_id]);
            if (b.rows.length === 0) throw new AppError(404, 'That block does not exist.');
        }
        const { rows } = await upsert(client, block_id);
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
    const blocks = await managedBlocks(req.user);
    const specialization = req.query.specialization || null;
    res.json(await cache.memo(`perf:${scopeKey(blocks)}:${specialization}`, () => staffPerformance({ blocks, specialization })));
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
    const result = await tagPending({ limit: 500 });
    cache.invalidate('perf:'); // the board shows comment themes
    res.json(result);
});
