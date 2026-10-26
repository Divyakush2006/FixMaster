// Personal data never leaves the server in a prompt. Free tiers may keep
// prompts or train on them, so before any provider call the text is scrubbed
// of the things that identify a person: email addresses, phone numbers,
// university registration numbers, and the names the caller passes in (the
// student's own name, typically). Room and block codes stay: they identify a
// place, and the assistant needs them.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Indian mobile numbers with or without +91 / 0, and spaced or dashed forms.
const PHONE = /(?:\+?91[\s-]?|\b0)?\b[6-9]\d{4}[\s-]?\d{5}\b/g;
const REG_NO = /\b\d{2}[A-Z]{3}\d{4}\b/gi;
const EMPLOYEE_ID = /\bEMP_[A-Z0-9_]+\b/gi;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} text
 * @param {{ names?: string[] }} [known]  people whose names must not be sent
 * @returns {{ text: string, redactions: number }}
 */
function redact(text, { names = [] } = {}) {
    let out = String(text || '');
    let redactions = 0;
    const sub = (pattern, label) => {
        out = out.replace(pattern, () => {
            redactions += 1;
            return label;
        });
    };
    sub(EMAIL, '[email]');
    sub(REG_NO, '[reg-no]');
    sub(EMPLOYEE_ID, '[staff-id]');
    sub(PHONE, '[phone]');
    // Each part of a known name, longest first, so "Asha Rao" removes both.
    const parts = [...new Set(names.flatMap((n) => String(n || '').split(/\s+/)).filter((p) => p.replace(/\./g, '').length >= 3))].sort(
        (a, b) => b.length - a.length
    );
    for (const part of parts) sub(new RegExp(`\\b${escape(part)}\\b`, 'gi'), '[name]');
    return { text: out, redactions };
}

module.exports = { redact };
