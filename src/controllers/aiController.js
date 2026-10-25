const { asyncHandler, AppError } = require('../middleware/errorHandler');
const aiTriageService = require('../services/aiTriageService');
const db = require('../config/db');

exports.parseAndTriage = asyncHandler(async (req, res) => {
    const { raw_text, photo_url, student_allotment_room } = req.body;
    const userId = req.user ? req.user.userId : null;

    if (!raw_text || typeof raw_text !== 'string' || !raw_text.trim()) {
        throw new AppError(400, 'Field raw_text is required and must not be empty.');
    }

    let roomNumber = student_allotment_room;
    if (!roomNumber && userId) {
        const allotment = await db.query(
            'SELECT room_id FROM student_room_allotments WHERE student_id = $1 AND is_current = TRUE',
            [userId]
        );
        if (allotment.rows.length > 0) {
            roomNumber = allotment.rows[0].room_id;
        }
    }

    const result = await aiTriageService.parseAndTriage({
        rawText: raw_text,
        photoUrl: photo_url,
        studentRoom: roomNumber,
        studentUserId: userId,
    });

    res.status(200).json(result);
});

const aiAllocationService = require('../services/aiAllocationService');

exports.allocateTechnician = asyncHandler(async (req, res) => {
    const { category_id, subcategory_id, priority, floor_number, preview } = req.body;

    const allocation = await aiAllocationService.allocateTechnician({
        category_id: category_id ? parseInt(category_id, 10) : null,
        subcategory_id: subcategory_id ? parseInt(subcategory_id, 10) : null,
        priority: priority || 'MEDIUM',
        floorNumber: floor_number !== undefined ? parseInt(floor_number, 10) : null,
        preview: preview === true,
    });

    res.status(200).json({
        success: true,
        data: allocation,
        meta: allocation.meta,
    });
});

const aiHealthTracker = require('../services/aiHealthTracker');

/**
 * GET /api/ai/health
 * Returns the current AI service health status.
 * Accessible by SUPERVISOR and ADMIN roles.
 */
exports.getAiHealth = asyncHandler(async (req, res) => {
    const health = aiHealthTracker.getHealth();
    res.status(200).json(health);
});

/**
 * POST /api/ai/simulate-outage
 * Simulates or clears an AI outage for supervisor drills and testing.
 * Accessible by ADMIN and SUPERVISOR.
 */
exports.simulateOutage = asyncHandler(async (req, res) => {
    const { is_down, reason } = req.body;
    aiHealthTracker.setSimulatedDown(is_down !== false, reason || 'Manual drill triggered by supervisor');
    const health = aiHealthTracker.getHealth();
    res.status(200).json({ success: true, message: is_down === false ? 'AI service restored' : 'AI outage simulated', health });
});

