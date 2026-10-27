/**
 * Who may register as a student, and the rules for proving it.
 *
 *   STUDENT_EMAIL_DOMAINS    comma-separated mail domains that may self-register
 *                            (default: vitstudent.ac.in). Matching is exact on
 *                            the part after "@", so "evil-vitstudent.ac.in" and
 *                            "vitstudent.ac.in.example.com" are refused.
 *   STUDENT_REG_NO_PATTERN   registration-number format (default: VIT, e.g.
 *                            21BCE0843 = two-digit year, three-letter
 *                            programme, four-digit number).
 *   EMAIL_CODE_TTL_MINUTES   how long an emailed code works (default 15)
 *   EMAIL_CODE_MAX_ATTEMPTS  wrong guesses allowed per code (default 5)
 *   EMAIL_CODE_RESEND_SECONDS minimum gap between two codes (default 60)
 *
 * Staff, supervisor and administrator accounts are created by an
 * administrator and are not bound to the student domain: many hostel staff
 * have no university mailbox.
 */

const int = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const studentEmailDomains = () =>
    (process.env.STUDENT_EMAIL_DOMAINS || 'vitstudent.ac.in')
        .split(',')
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean);

function isAllowedStudentEmail(email) {
    const at = String(email || '').lastIndexOf('@');
    if (at < 1) return false;
    return studentEmailDomains().includes(String(email).slice(at + 1).toLowerCase());
}

/** Where the web app lives, for links in emails and redirects (APP_URL, else the first CORS origin). */
const appBaseUrl = () => (process.env.APP_URL || (process.env.CORS_ORIGIN || '').split(',')[0] || 'http://localhost:3000').trim().replace(/\/+$/, '');

const regNoPattern = () => new RegExp(process.env.STUDENT_REG_NO_PATTERN || '^[0-9]{2}[A-Z]{3}[0-9]{4}$');

const isValidStudentRegNo = (regNo) => regNoPattern().test(String(regNo || '').toUpperCase());

/** "kavya.r2024@vitstudent.ac.in" -> "ka***@vitstudent.ac.in" */
function maskEmail(email) {
    const [local, domain] = String(email).split('@');
    return `${local.slice(0, 2)}***@${domain}`;
}

// The privacy notice students accept during onboarding. Bump the version when
// its text changes; profiles record which version they consented to.
const PRIVACY_NOTICE_VERSION = '2026-10';

module.exports = {
    appBaseUrl,
    studentEmailDomains,
    isAllowedStudentEmail,
    isValidStudentRegNo,
    maskEmail,
    PRIVACY_NOTICE_VERSION,
    EMAIL_CODE_TTL_MINUTES: int(process.env.EMAIL_CODE_TTL_MINUTES, 15),
    EMAIL_CODE_MAX_ATTEMPTS: int(process.env.EMAIL_CODE_MAX_ATTEMPTS, 5),
    EMAIL_CODE_RESEND_SECONDS: int(process.env.EMAIL_CODE_RESEND_SECONDS, 60),
};
