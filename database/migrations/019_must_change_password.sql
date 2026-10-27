-- ============================================================================
-- FIX_MASTER migration 019: first-sign-in password change
-- ----------------------------------------------------------------------------
-- Accounts created for someone else (the provisioning script, or an administrator
-- who types an initial password) start with a password somebody other than the
-- owner knows. With this flag set the account may only change its password: the
-- API refuses everything else (403 PASSWORD_CHANGE_REQUIRED) until it has, and
-- the change clears the flag.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
