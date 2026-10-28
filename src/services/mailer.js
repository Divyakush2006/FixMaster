const nodemailer = require('nodemailer');

// Outbound email: sign-up codes and password-reset links.
//
// Two ways to send, the first one found wins:
//
//   BREVO_API_KEY   Brevo's web API (HTTPS, port 443). Works on hosts that block SMTP ports (Render's free plan
//                   blocks 25, 465 and 587) and reports what happened to each message. A v3 API key
//                   ("xkeysib-..."), not the SMTP key.
//
//   SMTP, either one address ...
//     SMTP_URL    e.g. smtp://login:key@smtp-relay.brevo.com:587 (user and password URL-encoded; never committed)
//   ... or the parts, which need no encoding (use this when the login is an email address):
//     SMTP_HOST   e.g. smtp-relay.brevo.com
//     SMTP_PORT   587 (STARTTLS, the default) or 465 (TLS from the start); Brevo also answers on 2525
//     SMTP_USER / SMTP_PASS
//
//   MAIL_FROM   sender, e.g. "FixMaster <no-reply@your-domain>". The provider must have verified it, and the address
//               should be on a domain you have authenticated (SPF and DKIM) with the provider: mail "from" a
//               gmail.com or other free-mail address that did not leave through that mail service is rejected or
//               junked by Gmail and Microsoft, which is where most university mailboxes live.
//
// With none of these, no email can be sent. In development the message is printed to the console instead; in
// production the feature reports itself as unavailable (see isConfigured) rather than pretending to send.
//
// Every send is logged without its content: who it went to (masked), the subject with digits hidden, and what
// the mail service answered, so a deploy log shows whether a code left the server.

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
        // Fail in seconds, not minutes, when the host cannot be reached (a sign-up waits on this).
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
    };
}

const apiKey = (env = process.env) => (env.BREVO_API_KEY || '').trim();

/** "FixMaster <no-reply@x.org>" -> { name, email } */
function parseAddress(value) {
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value || '');
    return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: String(value || '').trim() };
}

/** A transport with nodemailer's sendMail shape that sends through Brevo's web API. */
function brevoApiTransport(key, fetchImpl = fetch) {
    return {
        async sendMail({ from, to, subject, text }) {
            const res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify({ sender: parseAddress(from), to: [{ email: to }], subject, textContent: text }),
                signal: AbortSignal.timeout(20000),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                const err = new Error(`Brevo API ${res.status}: ${body.message || res.statusText}`);
                err.code = body.code || `HTTP_${res.status}`;
                throw err;
            }
            return { messageId: body.messageId, response: `Brevo API ${res.status} accepted` };
        },
    };
}

function getTransport() {
    if (override) return override;
    if (!transport) transport = apiKey() ? brevoApiTransport(apiKey()) : nodemailer.createTransport(smtpSettings());
    return transport;
}

const isProduction = () => process.env.NODE_ENV === 'production';

/** True when a message sent now would actually reach (or, in development, be shown to) someone. */
function isConfigured() {
    return !!(override || apiKey() || smtpSettings() || (!isProduction() && process.env.NODE_ENV !== 'test'));
}

/** a***@example.org: enough to recognise the mailbox in a log, not enough to harvest it. */
const maskRecipient = (to) => String(to).replace(/^(.).*?(@.*)$/, '$1***$2');

async function sendMail({ to, subject, text }) {
    if (!override && !apiKey() && !smtpSettings()) {
        // Development only (isConfigured() is false in production).
        console.log(`[DEV mail] to=${to} subject="${subject}"\n${text}`);
        return;
    }
    const label = `to ${maskRecipient(to)} "${String(subject).replace(/\d/g, '#')}"`;
    try {
        const info = await getTransport().sendMail({ from: process.env.MAIL_FROM || 'FixMaster <no-reply@localhost>', to, subject, text });
        if (process.env.NODE_ENV !== 'test') {
            const rejected = (info && info.rejected) || [];
            console.log(`[mail] ${rejected.length ? 'REJECTED by the mail service' : 'accepted by the mail service'}: ${label} (${(info && info.response) || 'no response text'})`);
        }
        if (info && info.rejected && info.rejected.length) throw new Error(`the mail service rejected ${maskRecipient(to)}`);
    } catch (err) {
        if (process.env.NODE_ENV !== 'test') console.error(`[mail] FAILED: ${label}: ${err.code ? `${err.code} ` : ''}${err.message}`);
        throw err;
    }
}

/** At start-up: say in the log whether the mail service can be reached, so a wrong setting shows at once. */
async function checkConnection(log = console) {
    try {
        if (override || process.env.NODE_ENV === 'test') return null;
        if (apiKey()) {
            const res = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': apiKey(), accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
            if (!res.ok) throw new Error(`Brevo API ${res.status}: the API key was refused`);
            log.log('[mail] ready: sending through the Brevo web API');
            return true;
        }
        const settings = smtpSettings();
        if (!settings) return null;
        await nodemailer.createTransport(settings).verify();
        log.log(`[mail] ready: connected to the SMTP server${typeof settings === 'object' ? ` ${settings.host}:${settings.port}` : ''}`);
        return true;
    } catch (err) {
        log.error(`[mail] NOT READY: ${err.code ? `${err.code} ` : ''}${err.message}. Sign-up codes and reset links will not arrive until this is fixed.`);
        return false;
    }
}

/** Test hook: route mail to a recording transport. Pass null to restore. */
function setTransportForTests(t) {
    override = t;
}

module.exports = { isConfigured, sendMail, setTransportForTests, smtpSettings, checkConnection, brevoApiTransport, parseAddress, maskRecipient };
