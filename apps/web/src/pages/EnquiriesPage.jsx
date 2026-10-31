import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { MessageSquareText, Pencil, Plus, Search, UserCheck, UserPlus } from 'lucide-react';
import { ENQUIRY_TYPES, LEAD_SOURCES } from '@salon/shared';
import { ContactLinks } from '../components/clients.jsx';
import { ConvertEnquiryModal, EnquiryFormModal, EnquiryRespondModal, STATUS_TONES, TYPE_TONES } from '../components/enquiries.jsx';
import { Badge, Button, Card, cx, DataTable, EmptyState, Input, PageHeader, Pagination, Select } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ENQUIRY_STATUS_LABELS, ENQUIRY_TYPE_LABELS, formatDate, LEAD_SOURCE_LABELS, todayIso } from '../lib/format.js';
import { useDebounced, useTeam } from '../lib/hooks.js';

export default function EnquiriesPage() {
  const { branchId } = useAuth();
  const team = useTeam();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: 'PENDING', type: '', source: '', due: '', assignedToId: '' });
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null); // { kind: 'form' | 'respond' | 'convert', enquiry }
  const q = useDebounced(search.trim());
  const today = todayIso();

  const params = { ...filters, q, page };
  const enquiries = useQuery({
    queryKey: [branchId, 'enquiries', params],
    queryFn: () => api(`/enquiries?${new URLSearchParams(params)}`),
    placeholderData: keepPreviousData,
  });

  const setFilter = (key) => (e) => {
    setFilters((current) => ({ ...current, [key]: e.target.value }));
    setPage(1);
  };
  const close = () => setDialog(null);

  const columns = [
    {
      key: 'name',
      header: 'Lead',
      render: (e) => (
        <div>
          <div className="font-medium text-slate-900">{e.name}</div>
          <div className="text-xs text-slate-500"><ContactLinks phone={e.phone} /></div>
        </div>
      ),
    },
    { key: 'enquiryFor', header: 'Interested in', render: (e) => <span className="line-clamp-2">{e.enquiryFor}</span> },
    { key: 'type', header: 'Type', render: (e) => <Badge tone={TYPE_TONES[e.type]}>{ENQUIRY_TYPE_LABELS[e.type]}</Badge> },
    { key: 'source', header: 'Source', render: (e) => LEAD_SOURCE_LABELS[e.source] },
    {
      key: 'followUpOn',
      header: 'Follow up',
      className: 'whitespace-nowrap',
      render: (e) => {
        if (!e.followUpOn) return '—';
        const overdue = e.status === 'PENDING' && e.followUpOn < today;
        const due = e.status === 'PENDING' && e.followUpOn === today;
        return (
          <span className={cx(overdue && 'font-medium text-rose-600', due && 'font-medium text-amber-700')}>
            {due ? 'Today' : formatDate(e.followUpOn)}
          </span>
        );
      },
    },
    { key: 'assignedTo', header: 'Assigned', render: (e) => e.assignedTo?.name ?? '—' },
    { key: 'status', header: 'Status', render: (e) => <Badge tone={STATUS_TONES[e.status]}>{ENQUIRY_STATUS_LABELS[e.status]}</Badge> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (e) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'respond', enquiry: e })}>
            <MessageSquareText className="size-3.5" /> Respond
          </Button>
          {e.status === 'CONVERTED' ? (
            <Button variant="ghost" size="sm" onClick={() => navigate(`/clients?view=${e.client.id}`)}>
              <UserCheck className="size-3.5" /> Client
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'convert', enquiry: e })}>
              <UserPlus className="size-3.5" /> Convert
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setDialog({ kind: 'form', enquiry: e })} aria-label={`Edit ${e.name}`}>
            <Pencil className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Enquiries"
        description="Leads for this branch: follow them up until they book or say no."
        actions={
          <Button onClick={() => setDialog({ kind: 'form', enquiry: {} })}>
            <Plus className="size-4" /> Add enquiry
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              type="search"
              placeholder="Search name, phone or interest"
              aria-label="Search enquiries"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Select aria-label="Status" value={filters.status} onChange={setFilter('status')} className="sm:w-auto">
            <option value="PENDING">Open</option>
            <option value="CONVERTED">Converted</option>
            <option value="CLOSED">Closed</option>
            <option value="ALL">All</option>
          </Select>
          <Select aria-label="Follow-up" value={filters.due} onChange={setFilter('due')} className="sm:w-auto">
            <option value="">Any follow-up date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming</option>
          </Select>
          <Select aria-label="Type" value={filters.type} onChange={setFilter('type')} className="sm:w-auto">
            <option value="">All types</option>
            {ENQUIRY_TYPES.map((t) => (
              <option key={t} value={t}>{ENQUIRY_TYPE_LABELS[t]}</option>
            ))}
          </Select>
          <Select aria-label="Source" value={filters.source} onChange={setFilter('source')} className="sm:w-auto">
            <option value="">All sources</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
            ))}
          </Select>
          <Select aria-label="Assigned to" value={filters.assignedToId} onChange={setFilter('assignedToId')} className="sm:w-auto">
            <option value="">Anyone</option>
            {team.data?.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={enquiries.data?.items}
          loading={enquiries.isPending}
          error={enquiries.error}
          empty={
            <EmptyState
              icon={UserPlus}
              title={q || filters.status !== 'PENDING' || filters.due ? 'No enquiries match' : 'No open enquiries'}
              description="Log walk-ins, calls and messages here so nobody forgets to follow up."
            />
          }
        />
        {enquiries.data && <Pagination page={enquiries.data.page} pageSize={enquiries.data.pageSize} total={enquiries.data.total} onChange={setPage} />}
      </Card>

      {dialog?.kind === 'form' && <EnquiryFormModal enquiry={dialog.enquiry} onClose={close} />}
      {dialog?.kind === 'respond' && <EnquiryRespondModal enquiryId={dialog.enquiry.id} onClose={close} />}
      {dialog?.kind === 'convert' && (
        <ConvertEnquiryModal enquiry={dialog.enquiry} onClose={close} onConverted={(clientId) => navigate(`/clients?view=${clientId}`)} />
      )}
    </>
  );
}
