require('dotenv').config();
const db = require('../src/config/db');

async function testPhase5() {
    console.log('[Phase 5 Test] Testing Atomic Complaint Submission with AI fields...');
    
    // Pick an existing student
    const studentRes = await db.query("SELECT user_id FROM users WHERE role = 'STUDENT' LIMIT 1");
    if (studentRes.rows.length === 0) throw new Error('No student found in users');
    const studentId = studentRes.rows[0].user_id;

    // Pick room L-843
    const roomRes = await db.query("SELECT room_id, block_id, floor_number FROM rooms WHERE room_id = 'L-843'");
    if (roomRes.rows.length === 0) throw new Error('Room L-843 not found');
    const room = roomRes.rows[0];

    // Find a subcategory that does not currently have a live ticket in room L-843
    const subRes = await db.query(
        `SELECT subcategory_id FROM complaint_subcategories 
         WHERE subcategory_id NOT IN (
             SELECT subcategory_id FROM complaints 
             WHERE room_id = 'L-843' AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'ESCALATED')
         ) LIMIT 1`
    );
    if (subRes.rows.length === 0) throw new Error('All subcategories have live tickets in L-843');
    const targetSubcategoryId = subRes.rows[0].subcategory_id;

    // Subcategory test complaint
    const testComplaint = await db.withTransaction(async (client) => {
        const { allocateTechnician } = require('../src/services/aiAllocationService');
        const allocation = await allocateTechnician({
            subcategory_id: targetSubcategoryId,
            priority: 'EMERGENCY',
            floorNumber: room.floor_number,
            client,
        });

        const ins = await client.query(
            `INSERT INTO complaints (
                ticket_scope, room_id, block_id, raised_by_user_id,
                subcategory_id, description, priority,
                ai_priority_reasoning, ai_safety_advisory, ai_decided, status
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [
                'ROOM',
                room.room_id,
                room.block_id,
                studentId,
                targetSubcategoryId,
                'Test phase 5 socket sparking emergency',
                'EMERGENCY',
                'Phase 5 Automated emergency test reasoning',
                'Phase 5 Safety advisory: Stay clear of switchboard',
                true,
                allocation.selected_staff_user_id ? 'ASSIGNED' : 'OPEN',
            ]
        );
        const comp = ins.rows[0];

        let assigned = null;
        if (allocation.selected_staff_user_id) {
            const asg = await client.query(
                `INSERT INTO complaint_assignments (
                    complaint_id, staff_user_id, assigned_by_user_id, current_state,
                    ai_allocation_reasoning, ai_allocated
                 )
                 VALUES ($1, $2, $3, 'ASSIGNED', $4, $5)
                 RETURNING *`,
                [comp.complaint_id, allocation.selected_staff_user_id, studentId, allocation.allocation_reasoning, true]
            );
            assigned = asg.rows[0];
        }

        return { comp, assigned, allocation };
    });

    console.log(' - Created Complaint ID:', testComplaint.comp.complaint_id);
    console.log(' - Status:', testComplaint.comp.status);
    console.log(' - AI Reasoning stored:', !!testComplaint.comp.ai_priority_reasoning);
    console.log(' - Assigned Technician Staff ID:', testComplaint.assigned ? testComplaint.assigned.staff_user_id : 'None');

    if (!testComplaint.comp.ai_priority_reasoning || !testComplaint.assigned) {
        throw new Error('Atomic complaint + assignment creation failed to store AI reasoning or assignment.');
    }

    // Clean up test complaint
    await db.query('DELETE FROM complaints WHERE complaint_id = $1', [testComplaint.comp.complaint_id]);
    console.log(' - Cleaned up test complaint row successfully.');

    console.log('\n[Phase 5 Test] ALL ASSERTIONS PASSED SUCCESSFULLY!');
    process.exit(0);
}

testPhase5().catch((err) => {
    console.error('[Phase 5 Test] FAILED:', err);
    process.exit(1);
});
