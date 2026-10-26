import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, IdCard, KeyRound, ShieldCheck } from 'lucide-react';
import { meApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardBody, CardFooter, CardHeader, DetailList } from '../../components/ui/Card';
import { Alert } from '../../components/ui/Alert';
import { Avatar } from '../../components/ui/Avatar';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Field, PasswordInput } from '../../components/ui/Form';
import { Skeleton } from '../../components/ui/PageLoader';
import { RoleBadge, SpecializationBadge } from '../../components/common/Badges';
import { formatDateTime } from '../../utils/formatters';
import { PASSWORD_HINT, passwordProblem } from '../../utils/password';

/**
 * Data-subject rights: a copy of everything held about the signed-in person,
 * and (for residents) a request to have their data erased. Erasure is carried
 * out by the hostel office once the room is vacated and no ticket is open.
 */
const YourDataCard: React.FC<{ role?: string; requestedAt: string | null }> = ({ role, requestedAt }) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [blockers, setBlockers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me'] });

  const download = useMutation({
    mutationFn: meApi.exportData,
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `fixmaster-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (err: Error) => showToast('Could not prepare your data', 'error', err.message),
  });

  const request = useMutation({
    mutationFn: () => meApi.requestErasure(password),
    onSuccess: (r) => {
      setBlockers(r.blockers);
      setAsking(false);
      setPassword('');
      setError(null);
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const cancel = useMutation({ mutationFn: meApi.cancelErasure, onSuccess: () => { setBlockers([]); refresh(); } });

  return (
    <Card>
      <CardHeader
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            <ShieldCheck className="h-4 w-4" />
          </span>
        }
        title="Your data"
        description={
          <>
            You can see everything we hold about you, and ask for it to be erased. <a href="/privacy" className="font-medium text-brand-700 underline">Read the privacy notice</a>.
          </>
        }
        actions={
          <Button variant="secondary" size="sm" icon={Download} loading={download.isPending} onClick={() => download.mutate()}>
            Download my data
          </Button>
        }
      />
      {role === 'STUDENT' && (
        <CardBody className="space-y-3">
          {requestedAt ? (
            <Alert
              tone="info"
              title="Erasure requested"
              action={
                <Button variant="secondary" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                  Cancel request
                </Button>
              }
            >
              The hostel office erases your data once you have vacated your room and have no open tickets.
              {blockers.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
            </Alert>
          ) : asking ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                request.mutate();
              }}
            >
              <p className="text-[13px] text-slate-700">
                Your profile, contact details and comments are removed. Tickets and ratings stay, without your name, so the service record is not lost. This cannot be undone.
              </p>
              {error && <Alert tone="danger">{error}</Alert>}
              <Field label="Enter your password to confirm" required>
                {(a) => <PasswordInput {...a} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="danger" loading={request.isPending} disabled={!password}>
                  Request erasure
                </Button>
                <Button type="button" variant="secondary" onClick={() => { setAsking(false); setError(null); setPassword(''); }}>
                  Not now
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setAsking(true)}>
              Ask for my data to be erased
            </Button>
          )}
        </CardBody>
      )}
    </Card>
  );
};

export const AccountPage: React.FC = () => {
  const { renewSession } = useAuth();
  const { showToast } = useToast();
  const { data: me, isLoading } = useQuery({ queryKey: ['me'], queryFn: meApi.getMe });

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => meApi.changePassword(current, next),
    onSuccess: (res) => {
      // The change revoked every older session; the server re-issued our cookie.
      renewSession(res.expires_at);
      setCurrent('');
      setNext('');
      setConfirm('');
      showToast('Password updated', 'success', 'You have been signed out on every other device.');
    },
    onError: (err: Error) => setError(err.message || 'Could not update the password.'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!current) return setError('Enter your current password.');
    const problem = passwordProblem(next, me?.reg_or_emp_id);
    if (problem) return setError(`New password: ${problem}`);
    if (next !== confirm) return setError('The new passwords do not match.');
    if (next === current) return setError('The new password must be different from the current one.');
    mutation.mutate();
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="My account" description="Your profile details and sign-in security." />

      <div className="space-y-6">
        <Card>
          <CardBody className="py-5">
            {isLoading || !me ? (
              <div className="flex items-center gap-4">
                <Skeleton className="h-14 w-14 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <div className="flex items-center gap-4">
                  <Avatar name={me.full_name} size="lg" />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-900">{me.full_name}</h2>
                      <RoleBadge role={me.role} />
                    </div>
                    <p className="font-mono text-[13px] text-slate-500">{me.reg_or_emp_id}</p>
                  </div>
                </div>
                <div className="border-t border-slate-100 pt-5">
                  <DetailList
                    columns={3}
                    items={[
                      { label: 'Email', value: me.email || '—' },
                      { label: 'Mobile number', value: me.phone_number || '—' },
                      ...(me.specialization ? [{ label: 'Trade', value: <SpecializationBadge specialization={me.specialization} /> }] : []),
                      ...(me.created_at ? [{ label: 'Member since', value: formatDateTime(me.created_at).split(',')[0] }] : []),
                      ...(me.last_login_at ? [{ label: 'Last sign-in', value: formatDateTime(me.last_login_at) }] : []),
                    ]}
                  />
                </div>
              </div>
            )}
          </CardBody>
          <div className="rounded-b-lg border-t border-slate-200 bg-slate-50/70 px-5 py-3 text-xs text-slate-500">
            To correct your name, email or room allotment, contact the hostel office.
          </div>
        </Card>

        {me?.role === 'STUDENT' && (
          <Card>
            <CardHeader
              icon={
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                  <IdCard className="h-4 w-4" />
                </span>
              }
              title="Resident profile"
              description="Your studies, emergency contacts, home address and preferences. Keep them current."
              actions={
                <ButtonLink to="/onboarding" variant="secondary" size="sm">
                  View or update
                </ButtonLink>
              }
            />
          </Card>
        )}

        <YourDataCard role={me?.role} requestedAt={me?.erasure_requested_at ?? null} />

        <Card>
          <form onSubmit={handleSubmit} noValidate>
            <CardHeader
              title="Change password"
              description="Changing your password signs you out on every other device."
              icon={
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                  <KeyRound className="h-4 w-4" />
                </span>
              }
            />
            <CardBody className="space-y-4">
              {error && <Alert tone="danger">{error}</Alert>}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="Current password" required>
                  {(a) => <PasswordInput {...a} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
                </Field>
                <Field label="New password" required hint={PASSWORD_HINT}>
                  {(a) => <PasswordInput {...a} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
                </Field>
                <Field label="Confirm new password" required error={confirm && next !== confirm ? 'Does not match.' : null}>
                  {(a) => <PasswordInput {...a} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
                </Field>
              </div>
            </CardBody>
            <CardFooter>
              <Button type="submit" loading={mutation.isPending}>
                Update password
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
};
