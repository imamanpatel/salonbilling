import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { FileText, Plus, Search, X } from 'lucide-react';
import { formatINR } from '@salon/shared';
import { Badge, Button, Card, DataTable, EmptyState, Field, Input, PageHeader, Pagination, Select } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDateTime, todayIso } from '../../lib/format.js';
import { useDebounced } from '../../lib/hooks.js';
import BillDetailModal from './BillDetailModal.jsx';
import { BILL_STATUS_LABELS, BILL_STATUS_TONES } from './labels.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PAID', label: 'Paid' },
  { value: 'DUE', label: 'With dues' },
  { value: 'VOID', label: 'Void' },
];

// Filters live in the URL (?from=&to=&status=&q=&clientId=&view=) so other pages can link to a filtered list.
// Plain /bills shows today; a link with only status/q/clientId shows all dates.
export default function BillsPage() {
  const { branchId } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') === 'PARTIAL' ? 'DUE' : searchParams.get('status') ?? '';
  const clientId = searchParams.get('clientId') ?? '';
  const viewing = searchParams.get('view');
  const urlQ = searchParams.get('q') ?? '';
  const hasDates = searchParams.has('from') || searchParams.has('to');
  const anyFilter = Boolean(status || clientId || urlQ);
  const from = hasDates ? searchParams.get('from') ?? '' : anyFilter ? '' : todayIso();
  const to = hasDates ? searchParams.get('to') ?? '' : anyFilter ? '' : todayIso();
  const page = Number(searchParams.get('page')) || 1;

  const [search, setSearch] = useState(urlQ);
  const q = useDebounced(search.trim());

  const update = (changes, { keepPage = false } = {}) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        // Pin the dates being shown so changing another filter doesn't jump back to "today".
        if (!next.has('from') && !next.has('to')) {
          next.set('from', from);
          next.set('to', to);
        }
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        if (!keepPage) next.delete('page');
        return next;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    if (q !== urlQ) update({ q: q || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const params = { from, to, status, q: urlQ, clientId, page };
  const bills = useQuery({
    queryKey: [branchId, 'bills', params],
    queryFn: () => api(`/bills?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== null))}`),
    placeholderData: keepPreviousData,
  });

  const setViewing = (id) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set('view', id);
        else next.delete('view');
        return next;
      },
      { replace: !id },
    );

  const columns = [
    {
      key: 'number',
      header: 'Bill',
      render: (b) => (
        <button type="button" onClick={() => setViewing(b.id)} className="font-medium text-slate-900 hover:text-brand-700">
          {b.number}
        </button>
      ),
    },
    { key: 'billedAt', header: 'Date', className: 'whitespace-nowrap', render: (b) => formatDateTime(b.billedAt) },
    {
      key: 'client',
      header: 'Client',
      render: (b) => (
        <div>
          <div className="text-slate-900">{b.client.name}</div>
          <div className="text-xs text-slate-500 tabular-nums">{b.client.phone}</div>
        </div>
      ),
    },
    { key: 'total', header: 'Total', className: 'text-right tabular-nums', render: (b) => formatINR(b.totalPaise) },
    { key: 'paid', header: 'Paid', className: 'text-right tabular-nums', render: (b) => formatINR(b.paidPaise) },
    {
      key: 'due',
      header: 'Due',
      className: 'text-right tabular-nums',
      render: (b) => (b.duePaise > 0 && b.status !== 'VOID' ? <span className="font-medium text-amber-700">{formatINR(b.duePaise)}</span> : '—'),
    },
    { key: 'status', header: 'Status', render: (b) => <Badge tone={BILL_STATUS_TONES[b.status]}>{BILL_STATUS_LABELS[b.status]}</Badge> },
    { key: 'by', header: 'By', render: (b) => b.createdBy.name },
  ];

  return (
    <>
      <PageHeader
        title="Bills"
        description="Every bill raised at this branch."
        actions={
          <Button onClick={() => navigate('/billing/new')}>
            <Plus className="size-4" /> New bill
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="From" className="w-40">
            <Input type="date" value={from} onChange={(e) => update({ from: e.target.value })} />
          </Field>
          <Field label="To" className="w-40">
            <Input type="date" value={to} onChange={(e) => update({ to: e.target.value })} />
          </Field>
          <Field label="Status" className="w-40">
            <Select value={status} onChange={(e) => update({ status: e.target.value || null })}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input type="search" placeholder="Bill number, client name or phone" aria-label="Search bills" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          {clientId && (
            <Button variant="secondary" onClick={() => update({ clientId: null })}>
              <X className="size-3.5" /> One client only
            </Button>
          )}
        </div>
        <DataTable
          columns={columns}
          rows={bills.data?.items}
          loading={bills.isPending}
          error={bills.error}
          empty={<EmptyState icon={FileText} title="No bills found" description={from || to ? 'Try a wider date range.' : undefined} />}
        />
        {bills.data && (
          <Pagination
            page={bills.data.page}
            pageSize={bills.data.pageSize}
            total={bills.data.total}
            onChange={(next) => update({ page: String(next) }, { keepPage: true })}
          />
        )}
      </Card>
      {viewing && <BillDetailModal billId={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
