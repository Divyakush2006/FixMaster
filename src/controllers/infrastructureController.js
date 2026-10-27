const db = require('../config/db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { recordAudit } = require('../services/auditService');
const { managedBlocks, assertBlockInScope } = require('../services/scopeService');

// Room numbering (enforced by the database too - migration 004):
//   room_number = floor code + two-digit room 01-99
//   floor code  = 'G' for ground (floor 0), otherwise the floor number
//   room_id     = <block code>-<room_number>, block code = block_id minus _BLOCK
const floorCode = (floorNumber) => (floorNumber === 0 ? 'G' : String(floorNumber));
const roomNumberFor = (floorNumber, seq) => `${floorCode(floorNumber)}${String(seq).padStart(2, '0')}`;
const blockCodeOf = (blockId) => blockId.split('_')[0];

// Block settings are used by supervisors and chief wardens as well as
// administrators (migration 016): every handler first checks the block is one
// the caller runs. Administrators run every block.
const requireBlock = (req, blockId, executor = db) => assertBlockInScope(req.user, blockId, executor);

async function hostelOf(userId, executor = db) {
    const { rows } = await executor.query('SELECT hostel_type FROM users WHERE user_id = $1', [userId]);
    return rows[0]?.hostel_type || null;
}

// A ladies' residential block's id starts with L (LA_BLOCK, LS_BLOCK), because
// both hostels have an A-Block and block ids are unique across the campus.
const blockIdFor = (code, kind, hostel) => `${kind === 'RESIDENTIAL' && hostel === 'LADIES' ? 'L' : ''}${code}_BLOCK`;

const AREA_TAGS = { WATER_COOLER: 'COOLER', COMMON_WASHROOM: 'WASH', SHOWER_ROOM: 'SHOWER', ELEVATOR: 'LIFT', CORRIDOR: 'CORR', STUDY_HALL: 'STUDY' };

// GET /api/infrastructure/blocks (and /api/admin/blocks): the blocks the caller runs.
exports.listBlocks = asyncHandler(async (req, res) => {
    const scope = await managedBlocks(req.user);
    const result = await db.query(`
        SELECT
            b.block_id,
            split_part(b.block_id, '_', 1) AS block_code,
            b.block_name,
            b.hostel_type,
            b.block_kind,
            b.total_floors,
            (SELECT COUNT(*) FROM common_areas c WHERE c.block_id = b.block_id)::int AS common_area_count,
            (SELECT COUNT(*) FROM block_floors f WHERE f.block_id = b.block_id)::int AS floor_count,
            (SELECT COUNT(*) FROM rooms r WHERE r.block_id = b.block_id)::int AS room_count,
            (SELECT COUNT(*) FROM rooms r WHERE r.block_id = b.block_id AND r.is_active)::int AS active_room_count,
            (SELECT COALESCE(SUM(r.bed_capacity), 0) FROM rooms r WHERE r.block_id = b.block_id AND r.is_active)::int AS total_beds,
            (SELECT COUNT(*) FROM student_room_allotments a JOIN rooms r ON r.room_id = a.room_id
              WHERE r.block_id = b.block_id AND a.is_current)::int AS occupied_beds
        FROM hostel_blocks b
        WHERE ($1::varchar[] IS NULL OR b.block_id = ANY($1::varchar[]))
        ORDER BY CASE b.hostel_type WHEN 'MENS' THEN 0 WHEN 'LADIES' THEN 1 ELSE 2 END, b.block_kind <> 'HOSTEL_WIDE', length(split_part(b.block_id, '_', 1)), b.block_id
    `, [scope]);
    res.json(result.rows);
});

// POST /api/infrastructure/blocks { block_code, block_name, top_floor, hostel_type, block_kind }
// Chief wardens add blocks to their own hostel (residential, or its whole-hostel
// block); administrators add any block, including academic ones. The new block
// gets Ground + floors 1..top_floor automatically (DB trigger).
exports.createBlock = asyncHandler(async (req, res) => {
    const { block_code, block_name, top_floor, block_kind = 'RESIDENTIAL' } = req.body;
    let hostel = block_kind === 'ACADEMIC' ? null : req.body.hostel_type || 'MENS';
    if (req.user.role === 'CHIEF_WARDEN') {
        const own = await hostelOf(req.user.userId);
        if (!own) throw new AppError(403, 'Your account is not attached to a hostel yet. Ask an administrator.');
        if (block_kind === 'ACADEMIC') throw new AppError(403, 'Only an administrator can add an academic block.');
        if (req.body.hostel_type && req.body.hostel_type !== own) throw new AppError(403, 'You can only add blocks to your own hostel.');
        hostel = own;
    }
    const blockId = blockIdFor(block_code, block_kind, hostel);
    if (blockId.length > 10) throw new AppError(400, 'That block code is too long for this kind of block.');
    const floors = top_floor || (block_kind === 'RESIDENTIAL' ? 10 : 2);
    const block = await db.withTransaction(async (client) => {
        const result = await client.query(
            `INSERT INTO hostel_blocks (block_id, block_name, total_floors, hostel_type, block_kind)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (block_id) DO NOTHING
             RETURNING block_id, block_name, total_floors, hostel_type, block_kind`,
            [blockId, block_name, floors, hostel, block_kind]
        );
        if (result.rows.length === 0) {
            throw new AppError(409, `Block ${blockId.replace('_BLOCK', '')} already exists.`);
        }
        await recordAudit(client, req, {
            action: 'block.create',
            targetType: 'block',
            targetId: blockId,
            details: { block_name, top_floor: floors, hostel_type: hostel, block_kind },
        });
        return result.rows[0];
    }, req.user.userId);
    res.status(201).json(block);
});

// PATCH /api/infrastructure/blocks/:block_id { block_name, hostel_type?, block_kind? }
// Anyone who runs the block can rename it; which hostel it belongs to, and what
// kind of block it is, is the administrator's decision.
exports.updateBlock = asyncHandler(async (req, res) => {
    const block = await db.withTransaction(async (client) => {
        await requireBlock(req, req.params.block_id, client);
        const before = await client.query('SELECT block_name, hostel_type, block_kind FROM hostel_blocks WHERE block_id = $1 FOR UPDATE', [
            req.params.block_id,
        ]);
        const current = before.rows[0];
        const nextKind = req.body.block_kind ?? current.block_kind;
        let nextHostel = req.body.hostel_type !== undefined ? req.body.hostel_type : current.hostel_type;
        if (nextKind === 'ACADEMIC') nextHostel = null;
        else if (!nextHostel) throw new AppError(400, 'A residential or whole-hostel block belongs to MENS or LADIES.');
        const reclassified = nextKind !== current.block_kind || nextHostel !== current.hostel_type;
        if (reclassified) {
            if (req.user.role !== 'ADMIN') throw new AppError(403, "Only an administrator can change a block's hostel or kind.");
            if (nextKind !== 'RESIDENTIAL') {
                const rooms = await client.query('SELECT COUNT(*)::int AS n FROM rooms WHERE block_id = $1', [req.params.block_id]);
                if (rooms.rows[0].n > 0) throw new AppError(409, `This block has ${rooms.rows[0].n} room(s); only a residential block can have rooms.`);
            }
            if (nextHostel) {
                const clash = await client.query(
                    `SELECT COUNT(*)::int AS n FROM supervisor_blocks sb JOIN users u ON u.user_id = sb.supervisor_user_id
                     WHERE sb.block_id = $1 AND u.hostel_type IS NOT NULL AND u.hostel_type <> $2`,
                    [req.params.block_id, nextHostel]
                );
                if (clash.rows[0].n > 0) throw new AppError(409, 'Supervisors of the other hostel are assigned to this block. Unassign them first.');
            }
        }
        const result = await client.query(
            `UPDATE hostel_blocks SET block_name = $2, hostel_type = $3, block_kind = $4
             WHERE block_id = $1 RETURNING block_id, block_name, total_floors, hostel_type, block_kind`,
            [req.params.block_id, req.body.block_name, nextHostel, nextKind]
        );
        if (current.block_name !== req.body.block_name) {
            await recordAudit(client, req, {
                action: 'block.rename',
                targetType: 'block',
                targetId: req.params.block_id,
                details: { from: current.block_name, to: req.body.block_name },
            });
        }
        if (reclassified) {
            await recordAudit(client, req, {
                action: 'block.set_type',
                targetType: 'block',
                targetId: req.params.block_id,
                details: { from: { hostel_type: current.hostel_type, block_kind: current.block_kind }, to: { hostel_type: nextHostel, block_kind: nextKind } },
            });
        }
        return result.rows[0];
    }, req.user.userId);
    res.json(block);
});

// GET /api/admin/blocks/:block_id/floors
exports.listFloors = asyncHandler(async (req, res) => {
    await requireBlock(req, req.params.block_id);
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
        await requireBlock(req, block_id, client);
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
        await recordAudit(client, req, { action: 'floor.add', targetType: 'block', targetId: block_id, details: { floor_number: floorNumber } });
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
        await recordAudit(client, req, { action: 'floor.remove', targetType: 'block', targetId: block_id, details: { floor_number: floorNumber } });
    }, req.user.userId);
    res.json({ message: `Floor ${floorCode(floorNumber)} removed.` });
});

