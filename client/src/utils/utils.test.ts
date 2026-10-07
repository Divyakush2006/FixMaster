import { describe, it, expect } from 'vitest';
import { coerceNumber } from './formatters';
import { mapApiError } from './errorMapper';
import { reconstructTimeline } from './timeline';
import { Complaint } from '../types';

describe('coerceNumber', () => {
  it('handles the string-encoded counts PostgreSQL returns', () => {
    expect(coerceNumber('6')).toBe(6);
    expect(coerceNumber('4.50')).toBe(4.5);
    expect(coerceNumber(null)).toBe(0);
    expect(coerceNumber('garbage', -1)).toBe(-1);
  });
});

describe('mapApiError', () => {
  it('passes friendly server messages through', () => {
    expect(mapApiError({ error: 'Room L-843 does not belong to block PRP_BLOCK.' })).toBe(
      'Room L-843 does not belong to block PRP_BLOCK.'
    );
  });
  it('never shows raw database text', () => {
    expect(mapApiError({ error: 'insert or update on table "complaints" violates foreign key constraint' })).not.toMatch(/violates/);
  });
});

describe('reconstructTimeline', () => {
  const base: Complaint = {
    complaint_id: 'c1', ticket_scope: 'ROOM', room_id: 'L-843', common_area_id: null, block_id: 'L_BLOCK',
    raised_by_user_id: 'u1', subcategory_id: 4, description: null, photo_evidence_url: null, status: 'OPEN',
    priority: 'MEDIUM', preferred_timeslot: null, created_at: '2026-10-01T10:00:00Z', resolved_at: null,
    closed_at: null, category_name: 'Electrical', issue_name: 'Tube Light', required_specialization: 'ELECTRICIAN',
    student_name: 'Vihaan',
  };
  it('ends on the current step for each status', () => {
    const open = reconstructTimeline(base);
    expect(open[open.length - 1].status).toBe('current');
    const closed = reconstructTimeline({ ...base, status: 'COMPLETED', closed_at: '2026-10-02T10:00:00Z' });
    expect(closed[closed.length - 1].title).toBe('Closed & Verified');
    expect(closed.every((e) => e.status === 'completed')).toBe(true);
  });
});
