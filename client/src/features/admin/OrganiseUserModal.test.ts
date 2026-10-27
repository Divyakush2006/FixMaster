import { describe, it, expect } from 'vitest';
import { placementSummary } from './OrganiseUserModal';
import type { User } from '../../types';

const base: User = { user_id: 'u1', reg_or_emp_id: 'X', full_name: 'X', role: 'STAFF' };

describe('placementSummary', () => {
  it('describes where staff work and when', () => {
    expect(placementSummary({ ...base, home_block_id: 'L_BLOCK', shift: 'NIGHT' })).toBe('L-Block · Night');
    expect(placementSummary({ ...base, home_block_id: null })).toBe('Campus pool');
  });

  it('describes which blocks a supervisor runs, empty meaning all', () => {
    expect(placementSummary({ ...base, role: 'SUPERVISOR', managed_blocks: [] })).toBe('All blocks');
    expect(placementSummary({ ...base, role: 'SUPERVISOR', managed_blocks: ['A_BLOCK', 'PRP_BLOCK'] })).toBe('A, PRP');
  });

  it('names the hostel of a supervisor or chief warden', () => {
    expect(placementSummary({ ...base, role: 'SUPERVISOR', hostel_type: 'LADIES', managed_blocks: [] })).toBe("Ladies' · Every block");
    expect(placementSummary({ ...base, role: 'SUPERVISOR', hostel_type: 'MENS', managed_blocks: ['A_BLOCK', 'MH_BLOCK'] })).toBe("Men's · A, MH");
    expect(placementSummary({ ...base, role: 'CHIEF_WARDEN', hostel_type: 'LADIES' })).toBe("Ladies' hostel");
    expect(placementSummary({ ...base, role: 'CHIEF_WARDEN', hostel_type: null })).toBe('Every block');
  });

  it('has nothing to say about other roles', () => {
    expect(placementSummary({ ...base, role: 'STUDENT' })).toBeNull();
  });
});
