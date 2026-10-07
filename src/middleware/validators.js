const { body, param, query, validationResult } = require('express-validator');

const ROLES = ['STUDENT', 'STAFF', 'SUPERVISOR', 'ADMIN'];
const SPECIALIZATIONS = ['CLEANING', 'ELECTRICIAN', 'CARPENTER', 'AC_TECH', 'PLUMBER'];
const TICKET_SCOPES = ['ROOM', 'COMMON_AREA'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY'];
const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'COMPLETED', 'ESCALATED', 'REJECTED'];

// bcrypt only uses the first 72 BYTES of a password and silently ignores the
// rest, so two passwords sharing a 72-byte prefix are interchangeable.
// Reject longer ones outright instead of pretending they are fully checked.
const BCRYPT_MAX_BYTES = 72;

/** Runs after a validation chain; returns a single friendly 400 on the first failure. */
function handleValidation(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array({ onlyFirstError: true })[0].msg });
    }
    next();
}

// Passwords that pass the length/character rules but are guessed first.
const COMMON_PASSWORDS = new Set([
    'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword1', 'qwerty123', 'qwerty12',
    'abc12345', 'abcd1234', 'abcdef12', 'admin123', 'admin1234', 'welcome1', 'welcome123', 'letmein1',
    'iloveyou1', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'test1234', 'vit12345', 'hostel123', 'student123',
]);

/**
 * Password policy for every place a password is set (registration, admin
 * create/reset, self-service change): 8-72 bytes, at least one letter and one
 * digit, not a well-known password and not the account's own ID.
 */
const newPassword = (field) =>
    body(field)
        .isString()
        .withMessage(`${field} is required.`)
        .bail()
        .isLength({ min: 8 })
        .withMessage(`${field} must be at least 8 characters.`)
        .bail()
        .custom((value) => Buffer.byteLength(value, 'utf8') <= BCRYPT_MAX_BYTES)
        .withMessage(`${field} must be at most ${BCRYPT_MAX_BYTES} bytes.`)
        .bail()
        .custom((value) => /\p{L}/u.test(value) && /\d/.test(value))
        .withMessage(`${field} must contain at least one letter and one number.`)
        .bail()
        .custom((value) => !COMMON_PASSWORDS.has(value.toLowerCase()))
        .withMessage(`${field} is too common. Choose a less predictable password.`)
        .bail()
        .custom((value, { req }) => {
            const id = typeof req.body.reg_or_emp_id === 'string' ? req.body.reg_or_emp_id.trim().toUpperCase() : '';
            return !id || !value.toUpperCase().includes(id);
        })
        .withMessage(`${field} must not contain the account ID.`);

// Login IDs are case-insensitive and stored upper-case (migration 002 adds a
// case-insensitive unique index), so '21bce0843' and '21BCE0843' are one user.
const regOrEmpId = () =>
    body('reg_or_emp_id')
        .trim()
        .notEmpty()
        .withMessage('reg_or_emp_id is required.')
        .bail()
        .toUpperCase()
        .matches(/^[A-Z0-9_-]{3,30}$/)
        .withMessage('reg_or_emp_id must be 3-30 letters, digits, "_" or "-".');

// Emails are stored lower-case. Deliberately NOT normalizeEmail(): its
// defaults rewrite addresses (they strip dots and +tags from Gmail), which
// stored a different address than the one the user typed.
const email = () =>
    body('email')
        .trim()
        .isEmail()
        .withMessage('A valid email is required.')
        .bail()
        .isLength({ max: 100 })
        .withMessage('email must be at most 100 characters.')
        .toLowerCase();

const userProfileRules = [
    regOrEmpId(),
    body('full_name').trim().notEmpty().withMessage('full_name is required.').bail().isLength({ max: 100 }),
    email(),
    body('phone_number').trim().matches(/^\d{10}$/).withMessage('phone_number must be exactly 10 digits.'),
    newPassword('password'),
    body('role').optional().isIn(ROLES).withMessage(`role must be one of: ${ROLES.join(', ')}.`),
    body('specialization')
        .optional({ nullable: true })
        .isIn(SPECIALIZATIONS)
        .withMessage(`specialization must be one of: ${SPECIALIZATIONS.join(', ')}.`),
];

