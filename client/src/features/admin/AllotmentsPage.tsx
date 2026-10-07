import React, { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, LogOut } from 'lucide-react';
import { adminApi, metaApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardBody, CardFooter, CardHeader } from '../../components/ui/Card';
import { Alert } from '../../components/ui/Alert';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Form';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pagination } from '../../components/ui/Pagination';
import { Table, TableWrap, THead, Th, TBody, Tr, Td, TableSkeleton } from '../../components/ui/Table';
import { StudentPicker } from './StudentPicker';
import { User } from '../../types';
import { floorLabel } from '../../utils/formatters';
import { blockLabel, ROOM_TYPE_LABEL } from '../../utils/labels';

const PAGE_SIZE = 25;

function currentAcademicYear(): string {
  const now = new Date();
  // Academic year starts in July.
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

export const AllotmentsPage: React.FC = () => {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [student, setStudent] = useState<User | null>(null);
  const [blockId, setBlockId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [academicYear, setAcademicYear] = useState(currentAcademicYear());
  const [error, setError] = useState<string | null>(null);
  const q = useDebouncedValue(search.trim(), 300);

  const { data: list, isLoading, isFetching } = useQuery({
    queryKey: ['admin-allotments', 'page', q, page],
    queryFn: () => adminApi.allotmentsPage({ q: q || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const allotments = list?.items ?? [];
  const total = list?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // The chosen student's current room (if any) - allotting them moves them.
  const { data: current } = useQuery({
    queryKey: ['admin-allotments', 'student', student?.user_id],
    queryFn: async () => (await adminApi.allotmentsPage({ student_id: student!.user_id, limit: 1, offset: 0 })).items[0] ?? null,
    enabled: !!student,
  });

  const { data: blocks = [] } = useQuery({ queryKey: ['meta-blocks'], queryFn: metaApi.getBlocks });
  // Admin room list carries live occupancy straight from the server.
  const { data: rooms = [], isLoading: isLoadingRooms } = useQuery({
    queryKey: ['admin-rooms', blockId],
    queryFn: () => adminApi.listRooms(blockId),
    enabled: !!blockId,
  });
  const openRooms = rooms.filter((r) => r.is_active);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-allotments'] });
    queryClient.invalidateQueries({ queryKey: ['admin-rooms'] });
    queryClient.invalidateQueries({ queryKey: ['admin-blocks'] });
    queryClient.invalidateQueries({ queryKey: ['admin-audit'] });
  };

  const allot = useMutation({
    mutationFn: () => adminApi.allotRoom(student!.user_id, roomId, academicYear),
    onSuccess: () => {
      refresh();
      showToast(current ? 'Student moved' : 'Room allotted', 'success', `${student!.full_name} · room ${roomId}, ${academicYear}`);
      setStudent(null);
      setRoomId('');
    },
    onError: (err: Error) => setError(err.message || 'Allotment failed.'),
  });

  const end = useMutation({
    mutationFn: (sid: string) => adminApi.endAllotment(sid),
    onSuccess: () => {
      refresh();
      showToast('Allotment ended', 'success');
    },
    onError: (err: Error) => showToast('Could not end the allotment', 'error', err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!student || !roomId) return setError('Choose a student and a room.');
    if (current && current.room_id === roomId) return setError(`${student.full_name} is already in ${roomId}.`);
    if (!/^\d{4}-\d{4}$/.test(academicYear)) return setError('Academic year must look like 2026-2027.');
    allot.mutate();
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Administration' }, { label: 'Room allotments' }]}
        title="Room allotments"
        description="Students can only raise room tickets for the room allotted to them here."
      />

      <div className="space-y-6">
        <Card>
          <form onSubmit={submit} noValidate>
            <CardHeader
              title="Allot or move a student"
              description="Allotting a student who already has a room moves them to the new one."
              icon={
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                  <DoorOpen className="h-4 w-4" />
                </span>
              }
            />
            <CardBody className="space-y-4">
              {error && <Alert tone="danger">{error}</Alert>}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Student" required hint={student ? (current ? `Currently in ${current.room_id} - will be moved.` : 'No current room.') : 'Search by name or registration number.'}>
                  {(a) => (
                    <StudentPicker
                      value={student}
                      onChange={(s) => {
                        setStudent(s);
                        setError(null);
                      }}
                      inputProps={a}
                    />
                  )}
                </Field>
                <Field label="Block" required>
                  {(a) => (
                    <Select
                      {...a}
                      value={blockId}
                      onChange={(e) => {
                        setBlockId(e.target.value);
                        setRoomId('');
                      }}
                    >
                      <option value="">Select a block</option>
                      {blocks.map((b) => (
                        <option key={b.block_id} value={b.block_id}>
                          {b.block_name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Room" required hint={blockId && !isLoadingRooms && openRooms.length === 0 ? 'This block has no open rooms yet.' : undefined}>
                  {(a) => (
                    <Select {...a} value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={!blockId || isLoadingRooms}>
                      <option value="">{!blockId ? 'Select a block first' : isLoadingRooms ? 'Loading rooms…' : 'Select a room'}</option>
                      {openRooms.map((r) => {
                        const full = r.occupied_beds >= r.bed_capacity;
                        return (
                          <option key={r.room_id} value={r.room_id} disabled={full}>
                            {r.room_id} · {floorLabel(r.floor_number)} · {ROOM_TYPE_LABEL[r.room_type]} · {r.occupied_beds}/{r.bed_capacity} beds
                            {full ? ' (full)' : ''}
                          </option>
                        );
                      })}
                    </Select>
                  )}
                </Field>
                <Field label="Academic year" required>
                  {(a) => <Input {...a} value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="2026-2027" />}
                </Field>
              </div>
            </CardBody>
            <CardFooter>
              <Button type="submit" loading={allot.isPending}>
                {current ? 'Move student' : 'Allot room'}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <Card>
          <CardHeader
            title="Current allotments"
            description={isLoading ? undefined : `${total} ${total === 1 ? 'student' : 'students'}${q ? ' match' : ' housed'}`}
            actions={
              <SearchInput
                className="w-full sm:w-72"
                value={search}
                onChange={(v) => {
                  setSearch(v);
                  setPage(1);
                }}
                placeholder="Search student, ID or room"
                label="Search allotments"
              />
            }
          />
          {!isLoading && allotments.length === 0 ? (
            <EmptyState bare title={q ? 'No matching allotments' : 'No current allotments'} description={q ? 'Try a different search.' : 'Allotted students appear here.'} />
          ) : (
            <>
              <TableWrap className={isFetching && !isLoading ? 'opacity-70 transition-opacity' : undefined}>
                <Table>
                  <THead>
                    <tr>
                      <Th>Student</Th>
                      <Th>Room</Th>
                      <Th>Block</Th>
                      <Th>Floor</Th>
                      <Th>Academic year</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </THead>
                  {isLoading ? (
                    <TableSkeleton columns={6} rows={4} />
                  ) : (
                    <TBody>
                      {allotments.map((a) => (
                        <Tr key={a.allotment_id}>
                          <Td>
                            <div className="flex items-center gap-3">
                              <Avatar name={a.full_name} />
                              <div>
                                <p className="font-medium text-slate-900">{a.full_name}</p>
                                <p className="font-mono text-xs text-slate-500">{a.reg_or_emp_id}</p>
                              </div>
                            </div>
                          </Td>
                          <Td className="font-mono font-semibold text-slate-900">{a.room_id}</Td>
                          <Td>{blockLabel(a.block_id)}</Td>
                          <Td>{floorLabel(a.floor_number)}</Td>
                          <Td>{a.academic_year}</Td>
                          <Td className="text-right">
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={LogOut}
                              disabled={end.isPending}
                              onClick={async () => {
                                const ok = await confirm({
                                  title: 'End this allotment?',
                                  message: `${a.full_name} will no longer be allotted to room ${a.room_id} and won't be able to raise room tickets until allotted again.`,
                                  confirmLabel: 'End allotment',
                                  tone: 'danger',
                                });
                                if (ok) end.mutate(a.student_id);
                              }}
                            >
                              End
                            </Button>
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
      </div>
    </div>
  );
};
