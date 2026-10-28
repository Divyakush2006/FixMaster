-- ============================================================================
-- FIX_MASTER migration 020: ticket photos stored in the database (optional)
-- ----------------------------------------------------------------------------
-- Used when PHOTO_STORAGE=database: hosts with no disk that survives a deploy
-- and no object store (the free Render plan with no storage account) keep each
-- ticket's photo here. The image has already been rebuilt without metadata.
-- With a disk or an S3 bucket configured this table stays empty.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ticket_photos (
    complaint_id VARCHAR(36) PRIMARY KEY REFERENCES complaints(complaint_id) ON DELETE CASCADE,
    content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
    data         BYTEA       NOT NULL,
    size_bytes   INTEGER     NOT NULL CHECK (size_bytes > 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