// GET /api/admin/blocks/:block_id/rooms - every room, including inactive ones.
exports.listRooms = asyncHandler(async (req, res) => {
    await requireBlock(req, req.params.block_id);
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
        await requireBlock(req, block_id, client);
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
        if (created.length > 0) {
            await recordAudit(client, req, {
                action: 'room.create',
                targetType: 'block',
                targetId: block_id,
                details: { floor_number, rooms: created, room_type, bed_capacity },
            });
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
        const current = await client.query('SELECT room_id, block_id, is_active, room_type, bed_capacity FROM rooms WHERE room_id = $1 FOR UPDATE', [room_id]);
        if (current.rows.length === 0) {
            throw new AppError(404, 'Room not found.');
        }
        await requireBlock(req, current.rows[0].block_id, client);
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
        const before = current.rows[0];
        const after = updated.rows[0];
        const changes = {};
        for (const key of ['is_active', 'room_type', 'bed_capacity']) {
            if (before[key] !== after[key]) changes[key] = { from: before[key], to: after[key] };
        }
        if (Object.keys(changes).length > 0) {
            const action = changes.is_active ? (after.is_active ? 'room.reopen' : 'room.close') : 'room.update';
            await recordAudit(client, req, { action, targetType: 'room', targetId: room_id, details: changes });
        }
        return { ...after, occupied_beds: occupied };
    }, req.user.userId);

    res.json(room);
});

