import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { cx, Input, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useDebounced } from '../../lib/hooks.js';

export const UNIT_LABELS = { PCS: 'pcs', ML: 'ml', L: 'L', G: 'g', KG: 'kg', PKT: 'pkt' };
export const REASON_LABELS = {
  OPENING: 'Opening stock',
  PURCHASE: 'Purchase',
  SALE: 'Sale',
  USAGE: 'Used in salon',
  ADJUSTMENT: 'Adjustment',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
  BILL_VOID: 'Bill voided',
};
export const REASON_TONES = {
  OPENING: 'slate', PURCHASE: 'green', SALE: 'brand', USAGE: 'amber', ADJUSTMENT: 'blue', TRANSFER_IN: 'green', TRANSFER_OUT: 'amber', BILL_VOID: 'rose',
};

/** "100 ml" style size line, or '' when the product has no volume. */
export const productSize = (p) => (p.volume ? `${p.volume} ${UNIT_LABELS[p.unit]}` : '');

/** Refresh everything derived from stock movements after a stock change. */
export function invalidateStock(queryClient, branchId) {
  for (const key of ['products', 'stock-alerts', 'product-movements']) queryClient.invalidateQueries({ queryKey: [branchId, key] });
}

/**
 * Searchable product picker (name, brand or barcode). `value` is `{ id, name }` or null; `onSelect` gets the product row.
 */
export function ProductPicker({ value, onSelect, invalid, id, placeholder = 'Search name, brand or barcode' }) {
  const { branchId } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const q = useDebounced(text.trim(), 200);
  const params = { q, pageSize: 8 };
  const results = useQuery({
    queryKey: [branchId, 'products', 'picker', params],
    queryFn: () => api(`/products?${new URLSearchParams(params)}`),
    enabled: open,
  });
  const items = results.data?.items ?? [];

  function choose(product) {
    onSelect(product);
    setOpen(false);
    setText('');
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (items.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (items[active]) choose(items[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        invalid={invalid}
        placeholder={value?.name ?? placeholder}
        value={open ? text : (value?.name ?? '')}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="pl-9"
      />
      {open && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-64 w-full min-w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {results.isPending && (
            <li className="px-3 py-3">
              <Spinner className="mx-auto size-4" />
            </li>
          )}
          {!results.isPending && items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No products found</li>}
          {items.map((product, index) => (
            <li
              key={product.id}
              role="option"
              aria-selected={index === active}
              // mousedown so the choice lands before the input's blur closes the list
              onMouseDown={(e) => {
                e.preventDefault();
                choose(product);
              }}
              onMouseEnter={() => setActive(index)}
              className={cx('flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm', index === active && 'bg-brand-50')}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-900">{product.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {[product.brand, productSize(product), product.barcode].filter(Boolean).join(' · ') || '—'}
                </span>
              </span>
              <span className={cx('shrink-0 text-xs tabular-nums', product.isLow ? 'text-rose-600' : 'text-slate-500')}>
                {product.stockOnHand} in stock
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
