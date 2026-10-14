const db = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');

// KPI summary across hostel blocks.
exports.getBlockSummary = asyncHandler(async (req, res) => {
    const result = await db.query('SELECT * FROM view_block_supervisor_summary ORDER BY block_id');
    res.json(result.rows);
});

// Recurring hotspot / defect alerts.
exports.getDefectHotspots = asyncHandler(async (req, res) => {
    const result = await db.query('SELECT * FROM view_recurring_defects_alert');
    res.json(result.rows);
});
