import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, metaApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/EmptyState';
import { BedDouble, DoorOpen, LogOut, AlertCircle } from 'lucide-react';

const inputClass =
  'w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-cyan-500 disabled:opacity-50';

function currentAcademicYear(): string {
  const now = new Date();
  // Academic year starts in July.
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

export const AllotmentsPage: React.FC = () => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const [blockId, setBlockId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [academicYear, setAcademicYear] = useState(currentAcademicYear());
  const [error, setError] = useState<string | null>(null);

  const { data: allotments = [], isLoading } = useQuery({ queryKey: ['admin-allotments'], queryFn: () => adminApi.listAllotments() });
  const { data: students = [] } = useQuery({ queryKey: ['admin-users', 'STUDENT'], queryFn: () => adminApi.listUsers('STUDENT') });
  const { data: blocks = [] } = useQuery({ queryKey: ['meta-blocks'], queryFn: metaApi.getBlocks });
  const { data: rooms = [] } = useQuery({
    queryKey: ['meta-rooms', blockId],
    queryFn: () => metaApi.getRoomsByBlock(blockId),
    enabled: !!blockId,
  });

  const occupancy = useMemo(() => {
    const m = new Map<string, number>();
    allotments.forEach((a) => m.set(a.room_id, (m.get(a.room_id) || 0) + 1));
    return m;
  }, [allotments]);
  const allottedStudentIds = useMemo(() => new Set(allotments.map((a) => a.student_id)), [allotments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allotments;
    return allotments.filter((a) => [a.full_name, a.reg_or_emp_id, a.room_id].some((v) => v.toLowerCase().includes(q)));
  }, [allotments, search]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-allotments'] });
  };

  const allot = useMutation({
    mutationFn: () => adminApi.allotRoom(studentId, roomId, academicYear),
    onSuccess: () => {
      refresh();
      showToast('Room allotted', 'success');
      setStudentId('');
      setRoomId('');
    },
    onError: (err: any) => setError(err.message || 'Allotment failed.'),
  });

  const end = useMutation({
    mutationFn: (sid: string) => adminApi.endAllotment(sid),
    onSuccess: () => {
      refresh();
      showToast('Allotment ended', 'success');
    },
    onError: (err: any) => showToast(err.message || 'Could not end allotment', 'error'),
  });

  return (
    <div className="space-y-6 font-sans">
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-blue-600/20 border border-blue-500/30 text-blue-400">
          <BedDouble className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-slate-100">Room Allotments</h1>
          <p className="text-xs text-slate-400">Students can only raise room tickets for the room allotted here</p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!studentId || !roomId) return setError('Choose a student and a room.');
          if (!/^\d{4}-\d{4}$/.test(academicYear)) return setError('Academic year must look like 2026-2027.');
          allot.mutate();
        }}
        className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-3"
      >
        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <DoorOpen className="w-4 h-4 text-cyan-400" />
          Allot or move a student
        </h2>
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <select className={inputClass} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Student...</option>
            {students
              .filter((s) => s.is_active)
              .map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {s.full_name} ({s.reg_or_emp_id}){allottedStudentIds.has(s.user_id) ? ' - will be moved' : ''}
                </option>
              ))}
          </select>
          <select className={inputClass} value={blockId} onChange={(e) => { setBlockId(e.target.value); setRoomId(''); }}>
            <option value="">Block...</option>
            {blocks.map((b) => <option key={b.block_id} value={b.block_id}>{b.block_name}</option>)}
          </select>
          <select className={inputClass} value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={!blockId}>
            <option value="">Room...</option>
            {rooms.map((r) => {
              const used = occupancy.get(r.room_id) || 0;
              const capacity = r.bed_capacity;
              return (
                <option key={r.room_id} value={r.room_id}>
                  {r.room_id} (Floor {r.floor_number}){capacity ? ` - ${used}/${capacity} beds` : ''}
                </option>
              );
            })}
          </select>
          <input className={inputClass} value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="2026-2027" />
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={allot.isPending} className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs disabled:opacity-50">
            {allot.isPending ? 'Saving...' : 'Allot Room'}
          </button>
        </div>
      </form>

      <SearchInput value={search} onChange={setSearch} placeholder="Search student, ID or room..." />

      {isLoading ? (
        <div className="h-32 bg-slate-900/60 rounded-2xl animate-pulse" />
      ) : filtered.length === 0 ? (
        <EmptyState title="No current allotments" description="Allotted students will appear here." />
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-950/80 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <th className="p-3">Student</th>
                <th className="p-3">Room</th>
                <th className="p-3">Floor</th>
                <th className="p-3">Year</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map((a) => (
                <tr key={a.allotment_id}>
                  <td className="p-3">
                    <div className="font-bold text-slate-100">{a.full_name}</div>
                    <div className="font-mono text-slate-500">{a.reg_or_emp_id}</div>
                  </td>
                  <td className="p-3 text-slate-200 font-semibold">{a.room_id}</td>
                  <td className="p-3 text-slate-300">{a.floor_number}</td>
                  <td className="p-3 text-slate-300">{a.academic_year}</td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => {
                        if (window.confirm(`End ${a.full_name}'s allotment of ${a.room_id}?`)) end.mutate(a.student_id);
                      }}
                      disabled={end.isPending}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>End</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
