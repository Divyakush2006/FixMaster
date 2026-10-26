/**
 * Role groups used by route guards.
 *
 *   SUPERVISOR    runs the blocks assigned to them (all blocks when none are)
 *   CHIEF_WARDEN  the same operational powers over every block, plus campus
 *                 analytics; no account or infrastructure administration
 *   ADMIN         everything, through the separate /admin portal
 */
const ROLES = ['STUDENT', 'STAFF', 'SUPERVISOR', 'CHIEF_WARDEN', 'ADMIN'];

/** People who dispatch, triage and oversee work. */
const MANAGER_ROLES = ['SUPERVISOR', 'CHIEF_WARDEN', 'ADMIN'];

/** Campus-wide by definition, whatever blocks exist. */
const CAMPUS_WIDE_ROLES = ['CHIEF_WARDEN', 'ADMIN'];

module.exports = { ROLES, MANAGER_ROLES, CAMPUS_WIDE_ROLES };
