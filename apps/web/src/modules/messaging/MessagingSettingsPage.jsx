import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, FileText, Info, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  CHANNEL_FIELDS, CHANNEL_PROVIDERS, MESSAGE_CHANNELS, MESSAGE_KINDS, messageTemplateSchema, messagingSettingsSchema,
  messagingTestSchema, reminderRuleSchema,
} from '@salon/shared/messaging';
import {
  Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge,
  Tabs, Textarea,
} from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useDebounced } from '../../lib/hooks.js';
import { APP_NAME } from '../../lib/brand.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { PlaceholderChips, PreviewBox, useInsertableField } from './components.jsx';
import { CHANNEL_LABELS, KIND_LABELS, PROVIDER_LABELS } from './labels.js';

const TABS = [
  { value: 'providers', label: 'Providers' },
  { value: 'templates', label: 'Templates' },
  { value: 'reminders', label: 'Service reminders' },
];
const EMPTY_CONFIG = { url: '', headerName: '', headerValue: '', phoneNumberId: '', accessToken: '' };

export default function MessagingSettingsPage() {
  const { branch } = useAuth();
  const [tab, setTab] = useState('providers');
  return (
    <>
      <PageHeader
        title="Messaging"
        description={`How ${branch?.name ?? 'this branch'} sends SMS, WhatsApp and email to clients.`}
        actions={<Tabs tabs={TABS} value={tab} onChange={setTab} />}
      />
      {tab === 'providers' && <ProvidersTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'reminders' && <RemindersTab />}
    </>
  );
}

