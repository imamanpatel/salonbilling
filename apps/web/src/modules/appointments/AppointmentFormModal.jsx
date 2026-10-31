import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray } from 'react-hook-form';
import { Plus, Search, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { CASH_METHODS, clientSchema, fieldErrors, formatINR, GENDERS, paiseToRupees } from '@salon/shared';
import {
  addMinutesToTime, APPOINTMENT_SOURCES, appointmentSchema, appointmentUpdateSchema, MAX_APPOINTMENT_ITEMS,
} from '@salon/shared/appointments';
import { Button, Checkbox, Field, Input, Modal, Select, Spinner, Textarea } from '../../components/ui.jsx';
import { api, ApiError } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, GENDER_LABELS, moneyInput, todayIso } from '../../lib/format.js';
import { useDebounced } from '../../lib/hooks.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { HH_MM, METHOD_LABELS, SOURCE_LABELS, useAppointmentDay, useInvalidateAppointments } from './lib.jsx';

const blankItem = (overrides = {}) => ({ serviceId: '', staffId: '', startTime: '10:00', endTime: '', pricePaise: '', ...overrides });

// Enter in a helper input (search, mini client form) must not submit the booking form.
const stopEnter = (handler) => (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  handler?.();
};

function NewClientForm({ initial, onCancel, onCreated }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const looksLikePhone = /^\+?[\d\s-]{6,}$/.test(initial);
  const [values, setValues] = useState({ name: looksLikePhone ? '' : initial, phone: looksLikePhone ? initial : '', gender: 'FEMALE' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const create = async () => {
    const parsed = clientSchema.safeParse(values);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setSaving(true);
    try {
      const client = await api('/clients', { method: 'POST', body: parsed.data });
      toast.success(`${client.name} added`);
      queryClient.invalidateQueries({ queryKey: [branchId, 'clients'] });
      queryClient.invalidateQueries({ queryKey: [branchId, 'client-segments'] });
      onCreated(client);
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        setErrors(err.status === 409 && err.details.phone ? { phone: 'Already a client: search for them instead' } : err.details);
      } else {
        toast.error(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem]">
        <Field label="Name" error={errors.name}>
          <Input value={values.name} onChange={set('name')} onKeyDown={stopEnter(create)} invalid={!!errors.name} />
        </Field>
        <Field label="Phone" error={errors.phone}>
          <Input type="tel" inputMode="tel" value={values.phone} onChange={set('phone')} onKeyDown={stopEnter(create)} invalid={!!errors.phone} />
        </Field>
        <Field label="Gender" error={errors.gender}>
          <Select value={values.gender} onChange={set('gender')}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{GENDER_LABELS[g]}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Back to search</Button>
        <Button size="sm" onClick={create} loading={saving}>Add client</Button>
      </div>
    </div>
  );
}

function ClientPicker({ value, onChange, error }) {
  const { branchId } = useAuth();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search.trim());
  const params = { q, pageSize: 8 };
  const results = useQuery({
    queryKey: [branchId, 'clients', params],
    queryFn: () => api(`/clients?${new URLSearchParams(params)}`),
    enabled: q.length >= 2 && !value && !creating,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{value.name}</p>
          <p className="text-xs text-slate-500 tabular-nums">{value.phone}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }

  if (creating) {
    return (
      <NewClientForm
        initial={search.trim()}
        onCancel={() => setCreating(false)}
        onCreated={(client) => {
          setCreating(false);
          onChange(client);
        }}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            type="search"
            placeholder="Search name or phone"
            aria-label="Search clients"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={stopEnter()}
            invalid={!!error}
            className="pl-9"
          />
        </div>
        <Button variant="secondary" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" /> New client
        </Button>
      </div>
      {q.length >= 2 && (
        <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {results.isPending ? (
            <li className="py-3"><Spinner className="mx-auto" /></li>
          ) : results.data?.items.length ? (
            results.data.items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onChange(c)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="truncate font-medium text-slate-900">{c.name}</span>
                  <span className="text-slate-500 tabular-nums">{c.phone}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-slate-500">No clients found. Add them with “New client”.</li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Book or reschedule. `appointment` is an existing appointment to edit; `initial` pre-fills a new one
 * ({ date, staffId, startTime, client }).
 */
export default function AppointmentFormModal({ appointment, initial = {}, onClose, onSaved }) {
  const { branchId } = useAuth();
  const invalidate = useInvalidateAppointments();
  const isNew = !appointment?.id;
  const [client, setClient] = useState(appointment?.client ?? initial.client ?? null);
  const services = useQuery({
    queryKey: [branchId, 'services', { status: 'active' }],
    queryFn: () => api('/services?status=active'),
    staleTime: 60_000,
  });

  const form = useApiForm({
    schema: isNew ? appointmentSchema : appointmentUpdateSchema,
    defaultValues: {
      clientId: client?.id ?? '',
      date: appointment?.date ?? initial.date ?? todayIso(),
      source: appointment?.source ?? 'PHONE',
      notes: appointment?.notes ?? '',
      items: appointment?.items.map((item) => ({
        serviceId: item.serviceId,
        staffId: item.staffId ?? '',
        startTime: item.startTime,
        endTime: item.endTime,
        pricePaise: paiseToRupees(item.pricePaise),
      })) ?? [blankItem({ staffId: initial.staffId ?? '', startTime: initial.startTime ?? '10:00' })],
      advance: { amountPaise: '', method: 'CASH', reference: '' },
      notifyClient: isNew,
    },
    toPayload: ({ advance, items, ...values }) => ({
      ...values,
      items: items.map((item) => ({ ...item, pricePaise: moneyInput(item.pricePaise) })),
      advance: isNew && String(advance.amountPaise).trim() !== '' ? { ...advance, amountPaise: moneyInput(advance.amountPaise) } : null,
    }),
    onSubmit: async (payload) => {
      const saved = await api(isNew ? '/appointments' : `/appointments/${appointment.id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: payload,
      });
      toast.success(isNew ? `Booked ${saved.client.name} on ${formatDate(saved.date)} at ${saved.startTime}` : 'Appointment updated');
      invalidate();
      onSaved?.(saved);
      onClose();
    },
  });
  const { register, control, setValue, getValues, clearErrors, watch, formState: { errors, isSubmitting } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const day = useAppointmentDay(watch('date'));

  const serviceById = useMemo(() => new Map((services.data ?? []).map((s) => [s.id, s])), [services.data]);
  // Keep services/providers of an appointment being edited selectable even if they were deactivated since.
  const serviceGroups = useMemo(() => {
    const groups = new Map();
    for (const s of services.data ?? []) {
      const name = s.category?.name ?? 'Services';
      groups.set(name, [...(groups.get(name) ?? []), s]);
    }
    const missing = (appointment?.items ?? []).filter((i) => !serviceById.has(i.serviceId)).map((i) => i.service);
    if (missing.length) groups.set('No longer offered', [...new Map(missing.map((s) => [s.id, s])).values()]);
    return [...groups];
  }, [services.data, serviceById, appointment]);
  const providers = useMemo(() => {
    const list = [...(day.data?.providers ?? [])];
    for (const item of appointment?.items ?? []) {
      if (item.staff && !list.some((p) => p.id === item.staffId)) list.push(item.staff);
    }
    return list;
  }, [day.data, appointment]);

  const pickClient = (next) => {
    setClient(next);
    setValue('clientId', next?.id ?? '');
    clearErrors('clientId');
  };

  const fillFromService = (index, serviceId) => {
    const service = serviceById.get(serviceId);
    if (!service) return;
    const start = getValues(`items.${index}.startTime`);
    if (HH_MM.test(start)) setValue(`items.${index}.endTime`, addMinutesToTime(start, service.durationMin) ?? '');
    setValue(`items.${index}.pricePaise`, paiseToRupees(service.pricePaise));
  };

  const onStartChange = (index, start) => {
    const service = serviceById.get(getValues(`items.${index}.serviceId`));
    if (service && HH_MM.test(start)) setValue(`items.${index}.endTime`, addMinutesToTime(start, service.durationMin) ?? '');
  };

  const addRow = () => {
    const last = getValues('items').at(-1);
    append(blankItem({ staffId: last?.staffId ?? '', startTime: last?.endTime || last?.startTime || '10:00' }));
  };

  const formId = 'appointment-form';
  const itemsError = errors.items?.message ?? errors.items?.root?.message;

  return (
    <Modal
      title={isNew ? 'New appointment' : 'Edit appointment'}
      description={!isNew && client ? `${client.name} · currently ${formatDate(appointment.date)} at ${appointment.startTime}` : undefined}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} loading={isSubmitting}>{isNew ? 'Book appointment' : 'Save changes'}</Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          // Server errors on array rows aren't cleared by react-hook-form's own validation; start each attempt clean.
          clearErrors();
          form.submit(e);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem_10rem]">
          <Field label="Client" as="div" error={errors.clientId?.message} required>
            <input type="hidden" {...register('clientId')} />
            <ClientPicker value={client} onChange={pickClient} error={errors.clientId?.message} />
          </Field>
          <Field
            label="Date"
            error={errors.date?.message ?? (day.data?.isHoliday ? `Salon closed: ${day.data.holiday.description}` : undefined)}
            required
          >
            <Input type="date" invalid={!!errors.date || day.data?.isHoliday} {...register('date')} />
          </Field>
          <Field label="Source" error={errors.source?.message}>
            <Select {...register('source')}>
              {APPOINTMENT_SOURCES.map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </Select>
          </Field>
        </div>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Services</h3>
          <ul className="space-y-3">
            {fields.map((field, index) => {
              const rowErrors = errors.items?.[index] ?? {};
              return (
                <li
                  key={field.id}
                  className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(10rem,1fr)_10rem_6.5rem_6.5rem_7rem_auto] sm:items-start"
                >
                  <Field label="Service" error={rowErrors.serviceId?.message} required>
                    <Select
                      invalid={!!rowErrors.serviceId}
                      {...register(`items.${index}.serviceId`, { onChange: (e) => fillFromService(index, e.target.value) })}
                    >
                      <option value="">{services.isPending ? 'Loading…' : 'Pick a service'}</option>
                      {serviceGroups.map(([group, list]) => (
                        <optgroup key={group} label={group}>
                          {list.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}{s.durationMin ? ` · ${s.durationMin} min` : ''}{s.pricePaise != null ? ` · ${formatINR(s.pricePaise)}` : ''}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Provider" error={rowErrors.staffId?.message}>
                    <Select invalid={!!rowErrors.staffId} {...register(`items.${index}.staffId`)}>
                      <option value="">Any</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Start" error={rowErrors.startTime?.message} required>
                    <Input
                      type="time"
                      step={300}
                      invalid={!!rowErrors.startTime}
                      {...register(`items.${index}.startTime`, { onChange: (e) => onStartChange(index, e.target.value) })}
                    />
                  </Field>
                  <Field label="End" error={rowErrors.endTime?.message}>
                    <Input type="time" step={300} invalid={!!rowErrors.endTime} {...register(`items.${index}.endTime`)} />
                  </Field>
                  <Field label="Price (₹)" error={rowErrors.pricePaise?.message}>
                    <Input inputMode="decimal" placeholder="Default" invalid={!!rowErrors.pricePaise} {...register(`items.${index}.pricePaise`)} />
                  </Field>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="sm:mt-7"
                    onClick={() => remove(index)}
                    disabled={fields.length === 1}
                    aria-label={`Remove service ${index + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
          {itemsError && <p role="alert" className="mt-2 text-xs text-rose-600">{itemsError}</p>}
          <Button variant="secondary" size="sm" className="mt-3" onClick={addRow} disabled={fields.length >= MAX_APPOINTMENT_ITEMS}>
            <Plus className="size-3.5" /> Add service
          </Button>
        </section>

        <Field label="Notes" hint="Preferences, allergies or anything the stylist should know" error={errors.notes?.message}>
          <Textarea rows={2} invalid={!!errors.notes} {...register('notes')} />
        </Field>

        {isNew && (
          <section className="rounded-lg bg-slate-50 p-3">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Advance payment <span className="font-normal text-slate-500">(optional)</span></h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Amount (₹)" error={errors.advance?.amountPaise?.message}>
                <Input inputMode="decimal" invalid={!!errors.advance?.amountPaise} {...register('advance.amountPaise')} />
              </Field>
              <Field label="Method" error={errors.advance?.method?.message}>
                <Select {...register('advance.method')}>
                  {CASH_METHODS.map((m) => (
                    <option key={m} value={m}>{METHOD_LABELS[m]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference" hint="UPI/transaction id, cheque no." error={errors.advance?.reference?.message}>
                <Input invalid={!!errors.advance?.reference} {...register('advance.reference')} />
              </Field>
            </div>
          </section>
        )}

        <Checkbox
          label={isNew ? 'Send confirmation to client' : 'Send updated confirmation to client'}
          description="Queues a WhatsApp/SMS message with the date and time."
          {...register('notifyClient')}
        />
      </form>
    </Modal>
  );
}
