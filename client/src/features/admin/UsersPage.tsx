import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Power, UserPlus } from 'lucide-react';
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
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/EmptyState';
import { Table, TableWrap, THead, Th, TBody, Tr, Td, TableSkeleton } from '../../components/ui/Table';
import { RoleBadge, SpecializationBadge } from '../../components/common/Badges';
import { CreateUserPayload, Role, Specialization, User } from '../../types';
import { ROLE_LABEL, SPECIALIZATION_LABEL } from '../../utils/labels';

const ROLES: Role[] = ['STUDENT', 'STAFF', 'SUPERVISOR', 'ADMIN'];
const CREATABLE_ROLES: Role[] = ['STAFF', 'SUPERVISOR', 'ADMIN', 'STUDENT'];
const SPECIALIZATIONS: Specialization[] = ['CLEANING', 'ELECTRICIAN', 'CARPENTER', 'AC_TECH', 'PLUMBER'];

type RoleTab = Role | 'ALL';

export const UsersPage: React.FC = () => {
  const { user: me } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [roleTab, setRoleTab] = useState<RoleTab>('ALL');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);

  // One list for every role: the tabs filter it locally and show counts.
  const { data: users = [], isLoading } = useQuery({ queryKey: ['admin-users', ''], queryFn: () => adminApi.listUsers() });

  const counts = useMemo(() => {
    const c: Record<RoleTab, number> = { ALL: users.length, STUDENT: 0, STAFF: 0, SUPERVISOR: 0, ADMIN: 0 };
    users.forEach((u) => (c[u.role] += 1));
    return c;
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(
      (u) => (roleTab === 'ALL' || u.role === roleTab) && (!q || [u.full_name, u.reg_or_emp_id, u.email || ''].some((v) => v.toLowerCase().includes(q)))
    );
  }, [users, search, roleTab]);

  const toggleActive = useMutation({
    mutationFn: (u: User) => adminApi.updateUser(u.user_id, { is_active: !u.is_active }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      showToast(
        res.is_active ? 'Account reactivated' : 'Account deactivated',
        'success',
        !res.is_active && res.released_tickets > 0 ? `${res.released_tickets} open task(s) were returned to the queue for reassignment.` : undefined
      );
    },
    onError: (err: Error) => showToast('Update failed', 'error', err.message),
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

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Administration' }, { label: 'Users & access' }]}
        title="Users & access"
        description="Create staff, supervisor and administrator accounts, deactivate leavers and reset passwords."
        actions={
          <Button icon={UserPlus} onClick={() => setCreating(true)}>
            New account
          </Button>
        }
      />

      <Card>
        <div className="px-5 pt-3">
          <Tabs
            ariaLabel="Filter by role"
            value={roleTab}
            onChange={setRoleTab}
            items={[
              { value: 'ALL', label: 'All', count: isLoading ? undefined : counts.ALL },
              ...ROLES.map((r) => ({ value: r as RoleTab, label: `${ROLE_LABEL[r]}s`, count: isLoading ? undefined : counts[r] })),
            ]}
          />
        </div>
        <div className="border-b border-slate-200 px-5 py-3">
          <SearchInput className="sm:max-w-sm" value={search} onChange={setSearch} placeholder="Search by name, ID or email" label="Search users" />
        </div>

        {!isLoading && filtered.length === 0 ? (
          <EmptyState bare title="No accounts found" description="Try a different search or role." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <Th>Name</Th>
                  <Th>ID</Th>
                  <Th>Role</Th>
                  <Th>Trade</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={6} />
              ) : (
                <TBody>
                  {filtered.map((u) => (
                    <Tr key={u.user_id}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar name={u.full_name} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">
                              {u.full_name}
                              {u.user_id === me?.user_id && <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>}
                            </p>
                            <p className="truncate text-xs text-slate-500">{u.email}</p>
                          </div>
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap font-mono text-xs">{u.reg_or_emp_id}</Td>
                      <Td>
                        <RoleBadge role={u.role} />
                      </Td>
                      <Td>{u.specialization ? <SpecializationBadge specialization={u.specialization} /> : <span className="text-slate-400">—</span>}</Td>
                      <Td>
                        {u.is_active ? (
                          <Badge tone="success" dot>
                            Active
                          </Badge>
                        ) : (
                          <Badge tone="neutral" dot>
                            Deactivated
                          </Badge>
                        )}
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-2">
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
    if (form.password.length < 8) return setError('The initial password must be at least 8 characters.');
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
          <Field label="Initial password" required className="sm:col-span-2" hint="At least 8 characters. Share it securely and ask the person to change it from My account.">
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
    if (password.length < 8) return setError('The password must be at least 8 characters.');
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
        <Field label="New password" required hint="At least 8 characters. The person is signed out everywhere.">
          {(a) => <PasswordInput {...a} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
      </form>
    </Modal>
  );
};
