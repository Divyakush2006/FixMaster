import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Inbox, X } from 'lucide-react';
import { adminApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { Alert } from '../../components/ui/Alert';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { Table, TableWrap, THead, Th, TBody, Tr, Td } from '../../components/ui/Table';
import { PendingAllotmentRequest } from '../../types';
import { floorLabel, formatRelativeTime } from '../../utils/formatters';
import { blockLabel } from '../../utils/labels';

function currentAcademicYear(): string {
  const now = new Date();
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

/**
 * Rooms students asked for when they registered. Approving uses the normal
 * allotment workflow (capacity is enforced there); declining records a reason
 * the student sees. Nothing here grants access by itself.
 */
export const RoomRequestsCard: React.FC = () => {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [declining, setDeclining] = useState<PendingAllotmentRequest | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: requests = [], isLoading, isError } = useQuery({
    queryKey: ['admin-allotment-requests'],
    queryFn: adminApi.allotmentRequests,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-allotment-requests'] });
    queryClient.invalidateQueries({ queryKey: ['admin-allotments'] });
    queryClient.invalidateQueries({ queryKey: ['admin-rooms'] });
    queryClient.invalidateQueries({ queryKey: ['admin-audit'] });
  };

  const approve = useMutation({
    mutationFn: (r: PendingAllotmentRequest) => adminApi.allotRoom(r.student_id, r.room_id, currentAcademicYear()),
    onSuccess: (_res, r) => {
      refresh();
      showToast('Room allotted', 'success', `${r.full_name} · room ${r.room_id}`);
    },
    onError: (err: Error) => showToast('Could not allot the room', 'error', err.message),
  });

  const decline = useMutation({
    mutationFn: () => adminApi.declineAllotmentRequest(declining!.student_id, reason.trim()),
    onSuccess: () => {
      refresh();
      showToast('Request declined', 'success', `${declining!.full_name} can see your reason and ask again.`);
      setDeclining(null);
      setReason('');
    },
    onError: (err: Error) => setError(err.message || 'Could not decline the request.'),
  });

  if (isLoading || (!isError && requests.length === 0)) return null;

  return (
    <Card>
      <CardHeader
        title="Room requests"
        description={`${requests.length} ${requests.length === 1 ? 'student is' : 'students are'} waiting for a room to be confirmed.`}
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-50 text-amber-600">
            <Inbox className="h-4 w-4" />
          </span>
        }
      />
      {isError ? (
        <div className="p-5">
          <Alert tone="danger">Requests could not be loaded.</Alert>
        </div>
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <Th>Student</Th>
                <Th>Requested room</Th>
                <Th>Beds</Th>
                <Th>Asked</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </THead>
            <TBody>
              {requests.map((r) => {
                const full = r.occupied_beds >= r.bed_capacity;
                return (
                  <Tr key={r.student_id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={r.full_name} />
                        <div>
                          <p className="font-medium text-slate-900">{r.full_name}</p>
                          <p className="font-mono text-xs text-slate-500">{r.reg_or_emp_id}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <p className="font-mono font-semibold text-slate-900">{r.room_id}</p>
                      <p className="text-xs text-slate-500">
                        {blockLabel(r.block_id)} · {floorLabel(r.floor_number)}
                      </p>
                    </Td>
                    <Td>
                      {full ? (
                        <Badge tone="danger">Full ({r.occupied_beds}/{r.bed_capacity})</Badge>
                      ) : (
                        <span className="tabular">
                          {r.occupied_beds}/{r.bed_capacity}
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-slate-500">{formatRelativeTime(r.requested_at)}</Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" icon={Check} disabled={full || approve.isPending} onClick={() => approve.mutate(r)}>
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-outline"
                          icon={X}
                          onClick={() => {
                            setError(null);
                            setReason('');
                            setDeclining(r);
                          }}
                        >
                          Decline
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}

      {declining && (
        <Modal
          isOpen
          onClose={() => setDeclining(null)}
          title="Decline room request"
          subtitle={`${declining.full_name} · ${declining.room_id}`}
          maxWidth="md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeclining(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={decline.isPending} disabled={reason.trim().length < 5} onClick={() => decline.mutate()}>
                Decline request
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Reason" required hint="The student sees this and can ask for a different room.">
              {(a) => <Input {...a} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Room reserved for final-year students" />}
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  );
};
