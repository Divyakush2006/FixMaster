const db = require('../../config/db');

// The handling trail of a ticket: one row per thing the system did to it, in
// the order a person would read them (received, reviewed, dispatched, followed
// up). See migration 017.
//
//   actor     SYSTEM | AI | AUTOPILOT | SUPERVISOR
//   outcome   DONE | WAITING | SKIPPED | FAILED
//   detail    one or two sentences for staff (may name the suggested technician, the block's setting, how many
//             are off shift). A resident sees residentDetail() instead.
//   data      what only managers see (scores, urgency, confidence ...)

const STAGE_ORDER = ['RECEIVED', 'AI_REVIEW', 'DISPATCH', 'FOLLOW_UP'];
const REPEAT_AFTER_HOURS = 6;

/** Writes one step. Pass a transaction client to make it part of the same commit as what it describes. */
async function record(executor, complaintId, { stage, actor, outcome, title, detail = null, provider = null, model = null, data = null }) {
    const { rows } = await executor.query(
        `INSERT INTO ticket_handling_steps (complaint_id, stage, actor, outcome, title, detail, provider, model, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING step_id, stage, actor, outcome, title, detail, provider, model, data, created_at`,
        [complaintId, stage, actor, outcome, String(title).slice(0, 120), detail, provider, model, data]
    );
    return rows[0];
}

/**
 * Writes a WAITING / FAILED step unless the last step of that stage says the
 * same thing and is recent: a ticket retried every minute must not fill its
 * trail with identical lines.
 */
async function recordIfChanged(executor, complaintId, step) {
    const { rows } = await executor.query(
        `SELECT outcome, title, detail, created_at FROM ticket_handling_steps
         WHERE complaint_id = $1 AND stage = $2 ORDER BY step_id DESC LIMIT 1`,
        [complaintId, step.stage]
    );
    const last = rows[0];
    const same = last && last.outcome === step.outcome && last.title === String(step.title).slice(0, 120) && (last.detail || null) === (step.detail || null);
    if (same && Date.now() - new Date(last.created_at).getTime() < REPEAT_AFTER_HOURS * 3_600_000) return null;
    return record(executor, complaintId, step);
}

/**
 * What a resident reads for a step that is still waiting. Staff details name technicians, shifts and the block's
 * autopilot setting; a resident only needs to know what happens next.
 */
function residentDetail(step) {
    if (step.stage !== 'DISPATCH' || step.outcome === 'DONE') return step.detail;
    if (step.outcome === 'FAILED') return 'A supervisor will assign this by hand.';
    const mode = step.data && step.data.mode;
    if (mode === 'SUGGEST' || mode === 'OFF') return 'A supervisor will choose the technician and you will be notified as soon as someone is assigned.';
    return 'The technicians for this kind of work are busy right now. Your request is queued and tried again every minute, and a supervisor has been told.';
}

/**
 * The trail for one ticket. Residents get the plain text; managers also get
 * `data`. `pending` names what is still on its way (the AI review runs just
 * after the ticket is raised).
 */
async function list(complaintId, { forManager = false, executor = db } = {}) {
    const { rows } = await executor.query(
        `SELECT step_id, stage, actor, outcome, title, detail, provider, model, data, created_at
         FROM ticket_handling_steps WHERE complaint_id = $1 ORDER BY step_id`,
        [complaintId]
    );
    const rank = (s) => STAGE_ORDER.indexOf(s.stage);
    // Stages read in order; inside a stage (the retries) the order they happened in.
    const shaped = forManager ? rows : rows.map(({ data, ...step }) => ({ ...step, detail: residentDetail({ ...step, data }) }));
    const steps = shaped.slice().sort((a, b) => rank(a) - rank(b) || Number(a.step_id) - Number(b.step_id));
    const t = (await executor.query('SELECT status, created_at FROM complaints WHERE complaint_id = $1', [complaintId])).rows[0];
    const pending = [];
    if (t && !steps.some((s) => s.stage === 'AI_REVIEW') && ['OPEN', 'ASSIGNED'].includes(t.status) && Date.now() - new Date(t.created_at).getTime() < 90_000) {
        pending.push('AI_REVIEW');
    }
    return { steps, pending };
}

module.exports = { record, recordIfChanged, list, STAGE_ORDER };
