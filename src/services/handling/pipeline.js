const { autoDispatchIfEnabled } = require('../autopilot');
const { reviewTicket } = require('./review');

// What happens to a ticket the moment it is raised, after it is committed:
//   1. the AI review reads it (urgency, safety) and the safety rules check it;
//   2. the autopilot assigns, suggests or waits, according to the block's setting.
// They run side by side: neither waits for the other, and each writes its own
// step to the ticket's trail (steps.js). The caller waits for both for a short
// time so the resident's confirmation can already show them; a slower review
// carries on in the background and the trail shows it as "in progress".

const waitMs = () => {
    const n = Number.parseInt(process.env.TICKET_REVIEW_WAIT_MS, 10);
    return Number.isFinite(n) && n >= 0 ? n : 3000;
};

/** Resolves with the value, or null after `ms`; never rejects. */
function within(promise, ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        timer.unref();
        promise.then(
            (v) => {
                clearTimeout(timer);
                resolve(v);
            },
            () => {
                clearTimeout(timer);
                resolve(null);
            }
        );
    });
}

/** Returns the autopilot's dispatch result (or null). Never throws. */
async function processNewTicket(complaintId, { log = console } = {}) {
    const review = reviewTicket(complaintId, { log });
    const dispatch = autoDispatchIfEnabled(complaintId, log, { trigger: 'NEW' });
    const dispatched = await dispatch;
    await within(review, waitMs());
    return dispatched;
}

module.exports = { processNewTicket };
