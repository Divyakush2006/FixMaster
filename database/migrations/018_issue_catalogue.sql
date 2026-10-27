-- ============================================================================
-- FIX_MASTER migration 018: the issue catalogue is reference data, not demo data
-- ----------------------------------------------------------------------------
-- The categories and the 25 issue types a resident can report (with their usual
-- priority, trade and target time) used to exist only in database/seed_data.sql,
-- which is demo data and is refused in production. A database set up for real
-- therefore had no issue types and nobody could raise a ticket. They belong to
-- the schema.
--
-- Same ids and values as the seed, inserted only where missing, so existing
-- databases (and a later demo seed) are unaffected; changes made by an
-- administrator to a row are never overwritten.
-- ============================================================================

-- Insert Complaint Categories Master
INSERT INTO complaint_categories (category_id, category_code, category_name, is_quick_action, default_sla_hours) VALUES
(1, 'CLEANING', 'Housekeeping & Cleaning', TRUE, 4),
(2, 'ELECTRICAL', 'Electrical & Power Systems', FALSE, 12),
(3, 'AC_MAINTENANCE', 'AC & HVAC Maintenance', FALSE, 24),
(4, 'CARPENTER', 'Carpentry & Furniture', FALSE, 24),
(5, 'PLUMBING', 'Plumbing & Sanitary', FALSE, 12),
(6, 'COMMON_AREA_INFRA', 'Hostel Block Infrastructure', FALSE, 6)
ON CONFLICT (category_id) DO NOTHING;

-- Insert Complaint Subcategories (25 Issues)
INSERT INTO complaint_subcategories (subcategory_id, category_id, subcategory_code, issue_name, estimated_resolution_mins, priority_level, required_specialization) VALUES
-- Housekeeping
(1, 1, 'CLN_ROOM_SWEEP', '1-Click Room Cleaning & Mopping', 20, 'LOW', 'CLEANING'),
(2, 1, 'CLN_DUSTING', 'Room Dusting & Balcony Sweep', 30, 'LOW', 'CLEANING'),
(3, 1, 'CLN_TRASH', 'Room Trash / Dustbin Clearance', 15, 'LOW', 'CLEANING'),

-- Electrical
(4, 2, 'ELEC_LIGHT', 'Tube Light / Bulb Failure', 20, 'MEDIUM', 'ELECTRICIAN'),
(5, 2, 'ELEC_SOCKET', 'Power Socket Damaged / Sparking', 30, 'HIGH', 'ELECTRICIAN'),
(6, 2, 'ELEC_SWITCH', 'Switch Board Loose / Burnt', 25, 'HIGH', 'ELECTRICIAN'),
(7, 2, 'ELEC_FAN', 'Fan Regulator Broken / Not Rotating', 30, 'MEDIUM', 'ELECTRICIAN'),
(8, 2, 'ELEC_MCB', 'Room MCB Tripped / Main Power Loss', 15, 'HIGH', 'ELECTRICIAN'),

-- AC & HVAC
(9, 3, 'AC_COOLING', 'AC Not Cooling / Weak Airflow', 45, 'MEDIUM', 'AC_TECH'),
(10, 3, 'AC_SMELL', 'AC Foul / Burning Smell', 40, 'HIGH', 'AC_TECH'),
(11, 3, 'AC_LEAKAGE', 'Water Dripping / Leakage in Room', 45, 'HIGH', 'AC_TECH'),
(12, 3, 'AC_REMOTE', 'AC Remote Malfunction / Error Code', 20, 'LOW', 'AC_TECH'),

-- Carpentry
(13, 4, 'CARP_DESK_CHAIR', 'Study Table / Chair Leg Broken', 40, 'MEDIUM', 'CARPENTER'),
(14, 4, 'CARP_ALMIRAH', 'Almirah / Wardrobe Hinge Broken', 35, 'MEDIUM', 'CARPENTER'),
(15, 4, 'CARP_DOOR_LOCK', 'Room Door Lock / Latch Jammed', 30, 'HIGH', 'CARPENTER'),
(16, 4, 'CARP_BED', 'Bed Frame / Plywood Base Cracked', 60, 'HIGH', 'CARPENTER'),

