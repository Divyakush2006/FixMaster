// The autopilot's score (docs/ROADMAP.md section 6). Pure functions: the same
// candidates and context always give the same ranking, which is what makes
// an automatic decision explainable and testable.
//
// Each component is 0..1; the total is the weighted sum on a 0..100 scale.
//
//   quality      average rating over 60 days, pulled toward the campus average
//                until there are enough ratings (PRIOR_WEIGHT of them)
//   load         1 - live jobs / cap
//   idle         time since the last assignment, capped at IDLE_CAP_MINUTES
//   proximity    same floor 1.0, same block 0.6, elsewhere 0.2
//   reliability  on-time share minus sent-back share, smoothed the same way
//   roomHistory  1 if this room rated them 4+ before, else 0

const DEFAULT_WEIGHTS = Object.freeze({ quality: 30, load: 25, idle: 15, proximity: 12, reliability: 10, roomHistory: 8 });
const RECOVERY_QUALITY_WEIGHT = 50;
const PRIOR_WEIGHT = 10;
const IDLE_CAP_MINUTES = 240;
const COMPONENTS = Object.keys(DEFAULT_WEIGHTS);

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round = (x, places = 3) => Math.round(x * 10 ** places) / 10 ** places;

/** Weights that add up to 100, from overrides on top of the defaults. */
function normaliseWeights(overrides) {
    const w = { ...DEFAULT_WEIGHTS };
    for (const k of COMPONENTS) {
        if (overrides && Number.isFinite(overrides[k]) && overrides[k] >= 0) w[k] = overrides[k];
    }
    const sum = COMPONENTS.reduce((s, k) => s + w[k], 0) || 1;
    return Object.fromEntries(COMPONENTS.map((k) => [k, (w[k] * 100) / sum]));
}

/** Recovery mode: quality counts for RECOVERY_QUALITY_WEIGHT, the rest shrink in proportion. */
function recoveryWeights(weights) {
    const others = COMPONENTS.filter((k) => k !== 'quality');
    const otherSum = others.reduce((s, k) => s + weights[k], 0) || 1;
    const out = { quality: RECOVERY_QUALITY_WEIGHT };
    for (const k of others) out[k] = (weights[k] * (100 - RECOVERY_QUALITY_WEIGHT)) / otherSum;
    return out;
}

/** Bayesian-smoothed 1-5 rating mapped onto 0..1. */
function qualityOf(c, campusMean) {
    const mean = (c.ratingSum + campusMean * PRIOR_WEIGHT) / ((c.rated || 0) + PRIOR_WEIGHT);
    return clamp01((mean - 1) / 4);
}

function reliabilityOf(c) {
    const jobs = c.completed || 0;
    const onTime = ((c.onTime || 0) + 0.8 * 5) / (jobs + 5);
    const sentBack = (c.rework || 0) / Math.max(jobs, 1);
    return clamp01(onTime - sentBack);
}

function proximityOf(c, ticket) {
    if (c.currentBlock === ticket.blockId && ticket.floor !== null && c.currentFloor === ticket.floor) return 1;
    if (c.currentBlock === ticket.blockId || c.homeBlock === ticket.blockId) return 0.6;
    return 0.2;
}

/**
 * @param {object[]} candidates  eligible staff with their metrics
 * @param {{ ticket: {blockId, floor}, now: Date, cap: number, campusMean: number, recovery: boolean, weights?: object }} ctx
 * @returns {object[]} candidates with { score, components, weights }, best first
 */
function rank(candidates, ctx) {
    const base = normaliseWeights(ctx.weights);
    const weights = ctx.recovery ? recoveryWeights(base) : base;
    let scored = candidates.map((c) => {
        const idleMinutes = c.lastAssignedAt ? (ctx.now - new Date(c.lastAssignedAt)) / 60000 : IDLE_CAP_MINUTES;
        const components = {
            quality: qualityOf(c, ctx.campusMean),
            load: clamp01(1 - (c.liveJobs || 0) / ctx.cap),
            idle: clamp01(idleMinutes / IDLE_CAP_MINUTES),
            proximity: proximityOf(c, ctx.ticket),
            reliability: reliabilityOf(c),
            roomHistory: c.roomAvgRating !== null && c.roomAvgRating !== undefined && c.roomAvgRating >= 4 ? 1 : 0,
        };
        const score = COMPONENTS.reduce((s, k) => s + weights[k] * components[k], 0);
        return {
            ...c,
            score: round(score, 1),
            components: Object.fromEntries(COMPONENTS.map((k) => [k, round(components[k])])),
        };
    });

    // After a bad experience at this place, only the best-rated quarter is considered.
    if (ctx.recovery && scored.length >= 4) {
        const qualities = scored.map((s) => s.components.quality).sort((a, b) => b - a);
        const cutoff = qualities[Math.ceil(qualities.length / 4) - 1];
        scored = scored.filter((s) => s.components.quality >= cutoff);
    }

    return scored
        .sort((a, b) => b.score - a.score || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
        .map((s) => ({ ...s, weights: Object.fromEntries(COMPONENTS.map((k) => [k, round(weights[k], 1)])) }));
}

module.exports = { rank, normaliseWeights, recoveryWeights, DEFAULT_WEIGHTS, COMPONENTS, PRIOR_WEIGHT, IDLE_CAP_MINUTES };
