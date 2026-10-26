// Signals that a message is trying to instruct the model rather than describe
// a fault. Screening is NOT the defence - the assistant has no priority or
// dispatch output to steer, and the server re-validates everything it drafts
// (docs/ROADMAP.md section 4). Flagged messages are still drafted normally;
// the flag is recorded on the ai_calls row so attempts can be reviewed.

const SIGNALS = [
    [/\b(ignore|disregard|forget|override)\b.{0,40}\b(instructions?|rules?|prompt|above|previous|system)\b/i, 'override-instructions'],
    [/\b(system|developer)\s*(prompt|message|mode)\b/i, 'system-prompt'],
    [/\byou are (now|no longer)\b|\bact as\b|\bpretend (to be|you)\b|\brole-?play\b/i, 'persona'],
    [/\bjail\s*break\b|\bDAN\b|\bdo anything now\b/i, 'jailbreak'],
    [/\bpriority\b.{0,20}\b(emergency|urgent|high|critical|p0|p1)\b|\b(emergency|urgent|high)\b.{0,15}\bpriority\b/i, 'priority-demand'],
    [/\b(set|make|mark|change|raise|escalate)\b.{0,25}\b(priority|emergency|urgent)\b/i, 'priority-demand'],
    [/\bpriority\s*(badha|badhao|high karo|high kar do)\b|\burgent (karo|kar do|bana do)\b/i, 'priority-demand'],
    [/\b(assign|dispatch|send)\b.{0,30}\b(technician|electrician|plumber|cleaner|staff)\b.{0,30}\b(now|immediately|first|right away)\b/i, 'dispatch-demand'],
    [/"?\b(priority|ai_decided|auto_allocate|staff_user_id)\b"?\s*[:=]/i, 'field-injection'],
    [/<\/?(system|instructions?|assistant)>|```\s*(json|system)/i, 'markup-injection'],
];

/** @returns {{ flagged: boolean, signals: string[] }} */
function screen(text) {
    const found = new Set();
    for (const [pattern, name] of SIGNALS) if (pattern.test(String(text || ''))) found.add(name);
    return { flagged: found.size > 0, signals: [...found] };
}

module.exports = { screen };
