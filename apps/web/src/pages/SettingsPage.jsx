import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { holidaySchema, paiseToRupees, settingsSchema, TAX_APPLIES_TO, taxSchema } from '@salon/shared';
import {
  Button, Card, CardHeader, Checkbox, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge,
} from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { formatDate, moneyInput, TAX_APPLIES_LABELS } from '../lib/format.js';
import { useApiForm } from '../lib/useApiForm.js';

const REMINDERS = [
  ['autoBirthday', 'Birthday wishes', "Greet clients on their birthday."],
  ['autoAnniversary', 'Anniversary wishes', "Greet clients on their anniversary."],
  ['autoAppointment', 'Appointment reminders', 'Remind clients before their appointment.'],
  ['autoPendingPayment', 'Pending payment reminders', 'Nudge clients with an outstanding balance.'],
  ['autoPackageExpiry', 'Package expiry reminders', 'Warn clients before a package expires.'],
];

export default function SettingsPage() {
  const { branch } = useAuth();
  return (
    <>
      <PageHeader title="Settings" description={`Taxes, loyalty points, reminders and holidays for ${branch?.name ?? 'this branch'}.`} />
      <div className="space-y-6">
        <TaxesCard />
        <PreferencesCard />
        <HolidaysCard />
      </div>
    </>
  );
}

