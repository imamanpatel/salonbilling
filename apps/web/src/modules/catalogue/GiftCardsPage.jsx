import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Copy, Gift, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR } from '@salon/shared';
import { giftCardIssueSchema, normalizeGiftCardCode } from '@salon/shared/catalogue';
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, formatDateTime, moneyInput } from '../../lib/format.js';
import { useDebounced } from '../../lib/hooks.js';
import { useApiForm } from '../../lib/useApiForm.js';

const CARD_STATUS = {
  ACTIVE: { label: 'Active', tone: 'green' },
  USED: { label: 'Used up', tone: 'slate' },
  EXPIRED: { label: 'Expired', tone: 'amber' },
  INACTIVE: { label: 'Deactivated', tone: 'rose' },
};

const CardStatus = ({ status }) => <Badge tone={CARD_STATUS[status]?.tone}>{CARD_STATUS[status]?.label ?? status}</Badge>;

export default function GiftCardsPage() {
  const { branchId, canManage } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [issuing, setIssuing] = useState(false);
  const q = useDebounced(search.trim());

  const params = { q, status, page };
  const cards = useQuery({
    queryKey: [branchId, 'gift-cards', params],
    queryFn: () => api(`/gift-cards?${new URLSearchParams(params)}`),
    placeholderData: keepPreviousData,
  });

  const toggleStatus = useMutation({
    mutationFn: (card) => api(`/gift-cards/${card.id}/status`, { method: 'PATCH', body: { isActive: !card.isActive } }),
    onSuccess: (card) => {
      toast.success(`Gift card ${card.code} ${card.isActive ? 'activated' : 'deactivated'}`);
      queryClient.invalidateQueries({ queryKey: [branchId, 'gift-cards'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const columns = [
    { key: 'code', header: 'Code', render: (c) => <span className="font-mono font-semibold text-slate-900">{c.code}</span> },
    {
      key: 'client',
      header: 'Client',
      render: (c) =>
        c.client ? (
          <Link to={`/clients?view=${c.client.id}`} className="block">
            <span className="block font-medium text-slate-900 hover:text-brand-700">{c.client.name}</span>
            <span className="block text-xs text-slate-500">{c.client.phone}</span>
          </Link>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    { key: 'initial', header: 'Value', className: 'text-right tabular-nums', render: (c) => formatINR(c.initialPaise) },
    { key: 'balance', header: 'Balance', className: 'text-right tabular-nums font-medium', render: (c) => formatINR(c.balancePaise) },
    { key: 'expiresOn', header: 'Expires', render: (c) => (c.expiresOn ? formatDate(c.expiresOn) : 'Never') },
    {
      key: 'issued',
      header: 'Issued',
      render: (c) => (
        <div>
          <div>{formatDateTime(c.createdAt)}</div>
          <div className="text-xs text-slate-500">{c.issuedBill ? `Bill ${c.issuedBill.number}` : 'Issued manually'}</div>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (c) => <CardStatus status={c.status} /> },
  ];
  if (canManage) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (c) => (
        <Button variant="ghost" size="sm" onClick={() => toggleStatus.mutate(c)} disabled={toggleStatus.isPending}>
          {c.isActive ? 'Deactivate' : 'Activate'}
        </Button>
      ),
    });
  }

  const filtered = Boolean(q || status !== 'all');

  return (
    <>
      <PageHeader
        title="Gift cards"
        description="Prepaid cards that can be redeemed as payment at any branch of your salon."
        actions={
          canManage && (
            <Button onClick={() => setIssuing(true)}>
              <Plus className="size-4" /> Issue gift card
            </Button>
          )
        }
      />

      <BalanceLookup />

      <Card className="mt-6">
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              type="search"
              placeholder="Search code, client name or phone"
              aria-label="Search gift cards"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="sm:w-auto"
          >
            <option value="all">All cards</option>
            <option value="active">Active</option>
            <option value="used">Used up</option>
            <option value="expired">Expired</option>
            <option value="inactive">Deactivated</option>
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={cards.data?.items}
          loading={cards.isPending}
          error={cards.error}
          empty={
            filtered ? (
              <EmptyState title="No gift cards match" />
            ) : (
              <EmptyState
                icon={Gift}
                title="No gift cards yet"
                description="Gift cards sold at billing appear here. Managers can also issue one manually."
                action={canManage && <Button onClick={() => setIssuing(true)}>Issue gift card</Button>}
              />
            )
          }
        />
        {cards.data && <Pagination page={cards.data.page} pageSize={cards.data.pageSize} total={cards.data.total} onChange={setPage} />}
      </Card>

      {issuing && <IssueGiftCardModal onClose={() => setIssuing(false)} />}
    </>
  );
}

function BalanceLookup() {
  const [code, setCode] = useState('');
  const lookup = useMutation({ mutationFn: (value) => api(`/gift-cards/lookup/${encodeURIComponent(value)}`) });

  function submit(e) {
    e.preventDefault();
    const value = normalizeGiftCardCode(code);
    if (!value) {
      toast.error('Enter a gift card code');
      return;
    }
    lookup.mutate(value);
  }

  const card = lookup.data;
  return (
    <Card>
      <CardHeader title="Check a balance" description="Enter the code printed on the gift card." />
      <div className="flex flex-wrap items-start gap-6 p-5">
        <form onSubmit={submit} className="flex w-full max-w-md gap-2">
          <Input
            aria-label="Gift card code"
            placeholder="e.g. ABCD EFGH 2345"
            className="font-mono uppercase"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              lookup.reset();
            }}
          />
          <Button type="submit" variant="secondary" loading={lookup.isPending}>Check</Button>
        </form>
        {lookup.error && (
          <p role="alert" className="py-2 text-sm text-rose-600">
            {lookup.error.status === 404 ? 'No gift card with this code.' : lookup.error.message}
          </p>
        )}
        {card && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div>
              <div className="text-xs text-slate-500">Balance</div>
              <div className="text-lg font-semibold text-slate-900 tabular-nums">{formatINR(card.balancePaise)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Original value</div>
              <div className="tabular-nums">{formatINR(card.initialPaise)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Expires</div>
              <div>{card.expiresOn ? formatDate(card.expiresOn) : 'Never'}</div>
            </div>
            <div className="flex items-center gap-2">
              <CardStatus status={card.status} />
              <span className={card.usable ? 'text-emerald-700' : 'text-rose-600'}>{card.usable ? 'Can be used' : 'Cannot be used'}</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function IssueGiftCardModal({ onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const [client, setClient] = useState(null);
  const [issued, setIssued] = useState(null);

  const form = useApiForm({
    schema: giftCardIssueSchema,
    defaultValues: { initialPaise: '', expiresOn: '' },
    toPayload: (values) => ({ ...values, initialPaise: moneyInput(values.initialPaise), clientId: client?.id ?? null }),
    onSubmit: async (payload) => {
      const card = await api('/gift-cards', { method: 'POST', body: payload });
      queryClient.invalidateQueries({ queryKey: [branchId, 'gift-cards'] });
      setIssued(card);
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  if (issued) {
    const copy = () =>
      navigator.clipboard?.writeText(issued.code).then(
        () => toast.success('Code copied'),
        () => toast.error('Could not copy the code'),
      );
    return (
      <Modal title="Gift card issued" onClose={onClose} focusForm={false} footer={<Button onClick={onClose}>Done</Button>}>
        <div className="text-center">
          <p className="text-sm text-slate-500">Give this code to the client. It is needed to redeem the card.</p>
          <p className="mt-4 font-mono text-3xl font-semibold tracking-widest text-slate-900">{issued.code}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={copy}>
            <Copy className="size-3.5" /> Copy code
          </Button>
          <p className="mt-4 text-sm text-slate-600">
            Value {formatINR(issued.initialPaise)}
            {issued.client && <> · for {issued.client.name}</>}
            {issued.expiresOn && <> · expires {formatDate(issued.expiresOn)}</>}
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Issue gift card"
      description="Issue a card without a bill, e.g. as compensation or a giveaway. Cards sold to clients are issued from billing."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="gift-card-form" loading={isSubmitting}>Issue card</Button>
        </>
      }
    >
      <form id="gift-card-form" onSubmit={form.submit} noValidate className="grid gap-4">
        <Field label="Value (₹)" error={errors.initialPaise?.message} required>
          <Input inputMode="decimal" placeholder="0.00" invalid={!!errors.initialPaise} {...register('initialPaise')} />
        </Field>
        <Field as="div" label="Client" hint="Optional. Anyone with the code can redeem the card." error={errors.clientId?.message}>
          <ClientPicker client={client} onChange={setClient} />
        </Field>
        <Field label="Expires on" hint="Leave blank for a card that never expires" error={errors.expiresOn?.message}>
          <Input type="date" invalid={!!errors.expiresOn} {...register('expiresOn')} />
        </Field>
      </form>
    </Modal>
  );
}

function ClientPicker({ client, onChange }) {
  const { branchId } = useAuth();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const results = useQuery({
    queryKey: [branchId, 'clients', { q, page: 1, pageSize: 8 }],
    queryFn: () => api(`/clients?${new URLSearchParams({ q, pageSize: 8 })}`),
    enabled: q.length >= 2,
  });

  if (client) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
        <span>
          <span className="font-medium text-slate-900">{client.name}</span>
          <span className="text-slate-500"> · {client.phone}</span>
        </span>
        <Button variant="ghost" size="icon" onClick={() => onChange(null)} aria-label="Remove client">
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  const items = results.data?.items ?? [];
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <Input
          type="search"
          placeholder="Search by name or phone"
          aria-label="Search clients"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          className="pl-9"
        />
      </div>
      {q.length >= 2 && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
          {results.isPending ? (
            <Spinner className="mx-auto my-3" />
          ) : items.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">No clients found</p>
          ) : (
            items.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onChange({ id: c.id, name: c.name, phone: c.phone })}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-slate-900">{c.name}</span>
                <span className="text-slate-500"> · {c.phone}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
