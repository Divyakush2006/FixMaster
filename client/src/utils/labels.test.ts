import { describe, it, expect } from 'vitest';
import { blockLabel, greeting, initials, isOpenStatus, STATUS_LABEL, ticketLocation, ticketRef } from './labels';
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
