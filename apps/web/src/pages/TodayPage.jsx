import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CakeSlice, Check, Heart, MessageSquareText, PhoneCall, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { ContactLinks } from '../components/clients.jsx';
import { EnquiryRespondModal } from '../components/enquiries.jsx';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Spinner } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { formatDate } from '../lib/format.js';

const whenLabel = (inDays) => (inDays === 0 ? 'Today' : inDays === 1 ? 'Tomorrow' : `In ${inDays} days`);
const firstName = (name) => name.split(' ')[0];
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function DueLabel({ date, today }) {
  if (date === today) return <Badge tone="amber">Today</Badge>;
  return <Badge tone="rose">Overdue · {formatDate(date)}</Badge>;
}

export default function TodayPage() {
  const { branchId, branch } = useAuth();
  const queryClient = useQueryClient();
  const [responding, setResponding] = useState(null);
  const list = useQuery({ queryKey: [branchId, 'follow-ups'], queryFn: () => api('/follow-ups/today') });

  const complete = useMutation({
    mutationFn: (id) => api(`/clients/follow-ups/${id}/complete`, { method: 'PATCH' }),
    onSuccess: () => {
      toast.success('Marked as done');
      queryClient.invalidateQueries({ queryKey: [branchId, 'follow-ups'] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (list.isPending) return <Spinner className="mx-auto mt-20 size-8" />;
  if (list.error) return <p className="text-sm text-rose-600">{list.error.message}</p>;

  const { today, birthdays, anniversaries, enquiries, clientFollowUps } = list.data;
  const salon = branch?.salonName ?? 'us';
  const occasions = [
    ...birthdays.map((c) => ({ ...c, kind: 'birthday', message: `Happy birthday ${firstName(c.name)}! Wishing you a wonderful year ahead from all of us at ${salon}.` })),
    ...anniversaries.map((c) => ({ ...c, kind: 'anniversary', message: `Happy anniversary ${firstName(c.name)}! Warm wishes from all of us at ${salon}.` })),
  ].sort((a, b) => a.inDays - b.inDays);

  return (
    <>
      <PageHeader
        title="Today"
        description={`${formatDate(today)} · ${plural(enquiries.length + clientFollowUps.length, 'follow-up')} due, ${plural(occasions.length, 'celebration')} this week`}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Enquiry follow-ups" description="Open leads due today or overdue." />
          {enquiries.length === 0 ? (
            <EmptyState icon={PhoneCall} title="All caught up" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {enquiries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-48 flex-1">
                    <p className="font-medium text-slate-900">{e.name}</p>
                    <p className="text-slate-500">{e.enquiryFor}</p>
                  </div>
                  <ContactLinks phone={e.phone} message={`Hi ${firstName(e.name)}, following up on your enquiry about ${e.enquiryFor}.`} />
                  <DueLabel date={e.followUpOn} today={today} />
                  <Button size="sm" variant="secondary" onClick={() => setResponding(e.id)}>
                    <MessageSquareText className="size-3.5" /> Respond
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Client follow-ups" description="Reminders your team scheduled on client profiles." />
          {clientFollowUps.length === 0 ? (
            <EmptyState icon={UserRound} title="Nothing due" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {clientFollowUps.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-48 flex-1">
                    <Link to={`/clients?view=${f.client.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {f.client.name}
                    </Link>
                    <p className="text-slate-500">
                      {f.note}
                      {f.dueTime ? ` · ${f.dueTime}` : ''} · by {f.createdBy.name}
                    </p>
                  </div>
                  <ContactLinks phone={f.client.phone} />
                  <DueLabel date={f.dueOn} today={today} />
                  <Button size="sm" variant="secondary" onClick={() => complete.mutate(f.id)} disabled={complete.isPending}>
                    <Check className="size-3.5" /> Done
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Birthdays & anniversaries" description="Next 7 days. The WhatsApp button opens a ready-written greeting." />
          {occasions.length === 0 ? (
            <EmptyState icon={CakeSlice} title="No celebrations this week" />
          ) : (
            <ul className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-y-0">
              {occasions.map((o) => (
                <li key={`${o.kind}-${o.id}`} className="flex items-center gap-3 border-slate-100 px-5 py-3 text-sm md:border-b">
                  {o.kind === 'birthday' ? (
                    <CakeSlice className="size-4 shrink-0 text-brand-600" aria-label="Birthday" />
                  ) : (
                    <Heart className="size-4 shrink-0 text-rose-500" aria-label="Anniversary" />
                  )}
                  <Link to={`/clients?view=${o.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-900 hover:text-brand-700">
                    {o.name}
                  </Link>
                  <Badge tone={o.inDays === 0 ? 'brand' : 'slate'}>{whenLabel(o.inDays)}</Badge>
                  <ContactLinks phone={o.phone} message={o.message} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {responding && <EnquiryRespondModal enquiryId={responding} onClose={() => setResponding(null)} />}
    </>
  );
}
