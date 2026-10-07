/**
 * Connection settings shared by the API pool and the CLI scripts
 * (migrate / seed / reset), so both connect the same way.
 *
 * TLS: enabled when DB_SSL=true, or when the URL itself asks for it
 * (sslmode=require) or points at Neon. Certificates are verified by default;
 * set DB_SSL_REJECT_UNAUTHORIZED=false only for a provider whose certificate
 * chain Node cannot validate.
 */
function sslConfig(connectionString) {
    const url = connectionString || '';
    const wantsSsl =
        process.env.DB_SSL === 'true' || url.includes('sslmode=require') || url.includes('neon.tech');
    if (!wantsSsl) return false;
    return { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
}

function connectionConfig(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) {
        throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
    }
    return { connectionString, ssl: sslConfig(connectionString) };
}

module.exports = { connectionConfig };
