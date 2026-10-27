import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarX2, Trash2 } from 'lucide-react';
import { adminApi, infraApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { Modal } from '../../components/ui/Modal';
import { Alert } from '../../components/ui/Alert';
import { Button, IconButton } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Form';
import type { AdminBlock, HostelType, StaffShift, User } from '../../types';
import { HOSTEL_LABEL } from '../../utils/labels';

const SHIFT_LABEL: Record<StaffShift, string> = { MORNING: 'Morning (6–2)', EVENING: 'Evening (2–10)', NIGHT: 'Night (10–6)' };

const HOSTEL_SHORT: Record<HostelType, string> = { MENS: "Men's", LADIES: "Ladies'" };

/** One line for the users table: where a staff member works, which hostel and blocks a supervisor runs, or a chief warden's hostel. */
export function placementSummary(u: User): string | null {
  if (u.role === 'STAFF') {
    const where = u.home_block_id ? u.home_block_id.replace(/_BLOCK$/, '-Block') : 'Campus pool';
    return u.shift ? `${where} · ${SHIFT_LABEL[u.shift].split(' ')[0]}` : where;
  }
  if (u.role === 'SUPERVISOR') {
    const blocks = u.managed_blocks ?? [];
    const what = blocks.length === 0 ? (u.hostel_type ? 'Every block' : 'All blocks') : blocks.map((b) => b.replace(/_BLOCK$/, '')).join(', ');
    return u.hostel_type ? `${HOSTEL_SHORT[u.hostel_type]} · ${what}` : what;
  }
  if (u.role === 'CHIEF_WARDEN') return u.hostel_type ? HOSTEL_LABEL[u.hostel_type] : 'Every block';
  return null;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Staff: home block, shift and leave (all used by the dispatch autopilot).
 * Supervisors: their hostel and the blocks they manage; none ticked means every
 * block of their hostel. Chief wardens: their hostel (they run all of it).
 */
export const OrganiseUserModal: React.FC<{ user: User; onClose: () => void; onSaved: () => void }> = ({ user, onClose, onSaved }) => {
  const isStaff = user.role === 'STAFF';
  const isSupervisor = user.role === 'SUPERVISOR';
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { data: blocks = [] } = useQuery({ queryKey: ['admin-blocks'], queryFn: infraApi.listBlocks });
  const [hostel, setHostel] = useState<HostelType | ''>(user.hostel_type ?? '');

  const [homeBlock, setHomeBlock] = useState(user.home_block_id ?? '');
  const [shift, setShift] = useState<StaffShift | ''>(user.shift ?? '');
  const [managed, setManaged] = useState<string[]>(user.managed_blocks ?? []);
  const [error, setError] = useState<string | null>(null);

  // A supervisor can be given blocks of their own hostel (and the academic blocks both share).
  const offered = blocks.filter((b) => !hostel || b.hostel_type === null || b.hostel_type === hostel);

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      if (isStaff) {
        await adminApi.setPlacement(user.user_id, { home_block_id: homeBlock || null, shift: shift || null });
        return;
      }
      if ((hostel || null) !== (user.hostel_type ?? null)) await adminApi.setUserHostel(user.user_id, hostel || null);
      if (isSupervisor) await adminApi.setSupervisorBlocks(user.user_id, managed.filter((id) => offered.some((b) => b.block_id === id)));
    },
    onSuccess: () => {
      onSaved();
      showToast(isStaff ? 'Placement saved' : 'Hostel and blocks saved', 'success');
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggle = (id: string) => setManaged((m) => (m.includes(id) ? m.filter((b) => b !== id) : [...m, id]));

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isStaff ? `Placement · ${user.full_name}` : isSupervisor ? `Hostel & blocks · ${user.full_name}` : `Hostel · ${user.full_name}`}
      maxWidth="lg"
      subtitle={
        isStaff
          ? 'The autopilot prefers staff based in the ticket’s block and never picks anyone off shift or on leave.'
          : isSupervisor
            ? 'The supervisor sees and acts on tickets in these blocks only. Leave all unticked for every block of their hostel.'
            : 'The chief warden runs every block of this hostel, plus the academic blocks. Each hostel has one chief warden.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}
        {isStaff ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Home block" hint="Leave as campus pool for staff who cover every block.">
                {(a) => (
                  <Select {...a} value={homeBlock} onChange={(e) => setHomeBlock(e.target.value)}>
                    <option value="">Campus pool</option>
                    {blocks.map((b) => (
                      <option key={b.block_id} value={b.block_id}>
                        {b.block_name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Shift" hint="No shift means available at any hour.">
                {(a) => (
                  <Select {...a} value={shift} onChange={(e) => setShift(e.target.value as StaffShift | '')}>
                    <option value="">Any hour</option>
                    {(Object.keys(SHIFT_LABEL) as StaffShift[]).map((s) => (
                      <option key={s} value={s}>
                        {SHIFT_LABEL[s]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <LeavePanel userId={user.user_id} onChanged={() => queryClient.invalidateQueries({ queryKey: ['admin-leave', user.user_id] })} />
          </>
        ) : (
          <>
            <Field label="Hostel" hint="Detached accounts keep the old behaviour: every block.">
              {(a) => (
                <Select {...a} value={hostel} onChange={(e) => setHostel(e.target.value as HostelType | '')}>
                  <option value="">Not attached to a hostel</option>
                  <option value="MENS">{HOSTEL_LABEL.MENS}</option>
                  <option value="LADIES">{HOSTEL_LABEL.LADIES}</option>
                </Select>
              )}
            </Field>
            {isSupervisor && <BlockChecklist blocks={offered} selected={managed} onToggle={toggle} hostelChosen={!!hostel} />}
            {isSupervisor && hostel && user.hostel_type && hostel !== user.hostel_type && (
              <Alert tone="warning">Moving a supervisor to the other hostel takes away any blocks they run in {HOSTEL_LABEL[user.hostel_type]}.</Alert>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

const BlockChecklist: React.FC<{ blocks: AdminBlock[]; selected: string[]; onToggle: (id: string) => void; hostelChosen: boolean }> = ({
  blocks,
  selected,
  onToggle,
  hostelChosen,
}) => (
  <fieldset>
    <legend className="mb-2 text-[13px] font-medium text-slate-700">
      Blocks managed{' '}
      <span className="font-normal text-slate-500">({selected.length === 0 ? (hostelChosen ? 'every block of the hostel' : 'every block') : `${selected.length} selected`})</span>
    </legend>
    <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
      {blocks.map((b) => (
        <label key={b.block_id} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm hover:border-slate-300">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={selected.includes(b.block_id)} onChange={() => onToggle(b.block_id)} />
          <span className="truncate">{b.block_name}</span>
          {b.hostel_type === 'LADIES' && <span className="ml-auto text-[11px] text-slate-500">Ladies</span>}
          {b.block_kind !== 'RESIDENTIAL' && <span className="ml-auto text-[11px] text-slate-500">{b.block_kind === 'ACADEMIC' ? 'Academic' : 'Whole hostel'}</span>}
        </label>
      ))}
    </div>
  </fieldset>
);

const LeavePanel: React.FC<{ userId: string; onChanged: () => void }> = ({ userId, onChanged }) => {
  const { data: leave = [], isLoading } = useQuery({ queryKey: ['admin-leave', userId], queryFn: () => adminApi.listLeave(userId) });
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => adminApi.addLeave(userId, { starts_on: from, ends_on: to, reason: reason.trim() || undefined }),
    onSuccess: () => {
      setReason('');
      setError(null);
      onChanged();
    },
    onError: (err: Error) => setError(err.message),
  });
  const remove = useMutation({ mutationFn: (id: number) => adminApi.deleteLeave(id), onSuccess: onChanged });

  return (
    <section className="rounded-lg border border-slate-200 p-4" aria-labelledby="leave-heading">
      <h3 id="leave-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <CalendarX2 className="h-4 w-4 text-slate-500" aria-hidden />
        Leave
      </h3>
      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : leave.length === 0 ? (
        <p className="text-sm text-slate-500">No leave recorded.</p>
      ) : (
        <ul className="mb-3 divide-y divide-slate-100">
          {leave.map((l) => (
            <li key={l.leave_id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="font-mono text-[13px]">
                  {l.starts_on} → {l.ends_on}
                </span>
                {l.reason && <span className="ml-2 text-slate-500">{l.reason}</span>}
              </span>
              <IconButton icon={Trash2} label="Remove this leave" size="sm" tone="danger" onClick={() => remove.mutate(l.leave_id)} />
            </li>
          ))}
        </ul>
      )}
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
        <Field label="From">{(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="To">{(a) => <Input {...a} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
        <Field label="Reason (optional)">{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
        <Button variant="secondary" loading={add.isPending} onClick={() => add.mutate()}>
          Add leave
        </Button>
      </div>
    </section>
  );
};
