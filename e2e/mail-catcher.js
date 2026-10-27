/**
 * A tiny mail catcher for the browser tests, so sign-up and password-reset can
 * be tested without Docker: it accepts mail over SMTP and exposes what it got
 * through the same HTTP calls the tests already use against Mailpit
 * (GET /api/v1/messages, GET /api/v1/message/:id). Nothing leaves the machine.
 */
const net = require('net');
const http = require('http');

const decodeQuotedPrintable = (s) =>
    s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

function parseMessage(raw) {
    const [head, ...rest] = raw.split(/\r?\n\r?\n/);
    const headers = {};
    for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
    }
    let body = rest.join('\n\n');
    const encoding = (headers['content-transfer-encoding'] || '').toLowerCase();
    if (encoding === 'quoted-printable') body = decodeQuotedPrintable(body);
    else if (encoding === 'base64') body = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    return { subject: headers.subject || '', body };
}

function startMailCatcher({ smtpPort = 0, httpPort = 0 } = {}) {
    const messages = [];
    const smtp = net.createServer((socket) => {
        let inData = false;
        let buffer = '';
        let data = '';
        let recipients = [];
        const reply = (line) => socket.write(`${line}\r\n`);
        reply('220 catcher ESMTP');
        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            let idx;
            while ((idx = buffer.indexOf('\r\n')) >= 0) {
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                if (inData) {
                    if (line === '.') {
                        inData = false;
                        const m = parseMessage(data);
                        messages.push({ ID: String(messages.length + 1), To: recipients.map((Address) => ({ Address })), Subject: m.subject, Text: m.body });
                        data = '';
                        recipients = [];
                        reply('250 queued');
                    } else {
                        data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
                    }
                    continue;
                }
                const cmd = line.slice(0, 4).toUpperCase();
                if (cmd === 'EHLO' || cmd === 'HELO') reply('250 catcher');
                else if (cmd === 'MAIL') reply('250 ok');
                else if (cmd === 'RCPT') {
                    const m = line.match(/<([^>]+)>/);
                    if (m) recipients.push(m[1].toLowerCase());
                    reply('250 ok');
                } else if (cmd === 'DATA') {
                    inData = true;
                    reply('354 end with .');
                } else if (cmd === 'QUIT') {
                    reply('221 bye');
                    socket.end();
                } else reply('250 ok');
            }
        });
        socket.on('error', () => {});
    });

    const web = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/api/v1/messages') return res.end(JSON.stringify({ messages: messages.map(({ ID, To, Subject }) => ({ ID, To, Subject })) }));
        const m = req.url.match(/^\/api\/v1\/message\/(\w+)$/);
        const found = m && messages.find((x) => x.ID === m[1]);
        if (found) return res.end(JSON.stringify({ Text: found.Text }));
        res.statusCode = 404;
        res.end('{}');
    });

    return new Promise((resolve) => {
        smtp.listen(smtpPort, '127.0.0.1', () =>
            web.listen(httpPort, '127.0.0.1', () =>
                resolve({
                    smtpPort: smtp.address().port,
                    httpPort: web.address().port,
                    messages,
                    close: () => {
                        smtp.close();
                        web.closeAllConnections();
                        web.close();
                    },
                })
            )
        );
    });
}

module.exports = { startMailCatcher };

// Run on its own: node mail-catcher.js  (SMTP on MAIL_SMTP_PORT, HTTP API on MAIL_HTTP_PORT)
if (require.main === module) {
    startMailCatcher({ smtpPort: Number(process.env.MAIL_SMTP_PORT) || 1025, httpPort: Number(process.env.MAIL_HTTP_PORT) || 8025 }).then((m) =>
        console.log(`mail catcher: smtp ${m.smtpPort}, http ${m.httpPort}`)
    );
}
