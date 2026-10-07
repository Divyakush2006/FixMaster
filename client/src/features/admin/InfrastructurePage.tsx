import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, DoorOpen, Layers, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { adminApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Form';
import { Tabs } from '../../components/ui/Tabs';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/PageLoader';
import { Table, TableWrap, THead, Th, TBody, Tr, Td } from '../../components/ui/Table';
import { cn } from '../../components/ui/cn';
import { AdminBlock, AdminRoom, RoomType } from '../../types';
import { floorCode, floorLabel, roomNumberFor } from '../../utils/formatters';
import { ROOM_TYPE_LABEL } from '../../utils/labels';

const ROOM_TYPES: RoomType[] = ['NON_AC', 'AC', 'DELUXE_AC'];

/**
 * Admin > Blocks & rooms. Blocks A-T exist with Ground + floors 1-10; the
 * admin adds floors and rooms here. Room numbers are generated from the floor
 * and can't be typed freely: floor code (G = ground) + two-digit room, e.g.
 * G01, 428, 1007 - the database enforces the same rule.
 */
export const InfrastructurePage: React.FC = () => {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [selectedBlock, setSelectedBlock] = useState('');
  const [blockSearch, setBlockSearch] = useState('');
  const [tab, setTab] = useState<'rooms' | 'floors'>('rooms');
  const [addingBlock, setAddingBlock] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const { data: blocks = [], isLoading } = useQuery({ queryKey: ['admin-blocks'], queryFn: adminApi.listBlocks });

  useEffect(() => {
    // Open on the first block that already has rooms, else the first block.
    if (!selectedBlock && blocks.length > 0) setSelectedBlock((blocks.find((b) => b.room_count > 0) ?? blocks[0]).block_id);
  }, [blocks, selectedBlock]);

  const block = blocks.find((b) => b.block_id === selectedBlock);

  const { data: floors = [], isLoading: isLoadingFloors } = useQuery({
    queryKey: ['admin-floors', selectedBlock],
    queryFn: () => adminApi.listFloors(selectedBlock),
    enabled: !!selectedBlock,
  });
  const { data: rooms = [], isLoading: isLoadingRooms } = useQuery({
    queryKey: ['admin-rooms', selectedBlock],
    queryFn: () => adminApi.listRooms(selectedBlock),
    enabled: !!selectedBlock,
  });

  const roomsByFloor = useMemo(() => {
    const m = new Map<number, AdminRoom[]>();
    rooms.forEach((r) => m.set(r.floor_number, [...(m.get(r.floor_number) || []), r]));
    return [...m.entries()].sort(([a], [b]) => a - b);
  }, [rooms]);

  const visibleBlocks = useMemo(() => {
    const q = blockSearch.trim().toLowerCase();
    return q ? blocks.filter((b) => [b.block_code, b.block_name, b.block_id].some((v) => v.toLowerCase().includes(q))) : blocks;
  }, [blocks, blockSearch]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-blocks'] });
    queryClient.invalidateQueries({ queryKey: ['admin-floors', selectedBlock] });
    queryClient.invalidateQueries({ queryKey: ['admin-rooms', selectedBlock] });
    // Student/admin room pickers read the public rooms list.
    queryClient.invalidateQueries({ queryKey: ['meta-rooms'] });
    queryClient.invalidateQueries({ queryKey: ['meta-blocks'] });
  };

  const addFloor = useMutation({
    mutationFn: () => adminApi.addFloor(selectedBlock),
    onSuccess: (f) => {
      refresh();
      showToast(`${floorLabel(f.floor_number)} added`, 'success', `Rooms on it are numbered ${f.floor_code}01, ${f.floor_code}02, …`);
    },
    onError: (err: Error) => showToast('Could not add the floor', 'error', err.message),
  });

  const removeFloor = useMutation({
    mutationFn: (floorNumber: number) => adminApi.removeFloor(selectedBlock, floorNumber),
    onSuccess: (res) => {
      refresh();
      showToast('Floor removed', 'success', res.message);
    },
    onError: (err: Error) => showToast('Could not remove the floor', 'error', err.message),
  });

  const updateRoom = useMutation({
    mutationFn: ({ roomId, changes }: { roomId: string; changes: Parameters<typeof adminApi.updateRoom>[1] }) => adminApi.updateRoom(roomId, changes),
    onSuccess: (room) => {
      refresh();
      showToast(room.is_active ? `Room ${room.room_id} reopened` : `Room ${room.room_id} closed`, 'success');
    },
    onError: (err: Error) => showToast('Could not update the room', 'error', err.message),
  });

  const toggleRoom = async (r: AdminRoom) => {
    if (r.is_active) {
      const ok = await confirm({
        title: `Close room ${r.room_id}?`,
        message: 'A closed room is hidden from students and cannot be allotted. Rooms with residents cannot be closed.',
        confirmLabel: 'Close room',
        tone: 'danger',
      });
      if (!ok) return;
    }
    updateRoom.mutate({ roomId: r.room_id, changes: { is_active: !r.is_active } });
  };

  const occupancyPct = block && block.total_beds > 0 ? Math.round((block.occupied_beds / block.total_beds) * 100) : 0;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Administration' }, { label: 'Blocks & rooms' }]}
        title="Blocks & rooms"
        description={
          <>
            Room numbers are the floor code followed by a two-digit room: <span className="font-mono text-slate-700">G01</span> is ground floor room 1,{' '}
            <span className="font-mono text-slate-700">428</span> is floor 4 room 28.
          </>
        }
        actions={
          <Button variant="secondary" icon={Plus} onClick={() => setAddingBlock(true)}>
            New block
          </Button>
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[280px_1fr]">
        {/* Block list */}
        <Card className="lg:sticky lg:top-20">
          <div className="border-b border-slate-200 p-3">
            <SearchInput value={blockSearch} onChange={setBlockSearch} placeholder="Find a block" label="Find a block" />
          </div>
          <nav aria-label="Blocks" className="max-h-[60vh] overflow-y-auto p-2 lg:max-h-[calc(100vh-13rem)]">
            {isLoading ? (
              <div className="space-y-2 p-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-11" />
                ))}
              </div>
            ) : visibleBlocks.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-slate-500">No blocks match.</p>
            ) : (
              <ul className="space-y-0.5">
                {visibleBlocks.map((b) => {
                  const active = b.block_id === selectedBlock;
                  return (
                    <li key={b.block_id}>
                      <button
                        type="button"
                        onClick={() => setSelectedBlock(b.block_id)}
                        aria-current={active ? 'true' : undefined}
                        className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors', active ? 'bg-brand-50' : 'hover:bg-slate-50')}
                      >
                        <span
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-mono text-xs font-semibold',
                            active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'
                          )}
                        >
                          {b.block_code}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate text-[13px] font-medium', active ? 'text-brand-800' : 'text-slate-900')}>{b.block_name}</span>
                          <span className="block text-xs text-slate-500">
                            {b.room_count} {b.room_count === 1 ? 'room' : 'rooms'} · {b.floor_count} floors
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>
        </Card>

        {/* Selected block */}
        {!block ? (
          isLoading ? (
            <Skeleton className="h-80" />
          ) : (
            <EmptyState icon={Building2} title="No blocks yet" description="Create the first hostel block to start adding floors and rooms." />
          )
        ) : (
          <div className="min-w-0 space-y-6">
            <Card>
              <div className="flex flex-col gap-5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3.5">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-600 font-mono text-base font-semibold text-white">
                    {block.block_code}
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h2 className="text-lg font-semibold text-slate-900">{block.block_name}</h2>
                      <IconButton icon={Pencil} label="Rename block" size="sm" onClick={() => setRenaming(true)} />
                    </div>
                    <p className="font-mono text-xs text-slate-500">{block.block_id}</p>
                  </div>
                </div>
                <dl className="grid grid-cols-3 gap-6 text-right sm:gap-8">
                  <div>
                    <dt className="text-xs text-slate-500">Floors</dt>
                    <dd className="text-lg font-semibold text-slate-900 tabular">{block.floor_count}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Open rooms</dt>
                    <dd className="text-lg font-semibold text-slate-900 tabular">
                      {block.active_room_count}
                      {block.room_count !== block.active_room_count && <span className="text-sm font-normal text-slate-500">/{block.room_count}</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Beds occupied</dt>
                    <dd className="text-lg font-semibold text-slate-900 tabular">
                      {block.occupied_beds}
                      <span className="text-sm font-normal text-slate-500">/{block.total_beds}</span>
                    </dd>
                  </div>
                </dl>
              </div>
              {block.total_beds > 0 && (
                <div className="border-t border-slate-100 px-5 py-3">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Occupancy</span>
                    <span className="tabular">{occupancyPct}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${occupancyPct}%` }} />
                  </div>
                </div>
              )}
            </Card>

            <Tabs
              ariaLabel="Block sections"
              value={tab}
              onChange={setTab}
              items={[
                { value: 'rooms', label: 'Rooms', icon: DoorOpen, count: block.room_count },
                { value: 'floors', label: 'Floors', icon: Layers, count: block.floor_count },
              ]}
            />

            {tab === 'rooms' ? (
              <>
                <AddRoomsForm blockId={block.block_id} blockCode={block.block_code} floors={floors.map((f) => f.floor_number)} onCreated={refresh} />

                {isLoadingRooms ? (
                  <Skeleton className="h-48" />
                ) : rooms.length === 0 ? (
                  <EmptyState icon={DoorOpen} title="No rooms in this block yet" description="Add rooms above, one floor at a time." />
                ) : (
                  <Card>
                    <CardHeader title="Rooms by floor" description="Close a room to hide it from students; occupied rooms can't be closed." />
                    <ul className="divide-y divide-slate-100">
                      {roomsByFloor.map(([floorNumber, floorRooms]) => (
                        <li key={floorNumber} className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[150px_1fr]">
                          <div className="flex items-center gap-2.5 md:block">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700">{floorCode(floorNumber)}</span>
                            <p className="text-[13px] font-medium text-slate-900 md:mt-2">{floorLabel(floorNumber)}</p>
                            <p className="text-xs text-slate-500">
                              {floorRooms.length} {floorRooms.length === 1 ? 'room' : 'rooms'}
                            </p>
                          </div>
                          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                            {floorRooms.map((r) => {
                              const pct = r.bed_capacity ? (r.occupied_beds / r.bed_capacity) * 100 : 0;
                              return (
                                <li
                                  key={r.room_id}
                                  className={cn('rounded-md border px-3 py-2.5', r.is_active ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50')}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className={cn('font-mono text-[15px] font-semibold', r.is_active ? 'text-slate-900' : 'text-slate-500')}>{r.room_number}</span>
                                    <IconButton
                                      icon={Power}
                                      size="sm"
                                      tone={r.is_active ? 'danger' : 'default'}
                                      label={r.is_active ? `Close room ${r.room_id}` : `Reopen room ${r.room_id}`}
                                      disabled={updateRoom.isPending}
                                      onClick={() => toggleRoom(r)}
                                    />
                                  </div>
                                  <div className="mt-0.5 flex items-center justify-between text-xs text-slate-500">
                                    <span>{ROOM_TYPE_LABEL[r.room_type]}</span>
                                    {r.is_active ? (
                                      <span className="tabular">
                                        {r.occupied_beds}/{r.bed_capacity} beds
                                      </span>
                                    ) : (
                                      <Badge className="px-1.5 py-0 text-2xs">Closed</Badge>
                                    )}
                                  </div>
                                  {r.is_active && (
                                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                                      <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-brand-400')} style={{ width: `${pct}%` }} />
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </>
            ) : (
              <Card>
                <CardHeader
                  title="Floors"
                  description="A floor can be removed only when it has no rooms or common areas."
                  actions={
                    <Button size="sm" icon={Plus} loading={addFloor.isPending} onClick={() => addFloor.mutate()}>
                      Add floor above
                    </Button>
                  }
                />
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <Th>Code</Th>
                        <Th>Floor</Th>
                        <Th className="text-right">Rooms</Th>
                        <Th className="text-right">Common areas</Th>
                        <Th>Room numbers</Th>
                        <Th className="text-right">
                          <span className="sr-only">Actions</span>
                        </Th>
                      </tr>
                    </THead>
                    <TBody>
                      {isLoadingFloors && (
                        <tr>
                          <td colSpan={6} className="p-4">
                            <Skeleton className="h-24" />
                          </td>
                        </tr>
                      )}
                      {floors.map((f) => {
                        const empty = f.room_count === 0 && f.common_area_count === 0;
                        return (
                          <Tr key={f.floor_number}>
                            <Td>
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700">{f.floor_code}</span>
                            </Td>
                            <Td className="font-medium text-slate-900">{floorLabel(f.floor_number)}</Td>
                            <Td className="text-right tabular">{f.room_count}</Td>
                            <Td className="text-right tabular">{f.common_area_count}</Td>
                            <Td className="font-mono text-xs text-slate-500">
                              {roomNumberFor(f.floor_number, 1)} – {roomNumberFor(f.floor_number, 99)}
                            </Td>
                            <Td className="text-right">
                              {empty ? (
                                <IconButton
                                  icon={Trash2}
                                  tone="danger"
                                  size="sm"
                                  label={`Remove ${floorLabel(f.floor_number)}`}
                                  disabled={removeFloor.isPending}
                                  onClick={async () => {
                                    const ok = await confirm({
                                      title: `Remove ${floorLabel(f.floor_number).toLowerCase()}?`,
                                      message: `It will be removed from ${block.block_name}. You can add it again later.`,
                                      confirmLabel: 'Remove floor',
                                      tone: 'danger',
                                    });
                                    if (ok) removeFloor.mutate(f.floor_number);
                                  }}
                                />
                              ) : (
                                <span className="text-xs text-slate-500">In use</span>
                              )}
                            </Td>
                          </Tr>
                        );
                      })}
                    </TBody>
                  </Table>
                </TableWrap>
              </Card>
            )}
          </div>
        )}
      </div>

      {addingBlock && (
        <AddBlockModal
          onClose={() => setAddingBlock(false)}
          onCreated={(blockId) => {
            refresh();
            setSelectedBlock(blockId);
          }}
        />
      )}
      {renaming && block && <RenameBlockModal block={block} onClose={() => setRenaming(false)} onRenamed={refresh} />}
    </div>
  );
};

const AddRoomsForm: React.FC<{ blockId: string; blockCode: string; floors: number[]; onCreated: () => void }> = ({ blockId, blockCode, floors, onCreated }) => {
  const { showToast } = useToast();
  const [floor, setFloor] = useState<number | ''>('');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [roomType, setRoomType] = useState<RoomType>('NON_AC');
  const [beds, setBeds] = useState(3);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFloor('');
    setError(null);
  }, [blockId]);

  const valid = floor !== '' && from >= 1 && to >= from && to <= 99;
  const count = Math.max(0, Math.min(to, 99) - from + 1);
  const preview =
    floor === ''
      ? null
      : from === to
        ? `${blockCode}-${roomNumberFor(floor, from)}`
        : `${blockCode}-${roomNumberFor(floor, from)} to ${blockCode}-${roomNumberFor(floor, Math.min(to, 99))}`;

  const mutation = useMutation({
    mutationFn: () => adminApi.createRooms(blockId, { floor_number: floor as number, from, to, room_type: roomType, bed_capacity: beds }),
    onSuccess: (res) => {
      onCreated();
      showToast(res.message, res.created.length ? 'success' : 'info', res.skipped.length ? `Already existed: ${res.skipped.join(', ')}` : undefined);
    },
    onError: (err: Error) => setError(err.message || 'Could not create rooms.'),
  });

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!valid) return setError('Choose a floor and a room range between 01 and 99.');
          mutation.mutate();
        }}
        noValidate
      >
        <CardHeader title="Add rooms" description="Add a single room or a numbered range on one floor. Existing rooms are skipped." />
        <CardBody className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <Field label="Floor" required className="col-span-2 md:col-span-1">
              {(a) => (
                <Select {...a} value={floor} onChange={(e) => setFloor(e.target.value === '' ? '' : Number(e.target.value))}>
                  <option value="">Select</option>
                  {floors.map((f) => (
                    <option key={f} value={f}>
                      {floorCode(f)} · {floorLabel(f)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="From room" required>
              {(a) => (
                <Input
                  {...a}
                  type="number"
                  min={1}
                  max={99}
                  value={from}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setFrom(v);
                    if (to < v) setTo(v);
                  }}
                />
              )}
            </Field>
            <Field label="To room" required>
              {(a) => <Input {...a} type="number" min={from} max={99} value={to} onChange={(e) => setTo(Number(e.target.value))} />}
            </Field>
            <Field label="Room type" required>
              {(a) => (
                <Select {...a} value={roomType} onChange={(e) => setRoomType(e.target.value as RoomType)}>
                  {ROOM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ROOM_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Beds per room" required>
              {(a) => (
                <Select {...a} value={beds} onChange={(e) => setBeds(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </CardBody>
        <div className="flex flex-col gap-3 rounded-b-lg border-t border-slate-200 bg-slate-50/70 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-slate-600">
            {preview ? (
              <>
                Will create <span className="font-mono font-medium text-slate-900">{preview}</span>
                {count > 1 && <span className="text-slate-500"> ({count} rooms)</span>}
              </>
            ) : (
              <span className="text-slate-500">Choose a floor to preview the room numbers.</span>
            )}
          </p>
          <Button type="submit" icon={Plus} disabled={!valid} loading={mutation.isPending}>
            {count > 1 ? `Create ${count} rooms` : 'Create room'}
          </Button>
        </div>
      </form>
    </Card>
  );
};

const AddBlockModal: React.FC<{ onClose: () => void; onCreated: (blockId: string) => void }> = ({ onClose, onCreated }) => {
  const { showToast } = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [topFloor, setTopFloor] = useState(10);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => adminApi.createBlock(code.trim().toUpperCase(), name.trim(), topFloor),
    onSuccess: (b) => {
      showToast('Block created', 'success', `${b.block_name} with ground floor and floors 1–${topFloor}.`);
      onCreated(b.block_id);
      onClose();
    },
    onError: (err: Error) => setError(err.message || 'Could not create the block.'),
  });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!/^[A-Za-z0-9]{1,3}$/.test(code.trim())) return setError('The block code must be 1–3 letters or digits, e.g. U or PRP.');
    if (!name.trim()) return setError('Enter a block name.');
    if (!Number.isInteger(topFloor) || topFloor < 1 || topFloor > 99) return setError('The top floor must be between 1 and 99.');
    mutation.mutate();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="New block"
      subtitle="The ground floor and floors 1 to the top floor are created automatically."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} onClick={() => submit()}>
            Create block
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-3 gap-4">
          <Field label="Code" required hint="e.g. U">
            {(a) => <Input {...a} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={3} className="font-mono uppercase" />}
          </Field>
          <Field label="Name" required className="col-span-2" hint="e.g. U-Block">
            {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />}
          </Field>
        </div>
        <Field label="Top floor" required hint="Floors can be added or removed later.">
          {(a) => <Input {...a} type="number" min={1} max={99} value={topFloor} onChange={(e) => setTopFloor(Number(e.target.value))} className="w-32" />}
        </Field>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
};

const RenameBlockModal: React.FC<{ block: AdminBlock; onClose: () => void; onRenamed: () => void }> = ({ block, onClose, onRenamed }) => {
  const { showToast } = useToast();
  const [name, setName] = useState(block.block_name);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => adminApi.renameBlock(block.block_id, name.trim()),
    onSuccess: () => {
      onRenamed();
      showToast('Block renamed', 'success');
      onClose();
    },
    onError: (err: Error) => setError(err.message || 'Could not rename the block.'),
  });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Enter a block name.');
    if (name.trim() === block.block_name) return onClose();
    mutation.mutate();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Rename block"
      subtitle={`Code ${block.block_code} · ${block.block_id}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} onClick={() => submit()}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Block name" required>
          {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />}
        </Field>
      </form>
    </Modal>
  );
};
