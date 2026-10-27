import { describe, it, expect } from 'vitest';
import { waitingReason } from './autopilotLabels';

describe('waitingReason', () => {
  it('lists what keeps everyone out, most common first', () => {
    expect(waitingReason({ eligible: 0, trade_staff: 5, reasons: { AT_CAPACITY: 2, OFF_DUTY: 3 } })).toBe('Nobody can take it: 3 off duty, 2 at their live-job limit');
  });
  it('says so when someone is free and the next pass will take it', () => {
    expect(waitingReason({ eligible: 2, trade_staff: 5, reasons: {} })).toMatch(/next pass/);
  });
  it('says so when the trade has nobody registered', () => {
    expect(waitingReason({ eligible: 0, trade_staff: 0, reasons: {} })).toBe('No technician of this trade is registered');
  });
});
