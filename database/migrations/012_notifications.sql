-- ============================================================================
-- FIX_MASTER migration 012: in-app notifications
-- ----------------------------------------------------------------------------
-- One row per message to one person. Rows are written by triggers in the
-- same transaction as the change they describe (migration 013), so a
-- notification exists exactly when the change committed - whichever path
-- made it (API, stored procedure, auto-dispatch or the background sweeper).
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
    notification_id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    -- What happened, e.g. 'job.assigned', 'ticket.done' (see migration 013).
    kind VARCHAR(40) NOT NULL,
    title VARCHAR(160) NOT NULL,
    body TEXT,
    complaint_id VARCHAR(36) REFERENCES complaints(complaint_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP WITH TIME ZONE
);

-- A person's feed, newest first, and the unread badge.
CREATE INDEX IF NOT EXISTS idx_notifications_user_time ON notifications (user_id, created_at DESC, notification_id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;

-- Set once a ticket's "past its deadline" alert has gone out, so the sweep
-- warns about each overdue ticket once.
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS sla_overdue_notified_at TIMESTAMP WITH TIME ZONE;
