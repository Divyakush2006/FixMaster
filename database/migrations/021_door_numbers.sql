-- ============================================================================
-- FIX_MASTER migration 021: a room's door number is its own
-- ----------------------------------------------------------------------------
-- Until now a room number had to start with its floor (428 only on floor 4). Hostels
-- number their doors differently: where the ground floor counts as "1", the third floor
-- above it holds rooms 401-420. A room number is now any three or four digits (the legacy
-- ground-floor form G01 stays valid); the floor is stored separately, and the number is
-- still unique within its block. room_id remains <block code>-<room number>.
-- ============================================================================

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS chk_room_number_format;
ALTER TABLE rooms ADD CONSTRAINT chk_room_number_format CHECK (room_number ~ '^([1-9][0-9]{2,3}|G[0-9]{2})$');
