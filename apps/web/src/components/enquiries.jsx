import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  convertEnquirySchema, ENQUIRY_TYPES, enquiryResponseSchema, enquirySchema, GENDERS, LEAD_SOURCES,
} from '@salon/shared';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  ENQUIRY_STATUS_LABELS, ENQUIRY_TYPE_LABELS, formatDate, formatDateTime, GENDER_LABELS, LEAD_SOURCE_LABELS, todayIso,
} from '../lib/format.js';
import { useTeam } from '../lib/hooks.js';
import { useApiForm } from '../lib/useApiForm.js';
import { ContactLinks } from './clients.jsx';
import { Badge, Button, Checkbox, Field, Input, Modal, Select, Spinner, Textarea } from './ui.jsx';

export const TYPE_TONES = { HOT: 'rose', WARM: 'amber', COLD: 'blue' };
export const STATUS_TONES = { PENDING: 'slate', CONVERTED: 'green', CLOSED: 'slate' };

function useInvalidateEnquiries() {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  return (enquiryId) => {
    queryClient.invalidateQueries({ queryKey: [branchId, 'enquiries'] });
    queryClient.invalidateQueries({ queryKey: [branchId, 'follow-ups'] });
    if (enquiryId) queryClient.invalidateQueries({ queryKey: [branchId, 'enquiry', enquiryId] });
  };
}