// ---- Common areas (shared places: washrooms, lifts, corridors ...) -------------------
// The only places MH (the whole men's hostel) and academic blocks like PRP have, and
// the places a resident can report a fault in outside their own room.

// GET /api/infrastructure/blocks/:block_id/common-areas - every area, including closed ones.
exports.listCommonAreas = asyncHandler(async (req, res) => {
    await requireBlock(req, req.params.block_id);
    const result = await db.query(
        `SELECT a.area_id, a.block_id, a.floor_number, a.area_type, a.description, a.is_operational,
                (SELECT COUNT(*) FROM complaints c WHERE c.common_area_id = a.area_id
                   AND c.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'ESCALATED'))::int AS open_tickets
         FROM common_areas a
         WHERE a.block_id = $1
         ORDER BY a.floor_number, a.area_type, a.area_id`,
        [req.params.block_id]
    );
    res.json(result.rows);
});

// POST /api/infrastructure/blocks/:block_id/common-areas { floor_number, area_type, description }
exports.createCommonArea = asyncHandler(async (req, res) => {
    const { block_id } = req.params;
    const { floor_number, area_type, description } = req.body;
    const area = await db.withTransaction(async (client) => {
        await requireBlock(req, block_id, client);
        const floor = await client.query('SELECT 1 FROM block_floors WHERE block_id = $1 AND floor_number = $2', [block_id, floor_number]);
        if (floor.rows.length === 0) {
            throw new AppError(404, `Floor ${floorCode(floor_number)} does not exist in this block. Add the floor first.`);
        }
        const prefix = `${blockCodeOf(block_id)}-F${String(floor_number).padStart(2, '0')}-${AREA_TAGS[area_type]}-`;
        const taken = await client.query('SELECT area_id FROM common_areas WHERE area_id LIKE $1', [`${prefix}%`]);
        const next = taken.rows.reduce((max, r) => Math.max(max, parseInt(r.area_id.slice(prefix.length), 10) || 0), 0) + 1;
        const areaId = `${prefix}${String(next).padStart(2, '0')}`;
        if (areaId.length > 30) throw new AppError(400, 'This block code is too long to name a common area.');
        const inserted = await client.query(
            `INSERT INTO common_areas (area_id, block_id, floor_number, area_type, description)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING area_id, block_id, floor_number, area_type, description, is_operational`,
            [areaId, block_id, floor_number, area_type, description]
        );
        await recordAudit(client, req, {
            action: 'area.create',
            targetType: 'block',
            targetId: block_id,
            details: { area_id: areaId, floor_number, area_type, description },
        });
        return inserted.rows[0];
    }, req.user.userId);
    res.status(201).json(area);
});

// PATCH /api/infrastructure/common-areas/:area_id { is_operational?, description? }
// A closed area is no longer offered when a resident raises a ticket.
exports.updateCommonArea = asyncHandler(async (req, res) => {
    const { area_id } = req.params;
    const { is_operational, description } = req.body;
    const area = await db.withTransaction(async (client) => {
        const current = await client.query('SELECT area_id, block_id, description, is_operational FROM common_areas WHERE area_id = $1 FOR UPDATE', [area_id]);
        if (current.rows.length === 0) throw new AppError(404, 'Common area not found.');
        await requireBlock(req, current.rows[0].block_id, client);
        const updated = await client.query(
            `UPDATE common_areas SET is_operational = COALESCE($2, is_operational), description = COALESCE($3, description)
             WHERE area_id = $1 RETURNING area_id, block_id, floor_number, area_type, description, is_operational`,
            [area_id, is_operational ?? null, description ?? null]
        );
        const before = current.rows[0];
        const after = updated.rows[0];
        const changes = {};
        for (const key of ['is_operational', 'description']) {
            if (before[key] !== after[key]) changes[key] = { from: before[key], to: after[key] };
        }
        if (Object.keys(changes).length > 0) {
            await recordAudit(client, req, {
                action: changes.is_operational ? (after.is_operational ? 'area.reopen' : 'area.close') : 'area.update',
                targetType: 'block',
                targetId: after.block_id,
                details: { area_id, ...changes },
            });
        }
        return after;
    }, req.user.userId);
    res.json(area);
});