function Note({ children, tone = 'slate' }) {
  const tones = { slate: 'border-slate-200 bg-slate-50 text-slate-600', amber: 'border-amber-200 bg-amber-50 text-amber-800' };
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${tones[tone]}`}>
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

// ─── Providers ────────────────────────────────────────────────────────────────

function ProvidersTab() {
  const { branchId } = useAuth();
  const settings = useQuery({ queryKey: [branchId, 'messaging', 'settings'], queryFn: () => api('/messaging/settings') });

  if (settings.isPending) return <Spinner className="mx-auto mt-12 size-6" />;
  if (settings.error) return <p className="text-sm text-rose-600">{settings.error.message}</p>;
  return (
    <div className="space-y-6">
      <ProvidersForm key={settings.dataUpdatedAt} settings={settings.data} />
      <TestMessageCard />
    </div>
  );
}

function ProvidersForm({ settings }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const defaultValues = { defaultChannel: settings.defaultChannel };
  for (const channel of MESSAGE_CHANNELS) {
    const { provider, config } = CHANNEL_FIELDS[channel];
    defaultValues[provider] = settings[provider];
    defaultValues[config] = { ...EMPTY_CONFIG, ...settings[config] };
  }

  const form = useApiForm({
    schema: messagingSettingsSchema,
    defaultValues,
    onSubmit: async (payload) => {
      await api('/messaging/settings', { method: 'PUT', body: payload });
      toast.success('Messaging settings saved');
      queryClient.invalidateQueries({ queryKey: [branchId, 'messaging', 'settings'] });
    },
  });
  const { register, watch, formState: { errors, isSubmitting, isDirty } } = form;

  return (
    <Card>
      <CardHeader title="Providers" description="Pick how each channel is delivered. Credentials are stored per branch and never shown in full." />
      <form onSubmit={form.submit} noValidate className="space-y-6 p-5">
        <Note>
          <strong>Console</strong> only writes messages to the server log — nothing reaches clients. It is the default until you
          configure a real provider for a channel.
        </Note>
        <Field label="Default channel" hint="Used by automatic reminders and when sending without picking a channel." className="max-w-xs">
          <Select {...register('defaultChannel')}>
            {MESSAGE_CHANNELS.map((c) => (
              <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-6 lg:grid-cols-3">
          {MESSAGE_CHANNELS.map((channel) => (
            <ChannelFieldset key={channel} channel={channel} register={register} errors={errors} provider={watch(CHANNEL_FIELDS[channel].provider)} />
          ))}
        </div>
        <Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save providers</Button>
      </form>
    </Card>
  );
}

function ChannelFieldset({ channel, provider, register, errors }) {
  const { provider: providerField, config } = CHANNEL_FIELDS[channel];
  const configErrors = errors[config] ?? {};
  const secretHint = 'Leave the masked value (••••1234) to keep the saved one.';

  return (
    <fieldset className="space-y-4 rounded-xl border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-900">{CHANNEL_LABELS[channel]}</legend>
      <Field label="Provider" error={errors[providerField]?.message}>
        <Select {...register(providerField)}>
          {CHANNEL_PROVIDERS[channel].map((p) => (
            <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
          ))}
        </Select>
      </Field>

      {provider === 'CONSOLE' && <p className="text-xs text-slate-500">Messages are logged on the server only.</p>}

      {provider === 'WEBHOOK' && (
        <>
          <Field label="Webhook URL" required error={configErrors.url?.message} hint='We POST JSON { "channel", "to", "body", "kind" }; any 2xx counts as sent.'>
            <Input placeholder="https://" invalid={!!configErrors.url} {...register(`${config}.url`)} />
          </Field>
          <Field label="Auth header name" error={configErrors.headerName?.message}>
            <Input placeholder="e.g. X-Api-Key" invalid={!!configErrors.headerName} {...register(`${config}.headerName`)} />
          </Field>
          <Field label="Auth header value" error={configErrors.headerValue?.message} hint={secretHint}>
            <Input autoComplete="off" invalid={!!configErrors.headerValue} {...register(`${config}.headerValue`)} />
          </Field>
        </>
      )}

      {provider === 'WHATSAPP_CLOUD' && (
        <>
          <Field label="Phone number ID" required error={configErrors.phoneNumberId?.message} hint="From Meta Business → WhatsApp → API setup.">
            <Input inputMode="numeric" invalid={!!configErrors.phoneNumberId} {...register(`${config}.phoneNumberId`)} />
          </Field>
          <Field label="Access token" required error={configErrors.accessToken?.message} hint={secretHint}>
            <Input autoComplete="off" invalid={!!configErrors.accessToken} {...register(`${config}.accessToken`)} />
          </Field>
          <Note tone="amber">
            WhatsApp only delivers free-form text within 24 hours of the client's last message to you. Business-initiated
            messages outside that window (reminders, wishes) need templates approved by Meta.
          </Note>
        </>
      )}
    </fieldset>
  );
}

function TestMessageCard() {
  const form = useApiForm({
    schema: messagingTestSchema,
    defaultValues: { channel: 'WHATSAPP', to: '', body: `This is a test message from ${APP_NAME}.` },
    onSubmit: async (payload) => {
      const result = await api('/messaging/test', { method: 'POST', body: payload });
      if (!result.ok) toast.error(`Not sent: ${result.error}`);
      else if (result.provider === 'CONSOLE') toast.success('Logged on the server by the Console provider (not delivered).');
      else toast.success(`Sent via ${PROVIDER_LABELS[result.provider]}${result.providerRef ? ` (ref ${result.providerRef})` : ''}`);
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Card>
      <CardHeader title="Send a test message" description="Uses the saved provider for the channel (save changes first). Test messages are not logged." />
      <form onSubmit={form.submit} noValidate className="flex flex-wrap items-start gap-3 p-5">
        <Field label="Channel" className="w-36">
          <Select {...register('channel')}>
            {MESSAGE_CHANNELS.map((c) => (
              <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
            ))}
          </Select>
        </Field>
        <Field label="To" error={errors.to?.message} className="w-56">
          <Input placeholder="Phone or email" invalid={!!errors.to} {...register('to')} />
        </Field>
        <Field label="Message" error={errors.body?.message} className="min-w-64 flex-1">
          <Input invalid={!!errors.body} {...register('body')} />
        </Field>
        <Button type="submit" className="mt-7" loading={isSubmitting}>
          <Send className="size-4" /> Send test
        </Button>
      </form>
    </Card>
  );
}

// ─── Templates ────────────────────────────────────────────────────────────────

function useTemplateDefaults() {
  const { branchId } = useAuth();
  return useQuery({
    queryKey: [branchId, 'messaging', 'template-defaults'],
    queryFn: () => api('/messaging/templates/defaults'),
    select: (data) => Object.fromEntries(data.kinds.map((k) => [k.kind, k])),
    staleTime: Infinity,
  });
}

function TemplatesTab() {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const templates = useQuery({ queryKey: [branchId, 'messaging', 'templates'], queryFn: () => api('/messaging/templates') });
  const defaults = useTemplateDefaults();

  const remove = useMutation({
    mutationFn: (id) => api(`/messaging/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Template deleted');
      queryClient.invalidateQueries({ queryKey: [branchId, 'messaging', 'templates'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const customised = new Set((templates.data ?? []).filter((t) => t.isActive).map((t) => t.kind));
  const columns = [
    {
      key: 'name',
      header: 'Template',
      render: (t) => (
        <>
          <span className="block font-medium text-slate-900">{t.name}</span>
          <span className="block text-xs text-slate-500">{KIND_LABELS[t.kind]} · {CHANNEL_LABELS[t.channel]}</span>
        </>
      ),
    },
    { key: 'body', header: 'Message', render: (t) => <span title={t.body} className="line-clamp-2 max-w-md text-xs text-slate-600">{t.body}</span> },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge active={t.isActive} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (t) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${t.name}`}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete the "${t.name}" template? The built-in default will be used instead.`)) remove.mutate(t.id);
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Templates"
          description="Your wording for each message type and channel. The newest active template for a type and channel is used."
          actions={
            <Button size="sm" onClick={() => setEditing({})}>
              <Plus className="size-3.5" /> Add template
            </Button>
          }
        />
        <DataTable
          columns={columns}
          rows={templates.data}
          loading={templates.isPending}
          error={templates.error}
          empty={<EmptyState icon={FileText} title="No custom templates" description="All messages use the built-in wording below." />}
        />
      </Card>

      <Card>
        <CardHeader title="Built-in wording" description="Used for any type and channel without an active template of your own." />
        {defaults.isPending ? (
          <Spinner className="mx-auto my-8" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {MESSAGE_KINDS.filter((kind) => kind !== 'CUSTOM').map((kind) => (
              <li key={kind} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
                <span className="w-48 font-medium text-slate-900">{KIND_LABELS[kind]}</span>
                <span className="min-w-60 flex-1 text-slate-600">{defaults.data?.[kind]?.defaultBody}</span>
                {customised.has(kind) && <Badge tone="brand">Customised</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && <TemplateFormModal template={editing} defaults={defaults.data} onClose={() => setEditing(null)} />}
    </div>
  );
}

function usePreview(body, kind) {
  const { branchId } = useAuth();
  const debounced = useDebounced(body ?? '', 400);
  return useQuery({
    queryKey: [branchId, 'messaging', 'preview', kind, debounced],
    queryFn: () => api('/messaging/templates/preview', { method: 'POST', body: { body: debounced, kind } }),
    enabled: debounced.trim().length > 0,
    placeholderData: (previous) => previous,
  });
}

function TemplateFormModal({ template, defaults, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const isNew = !template.id;

  const form = useApiForm({
    schema: messageTemplateSchema,
    defaultValues: {
      name: template.name ?? '',
      kind: template.kind ?? 'BIRTHDAY',
      channel: template.channel ?? 'WHATSAPP',
      body: template.body ?? '',
      isActive: template.isActive ?? true,
    },
    onSubmit: async (payload) => {
      await api(isNew ? '/messaging/templates' : `/messaging/templates/${template.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? 'Template added' : 'Template updated');
      queryClient.invalidateQueries({ queryKey: [branchId, 'messaging', 'templates'] });
      onClose();
    },
  });
  const { register, watch, setValue, formState: { errors, isSubmitting } } = form;
  const { field: bodyField, insert } = useInsertableField(form, 'body');
  const [kind, body] = watch(['kind', 'body']);
  const preview = usePreview(body, kind);
  const info = defaults?.[kind];

  return (
    <Modal
      title={isNew ? 'Add template' : `Edit ${template.name}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="template-form" loading={isSubmitting}>{isNew ? 'Add template' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="template-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name?.message} required className="sm:col-span-2">
          <Input invalid={!!errors.name} placeholder="e.g. Birthday wishes (WhatsApp)" {...register('name')} />
        </Field>
        <Field label="Message type" error={errors.kind?.message} required>
          <Select {...register('kind')}>
            {MESSAGE_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Channel" error={errors.channel?.message} required>
          <Select {...register('channel')}>
            {MESSAGE_CHANNELS.map((c) => (
              <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
            ))}
          </Select>
        </Field>
        <Field as="div" label="Message" error={errors.body?.message} required className="sm:col-span-2">
          <Textarea rows={5} maxLength={1000} invalid={!!errors.body} {...bodyField} />
          <div className="flex flex-wrap items-start justify-between gap-2">
            {info && <PlaceholderChips placeholders={info.placeholders} onInsert={insert} />}
            {info && (
              <Button variant="ghost" size="sm" className="mt-1.5" onClick={() => setValue('body', info.defaultBody, { shouldDirty: true })}>
                Use default
              </Button>
            )}
          </div>
          <span className="mt-1 block text-xs text-slate-500">Click a placeholder to insert it; it is replaced with the client's details when sent.</span>
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium text-slate-700">Preview with sample values</p>
          <PreviewBox text={body?.trim() ? preview.data?.body : ''} loading={preview.isFetching && !preview.data} />
        </div>
        <Checkbox className="sm:col-span-2" label="Active" description="Inactive templates are kept but not used." {...register('isActive')} />
      </form>
    </Modal>
  );
}

// ─── Service reminders ────────────────────────────────────────────────────────

function RemindersTab() {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const rules = useQuery({ queryKey: [branchId, 'messaging', 'reminder-rules'], queryFn: () => api('/messaging/reminder-rules') });

  const remove = useMutation({
    mutationFn: (id) => api(`/messaging/reminder-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Reminder deleted');
      queryClient.invalidateQueries({ queryKey: [branchId, 'messaging', 'reminder-rules'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const columns = [
    { key: 'service', header: 'Service', render: (r) => <span className="font-medium text-slate-900">{r.service.name}</span> },
    { key: 'afterDays', header: 'Remind after', className: 'whitespace-nowrap tabular-nums', render: (r) => `${r.afterDays} day${r.afterDays === 1 ? '' : 's'}` },
    { key: 'body', header: 'Message', render: (r) => <span title={r.body} className="line-clamp-2 max-w-md text-xs text-slate-600">{r.body}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge active={r.isActive} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete reminder for ${r.service.name}`}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete the reminder for ${r.service.name}?`)) remove.mutate(r.id);
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Service reminders"
        description="Message clients a set number of days after a service (e.g. a colour touch-up after 30 days), unless they have had it again since. Sent daily after 9 AM."
        actions={
          <Button size="sm" onClick={() => setEditing({})}>
            <Plus className="size-3.5" /> Add reminder
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={rules.data}
        loading={rules.isPending}
        error={rules.error}
        empty={<EmptyState icon={BellRing} title="No service reminders" description="Add one to bring clients back when a service is due again." />}
      />
      {editing && <RuleFormModal rule={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function RuleFormModal({ rule, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const isNew = !rule.id;
  const services = useQuery({ queryKey: [branchId, 'services', { status: 'active' }], queryFn: () => api('/services?status=active') });
  const defaults = useTemplateDefaults();
  const info = defaults.data?.SERVICE_REMINDER;

  const form = useApiForm({
    schema: reminderRuleSchema,
    defaultValues: { serviceId: rule.serviceId ?? '', afterDays: rule.afterDays ?? 30, body: rule.body ?? '', isActive: rule.isActive ?? true },
    onSubmit: async (payload) => {
      await api(isNew ? '/messaging/reminder-rules' : `/messaging/reminder-rules/${rule.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? 'Reminder added' : 'Reminder updated');
      queryClient.invalidateQueries({ queryKey: [branchId, 'messaging', 'reminder-rules'] });
      onClose();
    },
  });
  const { register, watch, setValue, formState: { errors, isSubmitting } } = form;
  const { field: bodyField, insert } = useInsertableField(form, 'body');
  const body = watch('body');
  const preview = usePreview(body, 'SERVICE_REMINDER');
  // Keep the current service selectable even if it has since been deactivated.
  const options = [...(services.data ?? [])];
  if (rule.service && !options.some((s) => s.id === rule.serviceId)) options.unshift(rule.service);

  return (
    <Modal
      title={isNew ? 'Add service reminder' : `Edit reminder for ${rule.service?.name}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="rule-form" loading={isSubmitting}>{isNew ? 'Add reminder' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="rule-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-3">
        <Field label="Service" error={errors.serviceId?.message} required className="sm:col-span-2">
          <Select invalid={!!errors.serviceId} {...register('serviceId')}>
            <option value="">{services.isPending ? 'Loading…' : 'Pick a service'}</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.category ? ` — ${s.category.name}` : ''}</option>
            ))}
          </Select>
        </Field>
        <Field label="Days after the visit" error={errors.afterDays?.message} required>
          <Input type="number" min={1} max={365} invalid={!!errors.afterDays} {...register('afterDays')} />
        </Field>
        <Field as="div" label="Message" error={errors.body?.message} required className="sm:col-span-3">
          <Textarea rows={4} maxLength={1000} invalid={!!errors.body} {...bodyField} />
          <div className="flex flex-wrap items-start justify-between gap-2">
            {info && <PlaceholderChips placeholders={info.placeholders} onInsert={insert} />}
            {info && (
              <Button variant="ghost" size="sm" className="mt-1.5" onClick={() => setValue('body', info.defaultBody, { shouldDirty: true })}>
                Use default
              </Button>
            )}
          </div>
        </Field>
        <div className="sm:col-span-3">
          <p className="mb-1.5 text-sm font-medium text-slate-700">Preview with sample values</p>
          <PreviewBox text={body?.trim() ? preview.data?.body : ''} loading={preview.isFetching && !preview.data} />
        </div>
        <Checkbox className="sm:col-span-3" label="Active" {...register('isActive')} />
      </form>
    </Modal>
  );
}
