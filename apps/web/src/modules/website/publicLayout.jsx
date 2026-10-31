import { Clock, Globe, MapPin, Phone } from 'lucide-react';
import { cx } from '../../components/ui.jsx';

/** Full-page, mobile-first frame for pages clients open without signing in. */
export function PublicShell({ children }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-28 sm:pt-8">{children}</main>
      <footer className="pb-6 text-center text-xs text-slate-400">Powered by Sabilling</footer>
    </div>
  );
}

export function SalonHeader({ salon, compact = false }) {
  return (
    <header className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-5 text-white shadow-sm sm:p-6">
      <p className="text-sm text-brand-100">{salon.name}</p>
      <h1 className={cx('font-semibold tracking-tight', compact ? 'text-xl' : 'text-2xl sm:text-3xl')}>{salon.salonName}</h1>
      {!compact && (
        <ul className="mt-4 space-y-1.5 text-sm text-brand-50">
          {salon.address && (
            <li className="flex gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {salon.address}
            </li>
          )}
          <li className="flex gap-2">
            <Clock className="mt-0.5 size-4 shrink-0" aria-hidden /> Open {salon.openTime} – {salon.closeTime}
          </li>
          {salon.phone && (
            <li className="flex gap-2">
              <Phone className="mt-0.5 size-4 shrink-0" aria-hidden />
              <a href={`tel:${salon.phone}`} className="font-medium underline underline-offset-2">{salon.phone}</a>
            </li>
          )}
          {salon.website && (
            <li className="flex gap-2">
              <Globe className="mt-0.5 size-4 shrink-0" aria-hidden />
              <a href={/^https?:\/\//.test(salon.website) ? salon.website : `https://${salon.website}`} className="underline underline-offset-2" rel="noreferrer" target="_blank">
                {salon.website}
              </a>
            </li>
          )}
        </ul>
      )}
    </header>
  );
}

/** A centred card with an icon, title and text, for empty/error/success states. */
export function PublicMessage({ icon: Icon, tone = 'brand', title, children }) {
  const tones = { brand: 'bg-brand-50 text-brand-600', green: 'bg-emerald-50 text-emerald-600', slate: 'bg-slate-100 text-slate-500' };
  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-xs">
      {Icon && (
        <div className={cx('mx-auto mb-4 grid size-14 place-items-center rounded-full', tones[tone])}>
          <Icon className="size-7" aria-hidden />
        </div>
      )}
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mx-auto mt-2 max-w-sm text-sm text-slate-600">{children}</div>
    </div>
  );
}

export function Section({ step, title, children, className }) {
  return (
    <section className={cx('mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5', className)}>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
        {step && <span className="grid size-6 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{step}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}
