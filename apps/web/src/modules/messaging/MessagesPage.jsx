import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, RotateCcw, Search, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { clientVars, MESSAGE_CHANNELS, MESSAGE_KINDS, MESSAGE_STATUSES, renderTemplate, sendMessagesSchema } from '@salon/shared/messaging';
import {
  Button, Card, cx, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Textarea,
} from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDateTime } from '../../lib/format.js';
import { useDebounced } from '../../lib/hooks.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { MessageStatusBadge, PlaceholderChips, PreviewBox, useInsertableField } from './components.jsx';
import { CHANNEL_LABELS, KIND_LABELS, STATUS_LABELS } from './labels.js';

const SUMMARY_CHIPS = [
  { status: 'SENT', label: 'Sent', className: 'text-emerald-700' },
  { status: 'FAILED', label: 'Failed', className: 'text-rose-700' },
  { status: 'QUEUED', label: 'Queued', className: 'text-sky-700' },
  { status: 'SKIPPED', label: 'Skipped (no contact)', className: 'text-amber-700' },
];
const EMPTY_FILTERS = { status: '', kind: '', channel: '', from: '', to: '' };
const MAX_CLIENTS = 1000;
const SEND_PLACEHOLDERS = ['firstName', 'name', 'salonName'];

export default function MessagesPage() {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sending, setSending] = useState(false);
  const q = useDebounced(search.trim());

  const params = { ...filters, q, page };
  const summary = useQuery({ queryKey: [branchId, 'messages', 'summary'], queryFn: () => api('/messaging/summary') });
  const logs = useQuery({
    queryKey: [branchId, 'messages', 'logs', params],
    queryFn: () => api(`/messaging/logs?${new URLSearchParams(params)}`),
    placeholderData: keepPreviousData,
  });

  const retry = useMutation({
    mutationFn: (id) => api(`/messaging/logs/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Message queued again');
      queryClient.invalidateQueries({ queryKey: [branchId, 'messages'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const setFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const filtered = Boolean(q || Object.values(filters).some(Boolean));

  const columns = [
    { key: 'createdAt', header: 'Time', className: 'whitespace-nowrap text-xs', render: (m) => formatDateTime(m.createdAt) },
    { key: 'client', header: 'Client', render: (m) => <span className="font-medium text-slate-900">{m.client?.name ?? '—'}</span> },
    { key: 'channel', header: 'Channel', render: (m) => CHANNEL_LABELS[m.channel] },
    { key: 'kind', header: 'Type', className: 'whitespace-nowrap', render: (m) => KIND_LABELS[m.kind] },
    { key: 'recipient', header: 'To', className: 'tabular-nums', render: (m) => m.recipient || <span className="text-slate-400">No contact</span> },
    {
      key: 'body',
      header: 'Message',
      render: (m) => (
        <span title={m.body} className="line-clamp-2 max-w-xs text-xs text-slate-600">{m.body}</span>
      ),
    },
    { key: 'status', header: 'Status', render: (m) => <MessageStatusBadge status={m.status} error={m.error} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (m) =>
        m.status === 'FAILED' || m.status === 'SKIPPED' ? (
          <Button variant="ghost" size="sm" onClick={() => retry.mutate(m.id)} disabled={retry.isPending}>
            <RotateCcw className="size-3.5" /> Retry
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Messages"
        description="Everything sent to clients by SMS, WhatsApp and email — automatic reminders and your own messages."
        actions={
          <Button onClick={() => setSending(true)}>
            <Send className="size-4" /> Send message
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SUMMARY_CHIPS.map((chip) => {
          const active = filters.status === chip.status;
          return (
            <button
              key={chip.status}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter('status', active ? '' : chip.status)}
              className={cx(
                'rounded-xl border bg-white p-4 text-left shadow-xs transition',
                active ? 'border-brand-400 ring-2 ring-brand-500/15' : 'border-slate-200 hover:border-brand-200',
              )}
            >
              <p className="text-sm text-slate-500">{chip.label} · last 7 days</p>
              <p className={cx('mt-1 text-2xl font-semibold tabular-nums', chip.className)}>
                {summary.data?.counts[chip.status] ?? '—'}
              </p>
            </button>
          );
        })}
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search client name, phone or email"
              className="pl-9"
              aria-label="Search messages"
            />
          </div>
          <Select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className="w-36" aria-label="Status">
            <option value="">Any status</option>
            {MESSAGE_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </Select>
          <Select value={filters.kind} onChange={(e) => setFilter('kind', e.target.value)} className="w-52" aria-label="Type">
            <option value="">Any type</option>
            {MESSAGE_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </Select>
          <Select value={filters.channel} onChange={(e) => setFilter('channel', e.target.value)} className="w-36" aria-label="Channel">
            <option value="">Any channel</option>
            {MESSAGE_CHANNELS.map((c) => (
              <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
            ))}
          </Select>
          <Input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} className="w-40" aria-label="From date" />
          <Input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} className="w-40" aria-label="To date" />
          {filtered && (
            <Button
              variant="ghost"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setSearch('');
                setPage(1);
              }}
            >
              Clear
            </Button>
          )}
        </div>
        <DataTable
          columns={columns}
          rows={logs.data?.items}
          loading={logs.isPending}
          error={logs.error}
          empty={
            <EmptyState
              icon={MessageSquare}
              title={filtered ? 'No messages match these filters' : 'No messages yet'}
              description={filtered ? undefined : 'Automatic reminders and messages you send will appear here.'}
            />
          }
        />
        {logs.data && <Pagination page={page} pageSize={logs.data.pageSize} total={logs.data.total} onChange={setPage} />}
      </Card>

      {sending && <SendMessageModal onClose={() => setSending(false)} />}
    </>
  );
}

function ClientPicker({ selected, onAdd, onRemove, error }) {
  const { branchId } = useAuth();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const results = useQuery({
    queryKey: [branchId, 'clients', { q, pageSize: 8 }],
    queryFn: () => api(`/clients?${new URLSearchParams({ q, pageSize: 8 })}`),
    enabled: q.length >= 2,
  });
  const chosen = new Set(selected.map((c) => c.id));
  const full = selected.length >= MAX_CLIENTS;

  return (
    <Field as="div" label="To" required error={error} hint={`${selected.length} selected (up to ${MAX_CLIENTS}).`}>
      {selected.length > 0 && (
        <div className="mb-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
          {selected.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pr-1 pl-2.5 text-xs font-medium text-brand-700">
              {c.name}
              <button type="button" onClick={() => onRemove(c.id)} aria-label={`Remove ${c.name}`} className="rounded-full p-0.5 hover:bg-brand-100">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={full ? 'Maximum reached' : 'Type a client name or phone to add'}
          disabled={full}
          invalid={!!error}
          aria-label="Find clients"
        />
        {q.length >= 2 && (
          <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {results.isPending ? (
              <Spinner className="mx-auto my-3" />
            ) : results.data?.items.length ? (
              results.data.items.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={chosen.has(c.id)}
                  onClick={() => {
                    onAdd(c);
                    setSearch('');
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  <span className="font-medium text-slate-900">{c.name}</span>
                  <span className="text-xs text-slate-500 tabular-nums">{c.phone}{c.email ? ` · ${c.email}` : ''}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-slate-500">No clients found.</p>
            )}
          </div>
        )}
      </div>
    </Field>
  );
}

function SendMessageModal({ onClose }) {
  const { branchId, branch } = useAuth();
  const queryClient = useQueryClient();
  const [clients, setClients] = useState([]);

  const form = useApiForm({
    schema: sendMessagesSchema,
    defaultValues: { channel: '', body: '' },
    toPayload: (values) => ({ ...values, clientIds: clients.map((c) => c.id) }),
    onSubmit: async (payload) => {
      const { queued, skipped } = await api('/messaging/send', { method: 'POST', body: payload });
      const skippedNote = skipped ? `, ${skipped} skipped (no phone/email for this channel)` : '';
      toast.success(`${queued} message${queued === 1 ? '' : 's'} queued${skippedNote}`);
      queryClient.invalidateQueries({ queryKey: [branchId, 'messages'] });
      onClose();
    },
  });
  const { register, watch, clearErrors, formState: { errors, isSubmitting } } = form;
  const { field: bodyField, insert } = useInsertableField(form, 'body');
  const body = watch('body');
  const sample = clients[0] ?? { name: 'Priya Sharma' };
  const preview = body ? renderTemplate(body, clientVars(sample, branch?.salonName)) : '';

  return (
    <Modal
      title="Send message"
      description="Messages are queued and sent in the background with this branch's provider."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="send-message-form" loading={isSubmitting}>
            <Send className="size-4" /> Send to {clients.length} client{clients.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <form id="send-message-form" onSubmit={form.submit} noValidate className="space-y-4">
        <ClientPicker
          selected={clients}
          error={errors.clientIds?.message}
          onAdd={(client) => {
            setClients((current) => (current.some((c) => c.id === client.id) || current.length >= MAX_CLIENTS ? current : [...current, client]));
            clearErrors('clientIds');
          }}
          onRemove={(id) => setClients((current) => current.filter((c) => c.id !== id))}
        />
        <Field label="Channel" error={errors.channel?.message} hint="Clients without a phone number (or email) for the channel are skipped.">
          <Select {...register('channel')}>
            <option value="">Branch default</option>
            {MESSAGE_CHANNELS.map((c) => (
              <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
            ))}
          </Select>
        </Field>
        <Field as="div" label="Message" required error={errors.body?.message}>
          <Textarea rows={5} maxLength={1000} invalid={!!errors.body} placeholder="Hi {firstName}, …" {...bodyField} />
          <PlaceholderChips placeholders={SEND_PLACEHOLDERS} onInsert={insert} />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Preview{clients[0] ? ` for ${clients[0].name}` : ''}</p>
          <PreviewBox text={preview} />
        </div>
      </form>
    </Modal>
  );
}
