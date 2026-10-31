import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CalendarOff, CalendarX2, Check, SearchX } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR } from '@salon/shared';
import { BOOKING_DAYS_AHEAD, MAX_BOOKING_SERVICES, publicBookingSchema } from '@salon/shared/website';
import { Button, cx, Field, Input, Spinner, Textarea } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDate, SERVICE_GENDER_LABELS, todayIso } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { PublicMessage, PublicShell, SalonHeader, Section } from './publicLayout.jsx';

const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h && `${h} hr`, m && `${m} min`].filter(Boolean).join(' ') || '0 min';
}

export default function BookingPage() {
  const { slug } = useParams();
  const [booking, setBooking] = useState(null);
  const info = useQuery({ queryKey: ['public', slug, 'info'], queryFn: () => api(`/public/${slug}`) });

  if (info.isPending) {
    return (
      <PublicShell>
        <Spinner className="mx-auto mt-24 size-8" />
      </PublicShell>
    );
  }
  if (info.error) {
    return (
      <PublicShell>
        <PublicMessage icon={SearchX} tone="slate" title={info.error.status === 404 ? "We couldn't find this salon" : 'Something went wrong'}>
          {info.error.status === 404 ? 'Please check the booking link you were given.' : 'Please refresh the page or try again in a moment.'}
        </PublicMessage>
      </PublicShell>
    );
  }

  const salon = info.data;
  return (
    <PublicShell>
      <title>{`Book at ${salon.salonName}`}</title>
      <SalonHeader salon={salon} compact={Boolean(booking)} />
      {booking ? (
        <Confirmation booking={booking} salon={salon} onAgain={() => setBooking(null)} />
      ) : salon.onlineBooking ? (
        <BookingForm slug={slug} onBooked={setBooking} />
      ) : (
        <PublicMessage icon={CalendarOff} title="Online booking is closed right now">
          {salon.phone ? (
            <>Please call us on <a href={`tel:${salon.phone}`} className="font-medium text-brand-700 underline">{salon.phone}</a> to book.</>
          ) : (
            'Please contact the salon to book your appointment.'
          )}
        </PublicMessage>
      )}
    </PublicShell>
  );
}

