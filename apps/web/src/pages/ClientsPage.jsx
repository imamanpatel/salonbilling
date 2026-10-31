import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Eye, Pencil, Plus, Search, Upload, Users } from 'lucide-react';
import { GENDERS, LEAD_SOURCES } from '@salon/shared';
import { ClientFormModal, ClientProfileModal, ContactLinks } from '../components/clients.jsx';
import ImportModal from '../components/ImportModal.jsx';
import { Button, Card, cx, DataTable, EmptyState, Input, PageHeader, Pagination, Select } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { formatDate, formatDayMonth, GENDER_LABELS, LEAD_SOURCE_LABELS } from '../lib/format.js';
import { useDebounced, useTeam } from '../lib/hooks.js';
import { clientSections } from '../modules.js';

const SEGMENTS = [
  { value: '', label: 'All clients', count: 'total' },
  { value: 'new', label: 'New (last 30 days)', count: 'new' },
  { value: 'birthdays', label: 'Birthdays this week', count: 'birthdays' },
  { value: 'anniversaries', label: 'Anniversaries this week', count: 'anniversaries' },
];

export default function ClientsPage() {
  const { branchId, canManage } = useAuth();
  const team = useTeam();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ segment: '', source: '', gender: '', assignedToId: '' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const q = useDebounced(search.trim());

  // The open profile lives in the URL (?view=<id>) so other pages can link straight to a client.
  const viewingId = searchParams.get('view');
  const setViewing = (id) => setSearchParams(id ? { view: id } : {}, { replace: !id });

  const params = { ...filters, q, page };
  const segments = useQuery({ queryKey: [branchId, 'client-segments'], queryFn: () => api('/clients/segments') });
  const clients = useQuery({
    queryKey: [branchId, 'clients', params],
    queryFn: () => api(`/clients?${new URLSearchParams(params)}`),
    placeholderData: keepPreviousData,
  });

  const setFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const filtered = Boolean(q || filters.segment || filters.source || filters.gender || filters.assignedToId);

  const columns = [
    {
      key: 'name',
      header: 'Client',
      render: (c) => (
        <button type="button" onClick={() => setViewing(c.id)} className="text-left">
          <span className="block font-medium text-slate-900 hover:text-brand-700">{c.name}</span>
          <span className="block text-xs text-slate-500">{GENDER_LABELS[c.gender]}{c.email ? ` · ${c.email}` : ''}</span>
        </button>
      ),
    },
    { key: 'phone', header: 'Phone', render: (c) => <ContactLinks phone={c.phone} /> },
    { key: 'dob', header: 'Birthday', className: 'whitespace-nowrap', render: (c) => (c.dob ? formatDayMonth(c.dob) : '—') },
    { key: 'source', header: 'Source', render: (c) => LEAD_SOURCE_LABELS[c.source] ?? '—' },
    { key: 'assignedTo', header: 'Assigned to', render: (c) => c.assignedTo?.name ?? '—' },
    { key: 'createdAt', header: 'Added', className: 'whitespace-nowrap', render: (c) => formatDate(c.createdAt) },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (c) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setViewing(c.id)}>
            <Eye className="size-3.5" /> View
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone who has visited or enquired, shared across all your branches."
        actions={
          <>
            {canManage && (
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <Upload className="size-4" /> Import
              </Button>
            )}
            <Button onClick={() => setEditing({})}>
              <Plus className="size-4" /> Add client
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SEGMENTS.map((segment) => {
          const active = filters.segment === segment.value;
          return (
            <button
              key={segment.value}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter('segment', segment.value)}
              className={cx(
                'rounded-xl border bg-white p-4 text-left shadow-xs transition',
                active ? 'border-brand-400 ring-2 ring-brand-500/15' : 'border-slate-200 hover:border-brand-200',
              )}
            >
              <p className="text-sm text-slate-500">{segment.label}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{segments.data?.[segment.count] ?? '—'}</p>
            </button>
          );
        })}
      </div>

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              type="search"
              placeholder="Search name, phone, email or invite code"
              aria-label="Search clients"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Select aria-label="Source" value={filters.source} onChange={(e) => setFilter('source', e.target.value)} className="sm:w-auto">
            <option value="">All sources</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
            ))}
          </Select>
          <Select aria-label="Gender" value={filters.gender} onChange={(e) => setFilter('gender', e.target.value)} className="sm:w-auto">
            <option value="">All genders</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{GENDER_LABELS[g]}</option>
            ))}
          </Select>
          <Select aria-label="Assigned to" value={filters.assignedToId} onChange={(e) => setFilter('assignedToId', e.target.value)} className="sm:w-auto">
            <option value="">Anyone</option>
            {team.data?.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={clients.data?.items}
          loading={clients.isPending}
          error={clients.error}
          empty={
            filtered ? (
              <EmptyState title="No clients match" />
            ) : (
              <EmptyState
                icon={Users}
                title="No clients yet"
                description="Add clients as they visit, or import your existing client list from Excel."
                action={<Button onClick={() => setEditing({})}>Add client</Button>}
              />
            )
          }
        />
        {clients.data && <Pagination page={clients.data.page} pageSize={clients.data.pageSize} total={clients.data.total} onChange={setPage} />}
      </Card>

      {editing && <ClientFormModal client={editing} onClose={() => setEditing(null)} />}
      {viewingId && !editing && (
        <ClientProfileModal
          clientId={viewingId}
          sections={clientSections}
          onClose={() => setViewing(null)}
          onEdit={(client) => setEditing(client)}
        />
      )}
      {importing && (
        <ImportModal
          title="Import clients from Excel"
          description="Clients are matched by phone number: existing ones are updated, blank cells keep current details."
          columns="Name, Phone, Gender, Email, Date of birth, Anniversary, Source, Address"
          hint="Dates as DD/MM/YYYY. Exports from other salon software usually work after matching the column order."
          templatePath="/clients/import-template"
          templateName="clients-import-template.xlsx"
          uploadPath="/clients/import"
          invalidate={[[branchId, 'clients'], [branchId, 'client-segments']]}
          onClose={() => setImporting(false)}
        />
      )}
    </>
  );
}
