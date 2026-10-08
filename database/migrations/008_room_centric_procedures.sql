-- ============================================================================
-- FIX_MASTER migration 008: procedures, triggers and views for room-centric
-- tickets (see 007)
-- ----------------------------------------------------------------------------
-- Lock order. Every transaction that touches a ticket locks the complaints
-- row FIRST and its complaint_assignments rows second. The technician
-- endpoints used to lock the assignment first, which deadlocked against a
-- supervisor reassigning the same ticket at the same moment. The procedures
-- below and the API (src/controllers/dispatchController.js,
-- adminController.js, meController.js) all follow this order.
--
-- Error contract unchanged (FM4xx = HTTP status). Where the client needs to
-- react to a specific conflict, the exception also carries a machine-readable
-- HINT, returned to the client as `code`:
--   STALE_ASSIGNMENT  the ticket changed since the supervisor last saw it
--   STAFF_OFF_DUTY    the chosen technician is off duty (confirm to override)
-- ============================================================================

-- 1. TRIGGERS ------------------------------------------------------------------

-- closed_at is now also set when a ticket is rejected or withdrawn.
CREATE OR REPLACE FUNCTION fn_update_complaint_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'PENDING_VERIFICATION' AND OLD.status IS DISTINCT FROM 'PENDING_VERIFICATION' THEN
        NEW.resolved_at = CURRENT_TIMESTAMP;
    ELSIF NEW.status = 'ESCALATED' AND OLD.status IS DISTINCT FROM 'ESCALATED' THEN
        NEW.resolved_at = NULL;
    ELSIF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED' THEN
        NEW.closed_at = CURRENT_TIMESTAMP;
        IF NEW.resolved_at IS NULL THEN
            NEW.resolved_at = CURRENT_TIMESTAMP;
        END IF;
    ELSIF NEW.status IN ('REJECTED', 'CANCELLED') AND OLD.status IS DISTINCT FROM NEW.status THEN
        NEW.closed_at = COALESCE(NEW.closed_at, CURRENT_TIMESTAMP);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Whoever creates a ticket is its first reporter, however the row is written
