/**
 * Technician job helpers shared by the admin and self-service endpoints.
 */

const LIVE_ASSIGNMENT_STATES = ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS'];

/** Number of jobs currently in a technician's queue. */
async function countLiveJobs(executor, staffUserId) {
    const result = await executor.query(
        'SELECT COUNT(*)::int AS n FROM complaint_assignments WHERE staff_user_id = $1 AND current_state = ANY($2)',
        [staffUserId, LIVE_ASSIGNMENT_STATES]
    );
    return result.rows[0].n;
}

/**
 * Hands a technician's live jobs back to the supervisors: each assignment is
 * DECLINED and its ticket returns to OPEN for re-dispatch, with `reason`
 * recorded in the ticket history. Must run inside a transaction.
 *
 * Lock order: the tickets are locked first (in id order), then their
 * assignments are updated - the same order every other ticket transaction
 * uses (migration 008), so this cannot deadlock against a technician or
 * supervisor acting on one of those tickets at the same moment.
 *
 * @returns {Promise<string[]>} ids of the tickets that were reopened
 */
async function releaseLiveJobs(client, staffUserId, reason) {
    const tickets = await client.query(
        `SELECT c.complaint_id
         FROM complaints c
         WHERE EXISTS (
             SELECT 1 FROM complaint_assignments ca
             WHERE ca.complaint_id = c.complaint_id AND ca.staff_user_id = $1 AND ca.current_state = ANY($2)
         )
         ORDER BY c.complaint_id
         FOR UPDATE OF c`,
        [staffUserId, LIVE_ASSIGNMENT_STATES]
    );
    if (tickets.rows.length === 0) return [];
    const ids = tickets.rows.map((r) => r.complaint_id);

    await client.query(
        `UPDATE complaint_assignments SET current_state = 'DECLINED'
         WHERE staff_user_id = $1 AND complaint_id = ANY($2) AND current_state = ANY($3)`,
        [staffUserId, ids, LIVE_ASSIGNMENT_STATES]
    );
    const reopened = await client.query(
        `UPDATE complaints c SET status = 'OPEN'
         WHERE c.complaint_id = ANY($1) AND c.status IN ('ASSIGNED', 'IN_PROGRESS')
           AND NOT EXISTS (
               SELECT 1 FROM complaint_assignments ca
               WHERE ca.complaint_id = c.complaint_id AND ca.current_state = ANY($2)
           )
         RETURNING c.complaint_id`,
        [ids, LIVE_ASSIGNMENT_STATES]
    );
    // Replace the trigger's generic "Transition" note with the reason.
    await client.query(
        `UPDATE complaint_logs cl SET action_note = $2
         WHERE cl.log_id IN (
             SELECT DISTINCT ON (complaint_id) log_id FROM complaint_logs
             WHERE complaint_id = ANY($1) AND new_status = 'OPEN' AND previous_status IN ('ASSIGNED', 'IN_PROGRESS')
             ORDER BY complaint_id, log_id DESC
         )`,
        [reopened.rows.map((r) => r.complaint_id), reason]
    );
    return reopened.rows.map((r) => r.complaint_id);
}

module.exports = { LIVE_ASSIGNMENT_STATES, countLiveJobs, releaseLiveJobs };
