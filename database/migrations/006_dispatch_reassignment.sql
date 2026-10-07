-- ============================================================================
-- FIX_MASTER migration 006: supervisors can reassign work in progress
-- ----------------------------------------------------------------------------
-- Replaces sp_supervisor_assign_task (migration 003). Before this, a ticket
-- could only be assigned while OPEN or ESCALATED, so once a technician had it
-- (ASSIGNED / IN_PROGRESS) nobody could move it: a technician who went off
-- shift, fell sick or simply never turned up left the ticket stuck until an
-- administrator deactivated their whole account.
--
-- Now an ASSIGNED or IN_PROGRESS ticket can be handed to another technician
-- of the right trade. The previous assignment is closed as DECLINED (it no
-- longer appears in that technician's queue) and the hand-over is recorded in
-- complaint_logs with both names.
-- ============================================================================

CREATE OR REPLACE PROCEDURE sp_supervisor_assign_task(
    p_complaint_id VARCHAR(36),
    p_staff_user_id VARCHAR(36),
    p_supervisor_user_id VARCHAR(36)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR(25);
    v_required VARCHAR(30);
    v_role VARCHAR(20);
    v_specialization VARCHAR(30);
    v_active BOOLEAN;
    v_new_name VARCHAR(100);
    v_previous_staff_id VARCHAR(36);
    v_previous_name VARCHAR(100);
BEGIN
    SELECT c.status, sub.required_specialization INTO v_status, v_required
    FROM complaints c
    JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
    WHERE c.complaint_id = p_complaint_id
    FOR UPDATE OF c;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint not found.' USING ERRCODE = 'FM404';
    END IF;
    IF v_status NOT IN ('OPEN', 'ESCALATED', 'ASSIGNED', 'IN_PROGRESS') THEN
        RAISE EXCEPTION 'Complaint is % and cannot be (re)assigned right now.', v_status USING ERRCODE = 'FM409';
    END IF;

    SELECT role, specialization, is_active, full_name INTO v_role, v_specialization, v_active, v_new_name
    FROM users WHERE user_id = p_staff_user_id;

    IF NOT FOUND OR v_role <> 'STAFF' THEN
        RAISE EXCEPTION 'staff_user_id does not refer to a staff member.' USING ERRCODE = 'FM400';
    END IF;
    IF NOT v_active THEN
        RAISE EXCEPTION 'That staff account is deactivated.' USING ERRCODE = 'FM400';
    END IF;
    IF v_specialization <> v_required THEN
        RAISE EXCEPTION 'This complaint needs a % technician; the selected staff member is %.', v_required, v_specialization
            USING ERRCODE = 'FM400';
    END IF;

    -- Reassignment: close the live assignment(s) of the current technician.
    IF v_status IN ('ASSIGNED', 'IN_PROGRESS') THEN
        SELECT ca.staff_user_id, u.full_name INTO v_previous_staff_id, v_previous_name
        FROM complaint_assignments ca
        JOIN users u ON u.user_id = ca.staff_user_id
        WHERE ca.complaint_id = p_complaint_id
          AND ca.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')
        ORDER BY ca.assigned_at DESC
        LIMIT 1;

        IF v_previous_staff_id = p_staff_user_id THEN
            RAISE EXCEPTION 'This ticket is already assigned to %.', v_new_name USING ERRCODE = 'FM409';
        END IF;

        UPDATE complaint_assignments
        SET current_state = 'DECLINED'
        WHERE complaint_id = p_complaint_id
          AND current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS');
    END IF;

    INSERT INTO complaint_assignments (complaint_id, staff_user_id, assigned_by_user_id, current_state)
    VALUES (p_complaint_id, p_staff_user_id, p_supervisor_user_id, 'ASSIGNED');

    UPDATE complaints SET status = 'ASSIGNED' WHERE complaint_id = p_complaint_id;

    -- Record the hand-over with both names. ASSIGNED -> ASSIGNED is not a
    -- status change, so the status trigger wrote nothing and the entry is
    -- added here; IN_PROGRESS -> ASSIGNED was just logged by the trigger, so
    -- that entry's generic note is replaced instead of adding a duplicate.
    IF v_previous_staff_id IS NOT NULL THEN
        IF v_status = 'ASSIGNED' THEN
            INSERT INTO complaint_logs (complaint_id, changed_by_user_id, previous_status, new_status, action_note)
            VALUES (p_complaint_id, p_supervisor_user_id, 'ASSIGNED', 'ASSIGNED',
                    CONCAT('Reassigned from ', COALESCE(v_previous_name, 'previous technician'), ' to ', v_new_name));
        ELSE
            UPDATE complaint_logs
            SET action_note = CONCAT('Reassigned from ', COALESCE(v_previous_name, 'previous technician'), ' to ', v_new_name)
            WHERE log_id = (
                SELECT log_id FROM complaint_logs
                WHERE complaint_id = p_complaint_id AND previous_status = v_status AND new_status = 'ASSIGNED'
                ORDER BY log_id DESC LIMIT 1
            );
        END IF;
    END IF;
END;
$$;
