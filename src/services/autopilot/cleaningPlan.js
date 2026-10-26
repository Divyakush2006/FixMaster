const db = require('../../config/db');
const { currentShift } = require('./index');

// The daily cleaning round for one block and shift: the block's floors are
// split among the cleaners on that shift into contiguous runs with about the
// same number of rooms each, so nobody criss-crosses the building. Each run
// lists how many residents asked for morning, afternoon or evening cleaning,
// so the cleaner can order their rooms around those windows.

async function cleaningPlan(blockId, { shift = currentShift(), date = null } = {}) {
    const [floors, cleaners] = await Promise.all([
        db.query(
            `SELECT r.floor_number,
                    COUNT(*)::int AS rooms,
                    COUNT(*) FILTER (WHERE p.slot = 'MORNING')::int AS morning,
                    COUNT(*) FILTER (WHERE p.slot = 'AFTERNOON')::int AS afternoon,
                    COUNT(*) FILTER (WHERE p.slot = 'EVENING')::int AS evening
             FROM rooms r
             LEFT JOIN LATERAL (
                 -- the room's most common preferred slot among current residents
                 SELECT sp.preferred_cleaning_slot AS slot
                 FROM student_room_allotments a JOIN student_profiles sp ON sp.user_id = a.student_id
                 WHERE a.room_id = r.room_id AND a.is_current AND sp.preferred_cleaning_slot <> 'ANY'
                 GROUP BY sp.preferred_cleaning_slot ORDER BY COUNT(*) DESC, sp.preferred_cleaning_slot LIMIT 1
             ) p ON TRUE
             WHERE r.block_id = $1 AND r.is_active
             GROUP BY r.floor_number ORDER BY r.floor_number`,
            [blockId]
        ),
        db.query(
            `SELECT u.user_id, u.full_name, u.home_block_id
             FROM users u
             WHERE u.role = 'STAFF' AND u.specialization = 'CLEANING' AND u.is_active AND u.is_available
               AND (u.shift IS NULL OR u.shift = $2)
               AND (u.home_block_id = $1 OR u.home_block_id IS NULL)
               AND NOT EXISTS (SELECT 1 FROM staff_leave l WHERE l.staff_user_id = u.user_id
                               AND COALESCE($3::date, CURRENT_DATE) BETWEEN l.starts_on AND l.ends_on)
             ORDER BY (u.home_block_id IS NULL), u.user_id`,
            [blockId, shift, date]
        ),
    ]);

    // The block's own cleaners; the campus pool only if it has none on shift.
    const own = cleaners.rows.filter((c) => c.home_block_id === blockId);
    const team = own.length ? own : cleaners.rows;
    const runs = team.map((c) => ({ user_id: c.user_id, full_name: c.full_name, floors: [], rooms: 0, slots: { MORNING: 0, AFTERNOON: 0, EVENING: 0 } }));
    const totalRooms = floors.rows.reduce((s, f) => s + f.rooms, 0);

    if (runs.length > 0) {
        // Contiguous split: fill each cleaner up to their share before moving on.
        let i = 0;
        let assigned = 0;
        for (const f of floors.rows) {
            const share = ((i + 1) * totalRooms) / runs.length;
            if (assigned >= share && i < runs.length - 1) i += 1;
            const run = runs[i];
            run.floors.push(f.floor_number);
            run.rooms += f.rooms;
            run.slots.MORNING += f.morning;
            run.slots.AFTERNOON += f.afternoon;
            run.slots.EVENING += f.evening;
            assigned += f.rooms;
        }
    }
    return {
        block_id: blockId,
        shift,
        total_rooms: totalRooms,
        cleaners: runs,
        unassigned_floors: runs.length === 0 ? floors.rows.map((f) => f.floor_number) : [],
        uses_campus_pool: own.length === 0 && runs.length > 0,
    };
}

module.exports = { cleaningPlan };
