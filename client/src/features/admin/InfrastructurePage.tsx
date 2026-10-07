import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { Modal } from '../../components/ui/Modal';
import { AdminRoom, RoomType } from '../../types';
import { floorCode, floorLabel, roomNumberFor } from '../../utils/formatters';
import { Building, Layers, Plus, DoorOpen, Trash2, Power, Pencil, AlertCircle } from 'lucide-react';

const ROOM_TYPES: RoomType[] = ['NON_AC', 'AC', 'DELUXE_AC'];
const inputClass =
  'w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-cyan-500 disabled:opacity-50';

/**
 * Admin > Blocks & Rooms. Blocks A-T exist with Ground + floors 1-10; the
 * admin adds floors and rooms here. Room numbers are generated from the floor
 * and can't be typed freely: floor code (G = ground) + two-digit room, e.g.
 * G01, 428, 1007 - the database enforces the same rule.
 */
export const InfrastructurePage: React.FC = () => {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selectedBlock, setSelectedBlock] = useState<string>('');
  const [addingBlock, setAddingBlock] = useState(false);

  const { data: blocks = [], isLoading } = useQuery({ queryKey: ['admin-blocks'], queryFn: adminApi.listBlocks });

  useEffect(() => {
    if (!selectedBlock && blocks.length > 0) setSelectedBlock(blocks[0].block_id);
  }, [blocks, selectedBlock]);

  const block = blocks.find((b) => b.block_id === selectedBlock);

  const { data: floors = [] } = useQuery({
    queryKey: ['admin-floors', selectedBlock],
    queryFn: () => adminApi.listFloors(selectedBlock),
    enabled: !!selectedBlock,
  });
  const { data: rooms = [] } = useQuery({
    queryKey: ['admin-rooms', selectedBlock],
    queryFn: () => adminApi.listRooms(selectedBlock),
    enabled: !!selectedBlock,
  });

  const roomsByFloor = useMemo(() => {
    const m = new Map<number, AdminRoom[]>();
    rooms.forEach((r) => m.set(r.floor_number, [...(m.get(r.floor_number) || []), r]));
    return m;
  }, [rooms]);

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
      showToast('Floor added', 'success', `${floorLabel(f.floor_number)} - rooms on it are numbered ${f.floor_code}01, ${f.floor_code}02, ...`);
    },
    onError: (err: any) => showToast(err.message || 'Could not add floor', 'error'),
  });

  const removeFloor = useMutation({
    mutationFn: (floorNumber: number) => adminApi.removeFloor(selectedBlock, floorNumber),
    onSuccess: (res) => {
      refresh();
      showToast(res.message, 'success');
    },
    onError: (err: any) => showToast(err.message || 'Could not remove floor', 'error'),
  });

  const updateRoom = useMutation({
    mutationFn: ({ roomId, changes }: { roomId: string; changes: Parameters<typeof adminApi.updateRoom>[1] }) =>
      adminApi.updateRoom(roomId, changes),
    onSuccess: () => refresh(),
    onError: (err: any) => showToast(err.message || 'Could not update room', 'error'),
  });

  const renameBlock = useMutation({
    mutationFn: (name: string) => adminApi.renameBlock(selectedBlock, name),
    onSuccess: () => {
      refresh();
      showToast('Block renamed', 'success');
    },
    onError: (err: any) => showToast(err.message || 'Could not rename block', 'error'),
  });

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-amber-600/20 border border-amber-500/30 text-amber-400">
            <Building className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-100">Blocks, Floors & Rooms</h1>
            <p className="text-xs text-slate-400">
              Room numbers: floor code + room, e.g. <span className="font-mono">G01</span> (ground),{' '}
              <span className="font-mono">428</span> (floor 4, room 28)
            </p>
          </div>
        </div>
        <button
          onClick={() => setAddingBlock(true)}
          className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs flex items-center gap-2 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Block</span>
        </button>
      </div>

      {/* Block picker */}
      {isLoading ? (
        <div className="h-24 bg-slate-900/60 rounded-2xl animate-pulse" />
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-11 gap-2">
          {blocks.map((b) => (
            <button
              key={b.block_id}
              onClick={() => setSelectedBlock(b.block_id)}
              className={`p-2.5 rounded-xl border text-center transition-colors ${
                b.block_id === selectedBlock
                  ? 'bg-amber-600/20 border-amber-500/50 text-amber-200'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
              }`}
              title={b.block_name}
            >
              <div className="text-sm font-black">{b.block_code}</div>
              <div className="text-[10px] text-slate-400">{b.room_count} rooms</div>
            </button>
          ))}
        </div>
      )}

      {block && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Block summary + floors */}
          <section className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-extrabold text-slate-100">{block.block_name}</h2>
                <p className="text-[11px] text-slate-400 font-mono">{block.block_id}</p>
              </div>
              <button
                onClick={() => {
                  const name = window.prompt('Block name', block.block_name);
                  if (name && name.trim() && name.trim() !== block.block_name) renameBlock.mutate(name.trim());
                }}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                title="Rename block"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <Stat label="Floors" value={block.floor_count} />
              <Stat label="Rooms" value={block.active_room_count} />
              <Stat label="Beds used" value={`${block.occupied_beds}/${block.total_beds}`} />
            </div>

            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-amber-400" /> Floors
              </h3>
              <button
                onClick={() => addFloor.mutate()}
                disabled={addFloor.isPending}
                className="px-2.5 py-1.5 rounded-lg bg-amber-600/20 border border-amber-500/40 text-amber-200 text-[11px] font-bold flex items-center gap-1 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" /> Add floor above
              </button>
            </div>

            <ul className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
              {floors.map((f) => {
                const empty = f.room_count === 0 && f.common_area_count === 0;
                return (
                  <li key={f.floor_number} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                    <span className="flex items-center gap-2">
                      <span className="w-8 text-center font-mono font-bold text-amber-300">{f.floor_code}</span>
                      <span className="text-slate-300">{floorLabel(f.floor_number)}</span>
                    </span>
                    <span className="flex items-center gap-2 text-slate-400">
                      <span>{f.room_count} rooms</span>
                      {empty && (
                        <button
                          onClick={() => {
                            if (window.confirm(`Remove ${floorLabel(f.floor_number)} from ${block.block_name}?`)) removeFloor.mutate(f.floor_number);
                          }}
                          className="p-1 rounded text-slate-500 hover:text-rose-400"
                          title="Remove empty floor"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Rooms */}
          <section className="lg:col-span-2 p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-4">
            <AddRoomsForm
              blockId={block.block_id}
              blockCode={block.block_code}
              floors={floors.map((f) => f.floor_number)}
              onCreated={refresh}
            />

            {rooms.length === 0 ? (
              <p className="text-xs text-slate-400 p-6 text-center bg-slate-950 rounded-2xl border border-slate-800">
                No rooms in this block yet. Add them above, floor by floor.
              </p>
            ) : (
              <div className="space-y-4 max-h-[32rem] overflow-y-auto pr-1">
                {[...roomsByFloor.entries()]
                  .sort(([a], [b]) => a - b)
                  .map(([floorNumber, floorRooms]) => (
                    <div key={floorNumber}>
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        {floorLabel(floorNumber)}
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                        {floorRooms.map((r) => (
                          <div
                            key={r.room_id}
                            className={`p-2.5 rounded-xl border text-xs ${r.is_active ? 'bg-slate-950 border-slate-800' : 'bg-slate-950/40 border-slate-800/50 opacity-60'}`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-black text-slate-100 font-mono">{r.room_number}</span>
                              <button
                                onClick={() => updateRoom.mutate({ roomId: r.room_id, changes: { is_active: !r.is_active } })}
                                className={`p-1 rounded ${r.is_active ? 'text-emerald-400 hover:text-rose-400' : 'text-slate-500 hover:text-emerald-400'}`}
                                title={r.is_active ? 'Close room (hide from students)' : 'Reopen room'}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {r.room_type.replace('_', ' ')} · {r.occupied_beds}/{r.bed_capacity} beds
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </section>
        </div>
      )}

      {addingBlock && (
        <AddBlockModal
          onClose={() => setAddingBlock(false)}
          onCreated={(blockId) => {
            refresh();
            setSelectedBlock(blockId);
          }}
        />
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
    <div className="text-[10px] text-slate-400 uppercase font-semibold">{label}</div>
    <div className="font-extrabold text-slate-100">{value}</div>
  </div>
);

const AddRoomsForm: React.FC<{ blockId: string; blockCode: string; floors: number[]; onCreated: () => void }> = ({
  blockId,
  blockCode,
  floors,
  onCreated,
}) => {
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
  const preview =
    floor === ''
      ? 'Choose a floor'
      : from === to
        ? `${blockCode}-${roomNumberFor(floor, from)}`
        : `${blockCode}-${roomNumberFor(floor, from)} … ${blockCode}-${roomNumberFor(floor, Math.min(to, 99))} (${Math.max(0, Math.min(to, 99) - from + 1)} rooms)`;

  const mutation = useMutation({
    mutationFn: () =>
      adminApi.createRooms(blockId, { floor_number: floor as number, from, to, room_type: roomType, bed_capacity: beds }),
    onSuccess: (res) => {
      onCreated();
      showToast(res.message, res.created.length ? 'success' : 'info', res.skipped.length ? `Already existed: ${res.skipped.join(', ')}` : undefined);
    },
    onError: (err: any) => setError(err.message || 'Could not create rooms.'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!valid) return setError('Choose a floor and a room range between 01 and 99.');
        mutation.mutate();
      }}
      className="space-y-3"
    >
      <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
        <DoorOpen className="w-4 h-4 text-cyan-400" /> Add rooms
      </h3>
      {error && (
        <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <label className="text-[10px] text-slate-400 space-y-1">
          <span>Floor</span>
          <select className={inputClass} value={floor} onChange={(e) => setFloor(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Floor...</option>
            {floors.map((f) => (
              <option key={f} value={f}>
                {floorCode(f)} - {floorLabel(f)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-slate-400 space-y-1">
          <span>From room</span>
          <input className={inputClass} type="number" min={1} max={99} value={from} onChange={(e) => { const v = Number(e.target.value); setFrom(v); if (to < v) setTo(v); }} />
        </label>
        <label className="text-[10px] text-slate-400 space-y-1">
          <span>To room</span>
          <input className={inputClass} type="number" min={from} max={99} value={to} onChange={(e) => setTo(Number(e.target.value))} />
        </label>
        <label className="text-[10px] text-slate-400 space-y-1">
          <span>Type</span>
          <select className={inputClass} value={roomType} onChange={(e) => setRoomType(e.target.value as RoomType)}>
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace('_', ' ')}</option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-slate-400 space-y-1">
          <span>Beds</span>
          <select className={inputClass} value={beds} onChange={(e) => setBeds(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">
          Will create: <span className="font-mono text-slate-200">{preview}</span>
        </span>
        <button
          type="submit"
          disabled={!valid || mutation.isPending}
          className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs disabled:opacity-40"
        >
          {mutation.isPending ? 'Creating...' : 'Create rooms'}
        </button>
      </div>
    </form>
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
      showToast('Block created', 'success', `${b.block_name} with Ground + floors 1-${topFloor}`);
      onCreated(b.block_id);
      onClose();
    },
    onError: (err: any) => setError(err.message || 'Could not create block.'),
  });

  return (
    <Modal isOpen onClose={onClose} title="New Block" subtitle="Ground + floors 1..N are created automatically" maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!/^[A-Za-z0-9]{1,3}$/.test(code.trim())) return setError('Block code must be 1-3 letters or digits, e.g. U or PRP.');
          if (!name.trim()) return setError('Block name is required.');
          mutation.mutate();
        }}
        className="space-y-3"
      >
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <input className={inputClass} placeholder="Block code (e.g. U)" value={code} onChange={(e) => setCode(e.target.value)} maxLength={3} required />
        <input className={inputClass} placeholder="Block name (e.g. U-Block)" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
        <label className="block text-[11px] text-slate-400 space-y-1">
          <span>Top floor</span>
          <input className={inputClass} type="number" min={1} max={99} value={topFloor} onChange={(e) => setTopFloor(Number(e.target.value))} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 text-xs">Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold disabled:opacity-50">
            {mutation.isPending ? 'Creating...' : 'Create Block'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
