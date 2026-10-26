-- ============================================================================
-- FIX_MASTER migration 012: AI platform
-- ----------------------------------------------------------------------------
-- 1. ai_calls: one row per attempt to call a model provider - which task,
--    provider, model and prompt version, how long it took, how many tokens,
--    and the outcome. No prompt or response text is stored, so no personal
--    data either. The same rows are the shared quota counters (calls per
--    provider per day, assistant uses per student per day), which is what
--    keeps several API servers within one free-tier allowance.
-- 2. app_settings: small runtime switches shared by every API server, e.g.
--    the "AI outage drill" that supervisors use to rehearse manual dispatch.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_calls (
    call_id BIGSERIAL PRIMARY KEY,
    -- One assistant use, briefing or question may try several providers;
    -- its attempts share a run_id (per-student limits count runs).
    run_id UUID NOT NULL,
    task VARCHAR(40) NOT NULL,
    provider VARCHAR(20) NOT NULL,
    model VARCHAR(120) NOT NULL,
    prompt_version VARCHAR(20) NOT NULL,
    user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE SET NULL,
    outcome VARCHAR(20) NOT NULL CHECK (
        outcome IN ('OK', 'INVALID_OUTPUT', 'ERROR', 'TIMEOUT', 'RATE_LIMITED', 'QUOTA', 'SKIPPED')
    ),
    latency_ms INT CHECK (latency_ms IS NULL OR latency_ms >= 0),
    input_tokens INT CHECK (input_tokens IS NULL OR input_tokens >= 0),
    output_tokens INT CHECK (output_tokens IS NULL OR output_tokens >= 0),
    error_code VARCHAR(60),
    flagged_injection BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_calls_created ON ai_calls (created_at);
CREATE INDEX IF NOT EXISTS idx_ai_calls_provider_day ON ai_calls (provider, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_calls_user_day ON ai_calls (user_id, task, created_at) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(60) PRIMARY KEY,
    setting_value JSONB NOT NULL,
    updated_by_user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