const registerValidators = [...userProfileRules, handleValidation];

const loginValidators = [
    body('reg_or_emp_id').isString().withMessage('reg_or_emp_id is required.').bail().trim().notEmpty().withMessage('reg_or_emp_id is required.').bail().isLength({ max: 30 }),
    body('password').exists({ checkFalsy: true }).withMessage('password is required.').bail().isString(),
    handleValidation,
];

const createComplaintValidators = [
    body('ticket_scope').isIn(TICKET_SCOPES).withMessage(`ticket_scope must be one of: ${TICKET_SCOPES.join(', ')}.`),
    body('block_id').trim().notEmpty().withMessage('block_id is required.'),
    body('subcategory_id').isInt({ min: 1 }).withMessage('subcategory_id must be a positive integer.').toInt(),
    body('room_id')
        .if(body('ticket_scope').equals('ROOM'))
        .trim()
        .notEmpty()
        .withMessage('room_id is required when ticket_scope is ROOM.'),
    body('common_area_id')
        .if(body('ticket_scope').equals('COMMON_AREA'))
        .trim()
        .notEmpty()
        .withMessage('common_area_id is required when ticket_scope is COMMON_AREA.'),
    body('description')
        .optional({ nullable: true })
        .isString()
        .isLength({ max: 500 })
        .withMessage('description must be at most 500 characters.'),
    // Only http(s) links. Anything else - notably `javascript:` - would be
    // stored and later rendered as a clickable link in the UI (stored XSS).
    body('photo_evidence_url')
        .optional({ nullable: true, checkFalsy: true })
        .isURL({ protocols: ['http', 'https'], require_protocol: true })
        .withMessage('photo_evidence_url must be an http(s) URL.')
        .bail()
        .isLength({ max: 255 })
        .withMessage('photo_evidence_url must be at most 255 characters.'),
    body('priority').optional({ nullable: true }).isIn(PRIORITIES).withMessage(`priority must be one of: ${PRIORITIES.join(', ')}.`),
    body('preferred_timeslot').optional({ nullable: true }).isString().isLength({ max: 50 }),
    handleValidation,
];

const listComplaintsValidators = [
    query('status').optional().isIn(STATUSES).withMessage(`status must be one of: ${STATUSES.join(', ')}.`),
    query('block_id').optional().trim().notEmpty(),
    query('q').optional().isString().trim().isLength({ max: 100 }).withMessage('q must be at most 100 characters.'),
    query('limit').optional().isInt({ min: 1, max: 500 }).withMessage('limit must be between 1 and 500.').toInt(),
    query('offset').optional().isInt({ min: 0 }).withMessage('offset must be 0 or more.').toInt(),
    handleValidation,
];

const complaintIdParamValidators = [
    param('id').trim().notEmpty().isLength({ max: 36 }).withMessage('complaint id is invalid.'),
    handleValidation,
];

const assignTechnicianValidators = [
    body('complaint_id').trim().notEmpty().withMessage('complaint_id is required.'),
    body('staff_user_id').trim().notEmpty().withMessage('staff_user_id is required.'),
    handleValidation,
];

const autoDispatchValidators = [
    body('complaint_id').trim().notEmpty().withMessage('complaint_id is required.'),
    handleValidation,
];

const assignmentIdParamValidators = [
    param('assignment_id').isInt({ min: 1 }).withMessage('assignment_id must be a positive integer.'),
    handleValidation,
];

const feedbackValidators = [
    body('complaint_id').trim().notEmpty().withMessage('complaint_id is required.'),
    body('is_satisfied').isBoolean({ strict: true }).withMessage('is_satisfied must be true or false.'),
    body('rating').optional({ nullable: true }).isInt({ min: 1, max: 5 }).withMessage('rating must be between 1 and 5.').toInt(),
    body('comments').optional({ nullable: true }).isString().isLength({ max: 1000 }),
    handleValidation,
];

