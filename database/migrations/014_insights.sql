-- ============================================================================
-- FIX_MASTER migration 014: operations insights
-- ----------------------------------------------------------------------------
-- ai_briefings: the daily operations briefing a supervisor or chief warden
-- opens the console to. One row per scope (the campus, or a supervisor's set
-- of blocks) per day, so the page is instant and the model is called at most
-- once per scope per day unless someone asks for a refresh. `facts` is the
-- numbers the text was written from, kept next to it so the two can always be
-- compared; `source` says whether a model or the built-in rules wrote it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_briefings (
    briefing_id BIGSERIAL PRIMARY KEY,
    scope_key VARCHAR(300) NOT NULL,
    briefing_date DATE NOT NULL,
    narrative JSONB NOT NULL,
    facts JSONB NOT NULL,
    source VARCHAR(10) NOT NULL CHECK (source IN ('AI', 'RULES')),
    model VARCHAR(120),
    generated_by_user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE SET NULL,
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_briefing_scope_day UNIQUE (scope_key, briefing_date)
);
