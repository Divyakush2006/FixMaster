const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');
const mailer = require('./mailer');
const { EMAIL_CODE_TTL_MINUTES, EMAIL_CODE_MAX_ATTEMPTS, EMAIL_CODE_RESEND_SECONDS } = require('../config/identity');

// Six-digit codes emailed to a new student's university address. Only a keyed
// hash is stored (HMAC with the server secret, bound to the user), so a copy
// of the table does not reveal codes. Only the newest code of a user counts;
// each one works once, for EMAIL_CODE_TTL_MINUTES, and dies after
// EMAIL_CODE_MAX_ATTEMPTS wrong guesses (1 in 200,000 per code).

const hashCode = (userId, code) => crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${userId}:${code}`).digest('hex');

const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

/**
 * Creates a fresh code for `user` inside the caller's transaction and returns
 * it (to be emailed after commit). Refuses when the previous code is younger
 * than EMAIL_CODE_RESEND_SECONDS, unless `force` (first code at registration).
 */
async function issueCode(client, user, { force = false } = {}) {
    if (!force) {
        const recent = await client.query(
            `SELECT 1 FROM email_verifications
             WHERE user_id = $1 AND created_at > NOW() - make_interval(secs => $2)`,
            [user.user_id, EMAIL_CODE_RESEND_SECONDS]
        );
        if (recent.rows.length > 0) return null;
    }
    const code = newCode();
    await client.query(
        `INSERT INTO email_verifications (user_id, code_hash, expires_at)
         VALUES ($1, $2, NOW() + make_interval(mins => $3))`,
        [user.user_id, hashCode(user.user_id, code), EMAIL_CODE_TTL_MINUTES]
    );
    return code;
}

function sendCode(user, code) {
    return mailer.sendMail({
        to: user.email,
        subject: `${code} is your FixMaster verification code`,
        text:
            `Hello ${user.full_name},\n\n` +
            `Your FixMaster verification code is ${code}. It works once, for ${EMAIL_CODE_TTL_MINUTES} minutes.\n\n` +
            `Enter it on the sign-up page to confirm this is your university address. ` +
            `If you did not create a FixMaster account, ignore this message.\n`,
    });
}

const REFUSED = 'That code is wrong or has expired. Check the latest email, or ask for a new code.';

/**
 * Checks `code` against the user's newest code inside the caller's
 * transaction. Wrong guesses are counted even though the request fails, so
 * the attempt counter is updated in its own statement before throwing.
 */
async function consumeCode(client, userId, code) {
    const { rows } = await client.query(
        `SELECT verification_id, code_hash, expires_at, attempts, consumed_at
         FROM email_verifications WHERE user_id = $1
         ORDER BY created_at DESC, verification_id DESC LIMIT 1
         FOR UPDATE`,
        [userId]
    );
    const row = rows[0];
    if (!row || row.consumed_at || row.expires_at <= new Date() || row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        throw new AppError(400, REFUSED, { code: 'CODE_INVALID' });
    }
    const expected = Buffer.from(row.code_hash, 'hex');
    const given = Buffer.from(hashCode(userId, String(code)), 'hex');
    if (!crypto.timingSafeEqual(expected, given)) {
        return { ok: false, verificationId: row.verification_id };
    }
    await client.query('UPDATE email_verifications SET consumed_at = NOW() WHERE verification_id = $1', [row.verification_id]);
    return { ok: true };
}

module.exports = { issueCode, sendCode, consumeCode, REFUSED };
