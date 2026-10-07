const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// Room numbering (enforced by the database too - migration 004):
//   room_number = floor code + two-digit room 01-99
//   floor code  = 'G' for ground (floor 0), otherwise the floor number
//   room_id     = <block code>-<room_number>, block code = block_id minus _BLOCK
const floorCode = (floorNumber) => (floorNumber === 0 ? 'G' : String(floorNumber));
const roomNumberFor = (floorNumber, seq) => `${floorCode(floorNumber)}${String(seq).padStart(2, '0')}`;
const blockCodeOf = (blockId) => blockId.split('_')[0];

async function requireBlock(client, blockId) {
    const block = await client.query('SELECT block_id FROM hostel_blocks WHERE block_id = $1', [blockId]);
    if (block.rows.length === 0) {
        throw new AppError(404, `Block ${blockId} not found.`);
    }
}

// GET /api/admin/blocks
exports.listBlocks = asyncHandler(async (req, res) => {
    const result = await db.query(`
        SELECT
            b.block_id,
            split_part(b.block_id, '_', 1) AS block_code,
            b.block_name,
            b.total_floors,
            (SELECT COUNT(*) FROM block_floors f WHERE f.block_id = b.block_id)::int AS floor_count,
            (SELECT COUNT(*) FROM rooms r WHERE r.block_id = b.block_id)::int AS room_count,
            (SELECT COUNT(*) FROM rooms r WHERE r.block_id = b.block_id AND r.is_active)::int AS active_room_count,
            (SELECT COALESCE(SUM(r.bed_capacity), 0) FROM rooms r WHERE r.block_id = b.block_id AND r.is_active)::int AS total_beds,
            (SELECT COUNT(*) FROM student_room_allotments a JOIN rooms r ON r.room_id = a.room_id
              WHERE r.block_id = b.block_id AND a.is_current)::int AS occupied_beds
        FROM hostel_blocks b
        ORDER BY length(split_part(b.block_id, '_', 1)), b.block_id
    `);
    res.json(result.rows);
});

// POST /api/admin/blocks { block_code, block_name, top_floor }
// The new block gets Ground + floors 1..top_floor automatically (DB trigger).
exports.createBlock = asyncHandler(async (req, res) => {
    const { block_code, block_name, top_floor } = req.body;
    const blockId = `${block_code}_BLOCK`;
    const result = await db.query(
        `INSERT INTO hostel_blocks (block_id, block_name, total_floors)
         VALUES ($1, $2, $3)
         ON CONFLICT (block_id) DO NOTHING
         RETURNING block_id, block_name, total_floors`,
        [blockId, block_name, top_floor || 10]
    );
    if (result.rows.length === 0) {
        throw new AppError(409, `Block ${block_code} already exists.`);
    }
    res.status(201).json(result.rows[0]);
});

// PATCH /api/admin/blocks/:block_id { block_name }
exports.updateBlock = asyncHandler(async (req, res) => {
    const result = await db.query(
        'UPDATE hostel_blocks SET block_name = $2 WHERE block_id = $1 RETURNING block_id, block_name, total_floors',
        [req.params.block_id, req.body.block_name]
    );
    if (result.rows.length === 0) {
        throw new AppError(404, 'Block not found.');
    }
    res.json(result.rows[0]);
});

// GET /api/admin/blocks/:block_id/floors
exports.listFloors = asyncHandler(async (req, res) => {
    await requireBlock(db, req.params.block_id);
    const result = await db.query(
        `SELECT f.floor_number, f.floor_code,
                (SELECT COUNT(*) FROM rooms r WHERE r.block_id = f.block_id AND r.floor_number = f.floor_number)::int AS room_count,
                (SELECT COUNT(*) FROM common_areas c WHERE c.block_id = f.block_id AND c.floor_number = f.floor_number)::int AS common_area_count
         FROM block_floors f
         WHERE f.block_id = $1
         ORDER BY f.floor_number`,
        [req.params.block_id]
    );
    res.json(result.rows);
});

// POST /api/admin/blocks/:block_id/floors { floor_number? }
// Without floor_number, adds the next floor above the current top floor.
exports.addFloor = asyncHandler(async (req, res) => {
    const { block_id } = req.params;
    const floor = await db.withTransaction(async (client) => {
        await requireBlock(client, block_id);
        let floorNumber = req.body.floor_number;
        if (floorNumber === undefined || floorNumber === null) {
            const top = await client.query('SELECT COALESCE(MAX(floor_number), -1) AS top FROM block_floors WHERE block_id = $1', [block_id]);
            floorNumber = top.rows[0].top + 1;
        }
        if (floorNumber > 99) {
            throw new AppError(400, 'A block can have at most 99 floors above ground.');
        }
        const inserted = await client.query(
            `INSERT INTO block_floors (block_id, floor_number) VALUES ($1, $2)
             ON CONFLICT DO NOTHING RETURNING floor_number, floor_code`,
            [block_id, floorNumber]
        );
        if (inserted.rows.length === 0) {
            throw new AppError(409, `Floor ${floorCode(floorNumber)} already exists in this block.`);
        }
        return inserted.rows[0];
    }, req.user.userId);
    res.status(201).json(floor);
});