export function EnquiryFormModal({ enquiry, onClose }) {
  const team = useTeam();
  const invalidate = useInvalidateEnquiries();
  const isNew = !enquiry.id;
  const converted = enquiry.status === 'CONVERTED';

  const form = useApiForm({
    schema: enquirySchema,
    defaultValues: {
      name: enquiry.name ?? '',
      phone: enquiry.phone ?? '',
      email: enquiry.email ?? '',
      address: enquiry.address ?? '',
      enquiryFor: enquiry.enquiryFor ?? '',
      type: enquiry.type ?? 'WARM',
      source: enquiry.source ?? 'WALK_IN',
      status: enquiry.status ?? 'PENDING',
      followUpOn: enquiry.followUpOn ?? todayIso(),
      assignedToId: enquiry.assignedToId ?? '',
      notes: enquiry.notes ?? '',
    },
    onSubmit: async (payload) => {
      await api(isNew ? '/enquiries' : `/enquiries/${enquiry.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? 'Enquiry added' : 'Enquiry updated');
      invalidate(enquiry.id);
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={isNew ? 'Add enquiry' : `Edit enquiry from ${enquiry.name}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="enquiry-form" loading={isSubmitting}>{isNew ? 'Add enquiry' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="enquiry-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name?.message} required>
          <Input invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field label="Phone" error={errors.phone?.message} required>
          <Input type="tel" inputMode="tel" invalid={!!errors.phone} {...register('phone')} />
        </Field>
        <Field label="Interested in" hint="Service, package or question" error={errors.enquiryFor?.message} required className="sm:col-span-2">
          <Input invalid={!!errors.enquiryFor} {...register('enquiryFor')} />
        </Field>
        <Field label="Lead temperature" error={errors.type?.message} required>
          <Select {...register('type')}>
            {ENQUIRY_TYPES.map((t) => (
              <option key={t} value={t}>{ENQUIRY_TYPE_LABELS[t]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Source" error={errors.source?.message} required>
          <Select {...register('source')}>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Follow up on" error={errors.followUpOn?.message}>
          <Input type="date" invalid={!!errors.followUpOn} {...register('followUpOn')} />
        </Field>
        <Field label="Assigned to" error={errors.assignedToId?.message}>
          <Select {...register('assignedToId')}>
            <option value="">—</option>
            {team.data?.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" invalid={!!errors.email} {...register('email')} />
        </Field>
        {!isNew && (
          <Field label="Status" error={errors.status?.message}>
            <Select disabled={converted} {...register('status')}>
              {converted && <option value="CONVERTED">{ENQUIRY_STATUS_LABELS.CONVERTED}</option>}
              <option value="PENDING">{ENQUIRY_STATUS_LABELS.PENDING}</option>
              <option value="CLOSED">{ENQUIRY_STATUS_LABELS.CLOSED}</option>
            </Select>
          </Field>
        )}
        <Field label="Notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea rows={2} invalid={!!errors.notes} {...register('notes')} />
        </Field>
      </form>
    </Modal>
  );
}

/** Log a call/message with a lead, reschedule the next follow-up, or close the lead. */
export function EnquiryRespondModal({ enquiryId, onClose }) {
  const { branchId } = useAuth();
  const invalidate = useInvalidateEnquiries();
  const enquiry = useQuery({ queryKey: [branchId, 'enquiry', enquiryId], queryFn: () => api(`/enquiries/${enquiryId}`) });

  const form = useApiForm({
    schema: enquiryResponseSchema,
    defaultValues: { note: '', nextFollowUpOn: '', closeLead: false },
    toPayload: ({ closeLead, ...values }) => ({ ...values, status: closeLead ? 'CLOSED' : null }),
    onSubmit: async (payload) => {
      await api(`/enquiries/${enquiryId}/responses`, { method: 'POST', body: payload });
      toast.success(payload.status === 'CLOSED' ? 'Lead closed' : 'Response saved');
      invalidate(enquiryId);
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;
  const e = enquiry.data;

  return (
    <Modal
      title={e ? `${e.name} — ${e.enquiryFor}` : 'Enquiry'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="response-form" loading={isSubmitting}>Save response</Button>
        </>
      }
    >
      {enquiry.isPending ? (
        <Spinner className="mx-auto my-8" />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <ContactLinks phone={e.phone} message={`Hi ${e.name.split(' ')[0]}, following up on your enquiry about ${e.enquiryFor}.`} />
            <Badge tone={TYPE_TONES[e.type]}>{ENQUIRY_TYPE_LABELS[e.type]}</Badge>
            <span className="text-slate-500">{LEAD_SOURCE_LABELS[e.source]}</span>
            {e.followUpOn && <span className="text-slate-500">Follow up {formatDate(e.followUpOn)}</span>}
            {e.assignedTo && <span className="text-slate-500">· {e.assignedTo.name}</span>}
          </div>

          <form id="response-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-[1fr_11rem]">
            <Field label="What happened?" error={errors.note?.message} required>
              <Textarea rows={2} placeholder="e.g. Called, wants a quote for 4 people" invalid={!!errors.note} {...register('note')} />
            </Field>
            <Field label="Next follow-up" error={errors.nextFollowUpOn?.message}>
              <Input type="date" invalid={!!errors.nextFollowUpOn} {...register('nextFollowUpOn')} />
            </Field>
            {e.status === 'PENDING' && (
              <Checkbox className="sm:col-span-2" label="Close this lead" description="Not interested or unreachable." {...register('closeLead')} />
            )}
          </form>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">History</h3>
            {e.responses.length === 0 ? (
              <p className="text-sm text-slate-500">No responses logged yet.{e.notes ? ` Notes: ${e.notes}` : ''}</p>
            ) : (
              <ul className="space-y-2">
                {e.responses.map((r) => (
                  <li key={r.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <p className="text-slate-800">{r.note}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{r.createdBy.name} · {formatDateTime(r.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

export function ConvertEnquiryModal({ enquiry, onClose, onConverted }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateEnquiries();

  const form = useApiForm({
    schema: convertEnquirySchema,
    defaultValues: { gender: 'FEMALE' },
    onSubmit: async (payload) => {
      const result = await api(`/enquiries/${enquiry.id}/convert`, { method: 'POST', body: payload });
      toast.success(result.createdClient ? `${enquiry.name} added as a client` : `Linked to existing client ${enquiry.name}`);
      invalidate(enquiry.id);
      queryClient.invalidateQueries({ queryKey: [branchId, 'clients'] });
      queryClient.invalidateQueries({ queryKey: [branchId, 'client-segments'] });
      onClose();
      onConverted?.(result.clientId);
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={`Convert ${enquiry.name} to a client`}
      description={
        enquiry.client
          ? `A client with ${enquiry.phone} already exists; the enquiry will be linked to them.`
          : 'Creates a client profile from this enquiry.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="convert-form" loading={isSubmitting}>Convert</Button>
        </>
      }
    >
      <form id="convert-form" onSubmit={form.submit} noValidate>
        <Field label="Gender" hint={enquiry.client ? 'Only used when creating a new client.' : undefined} error={errors.gender?.message} required>
          <Select {...register('gender')}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{GENDER_LABELS[g]}</option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}