-- Plumbing
(17, 5, 'PLUMB_TAP', 'Water Tap Leaking / Broken Nozzle', 20, 'LOW', 'PLUMBER'),
(18, 5, 'PLUMB_FLUSH', 'Flush Tank Overflow / Not Filling', 30, 'MEDIUM', 'PLUMBER'),
(19, 5, 'PLUMB_DRAIN', 'Washbasin / Drain Clogged', 35, 'HIGH', 'PLUMBER'),
(20, 5, 'PLUMB_GEYSER', 'Geyser / Hot Water Not Working', 45, 'MEDIUM', 'PLUMBER'),

-- Common Area
(21, 6, 'INFRA_COOLER_TEMP', 'Water Cooler No Cold Water', 60, 'HIGH', 'AC_TECH'),
(22, 6, 'INFRA_COOLER_RO', 'Purifier Filter Choked / Bad Taste', 45, 'HIGH', 'PLUMBER'),
(23, 6, 'INFRA_WASHROOM_BURST', 'Common Washroom Main Pipe Burst', 30, 'EMERGENCY', 'PLUMBER'),
(24, 6, 'INFRA_LIFT_FAULT', 'Elevator Jerking / Door Sensor Fault', 45, 'EMERGENCY', 'ELECTRICIAN'),
(25, 6, 'INFRA_CORRIDOR_LIGHT', 'Corridor Tube Lights Out', 30, 'MEDIUM', 'ELECTRICIAN')
ON CONFLICT (subcategory_id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('complaint_categories', 'category_id'), GREATEST((SELECT MAX(category_id) FROM complaint_categories), 1));
SELECT setval(pg_get_serial_sequence('complaint_subcategories', 'subcategory_id'), GREATEST((SELECT MAX(subcategory_id) FROM complaint_subcategories), 1));

-- ============================================================================
-- The campus's two special blocks
-- ----------------------------------------------------------------------------
-- MH is the complete men's hostel and PRP an academic block (migration 016 only
-- classified them where the demo seed had already created them). A database that
-- never saw the seed has neither, so residents could not report faults in the
-- hostel's shared places or in PRP. Neither has rooms, only shared areas.
-- ============================================================================

INSERT INTO hostel_blocks (block_id, block_name, total_floors, hostel_type, block_kind) VALUES
('PRP_BLOCK', 'PRP (academic block)', 8, NULL, 'ACADEMIC'),
('MH_BLOCK', 'MH (complete men''s hostel)', 2, 'MENS', 'HOSTEL_WIDE')
ON CONFLICT (block_id) DO NOTHING;

INSERT INTO common_areas (area_id, block_id, floor_number, area_type, description) VALUES
('MH-F00-CORR-01', 'MH_BLOCK', 0, 'CORRIDOR', 'Men''s hostel main corridor'),
('MH-F00-WASH-01', 'MH_BLOCK', 0, 'COMMON_WASHROOM', 'Men''s hostel ground floor washroom'),
('MH-F00-COOLER-01', 'MH_BLOCK', 0, 'WATER_COOLER', 'Men''s hostel ground floor water cooler'),
('MH-F01-STUDY-01', 'MH_BLOCK', 1, 'STUDY_HALL', 'Men''s hostel study hall'),
('PRP-F00-LIFT-01', 'PRP_BLOCK', 0, 'ELEVATOR', 'PRP ground floor lift'),
('PRP-F00-CORR-01', 'PRP_BLOCK', 0, 'CORRIDOR', 'PRP ground floor corridor'),
('PRP-F01-WASH-01', 'PRP_BLOCK', 1, 'COMMON_WASHROOM', 'PRP first floor washroom'),
('PRP-F01-COOLER-01', 'PRP_BLOCK', 1, 'WATER_COOLER', 'PRP first floor water cooler')
ON CONFLICT (area_id) DO NOTHING;

-- 004 named the block "L-Block (Ladies/Mens Hostel)"; it is the men's hostel's L-Block.
UPDATE hostel_blocks SET block_name = 'L-Block' WHERE block_id = 'L_BLOCK' AND block_name = 'L-Block (Ladies/Mens Hostel)';
