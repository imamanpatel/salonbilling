import { Link } from 'react-router';
import { formatINR } from '@salon/shared';
import { cx } from '../../components/ui.jsx';

const NUMERIC = 'text-right tabular-nums whitespace-nowrap';

/**
 * Report table with a bold totals footer.
 * columns: [{ key, header, value?(row), render?(row), money?, numeric?, className? }]; `totals` is read with the same
 * accessors (the first column shows `totals.totalLabel` or "Total"; set `total: false` to leave a column blank).
 */
export function ReportTable({ columns, rows, totals, rowKey = (row) => row.id, empty = 'Nothing to show for this period.' }) {
  const raw = (col, row) => (col.value ? col.value(row) : row[col.key]);
  const show = (col, row) => {
    if (col.render) return col.render(row);
    const value = raw(col, row);
    if (value === null || value === undefined || value === '') return '—';
    return col.money ? formatINR(value) : value;
  };
  const totalCell = (col, index) => {
    if (index === 0) return totals.totalLabel ?? 'Total';
    if (col.total === false) return '';
    const value = raw(col, totals);
    if (value === null || value === undefined) return '';
    return col.money ? formatINR(value) : value;
  };
  const align = (col) => cx((col.money || col.numeric) && NUMERIC, col.className);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={cx('px-4 py-2.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-slate-500 uppercase', align(col))}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-500">{empty}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-slate-50/70">
                {columns.map((col) => (
                  <td key={col.key} className={cx('px-4 py-2.5 align-middle text-slate-700', align(col))}>{show(col, row)}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {totals && rows.length > 0 && (
          <tfoot className="border-t-2 border-slate-200 bg-slate-50">
            <tr>
              {columns.map((col, index) => (
                <td key={col.key} className={cx('px-4 py-2.5 font-semibold text-slate-900', align(col))}>{totalCell(col, index)}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Plain SVG bar chart. bars: [{ key, value, title }] — `title` shows on hover. */
export function BarChart({ bars, height = 160, label, startLabel, endLabel }) {
  const max = Math.max(0, ...bars.map((b) => b.value));
  const slot = 10;
  return (
    <div>
      <svg
        viewBox={`0 0 ${Math.max(1, bars.length) * slot} 100`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={label}
      >
        <defs>
          {/* Pink at the top fading to fuchsia, matching the buttons. */}
          <linearGradient id="bar-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-fuchsia-500)" />
            <stop offset="100%" stopColor="var(--color-brand-500)" />
          </linearGradient>
        </defs>
        <line x1="0" y1="100" x2={bars.length * slot} y2="100" className="stroke-slate-200" vectorEffect="non-scaling-stroke" />
        {bars.map((bar, i) => {
          const h = max > 0 && bar.value > 0 ? Math.max(1.5, (bar.value / max) * 96) : 0;
          return (
            <g key={bar.key} className="group">
              <title>{bar.title}</title>
              <rect x={i * slot} y="0" width={slot} height="100" className="fill-transparent group-hover:fill-brand-50" />
              <rect x={i * slot + 1.5} y={100 - h} width={slot - 3} height={h} rx="0.8" fill="url(#bar-fill)" className="group-hover:opacity-80" />
            </g>
          );
        })}
      </svg>
      {(startLabel || endLabel) && (
        <div className="mt-2 flex justify-between text-xs text-slate-500">
          <span>{startLabel}</span>
          <span>{endLabel}</span>
        </div>
      )}
    </div>
  );
}

/** KPI tile; a link when `to` is given. */
// Tile colours: icon badge, soft background tint and accent stripe.
const TILE_COLORS = {
  brand: { chip: 'bg-linear-to-br from-brand-500 to-fuchsia-600 text-white', tint: 'from-brand-50', bar: 'bg-brand-500' },
  emerald: { chip: 'bg-linear-to-br from-emerald-400 to-teal-600 text-white', tint: 'from-emerald-50', bar: 'bg-emerald-500' },
  sky: { chip: 'bg-linear-to-br from-sky-400 to-blue-600 text-white', tint: 'from-sky-50', bar: 'bg-sky-500' },
  violet: { chip: 'bg-linear-to-br from-violet-400 to-purple-600 text-white', tint: 'from-violet-50', bar: 'bg-violet-500' },
  amber: { chip: 'bg-linear-to-br from-amber-400 to-orange-500 text-white', tint: 'from-amber-50', bar: 'bg-amber-500' },
  rose: { chip: 'bg-linear-to-br from-rose-400 to-red-600 text-white', tint: 'from-rose-50', bar: 'bg-rose-500' },
  slate: { chip: 'bg-slate-100 text-slate-500', tint: 'from-white', bar: 'bg-slate-300' },
};

/** Headline number. `color` picks the tile's colour; `tone="alert"` turns it amber when something needs attention. */
export function Tile({ icon: Icon, label, value, hint, to, tone = 'default', color = 'brand' }) {
  const c = TILE_COLORS[tone === 'alert' ? 'amber' : color] ?? TILE_COLORS.brand;
  const body = (
    <>
      <span className={cx('absolute inset-x-0 top-0 h-1', c.bar)} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        {Icon && (
          <span className={cx('grid size-9 shrink-0 place-items-center rounded-xl shadow-sm', c.chip)}>
            <Icon className="size-4.5" aria-hidden />
          </span>
        )}
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value ?? '—'}</p>
      {hint && <p className="mt-1 truncate text-xs text-slate-500">{hint}</p>}
    </>
  );
  const className = cx('group relative block overflow-hidden rounded-xl border border-slate-200/80 bg-linear-to-br to-white p-5 shadow-sm shadow-slate-200/60', c.tint);
  if (!to) return <div className={className}>{body}</div>;
  return (
    <Link to={to} className={cx(className, 'transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md')}>
      {body}
    </Link>
  );
}
