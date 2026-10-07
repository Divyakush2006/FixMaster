import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { Modal } from '../../components/ui/Modal';
import { RoleBadge } from '../../components/common/Badges';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/EmptyState';
import { CreateUserPayload, Role, Specialization, User } from '../../types';
import { Users, UserPlus, KeyRound, Power, AlertCircle } from 'lucide-react';

const ROLES: Role[] = ['STUDENT', 'STAFF', 'SUPERVISOR', 'ADMIN'];
const SPECIALIZATIONS: Specialization[] = ['CLEANING', 'ELECTRICIAN', 'CARPENTER', 'AC_TECH', 'PLUMBER'];
const inputClass =
  'w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-cyan-500';

export const UsersPage: React.FC = () => {
  const { user: me } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users', roleFilter],
    queryFn: () => adminApi.listUsers(roleFilter || undefined),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.full_name, u.reg_or_emp_id, u.email || ''].some((v) => v.toLowerCase().includes(q))
    );
  }, [users, search]);

  const toggleActive = useMutation({
    mutationFn: (u: User) => adminApi.updateUser(u.user_id, { is_active: !u.is_active }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      showToast(
        res.is_active ? 'Account reactivated' : 'Account deactivated',
        'success',
        !res.is_active && res.released_tickets > 0
          ? `${res.released_tickets} open task(s) were returned to the queue for reassignment.`
          : undefined
      );
    },
    onError: (err: any) => showToast(err.message || 'Update failed', 'error'),
  });

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-purple-600/20 border border-purple-500/30 text-purple-400">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-100">User Accounts</h1>
            <p className="text-xs text-slate-400">Create staff and supervisor accounts, deactivate leavers, reset passwords</p>
          </div>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-2 self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          <span>New Account</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, ID or email..." />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as Role | '')} className={inputClass}>
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-slate-900/60 rounded-2xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No accounts found" description="Try a different search or role filter." />
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-950/80 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <th className="p-3">Name</th>
                <th className="p-3">ID</th>
                <th className="p-3">Role</th>
                <th className="p-3">Trade</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map((u) => (
                <tr key={u.user_id} className={u.is_active ? '' : 'opacity-60'}>
                  <td className="p-3">
                    <div className="font-bold text-slate-100">{u.full_name}</div>
                    <div className="text-slate-500">{u.email}</div>
                  </td>
                  <td className="p-3 font-mono text-slate-300">{u.reg_or_emp_id}</td>
                  <td className="p-3"><RoleBadge role={u.role} /></td>
                  <td className="p-3 text-slate-300">{u.specialization || '—'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full font-bold ${u.is_active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                      {u.is_active ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setResetting(u)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold flex items-center gap-1"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>Reset password</span>
                      </button>
                      {u.user_id !== me?.user_id && (
                        <button
                          onClick={() => {
                            if (u.is_active && !window.confirm(`Deactivate ${u.full_name}? They will be signed out immediately${u.role === 'STAFF' ? ' and their open tasks returned to the queue' : ''}.`)) return;
                            toggleActive.mutate(u);
                          }}
                          disabled={toggleActive.isPending}
                          className={`px-2.5 py-1.5 rounded-lg border font-semibold flex items-center gap-1 disabled:opacity-50 ${u.is_active ? 'bg-rose-950/40 border-rose-500/30 text-rose-300 hover:bg-rose-900/40' : 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/40'}`}
                        >
                          <Power className="w-3.5 h-3.5" />
                          <span>{u.is_active ? 'Deactivate' : 'Reactivate'}</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CreateUserModal onClose={() => setCreating(false)} />}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
};

const CreateUserModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateUserPayload>({
    reg_or_emp_id: '',
    full_name: '',
    email: '',
    phone_number: '',
    password: '',
    role: 'STAFF',
    specialization: 'CLEANING',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (field: keyof CreateUserPayload) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () =>
      adminApi.createUser({ ...form, specialization: form.role === 'STAFF' ? form.specialization : null }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      showToast('Account created', 'success', `${res.user.full_name} (${res.user.reg_or_emp_id}) can now sign in.`);
      onClose();
    },
    onError: (err: any) => setError(err.message || 'Could not create account.'),
  });

  return (
    <Modal isOpen onClose={onClose} title="New Account" subtitle="Staff, supervisor or admin account" maxWidth="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!/^\d{10}$/.test(form.phone_number)) return setError('Phone number must be exactly 10 digits.');
          if (form.password.length < 8) return setError('Initial password must be at least 8 characters.');
          mutation.mutate();
        }}
        className="space-y-3"
      >
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className={inputClass} placeholder="Employee ID (e.g. EMP_ELEC_02)" value={form.reg_or_emp_id} onChange={set('reg_or_emp_id')} required />
          <input className={inputClass} placeholder="Full name" value={form.full_name} onChange={set('full_name')} required />
          <input className={inputClass} type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
          <input className={inputClass} type="tel" placeholder="Phone (10 digits)" value={form.phone_number} onChange={set('phone_number')} required />
          <select className={inputClass} value={form.role} onChange={set('role')}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {form.role === 'STAFF' ? (
            <select className={inputClass} value={form.specialization || ''} onChange={set('specialization')}>
              {SPECIALIZATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <div />
          )}
          <input className={`${inputClass} sm:col-span-2`} type="password" autoComplete="new-password" placeholder="Initial password (min 8 characters)" value={form.password} onChange={set('password')} required />
        </div>
        <p className="text-[11px] text-slate-500">Share the initial password securely and ask the user to change it from My Account.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 text-xs">Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold disabled:opacity-50">
            {mutation.isPending ? 'Creating...' : 'Create Account'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

const ResetPasswordModal: React.FC<{ user: User; onClose: () => void }> = ({ user, onClose }) => {
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => adminApi.resetPassword(user.user_id, password),
    onSuccess: () => {
      showToast('Password reset', 'success', `${user.full_name} has been signed out everywhere.`);
      onClose();
    },
    onError: (err: any) => setError(err.message || 'Reset failed.'),
  });
  return (
    <Modal isOpen onClose={onClose} title="Reset Password" subtitle={`${user.full_name} (${user.reg_or_emp_id})`} maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (password.length < 8) return setError('Password must be at least 8 characters.');
          mutation.mutate();
        }}
        className="space-y-3"
      >
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <input className={inputClass} type="password" autoComplete="new-password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 text-xs">Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold disabled:opacity-50">
            {mutation.isPending ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
