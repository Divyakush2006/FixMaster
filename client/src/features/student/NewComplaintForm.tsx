import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, DoorOpen } from 'lucide-react';
import { metaApi, complaintsApi } from '../../api/endpoints';
import { useMyAllotment } from '../../hooks/useMyAllotment';
import { floorLabel } from '../../utils/formatters';
import { useToast } from '../../components/ui/Toast';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardBody, CardFooter, CardHeader } from '../../components/ui/Card';
import { Field, Input, Select, Textarea } from '../../components/ui/Form';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { cn } from '../../components/ui/cn';
import { PriorityBadge, SpecializationBadge } from '../../components/common/Badges';
import { TicketScope, Priority, CommonAreaItem } from '../../types';
import { blockLabel, PRIORITY_LABEL, ticketRef } from '../../utils/labels';

const TIMESLOTS = ['08:00 AM - 10:00 AM', '10:00 AM - 12:00 PM', '02:00 PM - 04:00 PM', '04:00 PM - 06:00 PM', '06:00 PM - 08:00 PM'];
const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY'];

const Section: React.FC<{ step: number; title: string; description?: string; children: React.ReactNode }> = ({ step, title, description, children }) => (
  <div className="grid grid-cols-1 gap-4 py-6 first:pt-1 last:pb-1 lg:grid-cols-[200px_1fr] lg:gap-8">
    <div>
      <p className="eyebrow">Step {step}</p>
      <h2 className="mt-1 text-sm font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>}
    </div>
    <div className="space-y-4">{children}</div>
  </div>
);

