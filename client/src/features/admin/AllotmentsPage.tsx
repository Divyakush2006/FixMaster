import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, LogOut } from 'lucide-react';
import { adminApi, metaApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardBody, CardFooter, CardHeader } from '../../components/ui/Card';
import { Alert } from '../../components/ui/Alert';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Form';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/EmptyState';
import { Table, TableWrap, THead, Th, TBody, Tr, Td, TableSkeleton } from '../../components/ui/Table';
import { floorLabel } from '../../utils/formatters';
import { blockLabel } from '../../utils/labels';

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
  const [studentId, setStudentId] = useState('');
  const [blockId, setBlockId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [academicYear, setAcademicYear] = useState(currentAcademicYear());
  const [error, setError] = useState<string | null>(null);

  const { data: allotments = [], isLoading } = useQuery({ queryKey: ['admin-allotments'], queryFn: () => adminApi.listAllotments() });
  const { data: students = [] } = useQuery({ queryKey: ['admin-users', 'STUDENT'], queryFn: () => adminApi.listUsers('STUDENT') });
  const { data: blocks = [] } = useQuery({ queryKey: ['meta-blocks'], queryFn: metaApi.getBlocks });
  const { data: rooms = [], isLoading: isLoadingRooms } = useQuery({
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
  const currentRoomOf = useMemo(() => new Map(allotments.map((a) => [a.student_id, a.room_id])), [allotments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allotments;
    return allotments.filter((a) => [a.full_name, a.reg_or_emp_id, a.room_id].some((v) => v.toLowerCase().includes(q)));
  }, [allotments, search]);

  const allot = useMutation({
    mutationFn: () => adminApi.allotRoom(studentId, roomId, academicYear),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-allotments'] });
      queryClient.invalidateQueries({ queryKey: ['admin-blocks'] });
      showToast(allottedStudentIds.has(studentId) ? 'Student moved' : 'Room allotted', 'success', `Room ${roomId}, ${academicYear}`);
      setStudentId('');
      setRoomId('');
    },
    onError: (err: Error) => setError(err.message || 'Allotment failed.'),
  });

  const end = useMutation({
    mutationFn: (sid: string) => adminApi.endAllotment(sid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-allotments'] });
      queryClient.invalidateQueries({ queryKey: ['admin-blocks'] });
      showToast('Allotment ended', 'success');
    },
    onError: (err: Error) => showToast('Could not end the allotment', 'error', err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!studentId || !roomId) return setError('Choose a student and a room.');
    if (!/^\d{4}-\d{4}$/.test(academicYear)) return setError('Academic year must look like 2026-2027.');
    allot.mutate();
  };

  const moving = studentId && allottedStudentIds.has(studentId);

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
                <Field label="Student" required hint={moving ? `Currently in ${currentRoomOf.get(studentId)} - will be moved.` : undefined}>
                  {(a) => (
                    <Select {...a} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                      <option value="">Select a student</option>
                      {students
                        .filter((s) => s.is_active)
                        .map((s) => (
                          <option key={s.user_id} value={s.user_id}>
                            {s.full_name} ({s.reg_or_emp_id})
                          </option>
                        ))}
                    </Select>
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
                <Field label="Room" required hint={blockId && !isLoadingRooms && rooms.length === 0 ? 'This block has no open rooms yet.' : undefined}>
                  {(a) => (
                    <Select {...a} value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={!blockId}>
                      <option value="">{blockId ? 'Select a room' : 'Select a block first'}</option>
                      {rooms.map((r) => {
                        const used = occupancy.get(r.room_id) || 0;
                        const capacity = r.bed_capacity;
                        const full = capacity !== undefined && used >= capacity;
                        return (
                          <option key={r.room_id} value={r.room_id} disabled={full}>
                            {r.room_id} · {floorLabel(r.floor_number)}
                            {capacity ? ` · ${used}/${capacity} beds${full ? ' (full)' : ''}` : ''}
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
                {moving ? 'Move student' : 'Allot room'}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <Card>
          <CardHeader
            title="Current allotments"
            description={isLoading ? undefined : `${allotments.length} ${allotments.length === 1 ? 'student' : 'students'} housed`}
            actions={<SearchInput className="w-full sm:w-72" value={search} onChange={setSearch} placeholder="Search student, ID or room" label="Search allotments" />}
          />
          {!isLoading && filtered.length === 0 ? (
            <EmptyState bare title={search ? 'No matching allotments' : 'No current allotments'} description={search ? 'Try a different search.' : 'Allotted students appear here.'} />
          ) : (
            <TableWrap>
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
                    {filtered.map((a) => (
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
          )}
        </Card>
      </div>
    </div>
  );
};
