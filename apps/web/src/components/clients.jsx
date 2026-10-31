import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MessageCircle, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { clientFollowUpSchema, clientSchema, GENDERS, LEAD_SOURCES } from '@salon/shared';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  ENQUIRY_STATUS_LABELS, formatDate, formatDayMonth, GENDER_LABELS, LEAD_SOURCE_LABELS, todayIso, whatsappLink,
} from '../lib/format.js';
import { useTeam } from '../lib/hooks.js';
import { useApiForm } from '../lib/useApiForm.js';
import { Badge, Button, Field, Input, Modal, Select, Spinner, Textarea } from './ui.jsx';

/** Phone number with tap-to-call and a WhatsApp shortcut (optionally pre-filled with `message`). */
export function ContactLinks({ phone, message }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <a href={`tel:${phone}`} className="tabular-nums hover:text-brand-700">{phone}</a>
      <a
        href={whatsappLink(phone, message)}
        target="_blank"
        rel="noreferrer"
        title="Open in WhatsApp"
        aria-label={`WhatsApp ${phone}`}
        className="text-emerald-600 hover:text-emerald-700"
      >
        <MessageCircle className="size-4" />
      </a>
    </span>
  );
}

export function ClientFormModal({ client, onClose, onSaved }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const team = useTeam();
  const isNew = !client.id;

  const form = useApiForm({
    schema: clientSchema,
    defaultValues: {
      name: client.name ?? '',
      phone: client.phone ?? '',
      gender: client.gender ?? 'FEMALE',
      email: client.email ?? '',
      dob: client.dob ?? '',
      anniversary: client.anniversary ?? '',
      source: client.source ?? '',
      assignedToId: client.assignedToId ?? '',
      address: client.address ?? '',
      notes: client.notes ?? '',
    },
    onSubmit: async (payload) => {
      const saved = await api(isNew ? '/clients' : `/clients/${client.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? `${saved.name} added` : 'Client updated');
      queryClient.invalidateQueries({ queryKey: [branchId, 'clients'] });
      queryClient.invalidateQueries({ queryKey: [branchId, 'client-segments'] });
      queryClient.invalidateQueries({ queryKey: [branchId, 'client', saved.id] });
      onSaved?.(saved);
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={isNew ? 'Add client' : `Edit ${client.name}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="client-form" loading={isSubmitting}>{isNew ? 'Add client' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="client-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.name?.message} required>
          <Input invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field label="Phone" error={errors.phone?.message} required>
          <Input type="tel" inputMode="tel" placeholder="10-digit mobile" invalid={!!errors.phone} {...register('phone')} />
        </Field>
        <Field label="Gender" error={errors.gender?.message} required>
          <Select {...register('gender')}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{GENDER_LABELS[g]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" invalid={!!errors.email} {...register('email')} />
        </Field>
        <Field label="Date of birth" error={errors.dob?.message}>
          <Input type="date" invalid={!!errors.dob} {...register('dob')} />
        </Field>
        <Field label="Anniversary" error={errors.anniversary?.message}>
          <Input type="date" invalid={!!errors.anniversary} {...register('anniversary')} />
        </Field>
        <Field label="How did they find us?" error={errors.source?.message}>
          <Select {...register('source')}>
            <option value="">—</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Assigned to" hint="Team member who looks after this client" error={errors.assignedToId?.message}>
          <Select {...register('assignedToId')}>
            <option value="">—</option>
            {team.data?.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Address" error={errors.address?.message} className="sm:col-span-2">
          <Input invalid={!!errors.address} {...register('address')} />
        </Field>
        <Field label="Notes" hint="Allergies, preferences, anything the team should know" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea rows={2} invalid={!!errors.notes} {...register('notes')} />
        </Field>
      </form>
    </Modal>
  );
}

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children || '—'}</dd>
    </div>
  );
}

/**
 * Client 360°: profile, follow-ups and enquiries, plus `sections` contributed by feature modules
 * (bills, wallet, packages, appointments...). Each section receives `{ client }`.
 */
export function ClientProfileModal({ clientId, onClose, onEdit, sections = [] }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const client = useQuery({ queryKey: [branchId, 'client', clientId], queryFn: () => api(`/clients/${clientId}`) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [branchId, 'client', clientId] });
    queryClient.invalidateQueries({ queryKey: [branchId, 'follow-ups'] });
  };

  const followUpDefaults = { dueOn: todayIso(), dueTime: '', note: '' };
  const followUpForm = useApiForm({
    schema: clientFollowUpSchema,
    defaultValues: followUpDefaults,
    onSubmit: async (payload) => {
      await api(`/clients/${clientId}/follow-ups`, { method: 'POST', body: payload });
      toast.success('Follow-up scheduled');
      followUpForm.reset(followUpDefaults);
      refresh();
    },
  });

  const complete = useMutation({
    mutationFn: (followUpId) => api(`/clients/follow-ups/${followUpId}/complete`, { method: 'PATCH' }),
    onSuccess: () => {
      toast.success('Marked as done');
      refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const c = client.data;
  const today = todayIso();
  const { register, formState: { errors, isSubmitting } } = followUpForm;

  return (
    <Modal
      title={c?.name ?? 'Client'}
      description={c ? `Client since ${formatDate(c.createdAt)} · Invite code ${c.referralCode}` : undefined}
      onClose={onClose}
      size="xl"
      focusForm={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {c && (
            <Button onClick={() => onEdit(c)}>
              <Pencil className="size-4" /> Edit details
            </Button>
          )}
        </>
      }
    >
      {client.isPending ? (
        <Spinner className="mx-auto my-10" />
      ) : client.error ? (
        <p className="text-sm text-rose-600">{client.error.message}</p>
      ) : (
        <div className="space-y-6">
          <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Detail label="Phone"><ContactLinks phone={c.phone} /></Detail>
            <Detail label="Gender">{GENDER_LABELS[c.gender]}</Detail>
            <Detail label="Email">{c.email}</Detail>
            <Detail label="Source">{LEAD_SOURCE_LABELS[c.source]}</Detail>
            <Detail label="Birthday">{c.dob && formatDayMonth(c.dob)}</Detail>
            <Detail label="Anniversary">{c.anniversary && formatDayMonth(c.anniversary)}</Detail>
            <Detail label="Assigned to">{c.assignedTo?.name}</Detail>
            <Detail label="Home branch">{c.homeBranch?.name}</Detail>
            {c.address && <div className="sm:col-span-3 lg:col-span-4"><Detail label="Address">{c.address}</Detail></div>}
            {c.notes && <div className="sm:col-span-3 lg:col-span-4"><Detail label="Notes">{c.notes}</Detail></div>}
          </dl>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Follow-ups</h3>
            <form onSubmit={followUpForm.submit} noValidate className="mb-3 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-[9rem_7rem_1fr_auto] sm:items-start">
              <Field label="Date" error={errors.dueOn?.message}>
                <Input type="date" invalid={!!errors.dueOn} {...register('dueOn')} />
              </Field>
              <Field label="Time" error={errors.dueTime?.message}>
                <Input type="time" invalid={!!errors.dueTime} {...register('dueTime')} />
              </Field>
              <Field label="What to follow up on" error={errors.note?.message}>
                <Input placeholder="e.g. Remind about hair spa offer" invalid={!!errors.note} {...register('note')} />
              </Field>
              <Button type="submit" className="sm:mt-7" loading={isSubmitting}>Schedule</Button>
            </form>
            {c.followUps.length === 0 ? (
              <p className="text-sm text-slate-500">No follow-ups yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {c.followUps.map((f) => {
                  const overdue = !f.completedAt && f.dueOn < today;
                  return (
                    <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                      <span className={overdue ? 'w-32 font-medium text-rose-600' : 'w-32 text-slate-700'}>
                        {formatDate(f.dueOn)} {f.dueTime}
                      </span>
                      <span className="min-w-40 flex-1 text-slate-800">{f.note}</span>
                      <span className="text-xs text-slate-500">{f.createdBy.name} · {f.branch.name}</span>
                      {f.completedAt ? (
                        <Badge tone="green">Done</Badge>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => complete.mutate(f.id)} disabled={complete.isPending}>
                          <Check className="size-3.5" /> Done
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {c.enquiries.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Enquiries</h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {c.enquiries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="w-28 text-slate-500">{formatDate(e.createdAt)}</span>
                    <span className="flex-1 text-slate-800">{e.enquiryFor}</span>
                    <span className="text-xs text-slate-500">{e.branch.name}</span>
                    <Badge tone={e.status === 'CONVERTED' ? 'green' : 'slate'}>{ENQUIRY_STATUS_LABELS[e.status]}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {sections.map((Section, index) => (
            <Section key={index} client={c} />
          ))}
        </div>
      )}
    </Modal>
  );
}
