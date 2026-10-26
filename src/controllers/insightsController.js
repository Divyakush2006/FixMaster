const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const reports = require('../services/insights/reports');
const { CATALOGUE, NAMES } = require('../services/insights/catalogue');
const { briefingFor } = require('../services/insights/briefing');
const { ask } = require('../services/insights/ask');
const { managedBlocks } = require('../services/scopeService');
const { recordAudit } = require('../services/auditService');
const cache = require('../services/cache');

// All of these read inside the signed-in manager's block scope
// (scopeService.managedBlocks), so a supervisor sees only their own blocks and
// the chief warden sees the campus.

// GET /api/insights/overview?block_id= - totals and one row per block.
exports.getOverview = asyncHandler(async (req, res) => {
    const scope = await managedBlocks(req.user);
    const opts = { blockId: req.query.block_id };
    res.json(await cache.memo(`ins:overview:${cache.scopeKey(scope)}:${opts.blockId}`, () => reports.overview(scope, opts)));
});

// GET /api/insights/breach-risk?block_id=&limit=
exports.getBreachRisk = asyncHandler(async (req, res) => {
    const scope = await managedBlocks(req.user);
    const opts = { blockId: req.query.block_id, limit: req.query.limit };
    res.json(await cache.memo(`ins:risk:${cache.scopeKey(scope)}:${opts.blockId}:${opts.limit}`, () => reports.breachRisk(scope, opts)));
});

// GET /api/insights/recurring?block_id=&days=
exports.getRecurring = asyncHandler(async (req, res) => {
    const scope = await managedBlocks(req.user);
    const opts = { blockId: req.query.block_id, days: req.query.days };
    res.json(await cache.memo(`ins:recurring:${cache.scopeKey(scope)}:${opts.blockId}:${opts.days}`, () => reports.recurringFaults(scope, opts)));
});

// GET /api/insights/report/:name?block_id=&days= - any report in the catalogue
// (the same ones "Ask FixMaster" can run), with the same scoping.
exports.getReport = asyncHandler(async (req, res) => {
    const entry = CATALOGUE[req.params.name];
    if (!entry) throw new AppError(404, 'There is no such report.');
    const scope = await managedBlocks(req.user);
    const opts = { blockId: req.query.block_id, days: req.query.days };
    const rows = await cache.memo(`ins:${req.params.name}:${cache.scopeKey(scope)}:${opts.blockId}:${opts.days}`, () => entry.run(scope, opts));
    res.json({ report: req.params.name, title: entry.title, answer: entry.answer(rows, { blockId: opts.blockId, days: Number(opts.days) || 30 }), rows });
});

// GET /api/insights/reports - the catalogue, for screens that list what can be asked.
exports.listReports = (req, res) => res.json(NAMES.map((name) => ({ name, title: CATALOGUE[name].title, about: CATALOGUE[name].about })));

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
