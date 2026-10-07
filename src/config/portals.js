/**
 * The three sign-in portals and which account roles each one admits.
 *
 *   student - /login, Student tab   -> STUDENT
 *   staff   - /login, Staff tab     -> STAFF (technicians) and SUPERVISOR
 *   admin   - /admin                -> ADMIN
 *
 * Every account belongs to exactly one portal. A token records the portal it
 * was issued by (`portal` claim + JWT audience) and is only honoured while the
 * account's current role still belongs to that portal.
 */
const PORTALS = Object.freeze({
    student: ['STUDENT'],
    staff: ['STAFF', 'SUPERVISOR'],
    admin: ['ADMIN'],
});

const PORTAL_NAMES = Object.keys(PORTALS);

function portalForRole(role) {
    return PORTAL_NAMES.find((p) => PORTALS[p].includes(role)) || null;
}

const audienceFor = (portal) => `fixmaster:${portal}`;
const ALL_AUDIENCES = PORTAL_NAMES.map(audienceFor);

module.exports = { PORTALS, PORTAL_NAMES, portalForRole, audienceFor, ALL_AUDIENCES };
