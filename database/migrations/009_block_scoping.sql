-- ============================================================================
-- FIX_MASTER migration 009: block scoping for supervisors and technicians
-- ----------------------------------------------------------------------------
-- * A supervisor is responsible for one or more hostel blocks
--   (supervisor_blocks). They see and act on tickets in those blocks only;
--   a supervisor with no blocks sees none. Administrators remain campus-wide.
-- * A technician may have a home block. Auto-dispatch prefers on-duty
--   technicians whose home block is the ticket's block (see migration 011).
--
-- Upgrade path: every supervisor that exists when this migration runs is
-- given all current blocks, so an existing deployment keeps working exactly
-- as before; an administrator then narrows each supervisor's blocks.
-- ============================================================================

CREATE TABLE IF NOT EXISTS supervisor_blocks (
    supervisor_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    block_id VARCHAR(10) NOT NULL REFERENCES hostel_blocks(block_id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (supervisor_id, block_id)
);

-- "Which supervisors look after block X" (notifications, admin screens).
CREATE INDEX IF NOT EXISTS idx_supervisor_blocks_block ON supervisor_blocks (block_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS home_block_id VARCHAR(10)
    REFERENCES hostel_blocks(block_id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_home_block_staff_only') THEN
        ALTER TABLE users ADD CONSTRAINT chk_home_block_staff_only
            CHECK (home_block_id IS NULL OR role = 'STAFF');
    END IF;
END;
$$;

-- Keep existing supervisors' current (campus-wide) reach on upgrade.
INSERT INTO supervisor_blocks (supervisor_id, block_id)
SELECT u.user_id, b.block_id
FROM users u CROSS JOIN hostel_blocks b
WHERE u.role = 'SUPERVISOR'
ON CONFLICT DO NOTHING;
