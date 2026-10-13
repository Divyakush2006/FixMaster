-- ============================================================================
-- FIX_MASTER migration 011: procedures, triggers and views for block scoping
-- (009) and SLA tracking (010)
-- ----------------------------------------------------------------------------
-- Lock order and error contract are unchanged (see migration 008). New HINT:
--   OUT_OF_SCOPE  the supervisor does not look after this ticket's block
-- ============================================================================

-- 1. FUNCTIONS -----------------------------------------------------------------

-- TRUE when p_user may manage tickets in p_block: administrators everywhere,
-- supervisors in the blocks assigned to them.
CREATE OR REPLACE FUNCTION fn_user_manages_block(p_user_id VARCHAR(36), p_block_id VARCHAR(10))
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
    SELECT EXISTS (SELECT 1 FROM users WHERE user_id = p_user_id AND role = 'ADMIN' AND is_active)
        OR EXISTS (
            SELECT 1 FROM supervisor_blocks sb
            JOIN users u ON u.user_id = sb.supervisor_id
            WHERE sb.supervisor_id = p_user_id AND sb.block_id = p_block_id
              AND u.role = 'SUPERVISOR' AND u.is_active
        );
$$;

-- Where a ticket stands against its deadline:
--   ON_TRACK / AT_RISK (last quarter of the window) / OVERDUE  while unresolved
--   MET / BREACHED                                             once work is done
--   NOT_APPLICABLE                                             withdrawn, rejected, or no deadline
CREATE OR REPLACE FUNCTION fn_sla_status(
    p_status VARCHAR(25),
    p_created_at TIMESTAMP WITH TIME ZONE,
    p_due_at TIMESTAMP WITH TIME ZONE,
    p_resolved_at TIMESTAMP WITH TIME ZONE,
    p_closed_at TIMESTAMP WITH TIME ZONE
)
RETURNS VARCHAR(20)
LANGUAGE sql STABLE
AS $$
    SELECT CASE
        WHEN p_due_at IS NULL OR p_status IN ('CANCELLED', 'REJECTED') THEN 'NOT_APPLICABLE'
        WHEN p_status IN ('PENDING_VERIFICATION', 'COMPLETED') THEN
            CASE
                WHEN COALESCE(p_resolved_at, p_closed_at) IS NULL THEN 'NOT_APPLICABLE'
                WHEN COALESCE(p_resolved_at, p_closed_at) <= p_due_at THEN 'MET'
                ELSE 'BREACHED'
            END
        WHEN CURRENT_TIMESTAMP > p_due_at THEN 'OVERDUE'
        WHEN p_due_at - CURRENT_TIMESTAMP <= (p_due_at - COALESCE(p_created_at, p_due_at)) * 0.25 THEN 'AT_RISK'
        ELSE 'ON_TRACK'
    END;
$$;

-- 2. TRIGGERS ------------------------------------------------------------------

-- Every new ticket is due category-SLA hours after it was raised, however the
-- row is written (API, seed data or manual SQL).
CREATE OR REPLACE FUNCTION fn_set_sla_due()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.sla_due_at IS NULL THEN
        SELECT COALESCE(NEW.created_at, CURRENT_TIMESTAMP) + make_interval(hours => cat.default_sla_hours)
        INTO NEW.sla_due_at
        FROM complaint_subcategories sub
        JOIN complaint_categories cat ON cat.category_id = sub.category_id
        WHERE sub.subcategory_id = NEW.subcategory_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_sla_due ON complaints;
CREATE TRIGGER trg_set_sla_due
BEFORE INSERT ON complaints
FOR EACH ROW
EXECUTE FUNCTION fn_set_sla_due();

-- Only supervisor accounts can be given blocks.
CREATE OR REPLACE FUNCTION fn_check_supervisor_block_role()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = NEW.supervisor_id AND role = 'SUPERVISOR') THEN
        RAISE EXCEPTION 'Blocks can only be assigned to supervisor accounts.' USING ERRCODE = 'FM400';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_supervisor_block_role ON supervisor_blocks;
CREATE TRIGGER trg_check_supervisor_block_role
BEFORE INSERT OR UPDATE ON supervisor_blocks
FOR EACH ROW
EXECUTE FUNCTION fn_check_supervisor_block_role();

-- 3. STORED PROCEDURES ---------------------------------------------------------

