const db = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

// Block scoping (migration 009). A supervisor looks after the blocks listed
// in supervisor_blocks and sees / acts on tickets in those blocks only.
// Administrators are campus-wide; students and technicians have their own
// visibility rules in the controllers. The database enforces the same rule
// for dispatch (fn_user_manages_block in sp_supervisor_assign_task).

const isSupervisor = (user) => user && user.role === 'SUPERVISOR';

/**
 * WHERE fragment limiting tickets (alias `c`) to the supervisor's blocks.
 * Returns null when no limit applies. Pushes the user id onto `params`.
 */
function supervisorBlockFilter(user, params, alias = 'c') {
    if (!isSupervisor(user)) return null;
    params.push(user.userId);
    return `${alias}.block_id IN (SELECT block_id FROM supervisor_blocks WHERE supervisor_id = $${params.length})`;
}

/** Throws 403 OUT_OF_SCOPE unless the user may manage tickets in this block. */
async function assertManagesBlock(user, blockId, client = db) {
    if (!isSupervisor(user)) return;
    const { rows } = await client.query('SELECT fn_user_manages_block($1, $2) AS ok', [user.userId, blockId]);
    if (!rows[0] || !rows[0].ok) {
        throw new AppError(403, 'This ticket is in a block you do not look after.', { code: 'OUT_OF_SCOPE' });
    }
}

/** As assertManagesBlock, for an existing ticket. 404 when it doesn't exist. */
async function assertManagesComplaint(user, complaintId, client = db) {
    if (!isSupervisor(user)) return;
    const { rows } = await client.query('SELECT block_id FROM complaints WHERE complaint_id = $1', [complaintId]);
    if (rows.length === 0) {
        throw new AppError(404, 'Complaint not found.');
    }
    await assertManagesBlock(user, rows[0].block_id, client);
}

/** The block ids a supervisor looks after (empty for everyone else). */
async function managedBlocks(userId, client = db) {
    const { rows } = await client.query(
        'SELECT block_id FROM supervisor_blocks WHERE supervisor_id = $1 ORDER BY block_id',
        [userId]
    );
    return rows.map((r) => r.block_id);
}

module.exports = { supervisorBlockFilter, assertManagesBlock, assertManagesComplaint, managedBlocks, isSupervisor };
