import React, { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LockOpen, Power, UserPlus } from 'lucide-react';
import { adminApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Tabs } from '../../components/ui/Tabs';
import { Modal } from '../../components/ui/Modal';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Field, Input, PasswordInput, Select } from '../../components/ui/Form';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pagination } from '../../components/ui/Pagination';
import { Table, TableWrap, THead, Th, TBody, Tr, Td, TableSkeleton } from '../../components/ui/Table';
import { RoleBadge, SpecializationBadge } from '../../components/common/Badges';
import { CreateUserPayload, Role, Specialization, User } from '../../types';
import { ROLE_LABEL, SPECIALIZATION_LABEL } from '../../utils/labels';
import { formatDateTime, formatRelativeTime } from '../../utils/formatters';
import { PASSWORD_HINT, passwordProblem } from '../../utils/password';

const isLocked = (u: User) => !!u.locked_until && new Date(u.locked_until).getTime() > Date.now();

const ROLES: Role[] = ['STUDENT', 'STAFF', 'SUPERVISOR', 'ADMIN'];
const CREATABLE_ROLES: Role[] = ['STAFF', 'SUPERVISOR', 'ADMIN', 'STUDENT'];
const SPECIALIZATIONS: Specialization[] = ['CLEANING', 'ELECTRICIAN', 'CARPENTER', 'AC_TECH', 'PLUMBER'];

type RoleTab = Role | 'ALL';
type StatusFilter = '' | 'active' | 'deactivated' | 'locked';
const PAGE_SIZE = 25;

