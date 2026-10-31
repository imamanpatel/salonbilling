import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { ROLES } from '@salon/shared';
import { Button, Card, CardHeader, Checkbox, EmptyState, PageHeader, Spinner, Tabs, Textarea } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import FeedbackTab from './FeedbackTab.jsx';
import GalleryTab from './GalleryTab.jsx';
import { copyText } from './lib.js';
import OffersTab from './OffersTab.jsx';

const TABS = [
  { value: 'link', label: 'Booking link' },
  { value: 'offers', label: 'Offers' },
  { value: 'gallery', label: 'Gallery' },
  { value: 'feedback', label: 'Feedback' },
];

export default function WebsitePage() {
  const [tab, setTab] = useState('link');
  return (
    <>
      <PageHeader title="Website" description="Online booking link, offers, photos and client reviews for this branch." />
      <div className="mb-5 max-w-full overflow-x-auto">
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
      </div>
      {tab === 'link' && <BookingLinkTab />}
      {tab === 'offers' && <OffersTab />}
      {tab === 'gallery' && <GalleryTab />}
      {tab === 'feedback' && <FeedbackTab />}
    </>
  );
}

function UrlRow({ label, method = 'GET', url, open = false }) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="font-mono text-xs break-all text-slate-800">
          {method !== 'LINK' && <span className="mr-1.5 font-semibold text-brand-700">{method}</span>}
          {url}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => copyText(url)}>
        <Copy className="size-3.5" /> Copy
      </Button>
      {open && (
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
          <ExternalLink className="size-3.5" /> Open
        </a>
      )}
    </li>
  );
}

function BookingLinkTab() {
  const { branchId, user, canManage } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: [branchId, 'website', 'info'], queryFn: () => api('/website/info') });

  const toggle = useMutation({
    mutationFn: (onlineBooking) => api('/website/booking', { method: 'PATCH', body: { onlineBooking } }),
    onSuccess: ({ onlineBooking }) => {
      toast.success(onlineBooking ? 'Online booking switched on' : 'Online booking switched off');
      queryClient.invalidateQueries({ queryKey: [branchId, 'website', 'info'] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (info.isPending) return <Spinner className="mx-auto my-12" />;
  if (info.error) return <p className="text-sm text-rose-600">{info.error.message}</p>;

  const { slug, onlineBooking } = info.data;
  if (!slug) {
    return (
      <Card>
        <EmptyState
          icon={Link2}
          title="This branch has no public link name yet"
          description={
            user.role === ROLES.SUPERADMIN
              ? 'Give the branch a public link name (for example "andheri") under Branches to get your booking link.'
              : 'Ask your superadmin to set a public link name for this branch under Branches.'
          }
          action={user.role === ROLES.SUPERADMIN && <Button onClick={() => navigate('/branches')}>Go to Branches</Button>}
        />
      </Card>
    );
  }

  const origin = window.location.origin;
  const bookingUrl = `${origin}/book/${slug}`;
  const apiBase = `${origin}/api/public/${slug}`;
  const button = `<a href="${bookingUrl}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 22px;background:#c62f63;color:#fff;border-radius:8px;font:600 15px sans-serif;text-decoration:none">Book an appointment</a>`;
  const iframe = `<iframe src="${bookingUrl}" title="Book an appointment" style="width:100%;min-height:900px;border:0"></iframe>`;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Online booking page" description="Share this link on WhatsApp, Instagram or Google, or put it on your website." />
        <div className="px-5 pb-4">
          <ul className="divide-y divide-slate-100">
            <UrlRow label="Booking link" method="LINK" url={bookingUrl} open />
          </ul>
          <Checkbox
            className="mt-3"
            label="Accept online bookings"
            description="Requests arrive in Appointments as “Requested” for you to confirm."
            checked={onlineBooking}
            disabled={!canManage || toggle.isPending}
            onChange={(e) => toggle.mutate(e.target.checked)}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Add a booking button to your website" description="Paste one of these into your website's HTML." />
        <div className="space-y-4 px-5 pb-5">
          {[
            { label: 'Button', code: button },
            { label: 'Embedded booking form', code: iframe },
          ].map((snippet) => (
            <div key={snippet.label}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{snippet.label}</span>
                <Button variant="ghost" size="sm" onClick={() => copyText(snippet.code)}>
                  <Copy className="size-3.5" /> Copy
                </Button>
              </div>
              <Textarea readOnly rows={3} value={snippet.code} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader
          title="Public API for your web developer"
          description="JSON endpoints (responses are wrapped in { data }) that any website can call; no sign-in or API key needed."
        />
        <ul className="divide-y divide-slate-100 px-5 pb-2">
          <UrlRow label="Salon details and opening hours" url={apiBase} />
          <UrlRow label="Services by category" url={`${apiBase}/services`} />
          <UrlRow label="Current offers" url={`${apiBase}/offers`} />
          <UrlRow label="Photo gallery" url={`${apiBase}/gallery`} />
          <UrlRow label="Approved reviews and average rating" url={`${apiBase}/reviews`} />
          <UrlRow label="Free times (date=YYYY-MM-DD, serviceIds=comma-separated)" url={`${apiBase}/slots?date=YYYY-MM-DD&serviceIds=`} />
          <UrlRow label="Create a booking request { name, phone, email, date, time, serviceIds, notes }" method="POST" url={`${apiBase}/bookings`} />
        </ul>
      </Card>
    </div>
  );
}
