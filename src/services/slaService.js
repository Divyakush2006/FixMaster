// SLA tracking computed from what the database already holds: every issue
// category has default_sla_hours, every ticket has created_at / resolved_at /
// closed_at. Nothing is stored, so there is no historical SLA ledger: a
// ticket's figures always reflect its current timestamps.
//
// A ticket is due `default_sla_hours` after it was raised. The clock stops
// when the work is marked done (resolved_at) and runs again if a resident
// rejects the fix (ESCALATED clears resolved_at), against the same deadline.
//
//   ON_TRACK / AT_RISK (last quarter of the window) / OVERDUE   unresolved
//   MET / BREACHED                                              work done
//   NOT_APPLICABLE                                              withdrawn, rejected

const SLA_STATUSES = ['ON_TRACK', 'AT_RISK', 'OVERDUE', 'MET', 'BREACHED'];

/** SQL for the deadline. `c` = complaints alias, `cat` = complaint_categories alias. */
const slaDueSql = (c = 'c', cat = 'cat') => `(${c}.created_at + make_interval(hours => ${cat}.default_sla_hours))`;

/** SQL for the SLA status string. */
const slaStatusSql = (c = 'c', cat = 'cat') => {
    const due = slaDueSql(c, cat);
    return `(CASE
        WHEN ${c}.status IN ('CANCELLED', 'REJECTED') THEN 'NOT_APPLICABLE'
        WHEN ${c}.status IN ('PENDING_VERIFICATION', 'COMPLETED') THEN
            CASE
                WHEN COALESCE(${c}.resolved_at, ${c}.closed_at) IS NULL THEN 'NOT_APPLICABLE'
                WHEN COALESCE(${c}.resolved_at, ${c}.closed_at) <= ${due} THEN 'MET'
                ELSE 'BREACHED'
            END
        WHEN CURRENT_TIMESTAMP > ${due} THEN 'OVERDUE'
        WHEN ${due} - CURRENT_TIMESTAMP <= (${due} - ${c}.created_at) * 0.25 THEN 'AT_RISK'
        ELSE 'ON_TRACK'
    END)`;
};

module.exports = { SLA_STATUSES, slaDueSql, slaStatusSql };