// DELETE /api/admin/blocks/:block_id/floors/:floor_number - only an empty floor.
exports.removeFloor = asyncHandler(async (req, res) => {
    const { block_id } = req.params;
    const floorNumber = parseInt(req.params.floor_number, 10);
    await db.withTransaction(async (client) => {
        const usage = await client.query(
            `SELECT
                (SELECT COUNT(*) FROM rooms WHERE block_id = $1 AND floor_number = $2)::int AS rooms,
                (SELECT COUNT(*) FROM common_areas WHERE block_id = $1 AND floor_number = $2)::int AS areas,
                (SELECT COUNT(*) FROM block_floors WHERE block_id = $1 AND floor_number > 0 AND floor_number <> $2)::int AS other_upper_floors`,
            [block_id, floorNumber]
        );
        const u = usage.rows[0];
        if (u.rooms > 0 || u.areas > 0) {
            throw new AppError(409, `Floor ${floorCode(floorNumber)} still has ${u.rooms} room(s) and ${u.areas} common area(s). Remove them first.`);
        }
        if (floorNumber > 0 && u.other_upper_floors === 0) {
            throw new AppError(409, 'A block must keep at least one floor above ground.');
        }
        const deleted = await client.query('DELETE FROM block_floors WHERE block_id = $1 AND floor_number = $2 RETURNING 1', [block_id, floorNumber]);
        if (deleted.rows.length === 0) {
            throw new AppError(404, 'Floor not found.');
        }
    }, req.user.userId);
    res.json({ message: `Floor ${floorCode(floorNumber)} removed.` });
});

// GET /api/admin/blocks/:block_id/rooms - every room, including inactive ones.
exports.listRooms = asyncHandler(async (req, res) => {
    await requireBlock(db, req.params.block_id);
    const result = await db.query(
        `SELECT r.room_id, r.block_id, r.room_number, r.floor_number, r.room_type, r.bed_capacity, r.is_active,
                (SELECT COUNT(*) FROM student_room_allotments a WHERE a.room_id = r.room_id AND a.is_current)::int AS occupied_beds
         FROM rooms r
         WHERE r.block_id = $1
         ORDER BY r.floor_number, r.room_number`,
        [req.params.block_id]
    );
    res.json(result.rows);
});

// POST /api/admin/blocks/:block_id/rooms
//   { floor_number, from, to?, room_type, bed_capacity }
// Creates rooms <floor code><from..to> on that floor, e.g. floor 4, 1..20 ->
// 401..420; ground floor, 1..5 -> G01..G05. Rooms that already exist are
// skipped and reported, so the same range can safely be submitted twice.
exports.createRooms = asyncHandler(async (req, res) => {
    const { block_id } = req.params;
    const { floor_number, from, room_type, bed_capacity } = req.body;
    const to = req.body.to ?? from;
    if (to < from) {
        throw new AppError(400, '"to" must be greater than or equal to "from".');
    }

    const outcome = await db.withTransaction(async (client) => {
        await requireBlock(client, block_id);
        const floor = await client.query(
            'SELECT 1 FROM block_floors WHERE block_id = $1 AND floor_number = $2',
            [block_id, floor_number]
        );
        if (floor.rows.length === 0) {
            throw new AppError(404, `Floor ${floorCode(floor_number)} does not exist in this block. Add the floor first.`);
        }

        const created = [];
        const skipped = [];
        for (let seq = from; seq <= to; seq++) {
            const roomNumber = roomNumberFor(floor_number, seq);
            const roomId = `${blockCodeOf(block_id)}-${roomNumber}`;
            const inserted = await client.query(
                `INSERT INTO rooms (room_id, block_id, room_number, floor_number, room_type, bed_capacity)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT DO NOTHING
                 RETURNING room_id`,
                [roomId, block_id, roomNumber, floor_number, room_type, bed_capacity]
            );
            (inserted.rows.length ? created : skipped).push(roomId);
        }
        return { created, skipped };
    }, req.user.userId);

    res.status(outcome.created.length ? 201 : 200).json({
        message: `${outcome.created.length} room(s) created${outcome.skipped.length ? `, ${outcome.skipped.length} already existed` : ''}.`,
        ...outcome,
    });
});

// PATCH /api/admin/rooms/:room_id { is_active?, room_type?, bed_capacity? }
exports.updateRoom = asyncHandler(async (req, res) => {
    const { room_id } = req.params;
    const { is_active, room_type, bed_capacity } = req.body;

    const room = await db.withTransaction(async (client) => {
        const current = await client.query('SELECT room_id FROM rooms WHERE room_id = $1 FOR UPDATE', [room_id]);
        if (current.rows.length === 0) {
            throw new AppError(404, 'Room not found.');
        }
        const occ = await client.query(
            'SELECT COUNT(*)::int AS n FROM student_room_allotments WHERE room_id = $1 AND is_current = TRUE',
            [room_id]
        );
        const occupied = occ.rows[0].n;
        if (is_active === false && occupied > 0) {
            throw new AppError(409, `${occupied} student(s) are currently allotted to ${room_id}. Move them before closing the room.`);
        }
        if (bed_capacity !== undefined && bed_capacity < occupied) {
            throw new AppError(409, `${occupied} student(s) currently live in ${room_id}; capacity can't be set below that.`);
        }
        const updated = await client.query(
            `UPDATE rooms
             SET is_active = COALESCE($2, is_active),
                 room_type = COALESCE($3, room_type),
                 bed_capacity = COALESCE($4, bed_capacity)
             WHERE room_id = $1
             RETURNING room_id, block_id, room_number, floor_number, room_type, bed_capacity, is_active`,
            [room_id, is_active ?? null, room_type ?? null, bed_capacity ?? null]
        );
        return { ...updated.rows[0], occupied_beds: occupied };
    }, req.user.userId);

    res.json(room);
});
