const db = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const { CAMPUS_WIDE_ROLES } = require('../config/roles');

// Which hostel blocks a manager may see and act on (migration 011).
//
//   null      every block (chief wardens, administrators, and supervisors who
//             have not been assigned any block yet)
//   [ids...]  only these blocks
//
// The scope is read from the database on every request, like the role, so
// reassigning a supervisor takes effect immediately.

async function managedBlocks(user, executor = db) {
    if (CAMPUS_WIDE_ROLES.includes(user.role)) return null;
    if (user.role !== 'SUPERVISOR') return [];
    const { rows } = await executor.query('SELECT block_id FROM supervisor_blocks WHERE supervisor_user_id = $1 ORDER BY block_id', [user.userId]);
    return rows.length > 0 ? rows.map((r) => r.block_id) : null;
}

/**
 * Adds a "block is in scope" condition to a WHERE list. `column` is the SQL
 * expression holding the block id. Does nothing for campus-wide scopes.
 */
function scopeCondition(scope, column, params) {
    if (scope === null) return null;
    params.push(scope);
    return `${column} = ANY($${params.length}::varchar[])`;
}

const inScope = (scope, blockId) => scope === null || scope.includes(blockId);

/** 403 unless the ticket's block is one the manager runs. */
async function assertTicketInScope(user, complaintId, executor = db) {
    const scope = await managedBlocks(user, executor);
    if (scope === null) return;
    const { rows } = await executor.query('SELECT block_id FROM complaints WHERE complaint_id = $1', [complaintId]);
    if (rows.length === 0) throw new AppError(404, 'Complaint not found.');
    if (!scope.includes(rows[0].block_id)) {
        throw new AppError(403, 'This ticket is in a block you do not manage.', { code: 'OUT_OF_SCOPE' });
    }
}

module.exports = { managedBlocks, scopeCondition, inScope, assertTicketInScope };
