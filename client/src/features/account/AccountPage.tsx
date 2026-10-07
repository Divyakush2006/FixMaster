import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { meApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardBody, CardFooter, CardHeader, DetailList } from '../../components/ui/Card';
import { Alert } from '../../components/ui/Alert';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Field, PasswordInput } from '../../components/ui/Form';
import { Skeleton } from '../../components/ui/PageLoader';
import { RoleBadge, SpecializationBadge } from '../../components/common/Badges';
import { formatDateTime } from '../../utils/formatters';
import { PASSWORD_HINT, passwordProblem } from '../../utils/password';

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
            To correct your details or room allotment, contact the hostel office.
          </div>
        </Card>

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
