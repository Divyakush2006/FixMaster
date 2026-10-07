-- ============================================================================
-- FIX_MASTER migration 004: floors as data, room numbering rules, blocks A-T
-- ----------------------------------------------------------------------------
-- 1. block_floors: every floor of every block is a row (floor 0 = Ground).
--    Previously a block only had a total_floors number, so there was no way
--    to add a floor, and nothing tied a room's floor to its block.
-- 2. Room numbering is enforced by the database:
--      room_number = <floor code><two-digit room 01-99>
--      floor code  = 'G' for the ground floor, otherwise the floor number
--      e.g. G01 = ground floor room 1, 428 = floor 4 room 28, 1007 = floor 10 room 7
--      room_id     = <block code>-<room_number>, e.g. A-428 (block code = block_id
--                    without its _BLOCK suffix; matches existing ids like L-843)
-- 3. Hostel blocks A to T exist out of the box, each with Ground + floors 1-10.
--    Rooms are added per block by an administrator.
--
-- Existing rows are untouched: the seed's L_BLOCK row is inserted here with
-- exactly the same values the seed uses, and every seed room already follows
-- the numbering rule.
-- ============================================================================

-- ---- 1. Floors -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS block_floors (
    block_id VARCHAR(10) NOT NULL REFERENCES hostel_blocks(block_id) ON DELETE CASCADE,
    floor_number INT NOT NULL CHECK (floor_number BETWEEN 0 AND 99),
    -- 'G' for ground, otherwise the number: the prefix every room number on
    -- this floor must start with.
    floor_code VARCHAR(2) GENERATED ALWAYS AS (
        CASE WHEN floor_number = 0 THEN 'G' ELSE floor_number::text END
    ) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (block_id, floor_number)
);

-- Backfill floors for blocks that already exist: Ground + 1..total_floors,
-- plus any floor already used by a room or common area.
INSERT INTO block_floors (block_id, floor_number)
SELECT b.block_id, gs.n
FROM hostel_blocks b
CROSS JOIN LATERAL generate_series(0, b.total_floors) AS gs(n)
ON CONFLICT DO NOTHING;

INSERT INTO block_floors (block_id, floor_number)
SELECT DISTINCT block_id, floor_number FROM rooms
ON CONFLICT DO NOTHING;

INSERT INTO block_floors (block_id, floor_number)
SELECT DISTINCT block_id, floor_number FROM common_areas
ON CONFLICT DO NOTHING;

-- A new block automatically gets Ground + floors 1..total_floors.
CREATE OR REPLACE FUNCTION fn_create_block_floors()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO block_floors (block_id, floor_number)
    SELECT NEW.block_id, gs.n FROM generate_series(0, NEW.total_floors) AS gs(n)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_block_floors ON hostel_blocks;
CREATE TRIGGER trg_create_block_floors
AFTER INSERT ON hostel_blocks
FOR EACH ROW
EXECUTE FUNCTION fn_create_block_floors();

-- hostel_blocks.total_floors stays meaningful (the highest floor above
-- ground) as floors are added or removed.
CREATE OR REPLACE FUNCTION fn_sync_block_total_floors()
RETURNS TRIGGER AS $$
DECLARE
    v_block_id VARCHAR(10) := COALESCE(NEW.block_id, OLD.block_id);
    v_top INT;
BEGIN
    SELECT GREATEST(1, COALESCE(MAX(floor_number), 1)) INTO v_top
    FROM block_floors WHERE block_id = v_block_id;

    UPDATE hostel_blocks SET total_floors = v_top
    WHERE block_id = v_block_id AND total_floors IS DISTINCT FROM v_top;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_block_total_floors ON block_floors;
CREATE TRIGGER trg_sync_block_total_floors
AFTER INSERT OR DELETE ON block_floors
FOR EACH ROW
EXECUTE FUNCTION fn_sync_block_total_floors();

-- ---- 2. Rooms and common areas belong to a real floor ------------------------

CREATE INDEX IF NOT EXISTS idx_rooms_block_floor ON rooms (block_id, floor_number);

DO $$
BEGIN
    -- NO ACTION (checked at end of statement) rather than RESTRICT, so that
    -- deleting a whole block can cascade to its rooms and floors together.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rooms_floor') THEN
        ALTER TABLE rooms ADD CONSTRAINT fk_rooms_floor
            FOREIGN KEY (block_id, floor_number) REFERENCES block_floors (block_id, floor_number);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_common_areas_floor') THEN
        ALTER TABLE common_areas ADD CONSTRAINT fk_common_areas_floor
            FOREIGN KEY (block_id, floor_number) REFERENCES block_floors (block_id, floor_number);
    END IF;

    -- Room number = floor code + two digits 01-99, and the floor code must be
    -- the room's own floor: 428 can only be on floor 4, G01 only on ground.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_room_number_format') THEN
        ALTER TABLE rooms ADD CONSTRAINT chk_room_number_format CHECK (
            room_number ~ '^(G|[1-9][0-9]?)[0-9]{2}$'
            AND room_number = (CASE WHEN floor_number = 0 THEN 'G' ELSE floor_number::text END) || right(room_number, 2)
            AND right(room_number, 2) <> '00'
        );
    END IF;

    -- room_id is derived, never free text: <block code>-<room number>.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_room_id_format') THEN
        ALTER TABLE rooms ADD CONSTRAINT chk_room_id_format CHECK (
            room_id = split_part(block_id, '_', 1) || '-' || room_number
        );
    END IF;
END $$;

-- ---- 3. Hostel blocks A to T --------------------------------------------------
-- Each gets Ground + floors 1-10 via trg_create_block_floors. L_BLOCK uses the
-- exact values of the existing seed row so that row is identical either way.

INSERT INTO hostel_blocks (block_id, block_name, total_floors) VALUES
('A_BLOCK', 'A-Block', 10),
('B_BLOCK', 'B-Block', 10),
('C_BLOCK', 'C-Block', 10),
('D_BLOCK', 'D-Block', 10),
('E_BLOCK', 'E-Block', 10),
('F_BLOCK', 'F-Block', 10),
('G_BLOCK', 'G-Block', 10),
('H_BLOCK', 'H-Block', 10),
('I_BLOCK', 'I-Block', 10),
('J_BLOCK', 'J-Block', 10),
('K_BLOCK', 'K-Block', 10),
('L_BLOCK', 'L-Block (Ladies/Mens Hostel)', 10),
('M_BLOCK', 'M-Block', 10),
('N_BLOCK', 'N-Block', 10),
('O_BLOCK', 'O-Block', 10),
('P_BLOCK', 'P-Block', 10),
('Q_BLOCK', 'Q-Block', 10),
('R_BLOCK', 'R-Block', 10),
('S_BLOCK', 'S-Block', 10),
('T_BLOCK', 'T-Block', 10)
ON CONFLICT (block_id) DO NOTHING;
