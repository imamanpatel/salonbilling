import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Ban, CalendarCheck, Check, IndianRupee, Pencil, Receipt, RotateCcw, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { CASH_METHODS, formatINR } from '@salon/shared';
import { appointmentAdvanceSchema, appointmentStatusSchema } from '@salon/shared/appointments';
import { ContactLinks } from '../../components/clients.jsx';
import { Button, Field, Input, Modal, Select, Spinner, Textarea } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDateTime, moneyInput } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import {
  AppointmentStatusBadge, formatLongDate, METHOD_LABELS, SOURCE_LABELS, STATUS_LABELS, useInvalidateAppointments,
} from './lib.jsx';

function CancelForm({ appointmentId, onDone, onBack }) {
  const invalidate = useInvalidateAppointments();
  const form = useApiForm({
    schema: appointmentStatusSchema,
    defaultValues: { cancelReason: '' },
    toPayload: (values) => ({ ...values, status: 'CANCELLED' }),
    onSubmit: async (payload) => {
      await api(`/appointments/${appointmentId}/status`, { method: 'PATCH', body: payload });
      toast.success('Appointment cancelled');
      invalidate();
      onDone();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <form onSubmit={form.submit} noValidate className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/60 p-3">
      <Field label="Why is it being cancelled?" error={errors.cancelReason?.message} required>
        <Textarea rows={2} autoFocus placeholder="e.g. Client is unwell, will rebook" invalid={!!errors.cancelReason} {...register('cancelReason')} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>Keep appointment</Button>
        <Button type="submit" variant="danger" size="sm" loading={isSubmitting}>Cancel appointment</Button>
      </div>
    </form>
  );
}

function AdvanceForm({ appointmentId, onDone, onBack }) {
  const invalidate = useInvalidateAppointments();
  const form = useApiForm({
    schema: appointmentAdvanceSchema,
    defaultValues: { amountPaise: '', method: 'CASH', reference: '' },
    toPayload: (values) => ({ ...values, amountPaise: moneyInput(values.amountPaise) }),
    onSubmit: async (payload) => {
      await api(`/appointments/${appointmentId}/advance`, { method: 'POST', body: payload });
      toast.success(`Advance of ${formatINR(payload.amountPaise)} recorded`);
      invalidate();
      onDone();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <form onSubmit={form.submit} noValidate className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Amount (₹)" error={errors.amountPaise?.message} required>
          <Input inputMode="decimal" autoFocus invalid={!!errors.amountPaise} {...register('amountPaise')} />
        </Field>
        <Field label="Method" error={errors.method?.message} required>
          <Select {...register('method')}>
            {CASH_METHODS.map((m) => (
              <option key={m} value={m}>{METHOD_LABELS[m]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" error={errors.reference?.message}>
          <Input invalid={!!errors.reference} {...register('reference')} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>Back</Button>
        <Button type="submit" size="sm" loading={isSubmitting}>Record advance</Button>
      </div>
    </form>
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

export default function AppointmentDetailsModal({ appointmentId, onClose, onEdit }) {
  const { branchId } = useAuth();
  const navigate = useNavigate();
  const invalidate = useInvalidateAppointments();
  const [mode, setMode] = useState(null); // 'cancel' | 'advance'
  const query = useQuery({
    queryKey: [branchId, 'appointments', 'detail', appointmentId],
    queryFn: () => api(`/appointments/${appointmentId}`),
  });

  const changeStatus = useMutation({
    mutationFn: (status) => api(`/appointments/${appointmentId}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: (saved) => {
      toast.success(`Marked ${STATUS_LABELS[saved.status].toLowerCase()}`);
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const a = query.data;
  const statusButton = (status, label, Icon, variant = 'secondary') => (
    <Button
      variant={variant}
      size="sm"
      onClick={() => changeStatus.mutate(status)}
      loading={changeStatus.isPending && changeStatus.variables === status}
      disabled={changeStatus.isPending}
    >
      <Icon className="size-3.5" /> {label}
    </Button>
  );

  let actions = null;
  if (a && !mode) {
    const live = ['REQUESTED', 'BOOKED', 'CHECKED_IN'].includes(a.status);
    const billable = a.status === 'BOOKED' || a.status === 'CHECKED_IN';
    actions = (
      <div className="flex flex-wrap gap-2">
        {a.status === 'REQUESTED' && statusButton('BOOKED', 'Confirm', CalendarCheck, 'primary')}
        {a.status === 'BOOKED' && statusButton('CHECKED_IN', 'Check in', UserCheck, 'primary')}
        {billable && (
          <Button
            size="sm"
            onClick={() => {
              onClose();
              navigate(`/billing/new?appointmentId=${a.id}`);
            }}
          >
            <Receipt className="size-3.5" /> Create bill
          </Button>
        )}
        {live && (
          <Button variant="secondary" size="sm" onClick={() => onEdit(a)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        )}
        {live && (
          <Button variant="secondary" size="sm" onClick={() => setMode('advance')}>
            <IndianRupee className="size-3.5" /> Add advance
          </Button>
        )}
        {a.status === 'CHECKED_IN' && statusButton('BOOKED', 'Undo check-in', RotateCcw)}
        {a.status === 'BOOKED' && statusButton('NO_SHOW', 'No-show', UserX)}
        {live && (
          <Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => setMode('cancel')}>
            <Ban className="size-3.5" /> Cancel
          </Button>
        )}
        {(a.status === 'CANCELLED' || a.status === 'NO_SHOW') && statusButton('BOOKED', 'Restore booking', RotateCcw)}
      </div>
    );
  }

  return (
    <Modal
      title={a ? a.client.name : 'Appointment'}
      description={a ? `${formatLongDate(a.date)} · ${a.startTime}–${a.endTime}` : undefined}
      onClose={onClose}
      size="lg"
      focusForm={false}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {query.isPending ? (
        <Spinner className="mx-auto my-10" />
      ) : query.error ? (
        <p className="text-sm text-rose-600">{query.error.message}</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <AppointmentStatusBadge status={a.status} />
            {a.status === 'BILLED' && <span className="text-sm text-slate-500">Billed — this appointment can no longer be changed.</span>}
          </div>

          {actions}
          {mode === 'cancel' && <CancelForm appointmentId={a.id} onBack={() => setMode(null)} onDone={() => setMode(null)} />}
          {mode === 'advance' && <AdvanceForm appointmentId={a.id} onBack={() => setMode(null)} onDone={() => setMode(null)} />}

          <dl className="grid gap-4 sm:grid-cols-3">
            <Detail label="Client">
              <Link to={`/clients?view=${a.clientId}`} onClick={onClose} className="font-medium hover:text-brand-700">
                {a.client.name}
              </Link>
            </Detail>
            <Detail label="Phone">
              <ContactLinks phone={a.client.phone} message={`Hi ${a.client.name.split(' ')[0]}, about your appointment on ${formatLongDate(a.date)} at ${a.startTime}.`} />
            </Detail>
            <Detail label="Booked via">{SOURCE_LABELS[a.source]}</Detail>
          </dl>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Services</h3>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {a.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                  <span className="w-24 text-slate-500 tabular-nums">{item.startTime}–{item.endTime}</span>
                  <span className="min-w-32 flex-1 font-medium text-slate-900">{item.service.name}</span>
                  <span className="text-slate-600">{item.staff?.name ?? 'Any provider'}</span>
                  <span className="w-24 text-right text-slate-900 tabular-nums">{formatINR(item.pricePaise)}</span>
                </li>
              ))}
              <li className="flex justify-between px-4 py-2.5 text-sm font-medium">
                <span>Total</span>
                <span className="tabular-nums">{formatINR(a.totalPaise)}</span>
              </li>
            </ul>
          </section>

          {a.payments.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Advance paid · {formatINR(a.advancePaise)}</h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {a.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
                    <span className="text-slate-500">{formatDateTime(p.receivedAt)}</span>
                    <span className="flex-1 text-slate-700">
                      {METHOD_LABELS[p.method] ?? p.method}
                      {p.reference ? ` · ${p.reference}` : ''}
                      {p.billId && <span className="text-emerald-700"> · <Check className="inline size-3.5" /> applied to bill</span>}
                    </span>
                    <span className="tabular-nums">{formatINR(p.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(a.notes || a.cancelReason) && (
            <dl className="grid gap-4 sm:grid-cols-2">
              {a.notes && <Detail label="Notes">{a.notes}</Detail>}
              {a.cancelReason && <Detail label="Cancellation reason">{a.cancelReason}</Detail>}
            </dl>
          )}
          <p className="text-xs text-slate-400">Booked {formatDateTime(a.createdAt)}</p>
        </div>
      )}
    </Modal>
  );
}
