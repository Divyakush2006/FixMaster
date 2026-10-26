-- ============================================================================
-- FIX_MASTER migration 011: campus organisation
-- ----------------------------------------------------------------------------
-- 1. CHIEF_WARDEN role: campus-wide oversight (every block), the same
--    operational powers as a supervisor, none of the administrator's account
--    and infrastructure powers.
-- 2. supervisor_blocks: which blocks a supervisor manages. A supervisor with
--    no rows here is campus-wide (how every supervisor worked before this
--    migration); assigning blocks narrows what they see and can act on.
-- 3. Staff home block and shift, and leave days, which the dispatch
--    autopilot uses to decide who may take a job.
-- 4. hostel_blocks.hostel_type: men's or ladies' hostel.
-- ============================================================================

-- 1. Role list (declared inline originally, so its name varies by database).
DO $$
DECLARE
    v_name TEXT;
BEGIN
    FOR v_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%SUPERVISOR%'
          AND pg_get_constraintdef(oid) LIKE '%ADMIN%'
          AND pg_get_constraintdef(oid) NOT LIKE '%account_status%'
    LOOP
        EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', v_name);
    END LOOP;
END;
$$;

ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('STUDENT', 'STAFF', 'SUPERVISOR', 'CHIEF_WARDEN', 'ADMIN'));

-- 2. Supervisor to block.
CREATE TABLE IF NOT EXISTS supervisor_blocks (
    supervisor_user_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    block_id VARCHAR(10) NOT NULL REFERENCES hostel_blocks(block_id) ON DELETE CASCADE,
    assigned_by_user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE SET NULL,
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (supervisor_user_id, block_id)
);
CREATE INDEX IF NOT EXISTS idx_supervisor_blocks_block ON supervisor_blocks (block_id);

-- Only supervisors manage blocks. A trigger, because a CHECK cannot look at
-- another table.
CREATE OR REPLACE FUNCTION fn_supervisor_blocks_role_check() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = NEW.supervisor_user_id AND role = 'SUPERVISOR') THEN
        RAISE EXCEPTION 'Only supervisors can be assigned to blocks.' USING ERRCODE = 'FM400';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supervisor_blocks_role_check ON supervisor_blocks;
CREATE TRIGGER trg_supervisor_blocks_role_check
    BEFORE INSERT OR UPDATE ON supervisor_blocks
    FOR EACH ROW EXECUTE FUNCTION fn_supervisor_blocks_role_check();

-- 3. Staff home block, shift and leave.
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_block_id VARCHAR(10) REFERENCES hostel_blocks(block_id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS shift VARCHAR(10);
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_shift;
ALTER TABLE users ADD CONSTRAINT chk_users_shift CHECK (shift IS NULL OR shift IN ('MORNING', 'EVENING', 'NIGHT'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_staff_placement;
ALTER TABLE users ADD CONSTRAINT chk_users_staff_placement
    CHECK ((home_block_id IS NULL AND shift IS NULL) OR role = 'STAFF');
CREATE INDEX IF NOT EXISTS idx_users_staff_home_block ON users (home_block_id, specialization) WHERE role = 'STAFF';

CREATE TABLE IF NOT EXISTS staff_leave (
    leave_id SERIAL PRIMARY KEY,
    staff_user_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    reason VARCHAR(200),
    created_by_user_id VARCHAR(36) REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_staff_leave_dates CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS idx_staff_leave_staff ON staff_leave (staff_user_id, starts_on, ends_on);

-- 4. Men's or ladies' hostel.
ALTER TABLE hostel_blocks ADD COLUMN IF NOT EXISTS hostel_type VARCHAR(10) NOT NULL DEFAULT 'MENS';
ALTER TABLE hostel_blocks DROP CONSTRAINT IF EXISTS chk_hostel_blocks_type;
ALTER TABLE hostel_blocks ADD CONSTRAINT chk_hostel_blocks_type CHECK (hostel_type IN ('MENS', 'LADIES'));
