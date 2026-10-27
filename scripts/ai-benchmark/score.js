/**
 * Scoring for the model benchmark. Every score is computed from the labelled
 * cases (cases.js) or from the facts the model was given - no model judges
 * another model - so a run can be repeated and compared.
 *
 * Each scorer returns { perfect: boolean, ... } for one case; run.js averages.
 */

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const f1 = (tp, fp, fn) => (2 * tp + fp + fn === 0 ? 1 : (2 * tp) / (2 * tp + fp + fn));

/** INTAKE: [text, [[code, location, area_ref]...]] against { drafts, clarification }. */
function intake(testCase, data) {
    const expected = testCase[1];
    const drafts = Array.isArray(data?.drafts) ? data.drafts : [];
    const gotCodes = [...new Set(drafts.map((d) => d.issue_code))];
    const wantCodes = expected.map((e) => e[0]);
    const tp = gotCodes.filter((c) => wantCodes.includes(c)).length;
    const codeF1 = f1(tp, gotCodes.length - tp, wantCodes.length - tp);
    const locationOk = expected.every(([code, location]) => {
        const d = drafts.find((x) => x.issue_code === code);
        return d && d.location === location;
    });
    const areaCases = expected.filter((e) => e[2]);
    const areaOk = areaCases.every(([code, , area]) => drafts.find((x) => x.issue_code === code)?.area_ref === area);
    const perfect = expected.length === 0 ? drafts.length === 0 : sameSet(gotCodes, wantCodes) && locationOk && areaOk;
    return { perfect, codeF1, areaOk: areaCases.length ? areaOk : null, askedClarification: expected.length === 0 ? !!data?.clarification : null };
}

/** ASK: [question, accepted reports, block?, days?] against { report, days, block_id }. */
function ask(testCase, data) {
    const [, accepted, block, days] = testCase;
    const reportOk = accepted.includes(data?.report);
    const blockOk = block ? data?.block_id === block : !data?.block_id;
    const daysOk = days ? data?.days === days : true;
    return { perfect: reportOk && blockOk && daysOk, reportOk, paramsOk: blockOk && daysOk };
}

/** FEEDBACK_TAGS: a batch of cases against { items: [{id, tags, sentiment}] }; ids are "1".."n". */
function feedback(batch, data) {
    const items = Array.isArray(data?.items) ? data.items : [];
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let exact = 0;
    let sentimentOk = 0;
    let returned = 0;
    batch.forEach(([, , wantTags, wantSentiments], i) => {
        const it = items.find((x) => x.id === String(i + 1));
        if (it) returned += 1;
        const got = [...new Set(it?.tags || [])];
        const t = got.filter((g) => wantTags.includes(g)).length;
        tp += t;
        fp += got.length - t;
        fn += wantTags.length - t;
        const sOk = !!it && wantSentiments.includes(it.sentiment);
        if (sOk) sentimentOk += 1;
        if (sOk && sameSet(got, wantTags)) exact += 1;
    });
    return { perfect: exact === batch.length, tp, fp, fn, exact, sentimentOk, returned, n: batch.length };
}

const numbersIn = (text) => (String(text).match(/\d+(?:\.\d+)?/g) || []).map(Number);

/**
 * BRIEFING: nothing in the written briefing may be a number or a block that is
 * not in the facts it was given, and an open emergency must be mentioned.
 * Numbers 0-5 are allowed freely (lists of "3 actions", "2 blocks").
 */
function briefing(factsJson, data) {
    const text = [data?.headline, ...(data?.highlights || []), ...(data?.actions || [])].join(' \n ');
    const known = new Set(numbersIn(factsJson));
    const ungrounded = numbersIn(text).filter((n) => n > 5 && !known.has(n));
    const blocksKnown = new Set(factsJson.match(/[A-Z]_BLOCK/g) || []);
    const invented = (text.match(/[A-Z]_BLOCK/g) || []).filter((b) => !blocksKnown.has(b));
    const facts = JSON.parse(factsJson).facts || {};
    const emergencies = facts.totals?.emergencies || 0;
    const mentionsEmergency = emergencies === 0 || /emergenc/i.test(text);
    const hasActions = (data?.actions || []).length > 0;
    return {
        perfect: ungrounded.length === 0 && invented.length === 0 && mentionsEmergency && hasActions,
        ungrounded: ungrounded.length,
        inventedBlocks: invented.length,
        mentionsEmergency,
        hasActions,
    };
}

module.exports = { intake, ask, feedback, briefing };