export const UsersPage: React.FC = () => {
  const { user: me } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [roleTab, setRoleTab] = useState<RoleTab>('ALL');
  const [status, setStatus] = useState<StatusFilter>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const q = useDebouncedValue(search.trim(), 300);

  // Search, filters and paging run on the server, so the page stays fast
  // with any number of student accounts.
  const { data: summary } = useQuery({ queryKey: ['admin-users', 'summary'], queryFn: adminApi.userSummary });
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-users', 'page', roleTab, status, q, page],
    queryFn: () =>
      adminApi.usersPage({
        role: roleTab === 'ALL' ? undefined : roleTab,
        status: status || undefined,
        q: q || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });
  const users = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const countFor = (tab: RoleTab) =>
    summary ? { ALL: summary.all, STUDENT: summary.student, STAFF: summary.staff, SUPERVISOR: summary.supervisor, ADMIN: summary.admin }[tab] : undefined;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    queryClient.invalidateQueries({ queryKey: ['admin-audit'] });
  };

  const toggleActive = useMutation({
    mutationFn: (u: User) => adminApi.updateUser(u.user_id, { is_active: !u.is_active }),
    onSuccess: (res) => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      showToast(
        res.is_active ? 'Account reactivated' : 'Account deactivated',
        'success',
        !res.is_active && res.released_tickets > 0 ? `${res.released_tickets} open task(s) were returned to the queue for reassignment.` : undefined
      );
    },
    onError: (err: Error) => showToast('Update failed', 'error', err.message),
  });

  const unlock = useMutation({
    mutationFn: (u: User) => adminApi.updateUser(u.user_id, { unlock: true }),
    onSuccess: (res) => {
      refresh();
      showToast('Account unlocked', 'success', `${res.full_name} can sign in again.`);
    },
    onError: (err: Error) => showToast('Unlock failed', 'error', err.message),
  });

  const handleToggle = async (u: User) => {
    if (u.is_active) {
      const ok = await confirm({
        title: `Deactivate ${u.full_name}?`,
        message: (
          <>
            They will be signed out immediately and will not be able to sign in again until reactivated.
            {u.role === 'STAFF' && ' Their open tasks will be returned to the queue for reassignment.'}
          </>
        ),
        confirmLabel: 'Deactivate',
        tone: 'danger',
      });
      if (!ok) return;
    }
    toggleActive.mutate(u);
  };

  const filtering = !!(q || status);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Administration' }, { label: 'Users & access' }]}
        title="Users & access"
        description="Create staff, supervisor and administrator accounts, deactivate leavers, unlock accounts and reset passwords."
        actions={
          <Button icon={UserPlus} onClick={() => setCreating(true)}>
            New account
          </Button>
        }
      />

      {summary && summary.locked > 0 && (
        <Alert
          tone="warning"
          className="mb-4"
          title={`${summary.locked} ${summary.locked === 1 ? 'account is' : 'accounts are'} locked after repeated failed sign-ins`}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setStatus('locked');
                setRoleTab('ALL');
                setPage(1);
              }}
            >
              Show locked accounts
            </Button>
          }
        >
          Locks clear by themselves after 15 minutes. Unlock an account sooner once you have confirmed it is the owner asking.
        </Alert>
      )}

      <Card>
        <div className="px-5 pt-3">
          <Tabs
            ariaLabel="Filter by role"
            value={roleTab}
            onChange={(v) => {
              setRoleTab(v);
              setPage(1);
            }}
            items={[
              { value: 'ALL', label: 'All', count: countFor('ALL') },
              ...ROLES.map((r) => ({ value: r as RoleTab, label: `${ROLE_LABEL[r]}s`, count: countFor(r) })),
            ]}
          />
        </div>
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-3 sm:flex-row sm:items-center">
          <SearchInput
            className="sm:max-w-sm"
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search by name, ID or email"
            label="Search users"
          />
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setPage(1);
            }}
            className="sm:w-48"
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="deactivated">Deactivated</option>
            <option value="locked">Locked</option>
          </Select>
          <p className="text-[13px] text-slate-500 sm:ml-auto">
            {isLoading ? 'Loading…' : `${total} ${total === 1 ? 'account' : 'accounts'}`}
            {isFetching && !isLoading && <span className="ml-2 text-slate-500">Updating…</span>}
          </p>
        </div>

        {!isLoading && users.length === 0 ? (
          <EmptyState
            bare
            title="No accounts found"
            description={filtering ? 'Try a different search or status.' : 'No accounts have this role yet.'}
            action={
              filtering
                ? {
                    label: 'Clear filters',
                    onClick: () => {
                      setSearch('');
                      setStatus('');
                      setPage(1);
                    },
                  }
                : undefined
            }
          />
        ) : (
          <>
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <Th>Name</Th>
                    <Th>ID</Th>
                    <Th>Role</Th>
                    <Th>Trade</Th>
                    <Th>Status</Th>
                    <Th>Last sign-in</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </THead>
                {isLoading ? (
                  <TableSkeleton columns={7} />
                ) : (
                  <TBody>
                    {users.map((u) => (
                      <Tr key={u.user_id}>
                        <Td>
                          <div className="flex items-center gap-3">
                            <Avatar name={u.full_name} />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900">
                                {u.full_name}
                                {u.user_id === me?.user_id && <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>}
                              </p>
                              <p className="truncate text-xs text-slate-500">{u.email}</p>
                            </div>
                          </div>
                        </Td>
                        <Td className="whitespace-nowrap font-mono text-xs">{u.reg_or_emp_id}</Td>
                        <Td>
                          <RoleBadge role={u.role} />
                        </Td>
                        <Td>{u.specialization ? <SpecializationBadge specialization={u.specialization} /> : <span className="text-slate-500">—</span>}</Td>
                        <Td>
                          <div className="flex flex-wrap gap-1.5">
                            {u.is_active ? (
                              <Badge tone="success" dot>
                                Active
                              </Badge>
                            ) : (
                              <Badge tone="neutral" dot>
                                Deactivated
                              </Badge>
                            )}
                            {isLocked(u) && (
                              <Badge tone="danger" title={`Locked until ${formatDateTime(u.locked_until)}`}>
                                Locked
                              </Badge>
                            )}
                          </div>
                        </Td>
                        <Td className="whitespace-nowrap text-slate-500" title={u.last_login_at ? formatDateTime(u.last_login_at) : undefined}>
                          {u.last_login_at ? formatRelativeTime(u.last_login_at) : 'Never'}
                        </Td>
                        <Td>
                          <div className="flex justify-end gap-2">
                            {isLocked(u) && (
                              <Button size="sm" variant="secondary" icon={LockOpen} disabled={unlock.isPending} onClick={() => unlock.mutate(u)}>
                                Unlock
                              </Button>
                            )}
                            <Button size="sm" variant="secondary" icon={KeyRound} onClick={() => setResetting(u)}>
                              Reset password
                            </Button>
                            {u.user_id !== me?.user_id && (
                              <Button
                                size="sm"
                                variant={u.is_active ? 'danger-outline' : 'secondary'}
                                icon={Power}
                                disabled={toggleActive.isPending}
                                onClick={() => handleToggle(u)}
                                className="w-[112px]"
                              >
                                {u.is_active ? 'Deactivate' : 'Reactivate'}
                              </Button>
                            )}
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                )}
              </Table>
            </TableWrap>
            <Pagination currentPage={Math.min(page, totalPages)} totalPages={totalPages} onPageChange={setPage} totalItems={total} pageSize={PAGE_SIZE} />
          </>
        )}
      </Card>

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
    mutationFn: () => adminApi.createUser({ ...form, specialization: form.role === 'STAFF' ? form.specialization : null }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit'] });
      showToast('Account created', 'success', `${res.user.full_name} (${res.user.reg_or_emp_id}) can now sign in.`);
      onClose();
    },
    onError: (err: Error) => setError(err.message || 'Could not create the account.'),
  });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!form.reg_or_emp_id.trim() || !form.full_name.trim() || !form.email.trim()) return setError('Fill in the ID, name and email.');
    if (!/^\d{10}$/.test(form.phone_number)) return setError('Phone number must be exactly 10 digits.');
    const problem = passwordProblem(form.password, form.reg_or_emp_id);
    if (problem) return setError(`Initial password: ${problem}`);
    mutation.mutate();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="New account"
      subtitle="The person signs in with the ID and initial password you set here."
      maxWidth="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} onClick={() => submit()}>
            Create account
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Role" required>
            {(a) => (
              <Select {...a} value={form.role} onChange={set('role')}>
                {CREATABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {form.role === 'STAFF' ? (
            <Field label="Trade" required>
              {(a) => (
                <Select {...a} value={form.specialization || ''} onChange={set('specialization')}>
                  {SPECIALIZATIONS.map((s) => (
                    <option key={s} value={s}>
                      {SPECIALIZATION_LABEL[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          <Field label={form.role === 'STUDENT' ? 'Registration number' : 'Employee ID'} required hint={form.role === 'STUDENT' ? 'e.g. 21BCE0843' : 'e.g. EMP_ELEC_02'}>
            {(a) => <Input {...a} value={form.reg_or_emp_id} onChange={set('reg_or_emp_id')} spellCheck={false} />}
          </Field>
          <Field label="Full name" required>
            {(a) => <Input {...a} value={form.full_name} onChange={set('full_name')} />}
          </Field>
          <Field label="Email" required>
            {(a) => <Input {...a} type="email" value={form.email} onChange={set('email')} />}
          </Field>
          <Field label="Mobile number" required>
            {(a) => (
              <Input
                {...a}
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={form.phone_number}
                onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value.replace(/\D/g, '') }))}
                placeholder="10 digits"
              />
            )}
          </Field>
          <Field label="Initial password" required className="sm:col-span-2" hint={`${PASSWORD_HINT} Share it securely and ask the person to change it from My account.`}>
            {(a) => <PasswordInput {...a} autoComplete="new-password" value={form.password} onChange={set('password')} />}
          </Field>
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
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
      showToast('Password reset', 'success', `${user.full_name} has been signed out on every device.`);
      onClose();
    },
    onError: (err: Error) => setError(err.message || 'Reset failed.'),
  });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const problem = passwordProblem(password, user.reg_or_emp_id);
    if (problem) return setError(problem);
    mutation.mutate();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Reset password"
      subtitle={`${user.full_name} · ${user.reg_or_emp_id}`}
      maxWidth="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} onClick={() => submit()}>
            Reset password
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="New password" required hint={`${PASSWORD_HINT} Resetting also unlocks the account and signs the person out everywhere.`}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
      </form>
    </Modal>
  );
};
