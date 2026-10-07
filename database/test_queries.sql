-- ============================================================================
-- FIX_MASTER: STEP 1 TEST SUITE & EVALUATION QUERIES
-- Course: BCSE307L - Database Systems (SCOPE, VIT Vellore)
-- Purpose: Verify Tables, Joins, Aggregates, Views, Triggers, and Stored Procedures
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TEST 1: Verify All 11 Normalized Tables & Row Counts
-- ----------------------------------------------------------------------------
SELECT '1. hostel_blocks' AS entity_table, COUNT(*) AS row_count FROM hostel_blocks
UNION ALL SELECT '2. rooms', COUNT(*) FROM rooms
UNION ALL SELECT '3. common_areas', COUNT(*) FROM common_areas
UNION ALL SELECT '4. users (Single RBAC Table)', COUNT(*) FROM users
UNION ALL SELECT '5. student_room_allotments', COUNT(*) FROM student_room_allotments
UNION ALL SELECT '6. complaint_categories', COUNT(*) FROM complaint_categories
UNION ALL SELECT '7. complaint_subcategories', COUNT(*) FROM complaint_subcategories
UNION ALL SELECT '8. complaints', COUNT(*) FROM complaints
UNION ALL SELECT '9. complaint_assignments', COUNT(*) FROM complaint_assignments
UNION ALL SELECT '10. complaint_feedback', COUNT(*) FROM complaint_feedback
UNION ALL SELECT '11. complaint_logs', COUNT(*) FROM complaint_logs;


-- ----------------------------------------------------------------------------
-- TEST 2: Multi-Table 5-Way Join (Student Active Dashboard Query)
-- ----------------------------------------------------------------------------
SELECT 
    c.complaint_id,
    c.ticket_scope,
    COALESCE(r.room_number, ca.description) AS location,
    cat.category_name,
    sub.issue_name,
    c.status,
    c.priority,
    u_staff.full_name AS assigned_technician,
    u_staff.phone_number AS technician_phone,
    ca_assign.current_state AS technician_status
FROM complaints c
JOIN complaint_subcategories sub ON c.subcategory_id = sub.subcategory_id
JOIN complaint_categories cat ON sub.category_id = cat.category_id
LEFT JOIN rooms r ON c.room_id = r.room_id
LEFT JOIN common_areas ca ON c.common_area_id = ca.area_id
LEFT JOIN complaint_assignments ca_assign ON c.complaint_id = ca_assign.complaint_id AND ca_assign.current_state != 'DECLINED'
LEFT JOIN users u_staff ON ca_assign.staff_user_id = u_staff.user_id
WHERE c.raised_by_user_id = 'u009-stud-0843-uuid-000000000009';


-- ----------------------------------------------------------------------------
-- TEST 3: Test Analytical View 1 (Staff Floor-Optimized Routing Queue)
-- ----------------------------------------------------------------------------
SELECT 
    staff_name,
    specialization,
    location_identifier,
    floor_number,
    priority,
    issue_name,
    status,
    assignment_state
FROM view_staff_active_queue;


-- ----------------------------------------------------------------------------
-- TEST 4: Test Analytical View 2 (Block Supervisor Real-Time KPI Summary)
-- ----------------------------------------------------------------------------
SELECT 
    block_name,
    total_complaints,
    pending_complaints,
    active_in_progress,
    awaiting_student_verification,
    resolved_count,
    common_area_issues,
    average_student_rating
FROM view_block_supervisor_summary;


-- ----------------------------------------------------------------------------
-- TEST 5: Test Database Trigger (trg_complaint_status_audit)
-- Updating complaint status will auto-insert into complaint_logs
-- ----------------------------------------------------------------------------
UPDATE complaints 
SET status = 'IN_PROGRESS' 
WHERE complaint_id = 'cmp-843-0002-uuid-000000000002';

SELECT 
    log_id, 
    complaint_id, 
    previous_status, 
    new_status, 
    action_note, 
    timestamp 
FROM complaint_logs 
WHERE complaint_id = 'cmp-843-0002-uuid-000000000002'
ORDER BY timestamp DESC;


-- ----------------------------------------------------------------------------
-- TEST 6: Test Stored Procedure (sp_confirm_resolution - Student Sign-off)
-- ----------------------------------------------------------------------------
CALL sp_confirm_resolution(
    'cmp-810-0001-uuid-000000000003',
    'u010-stud-0810-uuid-000000000010',
    TRUE,
    5,
    'Carpenter fixed the chair backrest and table screws perfectly.'
);

SELECT complaint_id, status, closed_at FROM complaints WHERE complaint_id = 'cmp-810-0001-uuid-000000000003';