export const NewComplaintForm: React.FC = () => {
  // Room tickets can only be raised for the student's own allotted room (the
  // API enforces this), so the room is not a choice here - it is the
  // allotment. Common-area tickets can be raised for any block.
  const { allotment, isLoading: isLoadingAllotment } = useMyAllotment();

  const [ticketScope, setTicketScope] = useState<TicketScope>('ROOM');
  const [blockId, setBlockId] = useState('');
  const [commonAreaId, setCommonAreaId] = useState('');

  // Once the allotment is known: default the block to the student's own, and
  // fall back to COMMON_AREA when there is no room to raise a ticket for.
  useEffect(() => {
    if (isLoadingAllotment) return;
    if (allotment) {
      setBlockId((current) => current || allotment.block_id);
    } else {
      setTicketScope('COMMON_AREA');
    }
  }, [allotment, isLoadingAllotment]);

  const effectiveBlockId = ticketScope === 'ROOM' ? allotment?.block_id || '' : blockId;

  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [subcategoryId, setSubcategoryId] = useState<number | ''>('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [preferredTimeslot, setPreferredTimeslot] = useState('04:00 PM - 06:00 PM');
  const [photoEvidenceUrl, setPhotoEvidenceUrl] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const { data: blocks = [] } = useQuery({ queryKey: ['meta-blocks'], queryFn: metaApi.getBlocks });

  const { data: commonAreas = [], isLoading: isLoadingCommonAreas } = useQuery({
    queryKey: ['meta-common-areas', blockId],
    queryFn: () => metaApi.getCommonAreas(blockId),
    enabled: !!blockId && ticketScope === 'COMMON_AREA',
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['meta-categories'],
    queryFn: async () => [...(await metaApi.getCategories())].sort((a, b) => a.category_id - b.category_id),
  });

  const selectedCategory = categories.find((c) => c.category_id === categoryId);
  const subcategories = selectedCategory?.subcategories || [];
  const selectedSubcategory = subcategories.find((s) => s.subcategory_id === subcategoryId);
  const selectedArea = commonAreas.find((a) => a.area_id === commonAreaId);

  // The issue sets a default priority. A student may lower it, or raise it
  // by one level (the server enforces the same rule).
  useEffect(() => {
    if (selectedSubcategory) setPriority(selectedSubcategory.priority_level);
  }, [selectedSubcategory]);
  const allowedPriorities = selectedSubcategory
    ? PRIORITIES.slice(0, Math.min(PRIORITIES.indexOf(selectedSubcategory.priority_level) + 2, PRIORITIES.length))
    : PRIORITIES;

  const mutation = useMutation({
    mutationFn: complaintsApi.create,
    onSuccess: (res) => {
      showToast('Ticket raised', 'success', `${ticketRef(res.complaint.complaint_id)} · we will keep you updated here.`);
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      navigate('/student/complaints');
    },
    onError: (err: Error) => setFormError(err.message || 'The ticket could not be submitted.'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (ticketScope === 'ROOM' && !allotment) return setFormError('No room is allotted to your account, so room tickets are unavailable.');
    if (!effectiveBlockId) return setFormError('Select a hostel block.');
    if (ticketScope === 'COMMON_AREA' && !commonAreaId) return setFormError('Select the common area facility.');
    if (!subcategoryId) return setFormError('Select the issue you are reporting.');

    mutation.mutate({
      ticket_scope: ticketScope,
      block_id: effectiveBlockId,
      room_id: ticketScope === 'ROOM' ? allotment!.room_id : null,
      common_area_id: ticketScope === 'COMMON_AREA' ? commonAreaId : null,
      subcategory_id: Number(subcategoryId),
      description: description.trim() || null,
      priority,
      preferred_timeslot: preferredTimeslot || null,
      photo_evidence_url: photoEvidenceUrl.trim() || null,
    });
  };

  const scopeOption = (value: TicketScope, Icon: React.ElementType, title: string, text: string, disabled?: boolean) => {
    const active = ticketScope === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        disabled={disabled}
        onClick={() => setTicketScope(value)}
        className={cn(
          'flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          active ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        )}
      >
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-brand-600' : 'text-slate-500')} />
        <span>
          <span className="block text-[13px] font-semibold text-slate-900">{title}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{text}</span>
        </span>
      </button>
    );
  };

  const locationSummary =
    ticketScope === 'ROOM'
      ? allotment
        ? `Room ${allotment.room_id}`
        : '—'
      : selectedArea
        ? `${selectedArea.description}, ${blockLabel(blockId)}`
        : blockId
          ? blockLabel(blockId)
          : '—';

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Service desk', to: '/student' }, { label: 'Raise a ticket' }]}
        title="Raise a ticket"
        description="Report a maintenance problem in your room or a shared area of the hostel."
      />

      <form onSubmit={handleSubmit} noValidate className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardBody className="divide-y divide-slate-100">
            <Section step={1} title="Location" description="Where is the problem?">
              <div role="radiogroup" aria-label="Location type" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {scopeOption(
                  'ROOM',
                  DoorOpen,
                  'My room',
                  allotment ? `Room ${allotment.room_id}, ${floorLabel(allotment.floor_number).toLowerCase()}` : 'No room allotted yet',
                  !allotment
                )}
                {scopeOption('COMMON_AREA', Building2, 'Common area', 'Corridors, washrooms, water coolers, lifts')}
              </div>
              {!isLoadingAllotment && !allotment && (
                <p className="text-xs text-amber-700">
                  No room is allotted to your account yet, so only common-area problems can be reported. Contact the hostel office to have
                  your room allotted.
                </p>
              )}

              {ticketScope === 'COMMON_AREA' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Hostel block" required>
                    {(a) => (
                      <Select
                        {...a}
                        value={blockId}
                        onChange={(e) => {
                          setBlockId(e.target.value);
                          setCommonAreaId('');
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
                  <Field label="Facility" required>
                    {(a) => (
                      <Select {...a} value={commonAreaId} onChange={(e) => setCommonAreaId(e.target.value)} disabled={!blockId || isLoadingCommonAreas}>
                        <option value="">
                          {!blockId
                            ? 'Select a block first'
                            : isLoadingCommonAreas
                              ? 'Loading facilities…'
                              : commonAreas.length === 0
                                ? 'No facilities registered'
                                : 'Select a facility'}
                        </option>
                        {commonAreas.map((ca: CommonAreaItem) => (
                          <option key={ca.area_id} value={ca.area_id}>
                            {ca.description} ({floorLabel(ca.floor_number)})
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
              )}
            </Section>

            <Section step={2} title="Issue" description="Choosing the exact issue routes the ticket to the right trade.">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Category" required>
                  {(a) => (
                    <Select
                      {...a}
                      value={categoryId}
                      onChange={(e) => {
                        setCategoryId(e.target.value ? Number(e.target.value) : '');
                        setSubcategoryId('');
                      }}
                    >
                      <option value="">Select a category</option>
                      {categories.map((c) => (
                        <option key={c.category_id} value={c.category_id}>
                          {c.category_name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Issue" required>
                  {(a) => (
                    <Select
                      {...a}
                      value={subcategoryId}
                      onChange={(e) => setSubcategoryId(e.target.value ? Number(e.target.value) : '')}
                      disabled={!categoryId}
                    >
                      <option value="">{categoryId ? 'Select the issue' : 'Select a category first'}</option>
                      {subcategories.map((s) => (
                        <option key={s.subcategory_id} value={s.subcategory_id}>
                          {s.issue_name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Field
                label="Priority"
                hint={
                  selectedSubcategory
                    ? `Default for this issue: ${PRIORITY_LABEL[selectedSubcategory.priority_level]}. You can raise it by one level if the situation is worse than usual.`
                    : 'Choose the issue first; its usual priority is filled in for you.'
                }
              >
                {(a) => (
                  <Select {...a} value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="sm:max-w-xs" disabled={!selectedSubcategory}>
                    {allowedPriorities.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </Section>

            <Section step={3} title="Details" description="Optional, but helps the technician come prepared.">
              <Field label="Description" aside={`${description.length}/500`}>
                {(a) => (
                  <Textarea
                    {...a}
                    value={description}
                    onChange={(e) => setDescription(e.target.value.slice(0, 500))}
                    placeholder="What is wrong, and since when? e.g. The tube light above the study table flickers and turns off."
                    rows={4}
                  />
                )}
              </Field>
              <Field label="Preferred time" hint="When someone can access the location.">
                {(a) => (
                  <div className="space-y-2">
                    <Input {...a} value={preferredTimeslot} onChange={(e) => setPreferredTimeslot(e.target.value)} placeholder="e.g. 04:00 PM - 06:00 PM" />
                    <div className="flex flex-wrap gap-1.5">
                      {TIMESLOTS.map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setPreferredTimeslot(slot)}
                          className={cn(
                            'rounded-full border px-2.5 py-1 text-xs transition-colors',
                            preferredTimeslot === slot
                              ? 'border-brand-500 bg-brand-50 text-brand-700'
                              : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                          )}
                        >
                          {slot}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Field>
              <Field label="Photo link" aside="Optional" hint="A link to a photo of the problem (https://…).">
                {(a) => <Input {...a} type="url" value={photoEvidenceUrl} onChange={(e) => setPhotoEvidenceUrl(e.target.value)} placeholder="https://" />}
              </Field>
            </Section>
          </CardBody>
          <CardFooter>
            <Button variant="secondary" onClick={() => navigate('/student')}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Submit ticket
            </Button>
          </CardFooter>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-20">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Card>
            <CardHeader title="Summary" />
            <CardBody>
              <dl className="space-y-3 text-[13px]">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Location</dt>
                  <dd className="text-right font-medium text-slate-900">{locationSummary}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Issue</dt>
                  <dd className="text-right font-medium text-slate-900">{selectedSubcategory?.issue_name ?? '—'}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Trade</dt>
                  <dd>{selectedSubcategory ? <SpecializationBadge specialization={selectedSubcategory.required_specialization} /> : '—'}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Priority</dt>
                  <dd>
                    <PriorityBadge priority={priority} />
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="What happens next" />
            <CardBody>
              <ol className="space-y-3 text-[13px] text-slate-600">
                {[
                  'A supervisor assigns a technician from the right trade.',
                  'The technician visits and carries out the work.',
                  'You confirm the fix, and the ticket is closed.',
                ].map((text, i) => (
                  <li key={text} className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-2xs font-semibold text-slate-600">
                      {i + 1}
                    </span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      </form>
    </div>
  );
};
