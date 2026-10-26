import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eraser, ShieldCheck } from 'lucide-react';
import { adminApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/PageLoader';
import { Table, TableWrap, THead, Th, TBody, Tr, Td } from '../../components/ui/Table';
import type { ErasureRequest } from '../../types';
import { formatRelativeTime } from '../../utils/formatters';

/**
 * Residents who have asked for their data to be erased. Erasing is only
 * possible once they have vacated their room and have no open ticket; until
 * then the reason is shown here.
 */
export const PrivacyRequestsPage: React.FC = () => {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['erasure-requests'], queryFn: adminApi.erasureRequests });

  const erase = useMutation({
    mutationFn: (r: ErasureRequest) => adminApi.eraseUser(r.user_id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['erasure-requests'] });
      showToast('Data erased', 'success', res.message);
    },
    onError: (err: Error) => showToast('Not erased', 'error', err.message),
  });

  const run = async (r: ErasureRequest) => {
    const ok = await confirm({
      title: `Erase ${r.full_name}'s data?`,
      message: 'Their profile, contact details and review comments are removed and the account is disabled. Tickets and ratings stay without their name. This cannot be undone.',
      confirmLabel: 'Erase data',
      tone: 'danger',
    });
    if (ok) erase.mutate(r);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumbs={[{ label: 'Administration' }, { label: 'Privacy requests' }]}
        title="Privacy requests"
        description="Residents who asked for their personal data to be erased (Digital Personal Data Protection Act, 2023)."
      />
      <Card>
        {isLoading ? (
          <Skeleton className="m-5 h-24" />
        ) : (data ?? []).length === 0 ? (
          <EmptyState bare icon={ShieldCheck} title="No requests" description="Nobody is waiting for their data to be erased." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <Th>Resident</Th>
                  <Th>Asked</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </THead>
              <TBody>
                {(data ?? []).map((r) => (
                  <Tr key={r.user_id}>
                    <Td>
                      <p className="font-medium text-slate-900">{r.full_name}</p>
                      <p className="font-mono text-xs text-slate-500">{r.reg_or_emp_id}</p>
                    </Td>
                    <Td className="whitespace-nowrap">{formatRelativeTime(r.erasure_requested_at)}</Td>
                    <Td>
                      {r.blockers.length === 0 ? (
                        <Badge tone="success">Ready to erase</Badge>
                      ) : (
                        <ul className="space-y-0.5 text-xs text-slate-600">
                          {r.blockers.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      )}
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" variant="danger" icon={Eraser} disabled={r.blockers.length > 0} loading={erase.isPending && erase.variables?.user_id === r.user_id} onClick={() => run(r)}>
                        Erase
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
};
