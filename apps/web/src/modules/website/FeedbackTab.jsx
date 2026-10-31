import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareHeart } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, Pagination, Tabs } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDateTime } from '../../lib/format.js';
import { Stars } from './stars.jsx';

const FILTERS = [
  { value: 'pending', label: 'Waiting for approval' },
  { value: 'approved', label: 'On website' },
  { value: 'all', label: 'All' },
];

export default function FeedbackTab() {
  const { branchId, canManage } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);

  const feedback = useQuery({
    queryKey: [branchId, 'website', 'feedback', status, page],
    queryFn: () => api(`/website/feedback?${new URLSearchParams({ status, page })}`),
    placeholderData: keepPreviousData,
  });

  const moderate = useMutation({
    mutationFn: ({ id, isApproved }) => api(`/website/feedback/${id}`, { method: 'PATCH', body: { isApproved } }),
    onSuccess: (row) => {
      toast.success(row.isApproved ? 'Review shown on your website' : 'Review hidden from your website');
      queryClient.invalidateQueries({ queryKey: [branchId, 'website', 'feedback'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const summary = feedback.data?.summary;
  const columns = [
    { key: 'date', header: 'Received', className: 'whitespace-nowrap', render: (f) => formatDateTime(f.createdAt) },
    {
      key: 'client',
      header: 'Client',
      render: (f) => (
        <div>
          <div className="font-medium text-slate-900">{f.client?.name ?? f.name}</div>
          {f.bill && <div className="text-xs text-slate-500">Bill {f.bill.number}</div>}
        </div>
      ),
    },
    {
      key: 'rating',
      header: 'Rating',
      render: (f) => (
        <div>
          <Stars value={f.rating} />
          <div className="mt-0.5 text-xs whitespace-nowrap text-slate-500">
            {[
              f.serviceRating && `Service ${f.serviceRating}`,
              f.staffRating && `Staff ${f.staffRating}`,
              f.ambienceRating && `Ambience ${f.ambienceRating}`,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
      ),
    },
    { key: 'comment', header: 'Comment', className: 'max-w-md', render: (f) => f.comment ?? <span className="text-slate-400">—</span> },
    { key: 'status', header: 'Status', render: (f) => <Badge tone={f.isApproved ? 'green' : 'amber'}>{f.isApproved ? 'On website' : 'Pending'}</Badge> },
  ];
  if (canManage) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (f) => (
        <Button
          variant={f.isApproved ? 'ghost' : 'secondary'}
          size="sm"
          disabled={moderate.isPending}
          onClick={() => moderate.mutate({ id: f.id, isApproved: !f.isApproved })}
        >
          {f.isApproved ? 'Hide' : 'Approve'}
        </Button>
      ),
    });
  }

  return (
    <div className="space-y-5">
      {summary && <SummaryCard summary={summary} />}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <Tabs
            tabs={FILTERS}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
          <p className="text-xs text-slate-500">Only approved reviews appear on your website.</p>
        </div>
        <DataTable
          columns={columns}
          rows={feedback.data?.items}
          loading={feedback.isPending}
          error={feedback.error}
          empty={
            <EmptyState
              icon={MessageSquareHeart}
              title={status === 'pending' ? 'Nothing waiting for approval' : 'No feedback here yet'}
              description="Clients get a feedback link with their bill. Their ratings and comments show up here."
            />
          }
        />
        {feedback.data && <Pagination page={feedback.data.page} pageSize={feedback.data.pageSize} total={feedback.data.total} onChange={setPage} />}
      </Card>
    </div>
  );
}

function SummaryCard({ summary }) {
  const max = Math.max(1, ...Object.values(summary.byStars));
  return (
    <Card>
      <CardHeader title="Client ratings" description="All feedback received at this branch." />
      <div className="flex flex-wrap items-center gap-8 px-5 py-5">
        <div className="text-center">
          <p className="text-4xl font-semibold text-slate-900 tabular-nums">{summary.averageRating ?? '—'}</p>
          <Stars value={Math.round(summary.averageRating ?? 0)} className="mt-1" />
          <p className="mt-1 text-xs text-slate-500">{summary.count} {summary.count === 1 ? 'review' : 'reviews'}</p>
        </div>
        <ul className="min-w-56 flex-1 space-y-1.5">
          {[5, 4, 3, 2, 1].map((stars) => (
            <li key={stars} className="flex items-center gap-3 text-xs text-slate-600">
              <span className="w-10 tabular-nums">{stars} star</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <span className="block h-full rounded-full bg-amber-400" style={{ width: `${(summary.byStars[stars] / max) * 100}%` }} />
              </span>
              <span className="w-8 text-right tabular-nums">{summary.byStars[stars]}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
