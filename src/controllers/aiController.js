const { asyncHandler } = require('../middleware/errorHandler');
const gateway = require('../services/ai/gateway');
const { draftTickets } = require('../services/assistant/intake');
const { recordAudit } = require('../services/auditService');

// POST /api/assistant/draft { text } (STUDENT)
// Ticket drafts from the student's own words. Nothing is created: the student
// reviews a draft and submits it through POST /api/complaints.
exports.draftFromText = asyncHandler(async (req, res) => {
    res.json(await draftTickets({ userId: req.user.userId, text: req.body.text }));
});

// GET /api/ai/health (SUPERVISOR, CHIEF_WARDEN, ADMIN)
exports.getAiHealth = asyncHandler(async (req, res) => {
    res.json(await gateway.health());
});

// POST /api/ai/drill { active, reason } (CHIEF_WARDEN, ADMIN)
// Switches every AI feature off campus-wide so teams can rehearse working
// without it: the assistant falls back to the keyword matcher and the
// autopilot to suggestions. Audited.
exports.setDrill = asyncHandler(async (req, res) => {
    const active = req.body.active === true;
    await gateway.setDrill(active, req.body.reason, req.user.userId);
    await recordAudit(null, req, {
        action: active ? 'ai.drill_start' : 'ai.drill_end',
        targetType: 'system',
        targetId: 'ai',
        details: active ? { reason: req.body.reason || null } : {},
    });
    res.json(await gateway.health());
});
