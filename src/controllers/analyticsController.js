const db = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { supervisorBlockFilter } = require('../services/scopeService');

// KPI summary per hostel block, including SLA figures (migration 011).
// A supervisor gets the blocks they look after; an administrator every block.
exports.getBlockSummary = asyncHandler(async (req, res) => {
    const params = [];
    const scope = supervisorBlockFilter(req.user, params, 'v');
    const result = await db.query(
        `SELECT * FROM view_block_supervisor_summary v ${scope ? `WHERE ${scope}` : ''} ORDER BY block_id`,
        params
    );
    res.json(result.rows);
});

// Recurring hotspot / defect alerts, limited the same way.
exports.getDefectHotspots = asyncHandler(async (req, res) => {
    const params = [];
    const scope = supervisorBlockFilter(req.user, params, 'v');
    const result = await db.query(
        `SELECT * FROM view_recurring_defects_alert v ${scope ? `WHERE ${scope}` : ''}
         ORDER BY incident_count_14_days DESC`,
        params
    );
    res.json(result.rows);
});