const blockIdParamValidators = [
    param('block_id').trim().notEmpty().withMessage('block_id is required.'),
    handleValidation,
];

const listStaffValidators = [
    query('specialization').optional().isIn(SPECIALIZATIONS).withMessage(`specialization must be one of: ${SPECIALIZATIONS.join(', ')}.`),
    handleValidation,
];

// ---- /api/me -----------------------------------------------------------------

const changePasswordValidators = [
    body('current_password').isString().notEmpty().withMessage('current_password is required.'),
    newPassword('new_password'),
    handleValidation,
];

const availabilityValidators = [
    body('is_available').isBoolean({ strict: true }).withMessage('is_available must be true or false.'),
    handleValidation,
];

// ---- /api/admin --------------------------------------------------------------

const userIdParam = param('user_id').trim().notEmpty().isLength({ max: 36 }).withMessage('user id is invalid.');

const adminCreateUserValidators = [
    ...userProfileRules, // same rules as registration...
    body('role').exists().withMessage('role is required.'), // ...but role is mandatory here
    handleValidation,
];

const pageQuery = (max) => [
    query('limit').optional().isInt({ min: 1, max }).withMessage(`limit must be between 1 and ${max}.`).toInt(),
    query('offset').optional().isInt({ min: 0 }).withMessage('offset must be 0 or more.').toInt(),
];

const adminListUsersValidators = [
    query('role').optional().isIn(ROLES).withMessage(`role must be one of: ${ROLES.join(', ')}.`),
    query('status').optional().isIn(['active', 'deactivated', 'locked']).withMessage('status must be active, deactivated or locked.'),
    query('q').optional().isString().isLength({ max: 100 }).withMessage('q must be at most 100 characters.'),
    ...pageQuery(200),
    handleValidation,
];

const adminListAllotmentsValidators = [
    query('block_id').optional().isString().isLength({ max: 10 }),
    query('student_id').optional().isString().isLength({ max: 36 }),
    query('q').optional().isString().isLength({ max: 100 }).withMessage('q must be at most 100 characters.'),
    ...pageQuery(200),
    handleValidation,
];

const AUDIT_ACTION = /^[a-z_]+(\.[a-z_]+)*$/;
const adminAuditValidators = [
    query('action').optional().matches(AUDIT_ACTION).withMessage('action is invalid.'),
    query('actor').optional().isString().isLength({ max: 36 }),
    query('target_id').optional().isString().isLength({ max: 60 }),
    query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('limit must be between 1 and 200.').toInt(),
    query('offset').optional().isInt({ min: 0 }).withMessage('offset must be 0 or more.').toInt(),
    handleValidation,
];

const adminUpdateUserValidators = [
    userIdParam,
    body('is_active').optional().isBoolean({ strict: true }).withMessage('is_active must be true or false.'),
    body('is_available').optional().isBoolean({ strict: true }).withMessage('is_available must be true or false.'),
    body('unlock').optional().isBoolean({ strict: true }).withMessage('unlock must be true or false.'),
    body().custom((value) => value && (value.is_active !== undefined || value.is_available !== undefined || value.unlock === true))
        .withMessage('Provide is_active, is_available and/or unlock: true.'),
    handleValidation,
];

const adminResetPasswordValidators = [userIdParam, newPassword('new_password'), handleValidation];

const adminAllotValidators = [
    body('student_id').trim().notEmpty().withMessage('student_id is required.'),
    body('room_id').trim().notEmpty().withMessage('room_id is required.'),
    body('academic_year')
        .trim()
        .matches(/^\d{4}-\d{4}$/)
        .withMessage('academic_year must look like 2026-2027.'),
    handleValidation,
];

const adminEndAllotmentValidators = [
    param('student_id').trim().notEmpty().withMessage('student id is required.'),
    handleValidation,
];

