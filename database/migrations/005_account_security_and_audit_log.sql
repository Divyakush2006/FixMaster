-- ============================================================================
-- FIX_MASTER migration 005: account lockout + administrative audit log
-- ----------------------------------------------------------------------------
-- Idempotent (IF NOT EXISTS everywhere). Do not edit after it has been applied;
-- add a new migration instead.
-- ============================================================================

-- ---- Per-account sign-in lockout ---------------------------------------------
-- IP-based rate limits alone are not enough: a hostel campus sits behind a
-- few NAT addresses (so a per-IP limit locks out everyone at once), while a
-- distributed attacker rotates addresses (so a per-IP limit never trips).
-- The account itself therefore counts consecutive failures and is locked for
-- a cooling-off period after too many, wherever they come from.
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_failed_login_count') THEN
        ALTER TABLE users ADD CONSTRAINT chk_users_failed_login_count CHECK (failed_login_count >= 0);
    END IF;
END $$;

-- ---- Server-side sign-out -------------------------------------------------------
-- Session tokens are stateless JWTs, so deleting one in the browser does not
-- stop a copy of it from working until it expires. Every token carries a
-- unique id (jti); signing out records it here and the API refuses it from
-- then on. Rows are only needed until the token would have expired anyway.
CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expiry ON revoked_tokens (expires_at);

-- ---- Administrative audit log -------------------------------------------------
-- Who did what to which record, and when. Complaint status history already
-- lives in complaint_logs; this table covers everything else that changes
-- access or capacity: accounts, passwords, allotments, blocks, floors, rooms,
-- administrator sign-ins and account lockouts.
-- Rows are append-only: the API never updates or deletes them.
CREATE TABLE IF NOT EXISTS audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE SET NULL,
    action VARCHAR(60) NOT NULL,
    target_type VARCHAR(30),
    target_id VARCHAR(60),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(64),
    request_id VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log (occurred_at DESC, audit_id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_type, target_id);
