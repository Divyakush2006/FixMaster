const { AppError } = require('../middleware/errorHandler');
const { recordAudit } = require('./auditService');

// A student's room on registration is a REQUEST, not proof of residence.
// The database has no pending-allotment state and may not gain one, so each
// request is recorded in the audit log (action `allotment.request`, target =
// the student) and the hostel office answers it with the existing allotment
// workflow (`allotment.create` / `allotment.move`) or a decline
// (`allotment.decline`). The student's permissions come from a real
// student_room_allotments row only; a pending request grants nothing.
//
//   pending   = latest request, no current allotment, nothing later closing it
//   declined  = a later decline (the student may ask again)
//   withdrawn = a later withdrawal by the student (as if never asked)

const REQUEST = 'allotment.request';
const DECLINE = 'allotment.decline';
const WITHDRAW = 'allotment.withdraw';

/** Confirms block, floor and room exist together, are active, and match. */
async function assertRequestableRoom(client, { block_id, floor_number, room_id }) {
    const { rows } = await client.query(
        'SELECT room_id, block_id, floor_number, room_number, is_active FROM rooms WHERE room_id = $1',
        [room_id]
    );
    const room = rows[0];
    if (!room || !room.is_active) {
        throw new AppError(404, 'That room was not found or is not open for allotment.');
    }
    if (room.block_id !== block_id || room.floor_number !== floor_number) {
        throw new AppError(400, 'That room is not on the block and floor you selected.');
    }
    return room;
}

const HOSTEL_OF_GENDER = { MALE: 'MENS', FEMALE: 'LADIES' };
const HOSTEL_NAME = { MENS: "men's", LADIES: "ladies'" };

/**
 * A resident lives in the hostel of their gender (the profile's MALE or FEMALE;
 * other answers are not restricted). Applies to a room request and to an
 * allotment by the hostel office alike.
 */
async function assertHostelFits(client, studentId, blockId) {
    const { rows } = await client.query(
        `SELECT p.gender, b.hostel_type FROM hostel_blocks b
         LEFT JOIN student_profiles p ON p.user_id = $1
         WHERE b.block_id = $2`,
        [studentId, blockId]
    );
    const wanted = HOSTEL_OF_GENDER[rows[0]?.gender];
    if (wanted && rows[0].hostel_type && rows[0].hostel_type !== wanted) {
        throw new AppError(400, `That block is in the ${HOSTEL_NAME[rows[0].hostel_type]} hostel. Choose a block in the ${HOSTEL_NAME[wanted]} hostel.`);
    }
}

async function recordRoomRequest(client, req, studentId, room) {
    await recordAudit(client, req, {
        action: REQUEST,
        actorUserId: studentId,
        targetType: 'user',
        targetId: studentId,
        details: { block_id: room.block_id, floor_number: room.floor_number, room_id: room.room_id },
    });
}

/** The latest request of one student and its outcome, or null if they never asked. */
async function requestStatus(executor, studentId) {
    const { rows } = await executor.query(
        `SELECT a.audit_id, a.occurred_at, a.details,
                EXISTS (SELECT 1 FROM student_room_allotments s WHERE s.student_id = $1 AND s.is_current = TRUE) AS allotted,
                d.action AS closing_action, d.details->>'reason' AS decline_reason
         FROM audit_log a
         LEFT JOIN LATERAL (
             SELECT x.action, x.details FROM audit_log x
             WHERE x.action IN ($3, $4) AND x.target_id = $1 AND x.audit_id > a.audit_id
             ORDER BY x.audit_id DESC LIMIT 1
         ) d ON TRUE
         WHERE a.action = $2 AND a.target_id = $1
         ORDER BY a.audit_id DESC LIMIT 1`,
        [studentId, REQUEST, DECLINE, WITHDRAW]
    );
    const r = rows[0];
    if (!r || r.allotted || r.closing_action === WITHDRAW) return null;
    return {
        status: r.closing_action === DECLINE ? 'DECLINED' : 'PENDING',
        block_id: r.details.block_id,
        floor_number: r.details.floor_number,
        room_id: r.details.room_id,
        requested_at: r.occurred_at,
        decline_reason: r.decline_reason || null,
    };
}

/** Every open request, oldest first, with the room's current occupancy. */
async function pendingRequests(executor) {
    const { rows } = await executor.query(
        `SELECT * FROM (
             SELECT DISTINCT ON (a.target_id)
                    a.audit_id, a.occurred_at AS requested_at,
                    u.user_id AS student_id, u.reg_or_emp_id, u.full_name, u.email,
                    r.room_id, r.block_id, r.floor_number, r.room_number, r.bed_capacity,
                    (SELECT COUNT(*)::int FROM student_room_allotments s WHERE s.room_id = r.room_id AND s.is_current = TRUE) AS occupied_beds
             FROM audit_log a
             JOIN users u ON u.user_id = a.target_id AND u.role = 'STUDENT' AND u.is_active = TRUE
             JOIN rooms r ON r.room_id = a.details->>'room_id' AND r.is_active = TRUE
             WHERE a.action = $1
               AND NOT EXISTS (SELECT 1 FROM student_room_allotments s WHERE s.student_id = u.user_id AND s.is_current = TRUE)
               AND NOT EXISTS (SELECT 1 FROM audit_log d WHERE d.action IN ($2, $3) AND d.target_id = a.target_id AND d.audit_id > a.audit_id)
             ORDER BY a.target_id, a.audit_id DESC
         ) latest
         ORDER BY requested_at, audit_id`,
        [REQUEST, DECLINE, WITHDRAW]
    );
    return rows;
}

module.exports = { assertHostelFits, assertRequestableRoom, recordRoomRequest, requestStatus, pendingRequests, DECLINE, WITHDRAW };
