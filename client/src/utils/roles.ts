import type { Role } from '../types';

/** People who dispatch, triage and oversee work (mirrors the API's MANAGER_ROLES). */
export const MANAGER_ROLES: Role[] = ['SUPERVISOR', 'CHIEF_WARDEN', 'ADMIN'];

export const isManager = (role?: Role | null) => !!role && MANAGER_ROLES.includes(role);
