import { useEffect, useRef } from 'react';
import { Loader2, X } from 'lucide-react';

export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

const BUTTON_VARIANTS = {
  primary: 'bg-brand-600 text-white shadow-xs hover:bg-brand-700 focus-visible:ring-brand-500/30',
  secondary: 'border border-slate-300 bg-white text-slate-700 shadow-xs hover:bg-slate-50 focus-visible:ring-slate-400/30',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-400/30',
  danger: 'bg-rose-600 text-white shadow-xs hover:bg-rose-700 focus-visible:ring-rose-500/30',
};
const BUTTON_SIZES = { sm: 'h-8 px-2.5 text-xs', md: 'h-9 px-4 text-sm', icon: 'size-8' };

export function Button({ variant = 'primary', size = 'md', type = 'button', loading = false, disabled, className, children, ...props }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors',
        'focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const CONTROL = cx(
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs',
  'placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15',
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
  'aria-invalid:border-rose-400 aria-invalid:focus:ring-rose-500/15',
);

export function Input({ className, invalid, ...props }) {
  return <input aria-invalid={invalid || undefined} className={cx(CONTROL, className)} {...props} />;
}

export function Select({ className, invalid, children, ...props }) {
  return (
    <select aria-invalid={invalid || undefined} className={cx(CONTROL, 'pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, invalid, ...props }) {
  return <textarea rows={3} aria-invalid={invalid || undefined} className={cx(CONTROL, className)} {...props} />;
}

export function Checkbox({ label, description, className, ...props }) {
  return (
    <label className={cx('flex items-start gap-3 text-sm', className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 rounded border-slate-300 accent-brand-600" {...props} />
      <span>
        <span className="font-medium text-slate-800">{label}</span>
        {description && <span className="block text-slate-500">{description}</span>}
      </span>
    </label>
  );
}

/** Label + control + error/hint. Use `as="div"` when the child is itself a group of labels. */
export function Field({ label, error, hint, required, className, children, as: Tag = 'label' }) {
  return (
    <Tag className={cx('block', className)}>
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-xs text-rose-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </Tag>
  );
}

const BADGE_TONES = {
  slate: 'bg-slate-100 text-slate-600',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  brand: 'bg-brand-50 text-brand-700',
  blue: 'bg-sky-50 text-sky-700',
  rose: 'bg-rose-50 text-rose-700',
};

export function Badge({ tone = 'slate', className, children }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ active }) {
  return <Badge tone={active ? 'green' : 'slate'}>{active ? 'Active' : 'Inactive'}</Badge>;
}

export function Card({ className, children }) {
  return <section className={cx('rounded-xl border border-slate-200 bg-white shadow-xs', className)}>{children}</section>;
}

export function CardHeader({ title, description, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className }) {
  return <Loader2 className={cx('size-5 animate-spin text-slate-400', className)} aria-label="Loading" />;
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {Icon && (
        <div className="mb-3 grid size-11 place-items-center rounded-full bg-brand-50 text-brand-600">
          <Icon className="size-5" aria-hidden />
        </div>
      )}
      <p className="font-medium text-slate-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const MODAL_WIDTHS = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

/**
 * Native <dialog> modal: focus trap, Esc and backdrop click close it. Mount it to open it.
 * Set `focusForm={false}` for read-mostly dialogs that merely contain a form.
 */
export function Modal({ title, description, onClose, footer, size = 'md', focusForm = true, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // showModal() focuses the first focusable element (the close button); start on the first form field instead.
    if (focusForm) dialog.querySelector('form :is(input:not([type=hidden]), select, textarea):not(:disabled)')?.focus();
  }, [focusForm]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={cx(
        'm-auto w-[calc(100%-2rem)] rounded-2xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/40',
        MODAL_WIDTHS[size],
      )}
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3">{footer}</div>}
      </div>
    </dialog>
  );
}

/**
 * columns: [{ key, header, render?(row), className? }]
 * Shows a spinner, the error message, or `empty` when there are no rows.
 */
export function DataTable({ columns, rows, loading, error, empty, rowKey = 'id' }) {
  let body;
  if (loading) {
    body = (
      <tr>
        <td colSpan={columns.length} className="py-12">
          <Spinner className="mx-auto" />
        </td>
      </tr>
    );
  } else if (error) {
    body = (
      <tr>
        <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-rose-600">{error.message}</td>
      </tr>
    );
  } else if (!rows?.length) {
    body = (
      <tr>
        <td colSpan={columns.length}>{empty}</td>
      </tr>
    );
  } else {
    body = rows.map((row) => (
      <tr key={row[rowKey]} className="hover:bg-slate-50/70">
        {columns.map((col) => (
          <td key={col.key} className={cx('px-4 py-3 align-middle text-slate-700', col.className)}>
            {col.render ? col.render(row) : row[col.key]}
          </td>
        ))}
      </tr>
    ));
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={cx('px-4 py-2.5 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase', col.className)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{body}</tbody>
      </table>
    </div>
  );
}

/** "Showing 26–50 of 812" with previous/next buttons. `page` is 1-based. */
export function Pagination({ page, pageSize, total, onChange }) {
  if (!total) return null;
  const pages = Math.ceil(total / pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span className="tabular-nums">
        Showing {from}–{to} of {total}
      </span>
      {pages > 1 && (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    // Scrolls sideways instead of overflowing the page when the tabs don't fit (phones).
    <div role="tablist" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-slate-100 p-1 [scrollbar-width:none]">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cx(
            'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
            value === tab.value ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