function BookingForm({ slug, onBooked }) {
  const today = todayIso();
  const [selected, setSelected] = useState([]);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');

  const services = useQuery({ queryKey: ['public', slug, 'services'], queryFn: () => api(`/public/${slug}/services`) });
  const all = services.data?.categories.flatMap((c) => c.services) ?? [];
  const chosen = selected.map((id) => all.find((s) => s.id === id)).filter(Boolean);
  const totalMin = chosen.reduce((sum, s) => sum + s.durationMin, 0);
  const totalPaise = chosen.reduce((sum, s) => sum + s.pricePaise, 0);

  const slots = useQuery({
    queryKey: ['public', slug, 'slots', date, selected],
    queryFn: () => api(`/public/${slug}/slots?date=${date}&serviceIds=${selected.join(',')}`),
    enabled: selected.length > 0 && Boolean(date),
    staleTime: 0,
  });

  const form = useApiForm({
    schema: publicBookingSchema,
    defaultValues: { name: '', phone: '', email: '', notes: '' },
    toPayload: (values) => ({ ...values, date, time, serviceIds: selected }),
    onSubmit: async (payload) => {
      try {
        onBooked(await api(`/public/${slug}/bookings`, { method: 'POST', body: payload }));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        if (err.status === 409) {
          setTime('');
          slots.refetch();
        }
        throw err;
      }
    },
  });
  const { register, clearErrors, formState: { errors, isSubmitting } } = form;

  function toggle(id) {
    setTime('');
    clearErrors(['serviceIds', 'time']);
    setSelected((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      if (current.length >= MAX_BOOKING_SERVICES) {
        toast.info(`You can book up to ${MAX_BOOKING_SERVICES} services at a time`);
        return current;
      }
      return [...current, id];
    });
  }

  return (
    <form onSubmit={form.submit} noValidate>
      <Section step={1} title="Choose services">
        {services.isPending ? (
          <Spinner className="mx-auto my-6" />
        ) : !all.length ? (
          <p className="py-4 text-center text-sm text-slate-500">No services are available for online booking yet.</p>
        ) : (
          <div className="space-y-5">
            {services.data.categories.map((category) => (
              <div key={category.name}>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{category.name}</h3>
                <ul className="space-y-2">
                  {category.services.map((service) => {
                    const on = selected.includes(service.id);
                    return (
                      <li key={service.id}>
                        <label
                          className={cx(
                            'flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors',
                            on ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300',
                          )}
                        >
                          <input type="checkbox" checked={on} onChange={() => toggle(service.id)} className="size-5 shrink-0 accent-brand-600" />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-slate-900">{service.name}</span>
                            <span className="block text-xs text-slate-500">
                              {formatDuration(service.durationMin)}
                              {service.gender !== 'UNISEX' && ` · ${SERVICE_GENDER_LABELS[service.gender]}`}
                            </span>
                          </span>
                          <span className="text-sm font-semibold text-slate-900 tabular-nums">{formatINR(service.pricePaise)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {errors.serviceIds && <p role="alert" className="mt-2 text-sm text-rose-600">{errors.serviceIds.message}</p>}
      </Section>

      <Section step={2} title="Pick a date and time">
        <Field label="Date" className="max-w-xs">
          <Input
            type="date"
            value={date}
            min={today}
            max={addDays(today, BOOKING_DAYS_AHEAD)}
            onChange={(e) => {
              setDate(e.target.value);
              setTime('');
              clearErrors(['date', 'time']);
            }}
          />
        </Field>
        <div className="mt-4">
          {!selected.length ? (
            <p className="text-sm text-slate-500">Choose at least one service to see available times.</p>
          ) : slots.isFetching && !slots.data ? (
            <Spinner className="my-4" />
          ) : slots.error ? (
            <p className="text-sm text-rose-600">{slots.error.message}</p>
          ) : !slots.data?.slots.length ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <CalendarX2 className="size-4" aria-hidden /> No times available on {formatDate(date)}. Please try another day.
            </p>
          ) : (
            <div role="radiogroup" aria-label="Available times" className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {slots.data.slots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  role="radio"
                  aria-checked={time === slot}
                  onClick={() => {
                    setTime(slot);
                    clearErrors('time');
                  }}
                  className={cx(
                    'rounded-lg border py-2 text-sm font-medium tabular-nums transition-colors focus-visible:ring-4 focus-visible:ring-brand-500/30 focus-visible:outline-none',
                    time === slot ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-400',
                  )}
                >
                  {slot}
                </button>
              ))}
            </div>
          )}
        </div>
        {(errors.time || errors.date) && (
          <p role="alert" className="mt-2 text-sm text-rose-600">{errors.time ? (time ? errors.time.message : 'Pick a time') : errors.date.message}</p>
        )}
      </Section>

      <Section step={3} title="Your details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.name?.message} required>
            <Input autoComplete="name" invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field label="Mobile number" error={errors.phone?.message} required>
            <Input type="tel" inputMode="tel" autoComplete="tel" invalid={!!errors.phone} {...register('phone')} />
          </Field>
          <Field label="Email" error={errors.email?.message} className="sm:col-span-2">
            <Input type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
          </Field>
          <Field label="Anything we should know?" error={errors.notes?.message} className="sm:col-span-2">
            <Textarea rows={2} invalid={!!errors.notes} {...register('notes')} />
          </Field>
        </div>
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 text-sm">
            {chosen.length ? (
              <>
                <p className="font-semibold text-slate-900 tabular-nums">{formatINR(totalPaise)}</p>
                <p className="truncate text-xs text-slate-500">
                  {chosen.length} {chosen.length === 1 ? 'service' : 'services'} · {formatDuration(totalMin)}
                  {time && ` · ${formatDate(date)}, ${time}`}
                </p>
              </>
            ) : (
              <p className="text-slate-500">No services selected</p>
            )}
          </div>
          <Button type="submit" loading={isSubmitting} disabled={!chosen.length} className="h-11 px-6">Request booking</Button>
        </div>
      </div>
    </form>
  );
}

function Confirmation({ booking, salon, onAgain }) {
  const total = booking.services.reduce((sum, s) => sum + s.pricePaise, 0);
  return (
    <PublicMessage icon={CalendarCheck} tone="green" title="Booking request sent">
      <p>Thank you! {salon.salonName} will confirm your appointment shortly.</p>
      <div className="mt-5 rounded-xl bg-slate-50 p-4 text-left text-slate-700">
        <p className="text-xs text-slate-500 uppercase">Reference</p>
        <p className="font-mono text-xl font-semibold tracking-wider text-slate-900">{booking.reference}</p>
        <p className="mt-3 font-medium text-slate-900">
          {formatDate(booking.date)} at {booking.time}
        </p>
        <ul className="mt-2 space-y-1">
          {booking.services.map((s, i) => (
            <li key={`${s.id}-${i}`} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-600" aria-hidden /> {s.name}
              </span>
              <span className="tabular-nums">{formatINR(s.pricePaise)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
          <span>Total (before tax)</span>
          <span className="tabular-nums">{formatINR(total)}</span>
        </p>
      </div>
      {salon.phone && (
        <p className="mt-4">
          Need to change something? Call <a href={`tel:${salon.phone}`} className="font-medium text-brand-700 underline">{salon.phone}</a>.
        </p>
      )}
      <Button variant="secondary" className="mt-5" onClick={onAgain}>Book another appointment</Button>
    </PublicMessage>
  );
}
