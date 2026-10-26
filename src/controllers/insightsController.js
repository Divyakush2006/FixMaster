const db = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const reports = require('../services/insights/reports');
const { briefingFor } = require('../services/insights/briefing');
const { ask } = require('../services/insights/ask');
const { managedBlocks } = require('../services/scopeService');
const { recordAudit } = require('../services/auditService');

// All of these read inside the signed-in manager's block scope
// (scopeService.managedBlocks), so a supervisor sees only their own blocks and
// the chief warden sees the campus.

// GET /api/insights/overview?block_id= - totals and one row per block.
exports.getOverview = asyncHandler(async (req, res) => {
    res.json(await reports.overview(await managedBlocks(req.user), { blockId: req.query.block_id }));
});

// GET /api/insights/breach-risk?block_id=&limit=
exports.getBreachRisk = asyncHandler(async (req, res) => {
    res.json(await reports.breachRisk(await managedBlocks(req.user), { blockId: req.query.block_id, limit: req.query.limit }));
});

// GET /api/insights/recurring?block_id=&days=
exports.getRecurring = asyncHandler(async (req, res) => {
    res.json(await reports.recurringFaults(await managedBlocks(req.user), { blockId: req.query.block_id, days: req.query.days }));
});

// GET /api/insights/briefing - today's briefing for this manager's scope.
exports.getBriefing = asyncHandler(async (req, res) => {
    res.json(await briefingFor(await managedBlocks(req.user), { userId: req.user.userId }));
});

// POST /api/insights/briefing/refresh - writes it again from current figures.
exports.refreshBriefing = asyncHandler(async (req, res) => {
    res.json(await briefingFor(await managedBlocks(req.user), { userId: req.user.userId, refresh: true }));
});

// POST /api/insights/ask { question } - answers from the fixed reports only.
exports.askQuestion = asyncHandler(async (req, res) => {
    const scope = await managedBlocks(req.user);
    const { rows } = await db.query('SELECT block_id FROM hostel_blocks ORDER BY block_id');
    const result = await ask({ question: req.body.question, scope, userId: req.user.userId, allBlockIds: rows.map((r) => r.block_id) });
    await recordAudit(null, req, {
        action: 'insights.ask',
        targetType: 'system',
        targetId: 'insights',
        details: { report: result.report || null, source: result.source },
    });
    res.json(result);
});
