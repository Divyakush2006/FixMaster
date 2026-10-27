import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { metaApi } from '../../api/endpoints';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Field, Select } from '../ui/Form';
import { BlockOptions } from './BlockOptions';
import { floorLabel } from '../../utils/formatters';

export interface RoomChoice {
  blockId: string;
  floor: string;
  roomId: string;
}

export const EMPTY_ROOM_CHOICE: RoomChoice = { blockId: '', floor: '', roomId: '' };

interface RoomPickerProps {
  value: RoomChoice;
  onChange: (next: RoomChoice) => void;
  errors?: { block?: string; floor?: string; room?: string };
  /** Reports whether any block exists at all (so a form can disable submit). */
  onAvailability?: (hasInfrastructure: boolean) => void;
}

/**
 * Block -> floor -> room selection driven entirely by the hostel infrastructure
 * the administrators configured. Choosing a parent clears the choices below
 * it, so a stale room is never submitted.
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

  const floors = useMemo(() => [...new Set(rooms.map((r) => r.floor_number))].sort((a, b) => a - b), [rooms]);
  const floorRooms = useMemo(
    () =>
      rooms
        .filter((r) => String(r.floor_number) === value.floor)
        .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })),
    [rooms, value.floor]
  );
  const noInfrastructure = !loadingBlocks && !blocksFailed && blocks.length === 0;
  React.useEffect(() => onAvailability?.(!noInfrastructure), [noInfrastructure, onAvailability]);

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
              onChange={(e) => onChange({ blockId: e.target.value, floor: '', roomId: '' })}
            >
              <option value="">{loadingBlocks ? 'Loading…' : 'Select block'}</option>
              <BlockOptions blocks={blocks.filter((b) => !b.block_kind || b.block_kind === 'RESIDENTIAL')} />
            </Select>
          )}
        </Field>
        <Field label="Floor" required error={errors.floor}>
          {(a) => (
            <Select
              {...a}
              value={value.floor}
              disabled={!value.blockId || loadingRooms}
              onChange={(e) => onChange({ ...value, floor: e.target.value, roomId: '' })}
            >
              <option value="">
                {!value.blockId ? 'Choose a block first' : loadingRooms ? 'Loading…' : floors.length ? 'Select floor' : 'No rooms yet'}
              </option>
              {floors.map((f) => (
                <option key={f} value={f}>
                  {floorLabel(f)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Room" required error={errors.room}>
          {(a) => (
            <Select {...a} value={value.roomId} disabled={!value.floor} onChange={(e) => onChange({ ...value, roomId: e.target.value })}>
              <option value="">{value.floor ? 'Select room' : 'Choose a floor first'}</option>
              {floorRooms.map((r) => (
                <option key={r.room_id} value={r.room_id}>
                  {r.room_number}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </>
  );
};
