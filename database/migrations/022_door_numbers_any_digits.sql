-- ============================================================================
-- FIX_MASTER migration 022: any three or four digits are a door number
-- ----------------------------------------------------------------------------
-- Migration 021 required the first digit to be 1-9. Some doors read 012 or 0101, so any three or
-- four digits are accepted (the legacy ground-floor form G01 stays valid). Still unique per block.
-- ============================================================================

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS chk_room_number_format;
ALTER TABLE rooms ADD CONSTRAINT chk_room_number_format CHECK (room_number ~ '^([0-9]{3,4}|G[0-9]{2})$');
