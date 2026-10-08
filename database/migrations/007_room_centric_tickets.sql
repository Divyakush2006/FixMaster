-- ============================================================================
-- FIX_MASTER migration 007: the room (or common area) is the unit of a ticket
-- ----------------------------------------------------------------------------
-- Until now a ticket belonged to the person who raised it. Two roommates
-- asking for the same room cleaning produced two tickets, two dispatches and
-- two separate verifications, and twenty students reporting one broken water
-- cooler produced twenty tickets. From this migration on:
--
--   * there is at most ONE live ticket per location and issue type, enforced
--     by partial unique indexes (so it holds under concurrency, not just in
--     the API);
--   * everyone who reports that issue is recorded in complaint_reporters;
--   * a ticket can be withdrawn by its reporters (status CANCELLED) or closed
--     by a supervisor as invalid / a duplicate (status REJECTED), and every
--     closed ticket records why (closure_reason).
--
-- Existing databases may already hold live duplicates. They are merged into
-- one surviving ticket per location + issue before the unique indexes are
-- created; nothing is deleted.
-- ============================================================================

-- 1. Reporters ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS complaint_reporters (
    complaint_id VARCHAR(36) NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
    user_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    reported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- TRUE for the person who created the ticket; FALSE for people who later
    -- reported the same issue at the same location and were added to it.
    is_original BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (complaint_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reporters_user ON complaint_reporters (user_id, complaint_id);

INSERT INTO complaint_reporters (complaint_id, user_id, reported_at, is_original)
SELECT complaint_id, raised_by_user_id, COALESCE(created_at, CURRENT_TIMESTAMP), TRUE
FROM complaints
ON CONFLICT (complaint_id, user_id) DO NOTHING;

-- 2. Status CANCELLED and closure details --------------------------------------
-- The status CHECK was declared inline, so its name depends on how the
-- database was first created. Drop whichever CHECK constrains the status list.
DO $$
DECLARE
    v_name TEXT;
BEGIN
    FOR v_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'complaints'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%PENDING_VERIFICATION%'
    LOOP
        EXECUTE format('ALTER TABLE complaints DROP CONSTRAINT %I', v_name);
    END LOOP;
END;
$$;

ALTER TABLE complaints ADD CONSTRAINT complaints_status_check CHECK (
    status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'COMPLETED', 'ESCALATED', 'REJECTED', 'CANCELLED')
);

ALTER TABLE complaints ADD COLUMN IF NOT EXISTS closure_reason VARCHAR(20);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS closure_note VARCHAR(500);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS merged_into_id VARCHAR(36);

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS chk_complaint_closure_reason;
ALTER TABLE complaints ADD CONSTRAINT chk_complaint_closure_reason CHECK (
    closure_reason IS NULL OR closure_reason IN ('CONFIRMED', 'AUTO_CONFIRMED', 'WITHDRAWN', 'INVALID', 'DUPLICATE')
);
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS fk_complaint_merged_into;
ALTER TABLE complaints ADD CONSTRAINT fk_complaint_merged_into
    FOREIGN KEY (merged_into_id) REFERENCES complaints(complaint_id) ON DELETE SET NULL;
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS chk_complaint_merge;
ALTER TABLE complaints ADD CONSTRAINT chk_complaint_merge CHECK (
    merged_into_id IS NULL OR (closure_reason = 'DUPLICATE' AND merged_into_id <> complaint_id)
);

-- Every ticket closed before this migration was closed by its reporter.
UPDATE complaints SET closure_reason = 'CONFIRMED'
WHERE status = 'COMPLETED' AND closure_reason IS NULL;

-- 3. Merge live duplicates that already exist -----------------------------------
-- The survivor is the ticket furthest along (work in progress beats a fresh
-- request), then the oldest.
CREATE TEMP TABLE fm_duplicate_tickets ON COMMIT DROP AS
SELECT complaint_id, keeper_id
FROM (
    SELECT
        complaint_id,
        FIRST_VALUE(complaint_id) OVER (
            PARTITION BY ticket_scope, COALESCE(room_id, common_area_id), subcategory_id
            ORDER BY
                CASE status
                    WHEN 'IN_PROGRESS' THEN 1
                    WHEN 'PENDING_VERIFICATION' THEN 2
                    WHEN 'ASSIGNED' THEN 3
                    WHEN 'ESCALATED' THEN 4
                    ELSE 5
                END,
                created_at,
                complaint_id
        ) AS keeper_id
    FROM complaints
    WHERE status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'ESCALATED')
      AND COALESCE(room_id, common_area_id) IS NOT NULL
) ranked
WHERE complaint_id <> keeper_id;

INSERT INTO complaint_reporters (complaint_id, user_id, reported_at, is_original)
SELECT d.keeper_id, r.user_id, r.reported_at, FALSE
FROM fm_duplicate_tickets d
JOIN complaint_reporters r ON r.complaint_id = d.complaint_id
ON CONFLICT (complaint_id, user_id) DO NOTHING;

UPDATE complaint_assignments SET current_state = 'DECLINED'
WHERE complaint_id IN (SELECT complaint_id FROM fm_duplicate_tickets)
  AND current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS');

UPDATE complaints c
SET status = 'REJECTED',
    closure_reason = 'DUPLICATE',
    merged_into_id = d.keeper_id,
    closure_note = 'Merged during upgrade: another active ticket already covered this issue at this location.',
    closed_at = CURRENT_TIMESTAMP
FROM fm_duplicate_tickets d
WHERE c.complaint_id = d.complaint_id;

-- 4. One live ticket per location and issue -------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_room_issue
    ON complaints (room_id, subcategory_id)
    WHERE ticket_scope = 'ROOM'
      AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'ESCALATED');

CREATE UNIQUE INDEX IF NOT EXISTS uq_live_area_issue
    ON complaints (common_area_id, subcategory_id)
    WHERE ticket_scope = 'COMMON_AREA'
      AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'ESCALATED');

-- Auto-close sweep: find tickets waiting for verification quickly.
CREATE INDEX IF NOT EXISTS idx_complaints_pending_verification
    ON complaints (resolved_at)
    WHERE status = 'PENDING_VERIFICATION';