-- Procedure 1: auto-dispatch a cleaning ticket.
-- Change: prefer on-duty cleaners whose home block is the ticket's block, so
-- staff work where they are based; anyone else on duty is the fallback.
-- Within each group the least-loaded cleaner wins, as before.
CREATE OR REPLACE PROCEDURE sp_auto_dispatch_cleaning(
    p_complaint_id VARCHAR(36),
    INOUT p_assigned_staff_id VARCHAR(36) DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR(25);
    v_specialization VARCHAR(30);
    v_block VARCHAR(10);
BEGIN
    SELECT c.status, sub.required_specialization, c.block_id INTO v_status, v_specialization, v_block
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
    GROUP BY u.user_id, u.home_block_id
    ORDER BY (u.home_block_id IS NOT DISTINCT FROM v_block) DESC,
             COUNT(ca.assignment_id) ASC, MIN(u.created_at) ASC, u.user_id ASC
    LIMIT 1;

    IF p_assigned_staff_id IS NOT NULL THEN
        INSERT INTO complaint_assignments (complaint_id, staff_user_id, current_state)
        VALUES (p_complaint_id, p_assigned_staff_id, 'ASSIGNED');

        UPDATE complaints SET status = 'ASSIGNED' WHERE complaint_id = p_complaint_id;
    END IF;
END;
$$;

-- Procedure 3: supervisor dispatch / reassignment.
-- Change: a supervisor may only dispatch tickets in blocks they look after
-- (administrators anywhere). Checked here as well as in the API, so the rule
-- holds for every caller. Everything else is as in migration 008.
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
    v_block VARCHAR(10);
    v_role VARCHAR(20);
    v_specialization VARCHAR(30);
    v_active BOOLEAN;
    v_available BOOLEAN;
    v_new_name VARCHAR(100);
    v_previous_staff_id VARCHAR(36);
    v_previous_name VARCHAR(100);
    v_previous_by VARCHAR(100);
BEGIN
    SELECT c.status, sub.required_specialization, c.block_id INTO v_status, v_required, v_block
    FROM complaints c
    JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
    WHERE c.complaint_id = p_complaint_id
    FOR UPDATE OF c;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complaint not found.' USING ERRCODE = 'FM404';
    END IF;

    IF p_supervisor_user_id IS NOT NULL AND NOT fn_user_manages_block(p_supervisor_user_id, v_block) THEN
        RAISE EXCEPTION 'This ticket is in a block you do not look after.' USING ERRCODE = 'FM403', HINT = 'OUT_OF_SCOPE';
    END IF;

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

-- 4. VIEWS ---------------------------------------------------------------------
-- The block summary keeps its columns and gains SLA figures at the end:
--   overdue_count / at_risk_count  unresolved tickets past / near their deadline
--   sla_met_count / sla_breached_count, sla_compliance_pct  finished work

CREATE OR REPLACE VIEW view_block_supervisor_summary AS
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
    ROUND(COALESCE(AVG(fb.accepted_rating), 0), 2) AS average_student_rating,
    COUNT(CASE WHEN c.sla_status = 'OVERDUE' THEN 1 END) AS overdue_count,
    COUNT(CASE WHEN c.sla_status = 'AT_RISK' THEN 1 END) AS at_risk_count,
    COUNT(CASE WHEN c.sla_status = 'MET' THEN 1 END) AS sla_met_count,
    COUNT(CASE WHEN c.sla_status = 'BREACHED' THEN 1 END) AS sla_breached_count,
    ROUND(
        100.0 * COUNT(CASE WHEN c.sla_status = 'MET' THEN 1 END)
        / NULLIF(COUNT(CASE WHEN c.sla_status IN ('MET', 'BREACHED') THEN 1 END), 0),
        1
    ) AS sla_compliance_pct
FROM hostel_blocks b
LEFT JOIN (
    SELECT cx.*, fn_sla_status(cx.status, cx.created_at, cx.sla_due_at, cx.resolved_at, cx.closed_at) AS sla_status
    FROM complaints cx
    WHERE cx.status <> 'CANCELLED'
      AND cx.closure_reason IS DISTINCT FROM 'DUPLICATE'
) c ON b.block_id = c.block_id
LEFT JOIN (
    SELECT complaint_id, MAX(rating) AS accepted_rating
    FROM complaint_feedback
    WHERE is_satisfactorily_resolved = TRUE AND rating IS NOT NULL
    GROUP BY complaint_id
) fb ON c.complaint_id = fb.complaint_id
GROUP BY b.block_id, b.block_name;

-- The technician's queue keeps its order (floor, then priority) and gains the
-- deadline, so technicians can see what is close to its SLA.
CREATE OR REPLACE VIEW view_staff_active_queue AS
SELECT
    ca.assignment_id,
    ca.staff_user_id,
    u_staff.full_name AS staff_name,
    u_staff.specialization,
    c.complaint_id,
    c.ticket_scope,
    COALESCE(r.room_number, ca_area.description) AS location_identifier,
    COALESCE(r.floor_number, ca_area.floor_number) AS floor_number,
    c.priority,
    cat.category_name,
    sub.issue_name,
    c.status,
    ca.current_state AS assignment_state,
    ca.assigned_at,
    u_student.full_name AS student_name,
    u_student.phone_number AS student_phone,
    c.sla_due_at,
    fn_sla_status(c.status, c.created_at, c.sla_due_at, c.resolved_at, c.closed_at) AS sla_status
FROM complaint_assignments ca
JOIN complaints c ON ca.complaint_id = c.complaint_id
JOIN users u_staff ON ca.staff_user_id = u_staff.user_id
JOIN users u_student ON c.raised_by_user_id = u_student.user_id
JOIN complaint_subcategories sub ON c.subcategory_id = sub.subcategory_id
JOIN complaint_categories cat ON sub.category_id = cat.category_id
LEFT JOIN rooms r ON c.room_id = r.room_id
LEFT JOIN common_areas ca_area ON c.common_area_id = ca_area.area_id
WHERE c.status IN ('ASSIGNED', 'IN_PROGRESS')
  AND ca.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')
ORDER BY
    COALESCE(r.floor_number, ca_area.floor_number) ASC,
    CASE c.priority
        WHEN 'EMERGENCY' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'MEDIUM' THEN 3
        WHEN 'LOW' THEN 4
    END ASC,
    ca.assigned_at ASC;
