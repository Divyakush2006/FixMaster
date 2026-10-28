const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { smtpSettings } = require('../src/services/mailer');

// Which mail server the API talks to, from the environment.
describe('mailer settings', () => {
    it('is not configured without a server', () => {
        assert.equal(smtpSettings({}), null);
    });

    it('takes the parts, so a login that is an email address needs no URL-encoding', () => {
        const s = smtpSettings({ SMTP_HOST: 'smtp-relay.brevo.com', SMTP_PORT: '587', SMTP_USER: '123abc@smtp-brevo.com', SMTP_PASS: 'k3y/with+symbols=' });
        assert.deepEqual(s, { host: 'smtp-relay.brevo.com', port: 587, secure: false, auth: { user: '123abc@smtp-brevo.com', pass: 'k3y/with+symbols=' }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
    });

    it('uses TLS from the start on 465 and STARTTLS on 587 (the default)', () => {
        assert.equal(smtpSettings({ SMTP_HOST: 'h', SMTP_PORT: '465' }).secure, true);
        const d = smtpSettings({ SMTP_HOST: 'h' });
        assert.equal(d.port, 587);
        assert.equal(d.secure, false);
        assert.equal(d.auth, undefined);
    });

    it('prefers one SMTP_URL when both are given', () => {
        assert.equal(smtpSettings({ SMTP_URL: 'smtp://a:b@h:587', SMTP_HOST: 'other' }), 'smtp://a:b@h:587');
    });
});

describe('mailer: Brevo web API and logging helpers', () => {
    const { brevoApiTransport, parseAddress, maskRecipient, isConfigured } = require('../src/services/mailer');

    it('splits "Name <address>" and plain addresses', () => {
        assert.deepEqual(parseAddress('FixMaster <no-reply@divyakush.info>'), { name: 'FixMaster', email: 'no-reply@divyakush.info' });
        assert.deepEqual(parseAddress('"Fix Master" <a@b.org>'), { name: 'Fix Master', email: 'a@b.org' });
        assert.deepEqual(parseAddress('a@b.org'), { email: 'a@b.org' });
    });

    it('masks a recipient for the log', () => {
        assert.equal(maskRecipient('student.name@vitstudent.ac.in'), 's***@vitstudent.ac.in');
    });

    it('posts the message to Brevo with the key in a header, and reports the message id', async () => {
        let seen;
        const fakeFetch = async (url, init) => {
            seen = { url, init };
            return new Response(JSON.stringify({ messageId: '<abc@smtp-relay.mailin.fr>' }), { status: 201, headers: { 'content-type': 'application/json' } });
        };
        const info = await brevoApiTransport('xkeysib-test', fakeFetch).sendMail({ from: 'FixMaster <no-reply@divyakush.info>', to: 'a@vitstudent.ac.in', subject: '123456 is your code', text: 'hello' });
        assert.equal(seen.url, 'https://api.brevo.com/v3/smtp/email');
        assert.equal(seen.init.headers['api-key'], 'xkeysib-test');
        const body = JSON.parse(seen.init.body);
        assert.deepEqual(body.sender, { name: 'FixMaster', email: 'no-reply@divyakush.info' });
        assert.deepEqual(body.to, [{ email: 'a@vitstudent.ac.in' }]);
        assert.equal(body.textContent, 'hello');
        assert.equal(info.messageId, '<abc@smtp-relay.mailin.fr>');
    });

    it('turns a Brevo refusal into an error that says why', async () => {
        const fakeFetch = async () => new Response(JSON.stringify({ code: 'invalid_parameter', message: 'sender is not valid' }), { status: 400, headers: { 'content-type': 'application/json' } });
        await assert.rejects(brevoApiTransport('k', fakeFetch).sendMail({ from: 'x@y.z', to: 'a@b.c', subject: 's', text: 't' }), (err) => err.code === 'invalid_parameter' && /sender is not valid/.test(err.message));
    });

    it('counts a Brevo API key as a configured mail service', () => {
        const old = process.env.BREVO_API_KEY;
        process.env.BREVO_API_KEY = 'xkeysib-x';
        try {
            // NODE_ENV=test alone is not "configured"; with a key it is.
            assert.equal(isConfigured(), true);
        } finally {
            if (old === undefined) delete process.env.BREVO_API_KEY;
            else process.env.BREVO_API_KEY = old;
        }
    });
});
