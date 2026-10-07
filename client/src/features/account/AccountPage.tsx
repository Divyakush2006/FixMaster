import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { meApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { RoleBadge } from '../../components/common/Badges';
import { KeyRound, UserCircle2, AlertCircle, CheckCircle2 } from 'lucide-react';

const inputClass =
  'w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-cyan-500';

export const AccountPage: React.FC = () => {
  const { updateToken } = useAuth();
  const { showToast } = useToast();
  const { data: me, isLoading } = useQuery({ queryKey: ['me'], queryFn: meApi.getMe });

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => meApi.changePassword(current, next),
    onSuccess: (res) => {
      // The change revoked every older token, including the one in storage.
      updateToken(res.token);
      setCurrent('');
      setNext('');
      setConfirm('');
      showToast('Password updated', 'success', 'Any other signed-in devices have been signed out.');
    },
    onError: (err: any) => setError(err.message || 'Could not update password.'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError('The new password must be at least 8 characters.');
    if (new TextEncoder().encode(next).length > 72) return setError('The new password must be at most 72 bytes.');
    if (next !== confirm) return setError('The new passwords do not match.');
    if (next === current) return setError('The new password must be different from the current one.');
    mutation.mutate();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 font-sans">
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-cyan-600/20 border border-cyan-500/30 text-cyan-400">
          <UserCircle2 className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-slate-100">My Account</h1>
          <p className="text-xs text-slate-400">Profile details and password</p>
        </div>
      </div>

      <section className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-3 text-xs">
        {isLoading || !me ? (
          <div className="h-24 bg-slate-950 rounded-2xl animate-pulse" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name" value={me.full_name} />
            <div>
              <span className="text-slate-400 block mb-0.5">Role</span>
              <RoleBadge role={me.role} />
            </div>
            <Field label="Register / Employee ID" value={me.reg_or_emp_id} mono />
            <Field label="Email" value={me.email || '—'} />
            <Field label="Phone" value={me.phone_number || '—'} />
            {me.specialization && <Field label="Trade" value={me.specialization} />}
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          To correct your details or your room allotment, contact the hostel office.
        </p>
      </section>

      <section className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-4">
        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-cyan-400" />
          Change Password
        </h2>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} required />
          <input type="password" autoComplete="new-password" placeholder="New password (min 8 characters)" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} required />
          <input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} required />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-2 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{mutation.isPending ? 'Updating...' : 'Update Password'}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};

const Field: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div>
    <span className="text-slate-400 block mb-0.5">{label}</span>
    <span className={`font-bold text-slate-100 ${mono ? 'font-mono' : ''}`}>{value}</span>
  </div>
);
