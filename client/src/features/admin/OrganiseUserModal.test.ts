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

  it('has nothing to say about other roles', () => {
    expect(placementSummary({ ...base, role: 'STUDENT' })).toBeNull();
  });
});
