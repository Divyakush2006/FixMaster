import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, KeyRound } from 'lucide-react';
import { meApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, PasswordInput } from '../../components/ui/Form';
import { PASSWORD_HINT, passwordProblem } from '../../utils/password';
import { AuthHeading, AuthLayout } from './AuthLayout';

/**
 * Shown instead of the app to an account whose password was set by someone else
 * (an administrator, or the provisioning script): it has to choose its own before
 * anything else. The server enforces the same rule (403 PASSWORD_CHANGE_REQUIRED).
 */
export const ForcePasswordChange: React.FC = () => {
  const { user, updateUser, renewSession, logout } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => meApi.changePassword(current, next),
    onSuccess: (res) => {
      // The server re-issued the session cookie in the same response.
      renewSession(res.expires_at);
      updateUser({ must_change_password: false });
      queryClient.invalidateQueries();
      showToast('Password updated', 'success', 'You can now use FixMaster.');
    },
    onError: (err: Error) => setError(err.message || 'Could not update the password.'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!current) return setError('Enter the password you were given.');
    const problem = passwordProblem(next, user?.reg_or_emp_id);
    if (problem) return setError(`New password: ${problem}`);
    if (next !== confirm) return setError('The new passwords do not match.');
    if (next === current) return setError('Choose a password different from the one you were given.');
    change.mutate();
  };

  return (
    <AuthLayout
      panelTitle="Make this account yours"
      panelText="The password you signed in with was set for you by the hostel office. Choose one only you know before you continue."
      panelPoints={['Your new password replaces the one you were given', 'Other devices are signed out when it changes', 'Nobody at the hostel office can read it']}
    >
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
        <KeyRound className="h-3.5 w-3.5" aria-hidden />
        First sign-in
      </div>
      <AuthHeading title="Choose a new password" subtitle={user ? `Signed in as ${user.full_name} (${user.reg_or_emp_id}).` : ''} />
      {error && <Alert tone="danger">{error}</Alert>}
      <form onSubmit={submit} className="mt-4 space-y-4" aria-label="Choose a new password" noValidate>
        <Field label="Password you were given" required>
          {(a) => <PasswordInput {...a} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="h-10" />}
        </Field>
        <Field label="New password" required hint={PASSWORD_HINT}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="h-10" />}
        </Field>
        <Field label="Confirm new password" required>
          {(a) => <PasswordInput {...a} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-10" />}
        </Field>
        <Button type="submit" size="lg" block loading={change.isPending} iconRight={ArrowRight}>
          Save and continue
        </Button>
      </form>
      <button type="button" onClick={logout} className="link mt-6 block text-[13px]">
        Sign out instead
      </button>
    </AuthLayout>
  );
};
