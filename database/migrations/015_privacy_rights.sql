-- ============================================================================
-- FIX_MASTER migration 015: data-subject rights (India's DPDP Act 2023)
-- ----------------------------------------------------------------------------
-- A resident can download everything the hostel office holds about them and
-- ask for it to be erased. Erasure is carried out by an administrator once the
-- resident has no room and no open ticket; it removes the personal data and
-- keeps the operational history (tickets, ratings, the audit log) in a form
-- that no longer identifies anyone.
--
--   erasure_requested_at   when the resident asked (NULL = no pending request)
--   erased_at              when the personal data was removed (the account is
--                          kept as an anonymous, disabled row so the tickets
--                          and ratings that refer to it stay consistent)
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS erasure_requested_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS erased_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_users_erasure_pending ON users (erasure_requested_at)
    WHERE erasure_requested_at IS NOT NULL AND erased_at IS NULL;
