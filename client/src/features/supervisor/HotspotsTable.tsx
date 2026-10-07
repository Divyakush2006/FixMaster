import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, ShieldCheck } from 'lucide-react';
import { analyticsApi } from '../../api/endpoints';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import { Table, TableWrap, THead, Th, TBody, Tr, Td, TableSkeleton } from '../../components/ui/Table';
import { cn } from '../../components/ui/cn';
import { coerceNumber, formatDateTime, formatRelativeTime } from '../../utils/formatters';
import { blockLabel, SCOPE_LABEL } from '../../utils/labels';

export const HotspotsTable: React.FC = () => {
  const { data: hotspots = [], isLoading } = useQuery({ queryKey: ['analytics-hotspots'], queryFn: analyticsApi.getHotspots });

  const rows = [...hotspots].sort((a, b) => coerceNumber(b.incident_count_14_days) - coerceNumber(a.incident_count_14_days));
  const max = Math.max(1, ...rows.map((h) => coerceNumber(h.incident_count_14_days)));

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Operations' }, { label: 'Recurring issues' }]}
        title="Recurring issues"
        description="Locations with two or more incidents of the same kind in the last 14 days. These usually need a root-cause fix rather than another repair."
      />

      {!isLoading && rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No recurring issues" description="No location has had repeated incidents of the same kind in the last 14 days." />
      ) : (
        <Card>
          <CardHeader title="Hotspots" description="Ranked by number of incidents." />
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <Th>Location</Th>
                  <Th>Block</Th>
                  <Th>Type</Th>
                  <Th>Category</Th>
                  <Th className="w-[220px]">Incidents (14 days)</Th>
                  <Th>Most recent</Th>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={6} rows={4} />
              ) : (
                <TBody>
                  {rows.map((h, idx) => {
                    const count = coerceNumber(h.incident_count_14_days);
                    return (
                      <Tr key={`${h.asset_location}-${h.category_name}-${idx}`}>
                        <Td>
                          <span className="inline-flex items-center gap-2 font-medium text-slate-900">
                            <MapPin className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                            {h.asset_location}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap">{blockLabel(h.block_id)}</Td>
                        <Td>
                          <Badge>{SCOPE_LABEL[h.ticket_scope] ?? h.ticket_scope}</Badge>
                        </Td>
                        <Td>{h.category_name}</Td>
                        <Td>
                          <div className="flex items-center gap-3">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={cn('h-full rounded-full', count >= 4 ? 'bg-rose-500' : count >= 3 ? 'bg-orange-500' : 'bg-amber-400')}
                                style={{ width: `${(count / max) * 100}%` }}
                              />
                            </div>
                            <span className="w-6 text-right font-semibold text-slate-900 tabular">{count}</span>
                          </div>
                        </Td>
                        <Td className="whitespace-nowrap text-slate-500" title={formatDateTime(h.most_recent_incident)}>
                          {formatRelativeTime(h.most_recent_incident)}
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              )}
            </Table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
};
