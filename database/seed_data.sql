-- ============================================================================
-- FIX_MASTER: Realistic Seed Dataset for VIT Vellore (L-Block Focus)
-- Course: BCSE307L - Database Systems (SCOPE, VIT Vellore)
-- Database Engine: PostgreSQL 15+
-- ============================================================================

-- 1. Insert Hostel Blocks
INSERT INTO hostel_blocks (block_id, block_name, total_floors) VALUES
('L_BLOCK', 'L-Block (Ladies/Mens Hostel)', 10),
('PRP_BLOCK', 'PRP Block', 8),
('MH_BLOCK', 'Mens Hostel Block Q', 12)
ON CONFLICT (block_id) DO NOTHING;

-- 2. Insert Rooms for L-Block (Floors 1-10, with full Floor 8 rooms: L-801 to L-850)
INSERT INTO rooms (room_id, block_id, room_number, floor_number, room_type, bed_capacity) VALUES
-- Floor 8 (Primary focus: Room 843, 810, 825, etc.)
('L-801', 'L_BLOCK', '801', 8, 'AC', 3),
('L-802', 'L_BLOCK', '802', 8, 'AC', 3),
('L-810', 'L_BLOCK', '810', 8, 'NON_AC', 4),
('L-825', 'L_BLOCK', '825', 8, 'AC', 2),
('L-840', 'L_BLOCK', '840', 8, 'NON_AC', 3),
('L-841', 'L_BLOCK', '841', 8, 'AC', 3),
('L-842', 'L_BLOCK', '842', 8, 'AC', 3),
('L-843', 'L_BLOCK', '843', 8, 'AC', 3), -- Target demonstration room
('L-844', 'L_BLOCK', '844', 8, 'AC', 3),
('L-845', 'L_BLOCK', '845', 8, 'NON_AC', 4),
('L-850', 'L_BLOCK', '850', 8, 'DELUXE_AC', 2),
-- Other floors for routing demonstration
('L-101', 'L_BLOCK', '101', 1, 'NON_AC', 3),
('L-201', 'L_BLOCK', '201', 2, 'AC', 3),
('L-305', 'L_BLOCK', '305', 3, 'AC', 3),
('L-412', 'L_BLOCK', '412', 4, 'NON_AC', 4),
('L-520', 'L_BLOCK', '520', 5, 'AC', 3),
('L-615', 'L_BLOCK', '615', 6, 'NON_AC', 3),
('L-730', 'L_BLOCK', '730', 7, 'AC', 2)
ON CONFLICT (room_id) DO NOTHING;

-- 3. Insert Common Areas in L-Block
INSERT INTO common_areas (area_id, block_id, floor_number, area_type, description, is_operational) VALUES
('L-F08-COOLER-01', 'L_BLOCK', 8, 'WATER_COOLER', 'Floor 8 Water Cooler (Near Lift A)', TRUE),
('L-F08-WASHROOM-01', 'L_BLOCK', 8, 'COMMON_WASHROOM', 'Floor 8 West Wing Washroom Block', TRUE),
('L-F04-COOLER-01', 'L_BLOCK', 4, 'WATER_COOLER', 'Floor 4 Water Cooler (Near Stairs)', TRUE),
('L-F04-WASHROOM-01', 'L_BLOCK', 4, 'COMMON_WASHROOM', 'Floor 4 East Wing Washroom', TRUE),
('L-ELEVATOR-01', 'L_BLOCK', 1, 'ELEVATOR', 'L-Block Main Passenger Lift 1', TRUE),
('L-ELEVATOR-02', 'L_BLOCK', 1, 'ELEVATOR', 'L-Block Main Passenger Lift 2', TRUE)
ON CONFLICT (area_id) DO NOTHING;

-- 4. Insert Unified Users (Admins, Supervisors, Staff, Students)
-- Password for all seed users is 'Password@123' (bcrypt, cost 12, verified to match).
-- This is a shared demo credential for local development only - rotate it before
-- any deployment that isn't strictly local.
INSERT INTO users (user_id, reg_or_emp_id, full_name, email, phone_number, password_hash, role, specialization, is_available) VALUES
-- Admin
('u001-admin-0001-uuid-000000000001', 'ADMIN_ESTATES_01', 'Chief Warden / Estates Admin', 'admin.hostels@vit.ac.in', '9876543210', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'ADMIN', NULL, TRUE),

-- Supervisors
('u002-supv-0001-uuid-000000000002', 'SUP_LBLOCK_01', 'Mr. R. Sundaram (L-Block Supervisor)', 'supervisor.lblock@vit.ac.in', '9876543211', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'SUPERVISOR', NULL, TRUE),

