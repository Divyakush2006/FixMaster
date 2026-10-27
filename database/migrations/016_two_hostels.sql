-- ============================================================================
-- FIX_MASTER migration 016: two hostels
-- ----------------------------------------------------------------------------
-- The campus has a men's hostel and a ladies' hostel. Each has its own blocks,
-- its own supervisors and its own chief warden, and the two hostels reuse the
-- same block letters (both have an A-Block), so ladies' block ids start with L
-- (LA_BLOCK, LS_BLOCK ...; the men's L-Block stays L_BLOCK).
--
-- 1. hostel_blocks.block_kind: a block is RESIDENTIAL (floors and rooms), the
--    whole of one hostel (HOSTEL_WIDE: e.g. MH, the complete men's hostel, which
--    has only shared areas) or ACADEMIC (e.g. PRP, which belongs to no hostel
--    and has only shared areas).
-- 2. users.hostel_type: the hostel a supervisor or chief warden belongs to.
--    A chief warden runs every block of their hostel (and the academic blocks);
--    a supervisor runs the blocks assigned to them, or, with none assigned,
--    every residential block of their hostel. Accounts with no hostel keep the
--    campus-wide behaviour they had before this migration.
-- 3. A supervisor can only be given blocks of their own hostel; shared areas of
--    hostel-wide and academic blocks have no rooms.
-- ============================================================================

-- 1. Block kind and hostel.
ALTER TABLE hostel_blocks ADD COLUMN IF NOT EXISTS block_kind VARCHAR(12) NOT NULL DEFAULT 'RESIDENTIAL';
ALTER TABLE hostel_blocks DROP CONSTRAINT IF EXISTS chk_hostel_blocks_kind;
ALTER TABLE hostel_blocks ADD CONSTRAINT chk_hostel_blocks_kind CHECK (block_kind IN ('RESIDENTIAL', 'HOSTEL_WIDE', 'ACADEMIC'));
ALTER TABLE hostel_blocks ALTER COLUMN hostel_type DROP NOT NULL;

-- The two blocks every installation started with.
UPDATE hostel_blocks SET block_kind = 'ACADEMIC', hostel_type = NULL, block_name = 'PRP (academic block)' WHERE block_id = 'PRP_BLOCK';
UPDATE hostel_blocks SET block_kind = 'HOSTEL_WIDE', hostel_type = 'MENS', block_name = 'MH (complete men''s hostel)' WHERE block_id = 'MH_BLOCK';
UPDATE hostel_blocks SET block_name = 'L-Block' WHERE block_id = 'L_BLOCK' AND block_name = 'L-Block (Ladies/Mens Hostel)';

ALTER TABLE hostel_blocks DROP CONSTRAINT IF EXISTS chk_hostel_blocks_kind_hostel;
ALTER TABLE hostel_blocks ADD CONSTRAINT chk_hostel_blocks_kind_hostel CHECK (
    (block_kind = 'ACADEMIC' AND hostel_type IS NULL) OR (block_kind <> 'ACADEMIC' AND hostel_type IS NOT NULL)
);
-- One "whole hostel" block per hostel.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hostel_blocks_one_hostel_wide ON hostel_blocks (hostel_type) WHERE block_kind = 'HOSTEL_WIDE';
CREATE INDEX IF NOT EXISTS idx_hostel_blocks_hostel ON hostel_blocks (hostel_type);

-- Rooms (and the beds in them) only exist in residential blocks.
CREATE OR REPLACE FUNCTION fn_rooms_residential_only() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM hostel_blocks WHERE block_id = NEW.block_id AND block_kind <> 'RESIDENTIAL') THEN
        RAISE EXCEPTION 'Rooms can only be added to residential blocks; % has shared areas only.', NEW.block_id USING ERRCODE = 'FM400';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rooms_residential_only ON rooms;
CREATE TRIGGER trg_rooms_residential_only
    BEFORE INSERT ON rooms
    FOR EACH ROW EXECUTE FUNCTION fn_rooms_residential_only();

-- 2. The hostel of a supervisor or chief warden.
ALTER TABLE users ADD COLUMN IF NOT EXISTS hostel_type VARCHAR(10);
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_hostel_type;
ALTER TABLE users ADD CONSTRAINT chk_users_hostel_type CHECK (hostel_type IS NULL OR hostel_type IN ('MENS', 'LADIES'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_hostel_role;
ALTER TABLE users ADD CONSTRAINT chk_users_hostel_role CHECK (hostel_type IS NULL OR role IN ('SUPERVISOR', 'CHIEF_WARDEN'));
-- Each hostel has one chief warden.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_one_chief_warden_per_hostel
    ON users (hostel_type) WHERE role = 'CHIEF_WARDEN' AND hostel_type IS NOT NULL AND is_active;

-- 3. A supervisor is given blocks of their own hostel (academic blocks are shared by both).
CREATE OR REPLACE FUNCTION fn_supervisor_blocks_role_check() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_role TEXT;
    v_hostel TEXT;
    v_block_hostel TEXT;
BEGIN
    SELECT role, hostel_type INTO v_role, v_hostel FROM users WHERE user_id = NEW.supervisor_user_id;
    IF v_role IS DISTINCT FROM 'SUPERVISOR' THEN
        RAISE EXCEPTION 'Only supervisors can be assigned to blocks.' USING ERRCODE = 'FM400';
    END IF;
    IF v_hostel IS NOT NULL THEN
        SELECT hostel_type INTO v_block_hostel FROM hostel_blocks WHERE block_id = NEW.block_id;
        IF v_block_hostel IS NOT NULL AND v_block_hostel <> v_hostel THEN
            RAISE EXCEPTION 'Block % belongs to the other hostel.', NEW.block_id USING ERRCODE = 'FM400';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 4. The campus layout. Migration 004 created blocks A to T for the men's hostel;
-- S belongs to the ladies' hostel, whose blocks are A, B, C, D, E, F, G, H, J and S
-- (ids LA_BLOCK ... LS_BLOCK).
--
-- S_BLOCK was never built in most installations: when nothing refers to it, it is
-- removed (the ladies' S is LS_BLOCK). If rooms, areas, tickets or staff do refer
-- to it, it is kept and simply becomes a ladies' block, and no LS_BLOCK is added.
DELETE FROM hostel_blocks b
WHERE b.block_id = 'S_BLOCK'
  AND NOT EXISTS (SELECT 1 FROM rooms r WHERE r.block_id = b.block_id)
  AND NOT EXISTS (SELECT 1 FROM common_areas a WHERE a.block_id = b.block_id)
  AND NOT EXISTS (SELECT 1 FROM complaints c WHERE c.block_id = b.block_id)
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.home_block_id = b.block_id);
UPDATE hostel_blocks SET hostel_type = 'LADIES' WHERE block_id = 'S_BLOCK';

INSERT INTO hostel_blocks (block_id, block_name, total_floors, hostel_type, block_kind)
SELECT 'L' || letter || '_BLOCK', letter || '-Block (Ladies)', 10, 'LADIES', 'RESIDENTIAL'
FROM unnest(ARRAY['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'S']) AS letter
WHERE NOT (letter = 'S' AND EXISTS (SELECT 1 FROM hostel_blocks WHERE block_id = 'S_BLOCK'))
ON CONFLICT (block_id) DO NOTHING;