// ---- /api/admin infrastructure (blocks, floors, rooms) -------------------------

const ROOM_TYPES = ['AC', 'NON_AC', 'DELUXE_AC'];
const blockIdParam = param('block_id').trim().notEmpty().isLength({ max: 10 }).withMessage('block id is invalid.');

const createBlockValidators = [
    body('block_code')
        .trim()
        .toUpperCase()
        .matches(/^[A-Z0-9]{1,3}$/)
        .withMessage('block_code must be 1-3 letters or digits, e.g. "A" or "PRP".'),
    body('block_name').trim().notEmpty().withMessage('block_name is required.').bail().isLength({ max: 50 }),
    body('top_floor').optional().isInt({ min: 1, max: 99 }).withMessage('top_floor must be between 1 and 99.').toInt(),
    handleValidation,
];

const updateBlockValidators = [
    blockIdParam,
    body('block_name').trim().notEmpty().withMessage('block_name is required.').bail().isLength({ max: 50 }),
    handleValidation,
];

const blockOnlyValidators = [blockIdParam, handleValidation];

const addFloorValidators = [
    blockIdParam,
    body('floor_number').optional({ nullable: true }).isInt({ min: 0, max: 99 }).withMessage('floor_number must be 0 (ground) to 99.').toInt(),
    handleValidation,
];

const removeFloorValidators = [
    blockIdParam,
    param('floor_number').isInt({ min: 0, max: 99 }).withMessage('floor_number must be 0 (ground) to 99.'),
    handleValidation,
];

const createRoomsValidators = [
    blockIdParam,
    body('floor_number').isInt({ min: 0, max: 99 }).withMessage('floor_number must be 0 (ground) to 99.').toInt(),
    body('from').isInt({ min: 1, max: 99 }).withMessage('from must be a room number 1-99 on that floor.').toInt(),
    body('to').optional({ nullable: true }).isInt({ min: 1, max: 99 }).withMessage('to must be a room number 1-99 on that floor.').toInt(),
    body('room_type').isIn(ROOM_TYPES).withMessage(`room_type must be one of: ${ROOM_TYPES.join(', ')}.`),
    body('bed_capacity').isInt({ min: 1, max: 6 }).withMessage('bed_capacity must be 1-6.').toInt(),
    handleValidation,
];

const updateRoomValidators = [
    param('room_id').trim().notEmpty().isLength({ max: 20 }).withMessage('room id is invalid.'),
    body('is_active').optional().isBoolean({ strict: true }).withMessage('is_active must be true or false.'),
    body('room_type').optional().isIn(ROOM_TYPES).withMessage(`room_type must be one of: ${ROOM_TYPES.join(', ')}.`),
    body('bed_capacity').optional().isInt({ min: 1, max: 6 }).withMessage('bed_capacity must be 1-6.').toInt(),
    body()
        .custom((v) => v && (v.is_active !== undefined || v.room_type !== undefined || v.bed_capacity !== undefined))
        .withMessage('Provide is_active, room_type and/or bed_capacity.'),
    handleValidation,
];

module.exports = {
    ROLES,
    SPECIALIZATIONS,
    handleValidation,
    registerValidators,
    loginValidators,
    createComplaintValidators,
    listComplaintsValidators,
    complaintIdParamValidators,
    assignTechnicianValidators,
    autoDispatchValidators,
    assignmentIdParamValidators,
    feedbackValidators,
    blockIdParamValidators,
    listStaffValidators,
    changePasswordValidators,
    availabilityValidators,
    adminCreateUserValidators,
    adminListUsersValidators,
    adminListAllotmentsValidators,
    adminAuditValidators,
    adminUpdateUserValidators,
    adminResetPasswordValidators,
    adminAllotValidators,
    adminEndAllotmentValidators,
    createBlockValidators,
    updateBlockValidators,
    blockOnlyValidators,
    addFloorValidators,
    removeFloorValidators,
    createRoomsValidators,
    updateRoomValidators,
};
