const app = require('./app');
const db = require('./config/db');
const { startVerificationSweeper } = require('./services/verificationSweeper');
const { startFeedbackTagger } = require('./services/autopilot/feedbackTagger');
const { startAutopilotSweeper } = require('./services/autopilot/sweeper');
const { startRetentionSweeper } = require('./services/retentionService');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const SHUTDOWN_GRACE_MS = 10000;

const server = app.listen(PORT, () => {
    console.log(`FIX_MASTER API listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

// Say in the log whether the mail service answers (never blocks start-up, never throws).
require('./services/mailer').checkConnection();

// Background job: close tickets nobody verified (see verificationSweeper.js).
const stopSweeper = startVerificationSweeper();
// Background job: themes in residents' review comments (see feedbackTagger.js).
const stopTagger = startFeedbackTagger();
// Background job: gives tickets on Automatic that nobody could take another go (see autopilot/sweeper.js).
const stopAutopilot = startAutopilotSweeper();
// Background job: removes data past its retention period (see retentionService.js).
const stopRetention = startRetentionSweeper();

// Graceful shutdown: on SIGTERM (container stop, deploy, scale-down) stop
// accepting new connections, let in-flight requests finish, then close the
// database pool. Without this a redeploy cuts requests off mid-transaction.
let shuttingDown = false;
function shutdown(signal, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down gracefully...`);

    const forceExit = setTimeout(() => {
        console.error('Shutdown grace period elapsed; forcing exit.');
        process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    stopSweeper();
    stopTagger();
    stopAutopilot();
    stopRetention();
    server.close(async () => {
        try {
            await db.pool.end();
        } catch (err) {
            console.error('Error closing database pool:', err);
        }
        await require('./config/redis').closeRedis().catch(() => {});
        await require('./services/tracing').shutdown().catch(() => {});
        process.exit(exitCode);
    });
    // Idle keep-alive sockets would otherwise hold server.close() open.
    server.closeIdleConnections();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A rejected promise nobody handled means the process is in an unknown state.
// Log it and restart cleanly (the process manager brings it back up) rather
// than keep serving.
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
    shutdown('unhandledRejection', 1);
});
