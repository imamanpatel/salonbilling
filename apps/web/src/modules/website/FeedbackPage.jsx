import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Heart, MessageSquareHeart, SearchX } from 'lucide-react';
import { feedbackSchema } from '@salon/shared/website';
import { Button, Field, Spinner, Textarea } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { PublicMessage, PublicShell } from './publicLayout.jsx';
import { StarPicker } from './stars.jsx';

const DETAILS = [
  { key: 'serviceRating', label: 'Service' },
  { key: 'staffRating', label: 'Staff' },
  { key: 'ambienceRating', label: 'Ambience' },
];

export default function FeedbackPage() {
  const { token } = useParams();
  const [sent, setSent] = useState(false);
  const visit = useQuery({ queryKey: ['public', 'feedback', token], queryFn: () => api(`/public/feedback/${token}`) });

  let body;
  if (visit.isPending) {
    body = <Spinner className="mx-auto mt-24 size-8" />;
  } else if (visit.error) {
    body = (
      <PublicMessage icon={SearchX} tone="slate" title={visit.error.status === 404 ? 'This feedback link is not valid' : 'Something went wrong'}>
        {visit.error.status === 404 ? 'It may have expired or been mistyped. Please check the link in your message.' : 'Please refresh the page or try again later.'}
      </PublicMessage>
    );
  } else if (sent) {
    body = (
      <PublicMessage icon={Heart} tone="green" title="Thank you!">
        Your feedback helps {visit.data.salonName} get better every day. We hope to see you again soon.
      </PublicMessage>
    );
  } else if (visit.data.alreadySubmitted) {
    body = (
      <PublicMessage icon={MessageSquareHeart} title="Feedback already received">
        Thanks {visit.data.clientFirstName}, we already have your feedback for this visit.
      </PublicMessage>
    );
  } else {
    body = <FeedbackForm token={token} visit={visit.data} onSent={() => setSent(true)} />;
  }

  return (
    <PublicShell>
      <title>{visit.data ? `Rate your visit to ${visit.data.salonName}` : 'Feedback'}</title>
      {body}
    </PublicShell>
  );
}

function FeedbackForm({ token, visit, onSent }) {
  const [ratings, setRatings] = useState({ rating: '', serviceRating: '', staffRating: '', ambienceRating: '' });
  const form = useApiForm({
    schema: feedbackSchema,
    defaultValues: { comment: '' },
    toPayload: (values) => ({ ...values, ...ratings }),
    onSubmit: async (payload) => {
      await api(`/public/feedback/${token}`, { method: 'POST', body: payload });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      onSent();
    },
  });
  const { register, clearErrors, formState: { errors, isSubmitting } } = form;

  const rate = (key) => (value) => {
    setRatings((current) => ({ ...current, [key]: value }));
    clearErrors(key);
  };

  return (
    <form onSubmit={form.submit} noValidate className="mt-2 sm:mt-6">
      <div className="rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-6 text-center text-white shadow-sm">
        <p className="text-sm text-brand-100">Hi {visit.clientFirstName},</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">How was your visit to {visit.salonName}?</h1>
        <p className="mt-1 text-sm text-brand-100">
          Bill {visit.billNumber} · {formatDate(visit.billedAt)}
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-col items-center">
          <StarPicker name="rating" label="Overall rating" size="lg" value={ratings.rating} onChange={rate('rating')} />
          {errors.rating && <p role="alert" className="mt-2 text-sm text-rose-600">{errors.rating.message}</p>}
        </div>

        <div className="mt-6 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
          {DETAILS.map((d) => (
            <StarPicker key={d.key} name={d.key} label={`${d.label} (optional)`} value={ratings[d.key]} onChange={rate(d.key)} />
          ))}
        </div>

        <Field label="Anything you'd like to tell us?" error={errors.comment?.message} className="mt-5">
          <Textarea rows={4} maxLength={1000} invalid={!!errors.comment} {...register('comment')} />
        </Field>

        <Button type="submit" loading={isSubmitting} className="mt-5 h-11 w-full">Send feedback</Button>
      </div>
    </form>
  );
}
