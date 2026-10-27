-- ============================================================================
-- FIX_MASTER migration 017: the handling trail of a ticket
-- ----------------------------------------------------------------------------
-- Every ticket is received, reviewed (by an AI model or, when none is
-- available, by fixed rules), and dispatched (by the autopilot or by a
-- supervisor). Until now only the dispatch left a trace, and only when it
-- succeeded: a ticket nobody could take, or one waiting for a supervisor on a
-- block set to Suggest, said nothing to anyone.
--
-- One row per thing the system did to a ticket, in order, with who did it
-- (system / AI model / autopilot / supervisor), the model's name when one was
-- involved, and what came of it. Residents see these rows on their ticket;
-- supervisors see the same rows plus the retry history. No prompt or reply text
-- is stored here, only the outcome and a short explanation.
--
-- complaint_logs is untouched: it stays the status history that drives the
-- notification feed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ticket_handling_steps (
    step_id      BIGSERIAL PRIMARY KEY,
    complaint_id VARCHAR(36) NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
    stage        VARCHAR(16) NOT NULL,
    actor        VARCHAR(12) NOT NULL,
    outcome      VARCHAR(12) NOT NULL,
    title        VARCHAR(120) NOT NULL,
    detail       TEXT,
    provider     VARCHAR(20),
    model        VARCHAR(80),
    data         JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_handling_stage   CHECK (stage IN ('RECEIVED', 'AI_REVIEW', 'DISPATCH', 'FOLLOW_UP')),
    CONSTRAINT chk_handling_actor   CHECK (actor IN ('SYSTEM', 'AI', 'AUTOPILOT', 'SUPERVISOR')),
    -- DONE: finished; WAITING: needs something to happen first (a technician, a supervisor);
    -- SKIPPED: deliberately not done; FAILED: tried and could not.
    CONSTRAINT chk_handling_outcome CHECK (outcome IN ('DONE', 'WAITING', 'SKIPPED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_handling_steps_ticket ON ticket_handling_steps (complaint_id, step_id);

-- The retry sweeper looks for tickets still waiting for a technician.
CREATE INDEX IF NOT EXISTS idx_complaints_open_unassigned ON complaints (created_at) WHERE status = 'OPEN';
