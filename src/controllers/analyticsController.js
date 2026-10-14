const db = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { slaStatusSql } = require('../services/slaService');

// KPI summary across hostel blocks: the existing summary view plus SLA figures
// computed from category SLA hours and ticket timestamps (slaService).
exports.getBlockSummary = asyncHandler(async (req, res) => {
    const result = await db.query(`
        SELECT v.*,
               COALESCE(s.overdue_count, 0)::int AS overdue_count,
               COALESCE(s.at_risk_count, 0)::int AS at_risk_count,
               COALESCE(s.sla_met_count, 0)::int AS sla_met_count,
               COALESCE(s.sla_breached_count, 0)::int AS sla_breached_count,
               ROUND(100.0 * COALESCE(s.sla_met_count, 0)
                     / NULLIF(COALESCE(s.sla_met_count, 0) + COALESCE(s.sla_breached_count, 0), 0), 1) AS sla_compliance_pct
        FROM view_block_supervisor_summary v
        LEFT JOIN (
            SELECT block_id,
                   COUNT(*) FILTER (WHERE st = 'OVERDUE') AS overdue_count,
                   COUNT(*) FILTER (WHERE st = 'AT_RISK') AS at_risk_count,
                   COUNT(*) FILTER (WHERE st = 'MET') AS sla_met_count,
                   COUNT(*) FILTER (WHERE st = 'BREACHED') AS sla_breached_count
            FROM (
                SELECT c.block_id, ${slaStatusSql()} AS st
                FROM complaints c
                JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
                JOIN complaint_categories cat ON cat.category_id = sub.category_id
                WHERE c.status <> 'CANCELLED' AND c.closure_reason IS DISTINCT FROM 'DUPLICATE'
            ) t
            GROUP BY block_id
        ) s ON s.block_id = v.block_id
        ORDER BY v.block_id`);
    res.json(result.rows);
});

// Recurring hotspot / defect alerts.
exports.getDefectHotspots = asyncHandler(async (req, res) => {
    const result = await db.query('SELECT * FROM view_recurring_defects_alert');
    res.json(result.rows);
});
