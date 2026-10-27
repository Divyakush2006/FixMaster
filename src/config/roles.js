/**
 * Role groups used by route guards.
 *
 *   SUPERVISOR    runs the blocks assigned to them (every block of their hostel
 *                 when none are); manages the floors, rooms and shared areas
 *                 of those blocks
 *   CHIEF_WARDEN  the same operational powers over every block of one hostel
 *                 (men's or ladies') and the academic blocks, plus that
 *                 hostel's analytics and the right to add blocks to it; no
 *                 account administration
 *   ADMIN         everything, through the separate /admin portal
 *
 * Which blocks a manager runs is decided by services/scopeService.
 */
const ROLES = ['STUDENT', 'STAFF', 'SUPERVISOR', 'CHIEF_WARDEN', 'ADMIN'];

/** People who dispatch, triage and oversee work. */
const MANAGER_ROLES = ['SUPERVISOR', 'CHIEF_WARDEN', 'ADMIN'];

module.exports = { ROLES, MANAGER_ROLES };
