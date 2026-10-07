const db = require('../config/db');

/**
 * Appends one row to audit_log: who did what to which record.
 *
 * Pass the transaction `client` whenever the audited change runs in one, so
 * the change and its audit entry commit (or roll back) together - an action
 * is never recorded without happening, or done without being recorded.
 *
 * @param {object} executor  pg client inside a transaction, or null for the pool
 * @param {object} req       Express request (actor, IP and request id come from it)
 * @param {object} entry     { action, targetType, targetId, details, actorUserId }
 */
async function recordAudit(executor, req, { action, targetType = null, targetId = null, details = {}, actorUserId }) {
    const actor = actorUserId !== undefined ? actorUserId : req.user ? req.user.userId : null;
    await (executor || db).query(
        `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, details, ip_address, request_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [actor, action, targetType, targetId === null ? null : String(targetId), JSON.stringify(details), req.ip || null, req.id || null]
    );
}

module.exports = { recordAudit };
