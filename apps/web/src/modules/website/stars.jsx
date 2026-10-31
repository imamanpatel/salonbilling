import { Star } from 'lucide-react';
import { cx } from '../../components/ui.jsx';

const LABELS = ['', 'Poor', 'Okay', 'Good', 'Very good', 'Excellent'];

/** 1–5 star picker; `value` is a number or ''/null. Arrow keys work through the native radio group. */
export function StarPicker({ label, value, onChange, size = 'md', name }) {
  const icon = size === 'lg' ? 'size-10 sm:size-12' : 'size-7';
  return (
    <fieldset>
      <legend className={cx('font-medium text-slate-800', size === 'lg' ? 'sr-only' : 'mb-1 text-sm')}>{label}</legend>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer rounded-md p-0.5 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-500/30">
            <input type="radio" name={name} value={n} checked={Number(value) === n} onChange={() => onChange(n)} className="sr-only" />
            <Star
              aria-hidden
              className={cx(icon, 'transition-colors', n <= Number(value || 0) ? 'fill-amber-400 text-amber-400' : 'text-slate-300 hover:text-amber-300')}
            />
            <span className="sr-only">{n} {n === 1 ? 'star' : 'stars'} ({LABELS[n]})</span>
          </label>
        ))}
        {value ? <span className="ml-2 text-sm text-slate-500">{LABELS[Number(value)]}</span> : null}
      </div>
    </fieldset>
  );
}

/** Read-only stars, e.g. ★★★★☆ */
export function Stars({ value, className }) {
  return (
    <span className={cx('inline-flex items-center gap-0.5', className)} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} aria-hidden className={cx('size-3.5', n <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
      ))}
    </span>
  );
}
