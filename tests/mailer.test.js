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
        assert.deepEqual(s, { host: 'smtp-relay.brevo.com', port: 587, secure: false, auth: { user: '123abc@smtp-brevo.com', pass: 'k3y/with+symbols=' } });
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
