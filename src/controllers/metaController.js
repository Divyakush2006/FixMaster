const db = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');

exports.getBlocks = asyncHandler(async (req, res) => {
    const result = await db.query('SELECT * FROM hostel_blocks ORDER BY block_id ASC');
    res.json(result.rows);
});

exports.getRoomsByBlock = asyncHandler(async (req, res) => {
    const { block_id } = req.params;
    const result = await db.query(
        'SELECT * FROM rooms WHERE block_id = $1 AND is_active = TRUE ORDER BY floor_number, room_number',
        [block_id]
    );
    res.json(result.rows);
});

// Previously unfiltered: no dropdown for a facility that had no rooms/it
// was fine, but common areas were entirely unreachable from the API (no
// endpoint existed at all - filing a COMMON_AREA complaint required
// already knowing the area_id out of band).
exports.getCommonAreasByBlock = asyncHandler(async (req, res) => {
    const { block_id } = req.params;
    const result = await db.query(
        'SELECT * FROM common_areas WHERE block_id = $1 AND is_operational = TRUE ORDER BY floor_number, area_type',
        [block_id]
    );
    res.json(result.rows);
});

// Roster of maintenance staff for the supervisor's manual-assign picker.
// Previously there was no way to discover staff_user_id values at all short
// of querying the database directly, which made POST /dispatch/assign
// unusable from any client.
exports.getStaff = asyncHandler(async (req, res) => {
    const { specialization } = req.query;

    let query = `
        SELECT
            u.user_id,
            u.full_name,
            u.specialization,
            u.is_available,
            (COUNT(ca.assignment_id) FILTER (WHERE ca.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')))::int AS active_task_count
        FROM users u
        LEFT JOIN complaint_assignments ca ON ca.staff_user_id = u.user_id
        WHERE u.role = 'STAFF' AND u.is_active = TRUE
    `;
    const params = [];
    if (specialization) {
        params.push(specialization);
        query += ` AND u.specialization = $${params.length}`;
    }
    query += ` GROUP BY u.user_id ORDER BY u.full_name ASC`;

    const result = await db.query(query, params);
    res.json(result.rows);
});

exports.getCategoriesWithSubcategories = asyncHandler(async (req, res) => {
    // Fixes two bugs in the original query:
    //   1. No ORDER BY - Postgres does not guarantee GROUP BY output order,
    //      so a dropdown built from this reshuffled between requests.
    //   2. A category with zero subcategories produced `subcategories: [null]`
    //      (json_agg over an all-NULL group), an array containing a null
    //      rather than an empty array - the FILTER clause below fixes that.
    const query = `
      SELECT
        c.category_id,
        c.category_name,
        c.category_code,
        c.is_quick_action,
        COALESCE(
          json_agg(
            json_build_object(
              'subcategory_id', s.subcategory_id,
              'issue_name', s.issue_name,
              'priority_level', s.priority_level,
              'required_specialization', s.required_specialization
            )
          ) FILTER (WHERE s.subcategory_id IS NOT NULL),
          '[]'
        ) AS subcategories
      FROM complaint_categories c
      LEFT JOIN complaint_subcategories s ON c.category_id = s.category_id
      GROUP BY c.category_id
      ORDER BY c.category_id;
    `;
    const result = await db.query(query);
    res.json(result.rows);
});
