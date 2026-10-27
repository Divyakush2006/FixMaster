const nodemailer = require('nodemailer');

// Outbound email: sign-up codes and password-reset links.
//
// Either one address ...
//   SMTP_URL    e.g. smtp://login:key@smtp-relay.brevo.com:587 (user and password URL-encoded; never committed)
// ... or the parts, which need no encoding (use this when the login is an email address):
//   SMTP_HOST   e.g. smtp-relay.brevo.com
//   SMTP_PORT   587 (STARTTLS, the default) or 465 (TLS from the start)
//   SMTP_USER / SMTP_PASS
//   MAIL_FROM   sender, e.g. "FixMaster <no-reply@your-domain>"; the provider must have verified it
//
// With neither, no email can be sent. In development the message is printed to the
// console instead; in production the feature reports itself as unavailable
// (see isConfigured) rather than pretending to send.

let transport;
let override = null; // tests inject a transport here

/** The nodemailer settings from the environment, or null when no server is configured. */
function smtpSettings(env = process.env) {
    if (env.SMTP_URL) return env.SMTP_URL;
    if (!env.SMTP_HOST) return null;
    const port = Number.parseInt(env.SMTP_PORT, 10) || 587;
    return {
        host: env.SMTP_HOST,
        port,
        secure: port === 465, // 587 upgrades with STARTTLS, which nodemailer negotiates on its own
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
    };
}

function getTransport() {
    if (override) return override;
    if (!transport) transport = nodemailer.createTransport(smtpSettings());
    return transport;
}

const isProduction = () => process.env.NODE_ENV === 'production';

/** True when a message sent now would actually reach (or, in development, be shown to) someone. */
function isConfigured() {
    return !!(override || smtpSettings() || (!isProduction() && process.env.NODE_ENV !== 'test'));
}

async function sendMail({ to, subject, text }) {
    if (!override && !smtpSettings()) {
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

module.exports = { isConfigured, sendMail, setTransportForTests, smtpSettings };
