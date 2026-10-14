const nodemailer = require('nodemailer');

// Outbound email, used for password-reset links.
//
//   SMTP_URL   e.g. smtps://user:password@smtp.example.com:465 (never committed)
//   MAIL_FROM  sender, e.g. "FixMaster <no-reply@example.com>"
//
// Without SMTP_URL no email can be sent. In development the message is printed
// to the console instead; in production the feature reports itself as
// unavailable (see isConfigured) rather than pretending to send.

let transport;
let override = null; // tests inject a transport here

function getTransport() {
    if (override) return override;
    if (!transport) transport = nodemailer.createTransport(process.env.SMTP_URL);
    return transport;
}

const isProduction = () => process.env.NODE_ENV === 'production';

/** True when a message sent now would actually reach (or, in development, be shown to) someone. */
function isConfigured() {
    return !!(override || process.env.SMTP_URL || (!isProduction() && process.env.NODE_ENV !== 'test'));
}

async function sendMail({ to, subject, text }) {
    if (!override && !process.env.SMTP_URL) {
        // Development only (isConfigured() is false in production).
        console.log(`[DEV mail] to=${to} subject="${subject}"\n${text}`);
        return;
    }
    await getTransport().sendMail({ from: process.env.MAIL_FROM || 'FixMaster <no-reply@localhost>', to, subject, text });
}

/** Test hook: route mail to a recording transport. Pass null to restore. */
function setTransportForTests(t) {
    override = t;
}

module.exports = { isConfigured, sendMail, setTransportForTests };
