-- ============================================================================
-- FIX_MASTER migration 013: who is told what, and when
-- ----------------------------------------------------------------------------
-- Notifications are written by triggers, in the transaction that made the
-- change. The person who made the change (app.current_user_id, set by the
-- API for every transaction) is never notified about their own action.
--
--   event                        notified
--   ---------------------------  ----------------------------------------------
--   technician assigned          the technician; the ticket's followers
--   work started                 followers
--   work marked done             whoever can confirm it (room: current
--                                residents; common area: its reporters)
--   fix rejected (ESCALATED)     the block's supervisors; the technician
--   closed / auto-closed         followers; the technician (when confirmed)
--   rejected or merged           followers
--   job withdrawn / reassigned   the technician who lost it
--   new HIGH/EMERGENCY ticket    the block's supervisors
--   past its SLA deadline        the block's supervisors; the technician
--                                (sp_notify_overdue_tickets, run by the sweep)
--
-- Followers of a ticket = everyone who reported it, plus (room tickets) the
-- room's current residents, who share the ticket.
-- ============================================================================

-- 1. HELPERS -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_current_actor()
RETURNS VARCHAR(36)
LANGUAGE sql STABLE
AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::varchar(36);
$$;

CREATE OR REPLACE FUNCTION fn_notify(
    p_user_id VARCHAR(36),
    p_kind VARCHAR(40),
    p_title TEXT,
    p_body TEXT,
    p_complaint_id VARCHAR(36)
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_user_id IS NULL OR p_user_id IS NOT DISTINCT FROM fn_current_actor() THEN
        RETURN;
    END IF;
    INSERT INTO notifications (user_id, kind, title, body, complaint_id)
    VALUES (p_user_id, p_kind, LEFT(p_title, 160), p_body, p_complaint_id);
END;
$$;

-- "Tube light / bulb failure · L-843", used as the body of most messages.
CREATE OR REPLACE FUNCTION fn_ticket_label(p_complaint_id VARCHAR(36))
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
    SELECT sub.issue_name || ' · ' || COALESCE(c.room_id, ca.description, c.common_area_id, c.block_id)
    FROM complaints c
    JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
    LEFT JOIN common_areas ca ON ca.area_id = c.common_area_id
    WHERE c.complaint_id = p_complaint_id;
$$;

CREATE OR REPLACE FUNCTION fn_ticket_followers(p_complaint_id VARCHAR(36))
RETURNS TABLE (user_id VARCHAR(36))
LANGUAGE sql STABLE
AS $$
    SELECT cr.user_id FROM complaint_reporters cr WHERE cr.complaint_id = p_complaint_id
    UNION
    SELECT a.student_id
    FROM complaints c
    JOIN student_room_allotments a ON a.room_id = c.room_id AND a.is_current = TRUE
    WHERE c.complaint_id = p_complaint_id AND c.ticket_scope = 'ROOM';
$$;

-- Who may confirm finished work (same rule as sp_confirm_resolution).
CREATE OR REPLACE FUNCTION fn_ticket_verifiers(p_complaint_id VARCHAR(36))
RETURNS TABLE (user_id VARCHAR(36))
LANGUAGE sql STABLE
AS $$
    SELECT a.student_id
    FROM complaints c
    JOIN student_room_allotments a ON a.room_id = c.room_id AND a.is_current = TRUE
    WHERE c.complaint_id = p_complaint_id AND c.ticket_scope = 'ROOM'
    UNION
    SELECT cr.user_id
    FROM complaints c
    JOIN complaint_reporters cr ON cr.complaint_id = c.complaint_id
    WHERE c.complaint_id = p_complaint_id AND c.ticket_scope = 'COMMON_AREA';
$$;

CREATE OR REPLACE FUNCTION fn_block_supervisors(p_block_id VARCHAR(10))
RETURNS TABLE (user_id VARCHAR(36))
LANGUAGE sql STABLE
AS $$
    SELECT sb.supervisor_id
    FROM supervisor_blocks sb
    JOIN users u ON u.user_id = sb.supervisor_id
    WHERE sb.block_id = p_block_id AND u.is_active = TRUE;
$$;

-- The technician who most recently finished (or is doing) the work.
CREATE OR REPLACE FUNCTION fn_ticket_last_technician(p_complaint_id VARCHAR(36))
RETURNS VARCHAR(36)
LANGUAGE sql STABLE
AS $$
    SELECT staff_user_id FROM complaint_assignments
    WHERE complaint_id = p_complaint_id AND current_state IN ('DONE', 'IN_PROGRESS', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE')
    ORDER BY assigned_at DESC, assignment_id DESC
    LIMIT 1;
$$;

-- 2. TRIGGERS ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_notify_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_label TEXT := fn_ticket_label(NEW.complaint_id);
    v_user VARCHAR(36);
    v_tech VARCHAR(36);
BEGIN
    IF NEW.status = 'IN_PROGRESS' THEN
        FOR v_user IN SELECT user_id FROM fn_ticket_followers(NEW.complaint_id) LOOP
            PERFORM fn_notify(v_user, 'ticket.started', 'Work has started', v_label, NEW.complaint_id);
        END LOOP;

    ELSIF NEW.status = 'PENDING_VERIFICATION' THEN
        FOR v_user IN SELECT user_id FROM fn_ticket_verifiers(NEW.complaint_id) LOOP
            PERFORM fn_notify(v_user, 'ticket.done', 'Work done: please confirm the fix',
                v_label || '. Confirm it is fixed, or tell us if it is not.', NEW.complaint_id);
        END LOOP;

    ELSIF NEW.status = 'ESCALATED' THEN
        FOR v_user IN SELECT user_id FROM fn_block_supervisors(NEW.block_id) LOOP
            PERFORM fn_notify(v_user, 'ticket.escalated', 'A resident says the fix did not work', v_label, NEW.complaint_id);
        END LOOP;
        v_tech := fn_ticket_last_technician(NEW.complaint_id);
        PERFORM fn_notify(v_tech, 'job.rejected', 'Your fix was not accepted', v_label, NEW.complaint_id);

    ELSIF NEW.status = 'COMPLETED' THEN
        FOR v_user IN SELECT user_id FROM fn_ticket_followers(NEW.complaint_id) LOOP
            PERFORM fn_notify(v_user, 'ticket.closed',
                CASE WHEN NEW.closure_reason = 'AUTO_CONFIRMED' THEN 'Ticket closed automatically' ELSE 'Ticket closed' END,
                v_label, NEW.complaint_id);
        END LOOP;
        IF NEW.closure_reason = 'CONFIRMED' THEN
            v_tech := fn_ticket_last_technician(NEW.complaint_id);
            PERFORM fn_notify(v_tech, 'job.confirmed', 'A resident confirmed your work', v_label, NEW.complaint_id);
        END IF;

    ELSIF NEW.status = 'REJECTED' THEN
        FOR v_user IN SELECT user_id FROM fn_ticket_followers(NEW.complaint_id) LOOP
            IF NEW.closure_reason = 'DUPLICATE' THEN
                PERFORM fn_notify(v_user, 'ticket.merged', 'Merged with an existing ticket',
                    v_label || ' is tracked on another ticket for the same issue.', NEW.complaint_id);
            ELSE
                PERFORM fn_notify(v_user, 'ticket.rejected', 'Closed without work',
                    v_label || COALESCE('. Reason: ' || NEW.closure_note, ''), NEW.complaint_id);
            END IF;
        END LOOP;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_status_change ON complaints;
CREATE TRIGGER trg_notify_status_change
AFTER UPDATE OF status ON complaints
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION fn_notify_status_change();

CREATE OR REPLACE FUNCTION fn_notify_new_urgent_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_user VARCHAR(36);
BEGIN
    IF NEW.priority IN ('HIGH', 'EMERGENCY') THEN
        FOR v_user IN SELECT user_id FROM fn_block_supervisors(NEW.block_id) LOOP
            PERFORM fn_notify(v_user, 'ticket.urgent',
                CASE WHEN NEW.priority = 'EMERGENCY' THEN 'New emergency ticket' ELSE 'New high-priority ticket' END,
                fn_ticket_label(NEW.complaint_id), NEW.complaint_id);
        END LOOP;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_urgent_ticket ON complaints;
CREATE TRIGGER trg_notify_new_urgent_ticket
AFTER INSERT ON complaints
FOR EACH ROW
EXECUTE FUNCTION fn_notify_new_urgent_ticket();

CREATE OR REPLACE FUNCTION fn_notify_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_label TEXT := fn_ticket_label(NEW.complaint_id);
    v_name VARCHAR(100);
    v_priority VARCHAR(10);
    v_user VARCHAR(36);
BEGIN
    IF NEW.current_state <> 'ASSIGNED' THEN
        RETURN NULL;
    END IF;
    SELECT priority INTO v_priority FROM complaints WHERE complaint_id = NEW.complaint_id;
    SELECT full_name INTO v_name FROM users WHERE user_id = NEW.staff_user_id;

    PERFORM fn_notify(NEW.staff_user_id, 'job.assigned',
        CASE WHEN v_priority = 'EMERGENCY' THEN 'New emergency job' ELSE 'New job assigned to you' END,
        v_label, NEW.complaint_id);
    FOR v_user IN SELECT user_id FROM fn_ticket_followers(NEW.complaint_id) LOOP
        PERFORM fn_notify(v_user, 'ticket.assigned', COALESCE(v_name, 'A technician') || ' will handle your request', v_label, NEW.complaint_id);
    END LOOP;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_assignment ON complaint_assignments;
CREATE TRIGGER trg_notify_assignment
AFTER INSERT ON complaint_assignments
FOR EACH ROW
EXECUTE FUNCTION fn_notify_assignment();

CREATE OR REPLACE FUNCTION fn_notify_assignment_withdrawn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM fn_notify(NEW.staff_user_id, 'job.withdrawn', 'A job was taken off your list',
        fn_ticket_label(NEW.complaint_id) || ' was reassigned or closed.', NEW.complaint_id);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_assignment_withdrawn ON complaint_assignments;
CREATE TRIGGER trg_notify_assignment_withdrawn
AFTER UPDATE OF current_state ON complaint_assignments
FOR EACH ROW
WHEN (NEW.current_state = 'DECLINED' AND OLD.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS'))
EXECUTE FUNCTION fn_notify_assignment_withdrawn();

-- 3. STORED PROCEDURES ---------------------------------------------------------

-- Warns once about each unresolved ticket that has passed its deadline.
-- SKIP LOCKED leaves alone a ticket someone is changing right now; the next
-- run picks it up. Safe to run from several instances.
CREATE OR REPLACE PROCEDURE sp_notify_overdue_tickets(INOUT p_notified INT DEFAULT 0)
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    v_user VARCHAR(36);
    v_label TEXT;
BEGIN
    p_notified := 0;
    FOR r IN
        SELECT complaint_id, block_id FROM complaints
        WHERE status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED')
          AND sla_due_at < CURRENT_TIMESTAMP
          AND sla_overdue_notified_at IS NULL
        ORDER BY complaint_id
        FOR UPDATE SKIP LOCKED
    LOOP
        v_label := fn_ticket_label(r.complaint_id);
        FOR v_user IN SELECT user_id FROM fn_block_supervisors(r.block_id) LOOP
            PERFORM fn_notify(v_user, 'ticket.overdue', 'Ticket past its deadline', v_label, r.complaint_id);
        END LOOP;
        FOR v_user IN
            SELECT staff_user_id FROM complaint_assignments
            WHERE complaint_id = r.complaint_id AND current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')
        LOOP
            PERFORM fn_notify(v_user, 'job.overdue', 'Job past its deadline', v_label, r.complaint_id);
        END LOOP;
        UPDATE complaints SET sla_overdue_notified_at = CURRENT_TIMESTAMP WHERE complaint_id = r.complaint_id;
        p_notified := p_notified + 1;
    END LOOP;
END;
$$;
