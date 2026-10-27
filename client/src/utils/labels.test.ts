import { describe, it, expect } from 'vitest';
import { blockLabel, greeting, initials, isOpenStatus, shortDuration, slaText, STATUS_LABEL, ticketLocation, ticketRef } from './labels';
import { floorCode, floorLabel, roomNumberFor } from './formatters';

describe('ticketRef', () => {
  it('gives a short, stable, upper-case reference', () => {
    expect(ticketRef('cmp-843-0001-uuid-000000000001')).toBe('TKT-000001');
    expect(ticketRef('3f2a9c1b-0d4e-4c7a-9b1e-8a7f6e5d4c3b')).toBe('TKT-5D4C3B');
    expect(ticketRef('')).toBe('');
  });
});

describe('ticketLocation', () => {
  it('prefers the room, then the common area, then the block', () => {
    expect(ticketLocation({ room_id: 'L-843', common_area_id: null, block_id: 'L_BLOCK' })).toBe('L-843');
    expect(ticketLocation({ room_id: null, common_area_id: 'L-CA-1', block_id: 'L_BLOCK' })).toBe('L-CA-1');
    expect(ticketLocation({ room_id: null, common_area_id: null, block_id: 'L_BLOCK' })).toBe('L_BLOCK');
  });
});

describe('labels', () => {
  it('has a human label for every status', () => {
    expect(STATUS_LABEL.PENDING_VERIFICATION).toBe('Awaiting confirmation');
    expect(Object.values(STATUS_LABEL).every((l) => l && !l.includes('_'))).toBe(true);
  });
  it('treats only closed and rejected tickets as finished', () => {
    expect(isOpenStatus('ESCALATED')).toBe(true);
    expect(isOpenStatus('COMPLETED')).toBe(false);
    expect(isOpenStatus('REJECTED')).toBe(false);
  });
  it('formats block ids, initials and greetings', () => {
    expect(blockLabel('C_BLOCK')).toBe('C-Block');
    expect(blockLabel('PRP')).toBe('PRP');
    expect(blockLabel('PRP_BLOCK')).toBe('PRP');
    expect(blockLabel('MH_BLOCK')).toBe('MH');
    expect(blockLabel('LA_BLOCK')).toBe('A-Block (Ladies)');
    expect(blockLabel('L_BLOCK')).toBe('L-Block');
    expect(initials('Vihaan  Sharma')).toBe('VS');
    expect(initials('Admin')).toBe('A');
    expect(initials('Suresh Kumar (Electrician)')).toBe('SK');
    expect(initials('Mr. R. Sundaram (L-Block)')).toBe('RS');
    expect(greeting(new Date(2026, 0, 1, 9))).toBe('Good morning');
    expect(greeting(new Date(2026, 0, 1, 20))).toBe('Good evening');
  });
});

describe('room numbering', () => {
  it('matches the database rule: floor code + two-digit room', () => {
    expect(floorCode(0)).toBe('G');
    expect(roomNumberFor(0, 1)).toBe('G01');
    expect(roomNumberFor(4, 28)).toBe('428');
    expect(roomNumberFor(10, 7)).toBe('1007');
    expect(floorLabel(0)).toBe('Ground floor');
  });
});

describe('SLA wording', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const at = (hoursFromNow: number) => new Date(now + hoursFromNow * 3600000).toISOString();

  it('formats short durations', () => {
    expect(shortDuration(45 * 60000)).toBe('45m');
    expect(shortDuration(3 * 3600000)).toBe('3h');
    expect(shortDuration(52 * 3600000)).toBe('2d 4h');
    expect(shortDuration(48 * 3600000)).toBe('2d');
    expect(shortDuration(10)).toBe('1m');
  });

  it('describes open and finished tickets against their deadline', () => {
    expect(slaText({ sla_status: 'ON_TRACK', sla_due_at: at(5), resolved_at: null, closed_at: null }, now)).toBe('Due in 5h');
    expect(slaText({ sla_status: 'AT_RISK', sla_due_at: at(0.5), resolved_at: null, closed_at: null }, now)).toBe('Due in 30m');
    expect(slaText({ sla_status: 'OVERDUE', sla_due_at: at(-2), resolved_at: null, closed_at: null }, now)).toBe('Overdue by 2h');
    expect(slaText({ sla_status: 'MET', sla_due_at: at(-2), resolved_at: at(-3), closed_at: null }, now)).toBe('Done within SLA');
    expect(slaText({ sla_status: 'BREACHED', sla_due_at: at(-5), resolved_at: at(-2), closed_at: null }, now)).toBe('SLA missed by 3h');
  });

  it('says nothing where no SLA applies', () => {
    expect(slaText({ sla_status: 'NOT_APPLICABLE', sla_due_at: at(1), resolved_at: null, closed_at: null }, now)).toBeNull();
    expect(slaText({ sla_status: undefined, sla_due_at: null, resolved_at: null, closed_at: null }, now)).toBeNull();
  });
});
