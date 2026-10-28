import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { metaApi } from '../../api/endpoints';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Field, Input, Select } from '../ui/Form';
import { BlockOptions } from './BlockOptions';
import { floorLabel } from '../../utils/formatters';

export interface RoomChoice {
  blockId: string;
  /** The floor as typed: a whole number from 0 (ground) to MAX_FLOOR. */
  floor: string;
  /** The room number as typed: the number on the door, three or four digits. It need not start with the floor. */
  roomNo: string;
  /** The room this names: its id when it is in the records, or the id it will get when requested; '' while the numbers are incomplete or clash. */
  roomId: string;
}

export const EMPTY_ROOM_CHOICE: RoomChoice = { blockId: '', floor: '', roomNo: '', roomId: '' };

interface RoomPickerProps {
  value: RoomChoice;
  onChange: (next: RoomChoice) => void;
  errors?: { block?: string; floor?: string; room?: string };
  /** Reports whether any block exists at all (so a form can disable submit). */
  onAvailability?: (hasInfrastructure: boolean) => void;
}

export const MAX_FLOOR = 24;

const digits = (s: string) => s.replace(/\D/g, '').slice(0, 4);

/** What is wrong with a typed floor, or null. */
export const floorProblem = (floor: string): string | null =>
  floor !== '' && Number(floor) > MAX_FLOOR ? `The floor must be from 0 (ground) to ${MAX_FLOOR}.` : null;

/** What is wrong with a typed room number, or null. */
export const roomProblem = (roomNo: string): string | null =>
  roomNo !== '' && !/^\d{3,4}$/.test(roomNo) ? 'The room number is the 3 or 4 digit number on your door.' : null;

/**
 * Block (a list: there are a few dozen) then floor (0-24) and the door number
 * (3 or 4 digits), typed as whole numbers. The door number does not have to start
 * with the floor: where the ground floor counts as 1, floor 3 holds rooms 401-420.
 * The room is looked up among the block's rooms as soon as it is typed, and the
 * form says so ("Room L-205"), or says it does not exist or is on another floor.
 * Changing the block clears the numbers, so a stale room is never submitted.
 */
export const RoomPicker: React.FC<RoomPickerProps> = ({ value, onChange, errors = {}, onAvailability }) => {
  const {
    data: blocks = [],
    isLoading: loadingBlocks,
    isError: blocksFailed,
    refetch,
  } = useQuery({ queryKey: ['meta-blocks'], queryFn: metaApi.getBlocks });
  const { data: rooms = [], isLoading: loadingRooms } = useQuery({
    queryKey: ['meta-rooms', value.blockId],
    queryFn: () => metaApi.getRoomsByBlock(value.blockId),
    enabled: !!value.blockId,
  });

  // A door number is unique within a block, so it names the room. A room already in the records must be on the
  // floor typed; one that is not is simply added when the request is sent (the hostel office confirms it).
  const byNumber = useMemo(() => new Map(rooms.map((r) => [r.room_number, r])), [rooms]);
  const lookup = (floor: string, roomNo: string) => {
    if (!value.blockId || floor === '' || roomNo === '' || floorProblem(floor) || roomProblem(roomNo)) return '';
    const room = byNumber.get(roomNo);
    if (room) return room.floor_number === Number(floor) ? room.room_id : '';
    return `${value.blockId.split('_')[0]}-${roomNo}`;
  };

  // Rooms may arrive after the numbers were typed (a slow connection): resolve again then.
  React.useEffect(() => {
    const id = lookup(value.floor, value.roomNo);
    if (id !== value.roomId) onChange({ ...value, roomId: id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byNumber]);

  const noInfrastructure = !loadingBlocks && !blocksFailed && blocks.length === 0;
  React.useEffect(() => onAvailability?.(!noInfrastructure), [noInfrastructure, onAvailability]);

  const typed = value.floor !== '' && value.roomNo !== '';
  const ready = !!value.blockId && !loadingRooms;
  const found = byNumber.get(value.roomNo);
  const problem = floorProblem(value.floor) || (value.roomNo.length >= 3 ? roomProblem(value.roomNo) : null);
  const status = problem
    ? { ok: false, text: problem }
    : !typed || !ready || value.roomNo.length < 3
      ? null
      : value.roomId
        ? found
          ? { ok: true, text: `Room ${value.roomId}` }
          : { ok: true, text: `Room ${value.roomId}: not in our records yet, so it will be added and the hostel office will confirm it.` }
        : found
          ? { ok: false, text: `Room ${value.roomNo} is on ${floorLabel(found.floor_number).toLowerCase()} of this block, not ${floorLabel(Number(value.floor)).toLowerCase()}.` }
          : null;

  return (
    <>
      {noInfrastructure && (
        <Alert tone="warning" className="mb-3" title="Hostel rooms are not set up yet">
          The hostel office has not configured any blocks or rooms, so a room cannot be requested yet. Please contact them.
        </Alert>
      )}
      {blocksFailed && (
        <Alert
          tone="danger"
          className="mb-3"
          title="Hostel blocks could not be loaded"
          action={
            <Button size="sm" variant="secondary" onClick={() => refetch()}>
              Try again
            </Button>
          }
        >
          Check your connection and try again.
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Block" required error={errors.block}>
          {(a) => (
            <Select
              {...a}
              value={value.blockId}
              disabled={loadingBlocks || blocks.length === 0}
              onChange={(e) => onChange({ blockId: e.target.value, floor: '', roomNo: '', roomId: '' })}
            >
              <option value="">{loadingBlocks ? 'Loading…' : 'Select block'}</option>
              <BlockOptions blocks={blocks.filter((b) => !b.block_kind || b.block_kind === 'RESIDENTIAL')} />
            </Select>
          )}
        </Field>
        <Field label="Floor" required error={errors.floor} hint="0 to 24; 0 is the ground floor">
          {(a) => (
            <Input
              {...a}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              placeholder="e.g. 2"
              value={value.floor}
              disabled={!value.blockId}
              onChange={(e) => {
                const floor = digits(e.target.value).slice(0, 2);
                onChange({ ...value, floor, roomId: lookup(floor, value.roomNo) });
              }}
            />
          )}
        </Field>
        <Field label="Room number" required error={errors.room} hint="The 3 or 4 digit number on your door">
          {(a) => (
            <Input
              {...a}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="e.g. 420"
              value={value.roomNo}
              disabled={!value.blockId}
              onChange={(e) => {
                const roomNo = digits(e.target.value);
                onChange({ ...value, roomNo, roomId: lookup(value.floor, roomNo) });
              }}
            />
          )}
        </Field>
      </div>
      {status && (
        <p role="status" className={status.ok ? 'mt-2 text-xs font-medium text-emerald-700' : 'mt-2 text-xs font-medium text-rose-700'}>
          {status.text}
        </p>
      )}
    </>
  );
};
