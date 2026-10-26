const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');
const { recordAudit } = require('./auditService');

// Data-subject rights (migration 015): a copy of what is held about a person,
// and erasure of their personal data.

const LIVE = `('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'ESCALATED')`;

/** Everything held about one person, as plain JSON. Never includes other people's details or credentials. */
async function exportData(executor, userId) {
    const one = async (sql, params = [userId]) => (await executor.query(sql, params)).rows;
    const [account] = await one(
        `SELECT user_id, reg_or_emp_id, full_name, email, phone_number, role, specialization, home_block_id, shift,
                account_status, email_verified_at, created_at, last_login_at, erasure_requested_at
         FROM users WHERE user_id = $1`
    );
    if (!account) throw new AppError(404, 'User not found.');
    const [profile] = await one(`SELECT * FROM student_profiles WHERE user_id = $1`);
    return {
        exported_at: new Date().toISOString(),
        about_this_file:
            'Everything FixMaster holds about you, as of the date above. Other people\'s details (roommates, technicians, other residents) are not included.',
        account,
        resident_profile: profile || null,
        room_allotments: await one(
            `SELECT a.room_id, r.block_id, r.floor_number, a.academic_year, a.is_current, a.assigned_date
             FROM student_room_allotments a JOIN rooms r ON r.room_id = a.room_id
             WHERE a.student_id = $1 ORDER BY a.assigned_date DESC`
        ),
        tickets: await one(
            `SELECT c.complaint_id, c.block_id, c.ticket_scope, COALESCE(r.room_number, ca.description) AS location,
                    cat.category_name, sub.issue_name, c.description, c.status, c.priority, c.created_at, c.resolved_at, c.closed_at,
                    rep.is_original AS raised_by_me
             FROM complaint_reporters rep
             JOIN complaints c ON c.complaint_id = rep.complaint_id
             JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
             JOIN complaint_categories cat ON cat.category_id = sub.category_id
             LEFT JOIN rooms r ON r.room_id = c.room_id
             LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id
             WHERE rep.user_id = $1 ORDER BY c.created_at DESC`
        ),
        reviews_given: await one(
            `SELECT complaint_id, is_satisfactorily_resolved, rating, student_comments, verified_at
             FROM complaint_feedback WHERE student_id = $1 ORDER BY verified_at DESC`
        ),
        jobs_assigned_to_me:
            account.role === 'STAFF'
                ? await one(
                      `SELECT complaint_id, assigned_at, started_at, work_completed_at, current_state, dispatch_source
                       FROM complaint_assignments WHERE staff_user_id = $1 ORDER BY assigned_at DESC LIMIT 1000`
                  )
                : undefined,
        my_actions_in_the_audit_log: await one(
            `SELECT occurred_at, action, target_type, target_id FROM audit_log WHERE actor_user_id = $1 ORDER BY occurred_at DESC LIMIT 500`
        ),
    };
}

/** Records a resident's request to have their data erased. Safe to repeat. */
async function requestErasure(client, req, userId) {
    const { rows } = await client.query(
        `UPDATE users SET erasure_requested_at = COALESCE(erasure_requested_at, CURRENT_TIMESTAMP)
         WHERE user_id = $1 AND erased_at IS NULL RETURNING erasure_requested_at`,
        [userId]
    );
    if (!rows[0]) throw new AppError(404, 'User not found.');
    await recordAudit(client, req, { action: 'privacy.erasure_requested', targetType: 'user', targetId: userId });
    return rows[0].erasure_requested_at;
}

async function cancelErasure(client, req, userId) {
    const { rowCount } = await client.query(`UPDATE users SET erasure_requested_at = NULL WHERE user_id = $1 AND erased_at IS NULL AND erasure_requested_at IS NOT NULL`, [userId]);
    if (rowCount === 0) throw new AppError(404, 'There is no erasure request to cancel.');
    await recordAudit(client, req, { action: 'privacy.erasure_cancelled', targetType: 'user', targetId: userId });
}

/** What stops an erasure right now, as sentences an administrator can act on. */
async function erasureBlockers(client, userId) {
    const blockers = [];
    const room = await client.query(`SELECT room_id FROM student_room_allotments WHERE student_id = $1 AND is_current`, [userId]);
    if (room.rows[0]) blockers.push(`The resident still has room ${room.rows[0].room_id}. End the allotment first.`);
    const live = await client.query(`SELECT COUNT(*)::int AS n FROM complaints WHERE raised_by_user_id = $1 AND status IN ${LIVE}`, [userId]);
    if (live.rows[0].n > 0) blockers.push(`${live.rows[0].n} ticket(s) raised by the resident are still open. Let them finish or close them first.`);
    return blockers;
}

/**
 * Removes a resident's personal data (administrator action, in a transaction).
 * The account row stays, disabled and anonymous, so tickets, ratings and the
 * audit log keep their shape; what identifies the person does not.
 */
async function eraseStudent(client, req, userId) {
    const { rows } = await client.query(`SELECT role, erased_at, erasure_requested_at FROM users WHERE user_id = $1 FOR UPDATE`, [userId]);
    const user = rows[0];
    if (!user) throw new AppError(404, 'User not found.');
    if (user.role !== 'STUDENT') throw new AppError(400, 'Only resident accounts are erased this way. Staff records follow the employer\'s retention rules.');
    if (user.erased_at) throw new AppError(409, 'This account has already been erased.');
    if (!user.erasure_requested_at) throw new AppError(409, 'The resident has not asked for their data to be erased.', { code: 'NO_REQUEST' });
    const blockers = await erasureBlockers(client, userId);
    if (blockers.length > 0) throw new AppError(409, blockers.join(' '), { code: 'ERASURE_BLOCKED', details: { blockers } });

    const tag = userId.replace(/-/g, '').slice(0, 10);
    await client.query(`DELETE FROM feedback_tags WHERE feedback_id IN (SELECT feedback_id FROM complaint_feedback WHERE student_id = $1)`, [userId]);
    await client.query(`UPDATE complaint_feedback SET student_comments = NULL WHERE student_id = $1`, [userId]);
    const photos = await client.query(`SELECT complaint_id FROM complaints WHERE raised_by_user_id = $1 AND photo_evidence_url IS NOT NULL`, [userId]);
    await client.query(`UPDATE complaints SET description = NULL, photo_evidence_url = NULL WHERE raised_by_user_id = $1`, [userId]);
    await client.query(`DELETE FROM student_profiles WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM email_verifications WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM revoked_tokens WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM student_room_allotments WHERE student_id = $1`, [userId]);
    await client.query(
        `UPDATE users SET reg_or_emp_id = $2, full_name = 'Former resident', email = $3, phone_number = '0000000000',
                password_hash = $4, is_active = FALSE, is_available = FALSE, account_status = 'ACTIVE',
                credentials_changed_at = CURRENT_TIMESTAMP, erased_at = CURRENT_TIMESTAMP
         WHERE user_id = $1`,
        [userId, `ERASED-${tag}`, `erased-${tag}@erased.invalid`, `!${crypto.randomBytes(24).toString('hex')}`]
    );
    // The audit entries stay (they say what happened, not who the person was);
    // this one records the erasure itself.
    await recordAudit(client, req, { action: 'privacy.erased', targetType: 'user', targetId: userId });
    // The photo files are removed by the caller once this commits.
    return { photoComplaintIds: photos.rows.map((r) => r.complaint_id) };
}

module.exports = { exportData, requestErasure, cancelErasure, erasureBlockers, eraseStudent };
