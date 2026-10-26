-- ============================================================================
-- FIX_MASTER migration 013: staff autopilot
-- ----------------------------------------------------------------------------
-- 1. autopilot_settings: per block and trade, whether the autopilot is OFF,
--    only SUGGESTS a technician, or assigns AUTOmatically; the live-job cap;
--    and optional score weights. A row with block_id NULL is the campus
--    default for that trade. With no row at all the mode is SUGGEST.
-- 2. complaint_assignments.dispatch_source and score_breakdown: how each
--    assignment was made (by hand, by accepting the autopilot's suggestion,
--    or by the autopilot itself) and, for the last two, the full score that
--    chose the technician - so every automatic decision can be explained.
-- 3. feedback_tags: themes found in residents' comments (late, rude,
--    incomplete, excellent...) and their tone, by a model or keyword rules.
-- 4. view_staff_feedback: each verification round attributed to the
--    technician whose finished work it judged. Performance, room history and
--    the "not again for this room" rule all read it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS autopilot_settings (
    setting_id SERIAL PRIMARY KEY,
    block_id VARCHAR(10) REFERENCES hostel_blocks(block_id) ON DELETE CASCADE,
    specialization VARCHAR(30) NOT NULL CHECK (specialization IN ('CLEANING', 'ELECTRICIAN', 'CARPENTER', 'AC_TECH', 'PLUMBER')),
    mode VARCHAR(10) NOT NULL DEFAULT 'SUGGEST' CHECK (mode IN ('OFF', 'SUGGEST', 'AUTO')),
    live_job_cap INT NOT NULL DEFAULT 6 CHECK (live_job_cap BETWEEN 1 AND 50),
    weights JSONB,
    updated_by_user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_autopilot_settings_scope ON autopilot_settings (COALESCE(block_id, '*'), specialization);

ALTER TABLE complaint_assignments ADD COLUMN IF NOT EXISTS dispatch_source VARCHAR(12) NOT NULL DEFAULT 'MANUAL';
ALTER TABLE complaint_assignments DROP CONSTRAINT IF EXISTS chk_assignment_dispatch_source;
ALTER TABLE complaint_assignments ADD CONSTRAINT chk_assignment_dispatch_source
    CHECK (dispatch_source IN ('MANUAL', 'SUGGESTION', 'AUTOPILOT'));
ALTER TABLE complaint_assignments ADD COLUMN IF NOT EXISTS score_breakdown JSONB;
CREATE INDEX IF NOT EXISTS idx_assignments_staff_assigned ON complaint_assignments (staff_user_id, assigned_at DESC);

CREATE TABLE IF NOT EXISTS feedback_tags (
    feedback_id INT PRIMARY KEY REFERENCES complaint_feedback(feedback_id) ON DELETE CASCADE,
    tags TEXT[] NOT NULL DEFAULT '{}',
    sentiment SMALLINT NOT NULL CHECK (sentiment BETWEEN -1 AND 1),
    source VARCHAR(10) NOT NULL CHECK (source IN ('AI', 'RULES')),
    tagged_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP VIEW IF EXISTS view_staff_feedback;
CREATE VIEW view_staff_feedback AS
SELECT
    f.feedback_id,
    f.complaint_id,
    a.staff_user_id,
    a.assignment_id,
    f.rating,
    f.is_satisfactorily_resolved AS satisfied,
    f.student_comments,
    f.verified_at,
    c.room_id,
    c.common_area_id,
    c.block_id,
    sub.required_specialization AS specialization
FROM complaint_feedback f
JOIN complaints c ON c.complaint_id = f.complaint_id
JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
JOIN LATERAL (
    -- The work this round judged: the latest finished assignment before it.
    SELECT x.staff_user_id, x.assignment_id
    FROM complaint_assignments x
    WHERE x.complaint_id = f.complaint_id
      AND x.work_completed_at IS NOT NULL
      AND x.work_completed_at <= f.verified_at
    ORDER BY x.work_completed_at DESC, x.assignment_id DESC
    LIMIT 1
) a ON TRUE;
