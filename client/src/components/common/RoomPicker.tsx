import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { metaApi } from '../../api/endpoints';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Field, Input, Select } from '../ui/Form';
import { BlockOptions } from './BlockOptions';
import { doorNumber, floorLabel } from '../../utils/formatters';

export interface RoomChoice {
  blockId: string;
  /** The floor as typed: digits, 0 for the ground floor. */
  floor: string;
  /** The room number as typed: the number on the door ("205"), or the number on the floor ("5"). */
  roomNo: string;
  /** The room this resolves to, '' until it names a room that exists. */
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

const digits = (s: string) => s.replace(/\D/g, '').slice(0, 4);

/**
 * Block (a list: there are a few dozen) then floor and room NUMBER, typed as
 * whole numbers. The room is looked up among the block's rooms as soon as it is
 * typed, and the form says so ("Room L-205") or says it does not exist.
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

  const byNumber = useMemo(() => new Map(rooms.map((r) => [`${r.floor_number}|${r.room_number}`, r])), [rooms]);
  const lookup = (floor: string, roomNo: string) => {
    if (floor === '' || roomNo === '') return '';
    return byNumber.get(`${Number(floor)}|${doorNumber(Number(floor), Number(roomNo))}`)?.room_id ?? '';
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
  const status = !typed || !ready ? null : value.roomId ? { ok: true, text: `Room ${value.roomId}` } : { ok: false, text: `There is no room ${value.roomNo} on ${floorLabel(Number(value.floor)).toLowerCase()} of this block.` };

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
        <Field label="Floor" required error={errors.floor} hint="0 for the ground floor">
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
        <Field label="Room number" required error={errors.room} hint="The number on your door">
          {(a) => (
            <Input
              {...a}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="e.g. 205"
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
