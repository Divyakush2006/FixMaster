#!/usr/bin/env node
/**
 * Checks the outbound email settings, and optionally sends a test message.
 *
 *   npm run mail:check                        connect and sign in to the mail server; sends nothing
 *   npm run mail:check -- --to you@example.com   also sends one short test message
 *
 * Reads the same SMTP_URL / SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM as the API.
 * Passwords are never printed.
 */
const nodemailer = require('nodemailer');
require('dotenv').config({ quiet: true });
const { smtpSettings } = require('../src/services/mailer');

const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
};

/** What the settings point at, without the secret. */
function describe(settings) {
    if (typeof settings === 'string') {
        try {
            const u = new URL(settings);
            return `${u.protocol.replace(':', '')}://${u.hostname}:${u.port || '(default)'} as ${decodeURIComponent(u.username) || '(no login)'}`;
        } catch {
            return 'SMTP_URL (not a valid address: if the login is an email address, encode its @ as %40, or use SMTP_HOST / SMTP_USER / SMTP_PASS instead)';
        }
    }
    return `${settings.secure ? 'TLS' : 'STARTTLS'} ${settings.host}:${settings.port} as ${settings.auth ? settings.auth.user : '(no login)'}`;
}

/** A plain-words hint for the failures people actually hit. */
function hint(err) {
    const m = `${err.code || ''} ${err.responseCode || ''} ${err.message}`;
    if (/EAUTH|535|authentication/i.test(m)) return 'The server refused the login. Use the SMTP login and SMTP key from the provider\'s "SMTP & API" page, not your account email and password.';
    if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return 'The server name could not be found. Check SMTP_HOST (Brevo: smtp-relay.brevo.com).';
    if (/ECONNREFUSED|ETIMEDOUT|ESOCKET|ECONNECTION/i.test(m)) return 'Could not connect. Check the port (587 or 465); some networks block outgoing mail ports.';
    if (/sender|from|not verified|550|553/i.test(m)) return 'The sender address was refused. Verify MAIL_FROM (or its domain) with the provider first.';
    return null;
}

(async () => {
    const settings = smtpSettings();
    if (!settings) {
        console.error('No mail server is configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS (or SMTP_URL), and MAIL_FROM, in .env.');
        process.exit(1);
    }
    // Placeholders such as <your-key> in the docs are not part of the value.
    for (const k of ['SMTP_URL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'APP_URL']) {
        if (/^<.*>$/.test(process.env[k] || '')) console.error(`Warning: ${k} is wrapped in < >. Remove the angle brackets in .env: they are not part of the value.`);
    }
    const from = process.env.MAIL_FROM || '';
    console.log(`Mail server: ${describe(settings)}`);
    console.log(`Sender:      ${from || '(MAIL_FROM is not set: the provider will refuse most senders)'}`);
    const transport = nodemailer.createTransport(settings);
    try {
        await transport.verify();
        console.log('Connected and signed in: OK');
    } catch (err) {
        console.error(`Connection failed: ${err.message}`);
        const h = hint(err);
        if (h) console.error(h);
        process.exit(1);
    }
    const to = arg('to');
    if (!to) {
        console.log('Nothing sent. Add --to you@example.com to send a test message.');
        return;
    }
    try {
        const info = await transport.sendMail({
            from: from || 'FixMaster <no-reply@localhost>',
            to,
            subject: 'FixMaster test email',
            text: 'This is a test message from FixMaster. If you can read it, sign-up codes and password-reset links will reach people.',
        });
        console.log(`Sent to ${to} (${info.messageId}). Check the inbox and the spam folder.`);
    } catch (err) {
        console.error(`Sending failed: ${err.message}`);
        const h = hint(err);
        if (h) console.error(h);
        process.exit(1);
    }
})();
