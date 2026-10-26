const { body, param, query, validationResult } = require('express-validator');
const { isAllowedStudentEmail, isValidStudentRegNo, studentEmailDomains, PRIVACY_NOTICE_VERSION } = require('../config/identity');

const { ROLES } = require('../config/roles');
const SPECIALIZATIONS = ['CLEANING', 'ELECTRICIAN', 'CARPENTER', 'AC_TECH', 'PLUMBER'];
const TICKET_SCOPES = ['ROOM', 'COMMON_AREA'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY'];
const SLA_FILTERS = ['ON_TRACK', 'AT_RISK', 'OVERDUE', 'MET', 'BREACHED'];
const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'COMPLETED', 'ESCALATED', 'REJECTED', 'CANCELLED'];

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

// Hostel details are all-or-nothing: a student names block, floor and room
// together. They are a REQUEST for an allotment - the hostel office decides.
const roomRequestRules = [
    body('block_id').optional({ values: 'null' }).isString().trim().notEmpty().isLength({ max: 10 }).withMessage('block_id is invalid.'),
    body('floor_number').optional({ values: 'null' }).isInt({ min: 0, max: 99 }).withMessage('floor_number is invalid.').toInt(),
    body('room_id').optional({ values: 'null' }).isString().trim().notEmpty().isLength({ max: 20 }).withMessage('room_id is invalid.'),
    body().custom((v) => {
        const given = ['block_id', 'floor_number', 'room_id'].filter((k) => v && v[k] !== undefined && v[k] !== null);
        return given.length === 0 || given.length === 3;
    }).withMessage('Choose a block, a floor and a room together.'),
];

// Students prove they belong to the university: their address must be on a
// student mail domain (and is then verified by an emailed code), and their
// registration number must have the university's format.
const studentIdentityRules = (onlyIf) => {
    // A condition must come first in a chain: .if() only gates what follows it.
    const field = (name) => (onlyIf ? body(name).if(onlyIf) : body(name));
    return [
        field('email')
            .custom((value) => isAllowedStudentEmail(value))
            .withMessage(() => `Use your university email address (ending in @${studentEmailDomains().join(' or @')}).`),
        field('reg_or_emp_id')
            .custom((value) => isValidStudentRegNo(value))
            .withMessage('Enter your registration number as printed on your ID card, e.g. 21BCE0843.'),
    ];
};

const registerValidators = [...userProfileRules, ...studentIdentityRules(), ...roomRequestRules, handleValidation];

const verifyEmailValidators = [
    body('reg_or_emp_id').isString().trim().notEmpty().withMessage('reg_or_emp_id is required.').bail().isLength({ max: 30 }).toUpperCase(),
    body('code').isString().trim().matches(/^\d{6}$/).withMessage('Enter the 6-digit code from the email.'),
    handleValidation,
];

const resendCodeValidators = [
    body('reg_or_emp_id').isString().trim().notEmpty().withMessage('reg_or_emp_id is required.').bail().isLength({ max: 30 }).toUpperCase(),
    handleValidation,
];

// ---- Student profile (onboarding) ----------------------------------------------

