const { describe } = require('node:test');
const { photoJourney } = require('./support/photo_journey');
const objects = require('../src/services/objectStorage');

// The photo journey against a real S3-compatible server (SeaweedFS, MinIO, ...), which
// checks request signatures itself. Run with TEST_S3_ENDPOINT, TEST_S3_BUCKET (it must
// already exist), TEST_S3_ACCESS_KEY and TEST_S3_SECRET_KEY set; skipped otherwise.
describe('ticket photos in a real S3-compatible server', { skip: !process.env.TEST_S3_ENDPOINT && 'set TEST_S3_ENDPOINT to run against a real S3-compatible server' }, () => {
    const saved = {};
    const ENV = ['S3_BUCKET', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION', 'S3_PREFIX'];
    photoJourney({
        configure: async () => {
            for (const k of ENV) saved[k] = process.env[k];
            Object.assign(process.env, {
                S3_BUCKET: process.env.TEST_S3_BUCKET || 'fixmaster-test',
                S3_ENDPOINT: process.env.TEST_S3_ENDPOINT,
                S3_ACCESS_KEY_ID: process.env.TEST_S3_ACCESS_KEY,
                S3_SECRET_ACCESS_KEY: process.env.TEST_S3_SECRET_KEY,
                S3_REGION: 'us-east-1',
                S3_PREFIX: `ticket-photos-${Date.now()}/`,
            });
        },
        teardown: async () => {
            for (const k of ENV) {
                if (saved[k] === undefined) delete process.env[k];
                else process.env[k] = saved[k];
            }
        },
        keys: async (ticket) => {
            const found = [];
            for (const ext of ['jpg', 'png']) if (await objects.get(`${ticket}.${ext}`)) found.push(`${ticket}.${ext}`);
            return found;
        },
    });
});
