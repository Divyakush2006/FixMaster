const db = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// Which hostel blocks a manager may see and act on (migrations 011 and 016).
//
//   null      every block (administrators, and chief wardens and supervisors
//             who belong to no hostel yet)
//   [ids...]  only these blocks
//
//   ADMIN                       every block
//   CHIEF_WARDEN of a hostel    every block of that hostel, plus the academic blocks
//   SUPERVISOR with blocks      exactly those blocks
//   SUPERVISOR of a hostel      every block of that hostel when none are assigned
//   anyone with no hostel       as before migration 016: everything
//
// The scope is read from the database on every request, like the role, so
// reassigning a supervisor takes effect immediately.

async function managedBlocks(user, executor = db) {
    if (user.role === 'ADMIN') return null;
    if (user.role !== 'SUPERVISOR' && user.role !== 'CHIEF_WARDEN') return [];
    const { rows: me } = await executor.query('SELECT hostel_type FROM users WHERE user_id = $1', [user.userId]);
    const hostel = me[0]?.hostel_type || null;
    if (user.role === 'CHIEF_WARDEN') return hostel ? hostelBlocks(hostel, executor, { withAcademic: true }) : null;
    const { rows } = await executor.query('SELECT block_id FROM supervisor_blocks WHERE supervisor_user_id = $1 ORDER BY block_id', [user.userId]);
    if (rows.length > 0) return rows.map((r) => r.block_id);
    return hostel ? hostelBlocks(hostel, executor, { withAcademic: false }) : null;
}

/** Block ids of one hostel (and, for a chief warden, the academic blocks both hostels share). */
async function hostelBlocks(hostel, executor, { withAcademic }) {
    const { rows } = await executor.query(
        `SELECT block_id FROM hostel_blocks WHERE hostel_type = $1 ${withAcademic ? "OR block_kind = 'ACADEMIC'" : ''} ORDER BY block_id`,
        [hostel]
    );
    return rows.map((r) => r.block_id);
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

/** 403 unless the manager runs this block (404 when it does not exist). */
async function assertBlockInScope(user, blockId, executor = db) {
    const { rows } = await executor.query('SELECT 1 FROM hostel_blocks WHERE block_id = $1', [blockId]);
    if (rows.length === 0) throw new AppError(404, `Block ${blockId} not found.`);
    if (!inScope(await managedBlocks(user, executor), blockId)) {
        throw new AppError(403, 'This block is not one you manage.', { code: 'OUT_OF_SCOPE' });
    }
}

module.exports = { managedBlocks, scopeCondition, inScope, assertTicketInScope, assertBlockInScope };