function TaxesCard() {
  const { branchId } = useAuth();
  const [editing, setEditing] = useState(null);
  const taxes = useQuery({ queryKey: [branchId, 'taxes'], queryFn: () => api('/settings/taxes') });

  const columns = [
    { key: 'name', header: 'Name', render: (t) => <span className="font-medium text-slate-900">{t.name}</span> },
    { key: 'ratePct', header: 'Rate', className: 'tabular-nums', render: (t) => `${t.ratePct}%` },
    { key: 'appliesTo', header: 'Applies to', render: (t) => TAX_APPLIES_LABELS[t.appliesTo] },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge active={t.isActive} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (t) => (
        <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
          <Pencil className="size-3.5" /> Edit
        </Button>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Tax rates"
        description="GST rates that can be applied on bills. Service prices are stored excluding tax."
        actions={
          <Button size="sm" onClick={() => setEditing({})}>
            <Plus className="size-3.5" /> Add tax
          </Button>
        }
      />
      <DataTable columns={columns} rows={taxes.data} loading={taxes.isPending} error={taxes.error} empty={<EmptyState title="No tax rates" />} />
      {editing && <TaxFormModal tax={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TaxFormModal({ tax, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const isNew = !tax.id;

  const form = useApiForm({
    schema: taxSchema,
    defaultValues: { name: tax.name ?? '', ratePct: tax.ratePct ?? 18, appliesTo: tax.appliesTo ?? 'SERVICE', isActive: tax.isActive ?? true },
    onSubmit: async (payload) => {
      await api(isNew ? '/settings/taxes' : `/settings/taxes/${tax.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? 'Tax added' : 'Tax updated');
      queryClient.invalidateQueries({ queryKey: [branchId, 'taxes'] });
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={isNew ? 'Add tax rate' : `Edit ${tax.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="tax-form" loading={isSubmitting}>{isNew ? 'Add tax' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="tax-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="As printed on bills" error={errors.name?.message} required className="sm:col-span-2">
          <Input autoFocus invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field label="Rate (%)" error={errors.ratePct?.message} required>
          <Input type="number" min={0} max={100} step="0.01" invalid={!!errors.ratePct} {...register('ratePct')} />
        </Field>
        <Field label="Applies to" error={errors.appliesTo?.message} required>
          <Select {...register('appliesTo')}>
            {TAX_APPLIES_TO.map((value) => (
              <option key={value} value={value}>{TAX_APPLIES_LABELS[value]}</option>
            ))}
          </Select>
        </Field>
        <Checkbox className="sm:col-span-2" label="Active" description="Inactive taxes can't be picked on new bills." {...register('isActive')} />
      </form>
    </Modal>
  );
}

function PreferencesCard() {
  const { branchId } = useAuth();
  const settings = useQuery({ queryKey: [branchId, 'settings'], queryFn: () => api('/settings') });

  return (
    <Card>
      <CardHeader title="Loyalty points & automatic reminders" />
      {settings.isPending ? (
        <div className="p-8">
          <Spinner className="mx-auto" />
        </div>
      ) : settings.error ? (
        <p className="p-5 text-sm text-rose-600">{settings.error.message}</p>
      ) : (
        <PreferencesForm key={settings.dataUpdatedAt} settings={settings.data} />
      )}
    </Card>
  );
}

function PreferencesForm({ settings }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();

  const form = useApiForm({
    schema: settingsSchema,
    defaultValues: { ...settings, redeemValuePaise: paiseToRupees(settings.redeemValuePaise) },
    toPayload: (values) => ({ ...values, redeemValuePaise: moneyInput(values.redeemValuePaise) }),
    onSubmit: async (payload) => {
      await api('/settings', { method: 'PUT', body: payload });
      toast.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: [branchId, 'settings'] });
    },
  });
  const { register, watch, formState: { errors, isSubmitting, isDirty } } = form;
  const [points, value] = watch(['redeemPoints', 'redeemValuePaise']);

  return (
    <form onSubmit={form.submit} noValidate className="grid gap-8 p-5 lg:grid-cols-2">
      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-semibold text-slate-900">Redeeming points</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Points" error={errors.redeemPoints?.message} required>
            <Input type="number" min={1} invalid={!!errors.redeemPoints} {...register('redeemPoints')} />
          </Field>
          <Field label="Are worth (₹)" error={errors.redeemValuePaise?.message} required>
            <Input inputMode="decimal" invalid={!!errors.redeemValuePaise} {...register('redeemValuePaise')} />
          </Field>
          <Field label="Max points per bill" hint="0 means no limit" error={errors.maxRedeemPoints?.message} className="sm:col-span-2">
            <Input type="number" min={0} invalid={!!errors.maxRedeemPoints} {...register('maxRedeemPoints')} />
          </Field>
        </div>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {points || 0} point{Number(points) === 1 ? '' : 's'} = ₹{value || 0} off a bill.
        </p>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-3 text-sm font-semibold text-slate-900">Automatic messages</legend>
        {REMINDERS.map(([name, label, description]) => (
          <Checkbox key={name} label={label} description={description} {...register(name)} />
        ))}
        <p className="text-xs text-slate-500">Messages start going out once SMS/WhatsApp is connected (milestone M7).</p>
      </fieldset>

      <div className="lg:col-span-2">
        <Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save settings</Button>
      </div>
    </form>
  );
}

function HolidaysCard() {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const holidays = useQuery({ queryKey: [branchId, 'holidays'], queryFn: () => api('/settings/holidays') });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [branchId, 'holidays'] });

  const form = useApiForm({
    schema: holidaySchema,
    defaultValues: { date: '', description: '' },
    onSubmit: async (payload) => {
      await api('/settings/holidays', { method: 'POST', body: payload });
      toast.success('Holiday added');
      form.reset();
      invalidate();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  const remove = useMutation({
    mutationFn: (id) => api(`/settings/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Holiday removed');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader title="Holidays" description="Days the branch is closed. Online booking will skip these dates." />
      <form onSubmit={form.submit} noValidate className="flex flex-wrap items-start gap-3 border-b border-slate-100 p-5">
        <Field label="Date" error={errors.date?.message} className="w-44">
          <Input type="date" invalid={!!errors.date} {...register('date')} />
        </Field>
        <Field label="Description" error={errors.description?.message} className="min-w-56 flex-1">
          <Input placeholder="e.g. Diwali" invalid={!!errors.description} {...register('description')} />
        </Field>
        <Button type="submit" className="mt-7" loading={isSubmitting}>
          <Plus className="size-4" /> Add
        </Button>
      </form>
      {holidays.isPending ? (
        <div className="p-8">
          <Spinner className="mx-auto" />
        </div>
      ) : holidays.data?.length ? (
        <ul className="divide-y divide-slate-100">
          {holidays.data.map((h) => (
            <li key={h.id} className="flex items-center gap-4 px-5 py-3 text-sm">
              <span className="w-28 font-medium text-slate-900 tabular-nums">{formatDate(h.date)}</span>
              <span className="flex-1 text-slate-700">{h.description}</span>
              <Button size="icon" variant="ghost" onClick={() => remove.mutate(h.id)} disabled={remove.isPending} aria-label={`Remove ${h.description}`}>
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={CalendarOff} title="No holidays added" />
      )}
    </Card>
  );
}