-- (API, seed data or manual SQL), so complaint_reporters never misses one.
CREATE OR REPLACE FUNCTION fn_register_original_reporter()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO complaint_reporters (complaint_id, user_id, reported_at, is_original)
    VALUES (NEW.complaint_id, NEW.raised_by_user_id, COALESCE(NEW.created_at, CURRENT_TIMESTAMP), TRUE)
    ON CONFLICT (complaint_id, user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_register_original_reporter ON complaints;
CREATE TRIGGER trg_register_original_reporter
AFTER INSERT ON complaints
FOR EACH ROW
EXECUTE FUNCTION fn_register_original_reporter();

-- 2. STORED PROCEDURES ---------------------------------------------------------

-- Procedure 1: auto-dispatch a cleaning ticket to the least-loaded cleaner.
-- Change: the "who is least loaded" decision is serialized per trade, so two
-- tickets dispatched at the same instant no longer both pick the same person.
-- user_id breaks ties so the choice is deterministic.
CREATE OR REPLACE PROCEDURE sp_auto_dispatch_cleaning(
    p_complaint_id VARCHAR(36),
    INOUT p_assigned_staff_id VARCHAR(36) DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR(25);
    v_specialization VARCHAR(30);
BEGIN
    SELECT c.status, sub.required_specialization INTO v_status, v_specialization
    FROM complaints c
    JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
    WHERE c.complaint_id = p_complaint_id
    FOR UPDATE OF c;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint not found.' USING ERRCODE = 'FM404';
    END IF;
    IF v_specialization <> 'CLEANING' THEN
        RAISE EXCEPTION 'Auto-dispatch only applies to cleaning tickets. Use manual assignment for this complaint.' USING ERRCODE = 'FM400';
    END IF;
    IF v_status NOT IN ('OPEN', 'ESCALATED') THEN
        RAISE EXCEPTION 'Complaint is % and cannot be dispatched right now.', v_status USING ERRCODE = 'FM409';
    END IF;

    -- Held until commit: the next dispatch for this trade sees this one's
    -- assignment when it counts workloads.
    PERFORM pg_advisory_xact_lock(hashtext('fm-dispatch-pick:CLEANING'));

    SELECT u.user_id INTO p_assigned_staff_id
    FROM users u
    LEFT JOIN complaint_assignments ca
        ON u.user_id = ca.staff_user_id
        AND ca.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')
    WHERE u.role = 'STAFF'
      AND u.specialization = 'CLEANING'
      AND u.is_available = TRUE
      AND u.is_active = TRUE
    GROUP BY u.user_id
    ORDER BY COUNT(ca.assignment_id) ASC, MIN(u.created_at) ASC, u.user_id ASC
    LIMIT 1;

    IF p_assigned_staff_id IS NOT NULL THEN
        INSERT INTO complaint_assignments (complaint_id, staff_user_id, current_state)
        VALUES (p_complaint_id, p_assigned_staff_id, 'ASSIGNED');

        UPDATE complaints SET status = 'ASSIGNED' WHERE complaint_id = p_complaint_id;
    END IF;
END;
$$;

-- Procedure 2: closed-loop verification.
-- Changes:
--   * a ROOM ticket can be confirmed by anyone who currently lives in the
--     room (the room is the unit); someone who reported it and has since
--     moved out can still see it but not confirm it;
--   * a COMMON_AREA ticket can be confirmed by anyone who reported it;
--   * when two residents answer at the same moment the row lock serializes
--     them and the second is told who answered first.
CREATE OR REPLACE PROCEDURE sp_confirm_resolution(
    p_complaint_id VARCHAR(36),
    p_student_id VARCHAR(36),
    p_is_satisfied BOOLEAN,
    p_rating INT,
    p_comments TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_scope VARCHAR(15);
    v_room_id VARCHAR(20);
    v_status VARCHAR(25);
    v_last_by VARCHAR(100);
    v_last_ok BOOLEAN;
BEGIN
    SELECT ticket_scope, room_id, status
    INTO v_scope, v_room_id, v_status
    FROM complaints
    WHERE complaint_id = p_complaint_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint not found.' USING ERRCODE = 'FM404';
    END IF;

    IF v_scope = 'ROOM' THEN
        IF NOT EXISTS (
            SELECT 1 FROM student_room_allotments
            WHERE student_id = p_student_id AND room_id = v_room_id AND is_current = TRUE
        ) THEN
            IF EXISTS (SELECT 1 FROM complaint_reporters WHERE complaint_id = p_complaint_id AND user_id = p_student_id) THEN
                RAISE EXCEPTION 'You no longer live in this room, so one of its current residents needs to confirm this work.'
                    USING ERRCODE = 'FM403';
            END IF;
            RAISE EXCEPTION 'Only residents of this room can confirm this work.' USING ERRCODE = 'FM403';
        END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM complaint_reporters WHERE complaint_id = p_complaint_id AND user_id = p_student_id) THEN
        RAISE EXCEPTION 'Only people who reported this issue can confirm the work.' USING ERRCODE = 'FM403';
    END IF;

    IF v_status <> 'PENDING_VERIFICATION' THEN
        SELECT u.full_name, f.is_satisfactorily_resolved
        INTO v_last_by, v_last_ok
        FROM complaint_feedback f
        JOIN users u ON u.user_id = f.student_id
        WHERE f.complaint_id = p_complaint_id
        ORDER BY f.verified_at DESC, f.feedback_id DESC
        LIMIT 1;

        IF v_status = 'COMPLETED' AND v_last_ok IS TRUE THEN
            RAISE EXCEPTION 'This work was already confirmed by %.', v_last_by USING ERRCODE = 'FM409';
        ELSIF v_status = 'ESCALATED' AND v_last_ok IS FALSE THEN
            RAISE EXCEPTION '% already reported that the work was not done properly. The ticket has gone back to the supervisor.', v_last_by
                USING ERRCODE = 'FM409';
        ELSIF v_status = 'COMPLETED' THEN
            RAISE EXCEPTION 'This ticket is already closed.' USING ERRCODE = 'FM409';
        END IF;
        RAISE EXCEPTION 'This complaint is % - it can only be verified after the technician marks the work done.', v_status
            USING ERRCODE = 'FM409';
    END IF;

    INSERT INTO complaint_feedback (complaint_id, student_id, is_satisfactorily_resolved, rating, student_comments)
    VALUES (p_complaint_id, p_student_id, p_is_satisfied, p_rating, p_comments);

    IF p_is_satisfied THEN
        UPDATE complaints SET status = 'COMPLETED', closure_reason = 'CONFIRMED' WHERE complaint_id = p_complaint_id;
    ELSE
        UPDATE complaints SET status = 'ESCALATED' WHERE complaint_id = p_complaint_id;
        UPDATE complaint_assignments
        SET current_state = 'DECLINED'
        WHERE complaint_id = p_complaint_id AND current_state = 'DONE';
    END IF;
END;
$$;

-- Procedure 3: supervisor dispatch / reassignment.
-- Changes:
--   * optimistic concurrency: when p_check_expected is TRUE the caller states
--     who it believes currently holds the ticket (NULL = nobody). If that is
--     no longer true - another supervisor got there first - nothing changes
--     and the caller is told who did. Without this, two supervisors working
--     from the same screen silently overrode each other;
--   * assigning an off-duty technician needs p_allow_off_duty = TRUE.
DROP PROCEDURE IF EXISTS sp_supervisor_assign_task(VARCHAR, VARCHAR, VARCHAR);

CREATE OR REPLACE PROCEDURE sp_supervisor_assign_task(
    p_complaint_id VARCHAR(36),
    p_staff_user_id VARCHAR(36),
    p_supervisor_user_id VARCHAR(36),
    p_check_expected BOOLEAN DEFAULT FALSE,
    p_expected_staff_id VARCHAR(36) DEFAULT NULL,
    p_allow_off_duty BOOLEAN DEFAULT FALSE
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR(25);
    v_required VARCHAR(30);
    v_role VARCHAR(20);
    v_specialization VARCHAR(30);
    v_active BOOLEAN;
    v_available BOOLEAN;
    v_new_name VARCHAR(100);
    v_previous_staff_id VARCHAR(36);
    v_previous_name VARCHAR(100);
    v_previous_by VARCHAR(100);
BEGIN
    SELECT c.status, sub.required_specialization INTO v_status, v_required
    FROM complaints c
    JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
    WHERE c.complaint_id = p_complaint_id
    FOR UPDATE OF c;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint not found.' USING ERRCODE = 'FM404';
    END IF;

    -- Who holds the ticket right now (NULL when nobody does).
    SELECT ca.staff_user_id, u.full_name, COALESCE(sup.full_name, 'auto-dispatch')
    INTO v_previous_staff_id, v_previous_name, v_previous_by
    FROM complaint_assignments ca
    JOIN users u ON u.user_id = ca.staff_user_id
    LEFT JOIN users sup ON sup.user_id = ca.assigned_by_user_id
    WHERE ca.complaint_id = p_complaint_id
      AND ca.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')
    ORDER BY ca.assigned_at DESC, ca.assignment_id DESC
    LIMIT 1;

    IF p_check_expected AND v_previous_staff_id IS DISTINCT FROM p_expected_staff_id THEN
        IF v_previous_staff_id IS NOT NULL THEN
            RAISE EXCEPTION 'This ticket was just assigned to % by %. Refresh to see the latest before changing it.',
                v_previous_name, v_previous_by
                USING ERRCODE = 'FM409', HINT = 'STALE_ASSIGNMENT';
        END IF;
        RAISE EXCEPTION 'This ticket changed while you were viewing it (it is now %). Refresh and try again.', v_status
            USING ERRCODE = 'FM409', HINT = 'STALE_ASSIGNMENT';
    END IF;

    IF v_status NOT IN ('OPEN', 'ESCALATED', 'ASSIGNED', 'IN_PROGRESS') THEN
        RAISE EXCEPTION 'Complaint is % and cannot be (re)assigned right now.', v_status USING ERRCODE = 'FM409';
    END IF;

    SELECT role, specialization, is_active, is_available, full_name
    INTO v_role, v_specialization, v_active, v_available, v_new_name
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
    IF v_previous_staff_id = p_staff_user_id THEN
        RAISE EXCEPTION 'This ticket is already assigned to %.', v_new_name USING ERRCODE = 'FM409';
    END IF;
    IF NOT COALESCE(v_available, FALSE) AND NOT p_allow_off_duty THEN
        RAISE EXCEPTION '% is off duty. Confirm to assign the ticket anyway.', v_new_name
            USING ERRCODE = 'FM409', HINT = 'STAFF_OFF_DUTY';
    END IF;

    IF v_previous_staff_id IS NOT NULL THEN
        UPDATE complaint_assignments
        SET current_state = 'DECLINED'
        WHERE complaint_id = p_complaint_id
          AND current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS');
    END IF;

    INSERT INTO complaint_assignments (complaint_id, staff_user_id, assigned_by_user_id, current_state)
    VALUES (p_complaint_id, p_staff_user_id, p_supervisor_user_id, 'ASSIGNED');

    UPDATE complaints SET status = 'ASSIGNED' WHERE complaint_id = p_complaint_id;

    -- Record the hand-over with both names (see migration 006).
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

-- Procedure 4: close tickets nobody verified.
-- A ticket whose work was marked done p_hours ago and that no resident has
-- confirmed or rejected is closed as COMPLETED with closure_reason
-- AUTO_CONFIRMED (and no rating). SKIP LOCKED leaves alone any ticket a
-- resident is verifying at this very moment; that one is handled next run.
CREATE OR REPLACE PROCEDURE sp_auto_close_stale_verifications(
    p_hours INT,
    INOUT p_closed INT DEFAULT 0
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_id VARCHAR(36);
    v_note TEXT;
BEGIN
    IF p_hours IS NULL OR p_hours < 1 THEN
        RAISE EXCEPTION 'p_hours must be at least 1.' USING ERRCODE = 'FM400';
    END IF;
    v_note := format('Closed automatically: no resident responded within %s hours of the work being marked done.', p_hours);
    p_closed := 0;

    FOR v_id IN
        SELECT complaint_id FROM complaints
        WHERE status = 'PENDING_VERIFICATION'
          AND COALESCE(resolved_at, created_at) < CURRENT_TIMESTAMP - make_interval(hours => p_hours)
        ORDER BY complaint_id
        FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE complaints
        SET status = 'COMPLETED', closure_reason = 'AUTO_CONFIRMED', closure_note = v_note
        WHERE complaint_id = v_id;

        UPDATE complaint_logs SET action_note = v_note
        WHERE log_id = (
            SELECT log_id FROM complaint_logs
            WHERE complaint_id = v_id AND previous_status = 'PENDING_VERIFICATION' AND new_status = 'COMPLETED'
            ORDER BY log_id DESC LIMIT 1
        );
        p_closed := p_closed + 1;
    END LOOP;
END;
$$;

-- 3. VIEWS ---------------------------------------------------------------------
-- Withdrawn tickets and merged duplicates are not real incidents: they no
-- longer count towards block totals or recurring-defect alerts.

DROP VIEW IF EXISTS view_block_supervisor_summary;
CREATE VIEW view_block_supervisor_summary AS
SELECT
    b.block_id,
    b.block_name,
    COUNT(c.complaint_id) AS total_complaints,
    COUNT(CASE WHEN c.status IN ('OPEN', 'ASSIGNED') THEN 1 END) AS pending_complaints,
    COUNT(CASE WHEN c.status = 'IN_PROGRESS' THEN 1 END) AS active_in_progress,
    COUNT(CASE WHEN c.status = 'PENDING_VERIFICATION' THEN 1 END) AS awaiting_student_verification,
    COUNT(CASE WHEN c.status = 'COMPLETED' THEN 1 END) AS resolved_count,
    COUNT(CASE WHEN c.status = 'ESCALATED' THEN 1 END) AS escalated_count,
    COUNT(CASE WHEN c.ticket_scope = 'COMMON_AREA' THEN 1 END) AS common_area_issues,
    ROUND(COALESCE(AVG(fb.accepted_rating), 0), 2) AS average_student_rating
FROM hostel_blocks b
LEFT JOIN complaints c
    ON b.block_id = c.block_id
    AND c.status <> 'CANCELLED'
    AND c.closure_reason IS DISTINCT FROM 'DUPLICATE'
LEFT JOIN (
    SELECT complaint_id, MAX(rating) AS accepted_rating
    FROM complaint_feedback
    WHERE is_satisfactorily_resolved = TRUE AND rating IS NOT NULL
    GROUP BY complaint_id
) fb ON c.complaint_id = fb.complaint_id
GROUP BY b.block_id, b.block_name;

DROP VIEW IF EXISTS view_recurring_defects_alert;
CREATE VIEW view_recurring_defects_alert AS
SELECT
    c.block_id,
    c.ticket_scope,
    COALESCE(r.room_number, ca_area.description) AS asset_location,
    cat.category_name,
    COUNT(c.complaint_id) AS incident_count_14_days,
    MAX(c.created_at) AS most_recent_incident
FROM complaints c
JOIN complaint_subcategories sub ON c.subcategory_id = sub.subcategory_id
JOIN complaint_categories cat ON sub.category_id = cat.category_id
LEFT JOIN rooms r ON c.room_id = r.room_id
LEFT JOIN common_areas ca_area ON c.common_area_id = ca_area.area_id
WHERE c.created_at >= (CURRENT_TIMESTAMP - INTERVAL '14 days')
  AND c.status NOT IN ('CANCELLED', 'REJECTED')
GROUP BY c.block_id, c.ticket_scope, COALESCE(r.room_number, ca_area.description), cat.category_name
HAVING COUNT(c.complaint_id) >= 2
ORDER BY incident_count_14_days DESC;