const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'];
const CLEANING_SLOTS = ['MORNING', 'AFTERNOON', 'EVENING', 'ANY'];
const LANGUAGES = ['en', 'hi', 'ta', 'te'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const PHONE = /^\d{10}$/;

const yearsBetween = (from, to) => (to - from) / (365.25 * 24 * 3600 * 1000);

const profileValidators = [
    body('school').isString().trim().notEmpty().withMessage('Choose your school.').bail().isLength({ max: 20 }).toUpperCase(),
    body('programme').isString().trim().notEmpty().withMessage('Enter your programme, e.g. B.Tech CSE.').bail().isLength({ max: 100 }),
    body('admission_year')
        .isInt()
        .withMessage('Enter your year of admission.')
        .bail()
        .toInt()
        .custom((y) => y >= new Date().getFullYear() - 8 && y <= new Date().getFullYear() + 1)
        .withMessage('Year of admission looks wrong.'),
    body('expected_graduation_year')
        .isInt()
        .withMessage('Enter your expected graduation year.')
        .bail()
        .toInt()
        .custom((y, { req }) => y >= Number(req.body.admission_year) && y <= Number(req.body.admission_year) + 7)
        .withMessage('Graduation year must be within 7 years after admission.'),
    body('gender').isIn(GENDERS).withMessage('Choose a gender option.'),
    body('date_of_birth')
        .isISO8601({ strict: true })
        .withMessage('Enter your date of birth.')
        .bail()
        .custom((d) => {
            const age = yearsBetween(new Date(d).getTime(), Date.now());
            return age >= 15 && age <= 70;
        })
        .withMessage('Date of birth looks wrong.'),
    body('guardian_name').isString().trim().notEmpty().withMessage("Enter a parent or guardian's name.").bail().isLength({ max: 100 }),
    body('guardian_relation').isString().trim().notEmpty().withMessage('Enter how they are related to you.').bail().isLength({ max: 30 }),
    body('guardian_phone').isString().trim().matches(PHONE).withMessage("The guardian's phone must be 10 digits."),
    body('local_guardian_name').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
    body('local_guardian_phone').optional({ values: 'falsy' }).isString().trim().matches(PHONE).withMessage("The local guardian's phone must be 10 digits."),
    body('permanent_city').isString().trim().notEmpty().withMessage('Enter your home city.').bail().isLength({ max: 60 }),
    body('permanent_state').isString().trim().notEmpty().withMessage('Enter your home state.').bail().isLength({ max: 60 }),
    body('permanent_pincode').isString().trim().matches(/^[1-9]\d{5}$/).withMessage('Enter a 6-digit PIN code.'),
    body('preferred_cleaning_slot').optional().isIn(CLEANING_SLOTS).withMessage(`preferred_cleaning_slot must be one of: ${CLEANING_SLOTS.join(', ')}.`),
    body('preferred_language').optional().isIn(LANGUAGES).withMessage(`preferred_language must be one of: ${LANGUAGES.join(', ')}.`),
    body('health_consent').optional().isBoolean({ strict: true }).withMessage('health_consent must be true or false.'),
    body('blood_group').optional({ values: 'falsy' }).isIn(BLOOD_GROUPS).withMessage('Choose a valid blood group.'),
    body('medical_notes').optional({ values: 'falsy' }).isString().isLength({ max: 500 }).withMessage('Medical notes must be at most 500 characters.'),
    body().custom((v) => v.health_consent === true || (!v.blood_group && !v.medical_notes))
        .withMessage('Health details are only kept if you agree to share them with the wardens.'),
    body('privacy_consent').custom((v) => v === true).withMessage('You need to accept the privacy notice to continue.'),
    body('privacy_notice_version')
        .custom((v) => v === PRIVACY_NOTICE_VERSION)
        .withMessage('The privacy notice has changed. Reload the page and read the current version.'),
    handleValidation,
];

const roomRequestValidators = [
    body('block_id').isString().trim().notEmpty().isLength({ max: 10 }).withMessage('block_id is required.'),
    body('floor_number').isInt({ min: 0, max: 99 }).withMessage('floor_number is required.').toInt(),
    body('room_id').isString().trim().notEmpty().isLength({ max: 20 }).withMessage('room_id is required.'),
    handleValidation,
];

const declineRoomRequestValidators = [
    param('student_id').trim().notEmpty().isLength({ max: 36 }).withMessage('student id is invalid.'),
    body('reason').isString().trim().isLength({ min: 5, max: 300 }).withMessage('Give a reason of 5 to 300 characters.'),
    handleValidation,
];

const loginValidators = [
    body('reg_or_emp_id').isString().withMessage('reg_or_emp_id is required.').bail().trim().notEmpty().withMessage('reg_or_emp_id is required.').bail().isLength({ max: 30 }),
    body('password').exists({ checkFalsy: true }).withMessage('password is required.').bail().isString(),
    handleValidation,
];

const forgotPasswordValidators = [
    body('reg_or_emp_id').isString().withMessage('reg_or_emp_id is required.').bail().trim().notEmpty().withMessage('reg_or_emp_id is required.').bail().isLength({ max: 30 }),
    handleValidation,
];

const resetPasswordValidators = [
    body('token').isString().withMessage('token is required.').bail().isLength({ min: 20, max: 2000 }).withMessage('token is invalid.'),
    newPassword('new_password'),
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
    query('sla').optional().isIn(SLA_FILTERS).withMessage(`sla must be one of: ${SLA_FILTERS.join(', ')}.`),
    query('q').optional().isString().trim().isLength({ max: 100 }).withMessage('q must be at most 100 characters.'),
    query('limit').optional().isInt({ min: 1, max: 500 }).withMessage('limit must be between 1 and 500.').toInt(),
    query('offset').optional().isInt({ min: 0 }).withMessage('offset must be 0 or more.').toInt(),
    handleValidation,
];

const complaintIdParam = param('id').trim().notEmpty().isLength({ max: 36 }).withMessage('complaint id is invalid.');

const complaintIdParamValidators = [complaintIdParam, handleValidation];

// Photos are stored under the ticket id, so here it must be a real UUID.
const photoParamValidators = [param('id').isUUID().withMessage('complaint id is invalid.'), handleValidation];

const rejectComplaintValidators = [
    complaintIdParam,
    body('reason')
        .isString()
        .withMessage('reason is required.')
        .bail()
        .trim()
        .isLength({ min: 5, max: 300 })
        .withMessage('Give a reason of 5 to 300 characters; the people who reported the issue will see it.'),
    handleValidation,
];

const mergeComplaintValidators = [
    complaintIdParam,
    body('target_id').isString().withMessage('target_id is required.').bail().trim().notEmpty().isLength({ max: 36 }),
    handleValidation,
];

const assignTechnicianValidators = [
    body('complaint_id').trim().notEmpty().withMessage('complaint_id is required.'),
    body('staff_user_id').trim().notEmpty().withMessage('staff_user_id is required.'),
    // Optimistic concurrency: who the caller believes holds the ticket now
    // (null = nobody). Omit it to skip the check (older clients).
    body('expected_assignee_id')
        .optional({ values: 'undefined' })
        .custom((v) => v === null || (typeof v === 'string' && v.length > 0 && v.length <= 36))
        .withMessage('expected_assignee_id must be a user id or null.'),
    body('allow_off_duty').optional().isBoolean({ strict: true }).withMessage('allow_off_duty must be true or false.'),
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

const listNotificationsValidators = [
    query('since').optional().isISO8601().withMessage('since must be an ISO date-time.'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100.').toInt(),
    query('offset').optional().isInt({ min: 0 }).withMessage('offset must be 0 or more.').toInt(),
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
    // Going off duty with open jobs: true hands them back to the supervisor,
    // false keeps them. Required only when there are open jobs.
    body('release_open_jobs').optional().isBoolean({ strict: true }).withMessage('release_open_jobs must be true or false.'),
    handleValidation,
];

// ---- /api/admin --------------------------------------------------------------

const userIdParam = param('user_id').trim().notEmpty().isLength({ max: 36 }).withMessage('user id is invalid.');

const adminCreateUserValidators = [
    ...userProfileRules, // same rules as registration...
    body('role').exists().withMessage('role is required.'), // ...but role is mandatory here
    // Students are students whoever creates the account: same identity rules.
    ...studentIdentityRules(body('role').equals('STUDENT')),
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
    body('hostel_type').optional().isIn(['MENS', 'LADIES']).withMessage("hostel_type must be MENS or LADIES."),
    handleValidation,
];

const updateBlockValidators = [
    blockIdParam,
    body('block_name').trim().notEmpty().withMessage('block_name is required.').bail().isLength({ max: 50 }),
    body('hostel_type').optional().isIn(['MENS', 'LADIES']).withMessage("hostel_type must be MENS or LADIES."),
    handleValidation,
];

const blockOnlyValidators = [blockIdParam, handleValidation];

// ---- Campus organisation (migration 011) -----------------------------------------

const SHIFTS = ['MORNING', 'EVENING', 'NIGHT'];

const staffPlacementValidators = [
    param('user_id').trim().notEmpty().isLength({ max: 36 }).withMessage('user id is invalid.'),
    body('home_block_id').optional({ values: 'null' }).isString().trim().notEmpty().isLength({ max: 10 }).withMessage('home_block_id is invalid.'),
    body('shift').optional({ values: 'null' }).isIn(SHIFTS).withMessage(`shift must be one of: ${SHIFTS.join(', ')}.`),
    body().custom((v) => v && (v.home_block_id !== undefined || v.shift !== undefined)).withMessage('Send home_block_id and/or shift.'),
    handleValidation,
];

const supervisorBlocksValidators = [
    param('user_id').trim().notEmpty().isLength({ max: 36 }).withMessage('user id is invalid.'),
    body('block_ids').isArray({ max: 50 }).withMessage('block_ids must be a list of block ids.'),
    body('block_ids.*').isString().trim().notEmpty().isLength({ max: 10 }).withMessage('block_ids must be a list of block ids.'),
    handleValidation,
];

const leaveValidators = [
    param('user_id').trim().notEmpty().isLength({ max: 36 }).withMessage('user id is invalid.'),
    body('starts_on').isISO8601({ strict: true }).withMessage('starts_on must be a date (YYYY-MM-DD).'),
    body('ends_on')
        .isISO8601({ strict: true })
        .withMessage('ends_on must be a date (YYYY-MM-DD).')
        .bail()
        .custom((v, { req }) => v >= req.body.starts_on)
        .withMessage('Leave cannot end before it starts.'),
    body('reason').optional({ values: 'null' }).isString().isLength({ max: 200 }).withMessage('reason must be at most 200 characters.'),
    handleValidation,
];

const leaveIdValidators = [param('leave_id').isInt({ min: 1 }).withMessage('leave id is invalid.').toInt(), handleValidation];
const userIdOnlyValidators = [param('user_id').trim().notEmpty().isLength({ max: 36 }).withMessage('user id is invalid.'), handleValidation];

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
    verifyEmailValidators,
    resendCodeValidators,
    profileValidators,
    loginValidators,
    forgotPasswordValidators,
    resetPasswordValidators,
    createComplaintValidators,
    listComplaintsValidators,
    complaintIdParamValidators,
    photoParamValidators,
    rejectComplaintValidators,
    mergeComplaintValidators,
    assignTechnicianValidators,
    autoDispatchValidators,
    assignmentIdParamValidators,
    feedbackValidators,
    blockIdParamValidators,
    listStaffValidators,
    listNotificationsValidators,
    roomRequestValidators,
    declineRoomRequestValidators,
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
    staffPlacementValidators,
    supervisorBlocksValidators,
    leaveValidators,
    leaveIdValidators,
    userIdOnlyValidators,
    blockOnlyValidators,
    addFloorValidators,
    removeFloorValidators,
    createRoomsValidators,
    updateRoomValidators,
};
