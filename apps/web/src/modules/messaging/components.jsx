import { useRef } from 'react';
import { Badge, cx } from '../../components/ui.jsx';
import { STATUS_LABELS, STATUS_TONES } from './labels.js';

/** Clickable {placeholder} chips that insert into the body field at the cursor. */
export function PlaceholderChips({ placeholders, onInsert }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {placeholders.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => onInsert(`{${name}}`)}
          className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
        >
          {`{${name}}`}
        </button>
      ))}
    </div>
  );
}

/**
 * Wires a react-hook-form textarea so text can be inserted at the cursor.
 * Returns `{ field, insert }`; spread `field` on the Textarea.
 */
export function useInsertableField(form, name) {
  const element = useRef(null);
  const { ref, ...rest } = form.register(name);

  const insert = (text) => {
    const el = element.current;
    const current = form.getValues(name) ?? '';
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    form.setValue(name, current.slice(0, start) + text + current.slice(end), { shouldDirty: true });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const field = {
    ...rest,
    ref: (el) => {
      ref(el);
      element.current = el;
    },
  };
  return { field, insert };
}

export function MessageStatusBadge({ status, error }) {
  return (
    <span title={error || undefined} className={cx(error && 'cursor-help')}>
      <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
    </span>
  );
}

export function PreviewBox({ text, loading }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap text-slate-700">
      {loading ? <span className="text-slate-400">Rendering…</span> : text || <span className="text-slate-400">Nothing to preview yet.</span>}
    </div>
  );
}