-- Maintenance Staff (5 Specializations)
('u003-staf-clean-uuid-000000000003', 'EMP_CLN_01', 'Murugan K (Housekeeper)', 'murugan.cln@vit.ac.in', '9876543220', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STAFF', 'CLEANING', TRUE),
('u004-staf-clean-uuid-000000000004', 'EMP_CLN_02', 'Ramesh P (Housekeeper)', 'ramesh.cln@vit.ac.in', '9876543221', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STAFF', 'CLEANING', TRUE),
('u005-staf-elec-uuid-000000000005', 'EMP_ELEC_01', 'Suresh Kumar (Electrician)', 'suresh.elec@vit.ac.in', '9876543222', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STAFF', 'ELECTRICIAN', TRUE),
('u006-staf-carp-uuid-000000000006', 'EMP_CARP_01', 'Govindraj M (Carpenter)', 'govind.carp@vit.ac.in', '9876543223', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STAFF', 'CARPENTER', TRUE),
('u007-staf-actech-uuid-000000000007', 'EMP_AC_01', 'Dhanush V (AC Specialist)', 'dhanush.ac@vit.ac.in', '9876543224', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STAFF', 'AC_TECH', TRUE),
('u008-staf-plumb-uuid-000000000008', 'EMP_PLB_01', 'Karthik N (Plumber)', 'karthik.plb@vit.ac.in', '9876543225', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STAFF', 'PLUMBER', TRUE),

-- Students residing in L-Block
('u009-stud-0843-uuid-000000000009', '21BCE0843', 'Vihaan Sharma', 'vihaan.sharma2021@vitstudent.ac.in', '9876543230', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STUDENT', NULL, TRUE),
('u010-stud-0810-uuid-000000000010', '21BCE1042', 'Rahul Varma', 'rahul.varma2021@vitstudent.ac.in', '9876543231', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STUDENT', NULL, TRUE),
('u011-stud-0825-uuid-000000000011', '21BCE1523', 'Aditya Nair', 'aditya.nair2021@vitstudent.ac.in', '9876543232', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STUDENT', NULL, TRUE),
('u012-stud-0305-uuid-000000000012', '22BCE0190', 'Priya Iyer', 'priya.iyer2022@vitstudent.ac.in', '9876543233', '$2b$12$FHrTmI5VL8yWlJQ07Vfcx.nuZhvBoNSdei0tQSGyJwCjM1BY2uxiS', 'STUDENT', NULL, TRUE)
ON CONFLICT (user_id) DO NOTHING;

-- 5. Insert Student Room Allotments
INSERT INTO student_room_allotments (student_id, room_id, academic_year, is_current) VALUES
('u009-stud-0843-uuid-000000000009', 'L-843', '2026-2027', TRUE),
('u010-stud-0810-uuid-000000000010', 'L-810', '2026-2027', TRUE),
('u011-stud-0825-uuid-000000000011', 'L-825', '2026-2027', TRUE),
('u012-stud-0305-uuid-000000000012', 'L-305', '2026-2027', TRUE)
ON CONFLICT DO NOTHING;

-- 6. Insert Complaint Categories Master
INSERT INTO complaint_categories (category_id, category_code, category_name, is_quick_action, default_sla_hours) VALUES
(1, 'CLEANING', 'Housekeeping & Cleaning', TRUE, 4),
(2, 'ELECTRICAL', 'Electrical & Power Systems', FALSE, 12),
(3, 'AC_MAINTENANCE', 'AC & HVAC Maintenance', FALSE, 24),
(4, 'CARPENTER', 'Carpentry & Furniture', FALSE, 24),
(5, 'PLUMBING', 'Plumbing & Sanitary', FALSE, 12),
(6, 'COMMON_AREA_INFRA', 'Hostel Block Infrastructure', FALSE, 6)
ON CONFLICT (category_id) DO NOTHING;

-- 7. Insert Complaint Subcategories (25 Issues)
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

-- 8. Insert Sample Active & Past Complaints across states
INSERT INTO complaints (complaint_id, ticket_scope, room_id, common_area_id, block_id, raised_by_user_id, subcategory_id, description, status, priority, preferred_timeslot, created_at, resolved_at, closed_at) VALUES
-- 1. Vihaan in Room 843: Active 1-Click Cleaning (In Progress)
('cmp-843-0001-uuid-000000000001', 'ROOM', 'L-843', NULL, 'L_BLOCK', 'u009-stud-0843-uuid-000000000009', 1, 'Quick 1-Click Daily Room Cleaning requested for Room 843.', 'IN_PROGRESS', 'LOW', 'Immediate', CURRENT_TIMESTAMP - INTERVAL '1 hour', NULL, NULL),

-- 2. Vihaan in Room 843: Electrical Socket Sparking (Assigned)
('cmp-843-0002-uuid-000000000002', 'ROOM', 'L-843', NULL, 'L_BLOCK', 'u009-stud-0843-uuid-000000000009', 5, 'Left study table socket has spark when laptop charger is plugged in.', 'ASSIGNED', 'HIGH', '04:00 PM - 06:00 PM', CURRENT_TIMESTAMP - INTERVAL '3 hours', NULL, NULL),

-- 3. Rahul in Room 810: Table Leg Broken (Pending Verification)
('cmp-810-0001-uuid-000000000003', 'ROOM', 'L-810', NULL, 'L_BLOCK', 'u010-stud-0810-uuid-000000000010', 13, 'Study chair backrest broken and table leg screw loose.', 'PENDING_VERIFICATION', 'MEDIUM', '02:00 PM - 04:00 PM', CURRENT_TIMESTAMP - INTERVAL '6 hours', CURRENT_TIMESTAMP - INTERVAL '30 mins', NULL),

-- 4. Aditya in Room 825: AC Water Dripping (Completed & Rated 5 Stars)
('cmp-825-0001-uuid-000000000004', 'ROOM', 'L-825', NULL, 'L_BLOCK', 'u011-stud-0825-uuid-000000000011', 11, 'AC water dripping over wardrobe.', 'COMPLETED', 'HIGH', 'Morning', CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day'),

-- 5. Common Area Outage: Floor 8 Water Cooler Down
('cmp-cmn-0001-uuid-000000000005', 'COMMON_AREA', NULL, 'L-F08-COOLER-01', 'L_BLOCK', 'u009-stud-0843-uuid-000000000009', 21, 'Floor 8 water cooler is dispensing warm water since morning.', 'ASSIGNED', 'HIGH', 'Anytime', CURRENT_TIMESTAMP - INTERVAL '5 hours', NULL, NULL)
ON CONFLICT (complaint_id) DO NOTHING;

-- 9. Insert Complaint Assignments for Active Complaints
INSERT INTO complaint_assignments (complaint_id, staff_user_id, assigned_by_user_id, assigned_at, started_at, work_completed_at, current_state) VALUES
('cmp-843-0001-uuid-000000000001', 'u003-staf-clean-uuid-000000000003', NULL, CURRENT_TIMESTAMP - INTERVAL '50 mins', CURRENT_TIMESTAMP - INTERVAL '30 mins', NULL, 'IN_PROGRESS'),
('cmp-843-0002-uuid-000000000002', 'u005-staf-elec-uuid-000000000005', 'u002-supv-0001-uuid-000000000002', CURRENT_TIMESTAMP - INTERVAL '2 hours', NULL, NULL, 'ASSIGNED'),
('cmp-810-0001-uuid-000000000003', 'u006-staf-carp-uuid-000000000006', 'u002-supv-0001-uuid-000000000002', CURRENT_TIMESTAMP - INTERVAL '5 hours', CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '30 mins', 'DONE'),
('cmp-825-0001-uuid-000000000004', 'u007-staf-actech-uuid-000000000007', NULL, CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day', 'DONE'),
('cmp-cmn-0001-uuid-000000000005', 'u007-staf-actech-uuid-000000000007', 'u002-supv-0001-uuid-000000000002', CURRENT_TIMESTAMP - INTERVAL '4 hours', NULL, NULL, 'ASSIGNED')
ON CONFLICT DO NOTHING;

-- 10. Insert Feedback for Completed Complaint
INSERT INTO complaint_feedback (complaint_id, student_id, is_satisfactorily_resolved, rating, student_comments, verified_at) VALUES
('cmp-825-0001-uuid-000000000004', 'u011-stud-0825-uuid-000000000011', TRUE, 5, 'AC technician cleaned the drainage pipe thoroughly. No more leaking.', CURRENT_TIMESTAMP - INTERVAL '1 day')
ON CONFLICT (complaint_id) WHERE is_satisfactorily_resolved = TRUE DO NOTHING;

-- 11. Insert Audit History Logs
INSERT INTO complaint_logs (complaint_id, changed_by_user_id, previous_status, new_status, action_note, timestamp) VALUES
('cmp-843-0001-uuid-000000000001', 'u009-stud-0843-uuid-000000000009', NULL, 'OPEN', 'Student raised 1-click room cleaning', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
('cmp-843-0001-uuid-000000000001', NULL, 'OPEN', 'ASSIGNED', 'System auto-dispatched to Murugan K (Cleaning Staff)', CURRENT_TIMESTAMP - INTERVAL '50 mins'),
('cmp-843-0001-uuid-000000000001', 'u003-staf-clean-uuid-000000000003', 'ASSIGNED', 'IN_PROGRESS', 'Staff arrived at Room 843 and commenced cleaning', CURRENT_TIMESTAMP - INTERVAL '30 mins'),
('cmp-825-0001-uuid-000000000004', 'u011-stud-0825-uuid-000000000011', 'PENDING_VERIFICATION', 'COMPLETED', 'Student verified work and gave 5 stars', CURRENT_TIMESTAMP - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- 12. Re-sync serial sequences.
-- Categories and subcategories above are inserted with explicit ids, which
-- does not advance their sequences. Without this the next category or
-- subcategory created through the column default collides with id 1.
SELECT setval(pg_get_serial_sequence('complaint_categories', 'category_id'), (SELECT MAX(category_id) FROM complaint_categories));
SELECT setval(pg_get_serial_sequence('complaint_subcategories', 'subcategory_id'), (SELECT MAX(subcategory_id) FROM complaint_subcategories));
