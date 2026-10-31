import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { CalendarCheck, CheckCircle2, Gift, MessageCircle, Plus, Printer, Receipt, Search, Trash2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { fieldErrors, formatINR, paiseToRupees, PAYMENT_METHODS } from '@salon/shared';
import { billSchema } from '@salon/shared/billing';
import { Badge, Button, Card, CardHeader, Checkbox, cx, Input, Select, Spinner, Textarea } from '../../components/ui.jsx';
import { api, ApiError } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, formatDateTime, moneyInput, whatsappLink } from '../../lib/format.js';
import { useDebounced } from '../../lib/hooks.js';
import ClientPicker from './ClientPicker.jsx';
import { billingKeys, useActiveStaff, useBillCatalogue, useClientAccount } from './hooks.js';
import { ITEM_KIND_LABELS, METHOD_LABELS, needsReference } from './labels.js';

// One compact form, laid out like a paper bill: client, item rows, then the totals and payment rows underneath,
// with the client's account (wallet, points, packages) alongside.

let lineSeq = 0;
const newLine = (fields) => ({
  key: (lineSeq += 1),
  refId: null,
  clientPackageItemId: null,
  staffId: '',
  qty: '1',
  price: '', // rupees; blank = catalogue (or member) price
  catalogPaise: 0,
  discountType: 'PERCENT',
  discount: '',
  ...fields,
});
const newPayment = (method = 'CASH') => ({ key: (lineSeq += 1), method, amount: '', reference: '' });

const taxCategory = (kind) => (kind === 'PRODUCT' ? 'PRODUCT' : 'SERVICE');
const isRedemption = (line) => Boolean(line.clientPackageItemId);
const fixedLine = (line) => isRedemption(line) || line.kind === 'GIFT_CARD';

/** The tax rate chosen for the bill, as the matching rate for this line (services and products have separate GST rows). */
const taxIdFor = (taxes, rate, kind) =>
  rate === '' ? null : taxes.find((t) => Number(t.ratePct) === Number(rate) && (t.appliesTo === 'ALL' || t.appliesTo === taxCategory(kind)))?.id ?? null;

/** POS state -> billSchema payload. Payment rows without an amount are left out (`paymentRows` maps indexes back). */
function toPayload(state, taxes) {
  const paymentRows = state.payments.filter((p) => p.amount !== '');
  const manual = state.manualDiscount.trim();
  const percentManual = state.manualDiscountType === 'PERCENT';
  const payload = {
    clientId: state.client?.id,
    appointmentId: state.appointmentId || null,
    items: state.lines.map((line) => {
      const raw = line.discount.trim();
      const value = raw === '' ? null : line.discountType === 'PERCENT' ? Number(raw) : moneyInput(raw);
      return {
        kind: line.kind,
        refId: line.refId,
        clientPackageItemId: line.clientPackageItemId,
        staffId: line.staffId || null,
        qty: line.qty,
        unitPricePaise: line.price === '' ? null : moneyInput(line.price),
        discount: fixedLine(line) || value === null || value === 0 ? null : { type: line.discountType, value },
        taxRateId: fixedLine(line) ? null : taxIdFor(taxes, state.taxRate ?? '', line.kind),
      };
    }),
    couponCode: state.couponCode || null,
    // The extra discount is either a percentage (worked out by the server) or rupees.
    manualDiscountPaise: manual === '' || percentManual ? 0 : moneyInput(manual),
    manualDiscountPct: manual !== '' && percentManual ? Number(manual) : 0,
    redeemPoints: state.redeemPoints.trim() === '' ? 0 : state.redeemPoints,
    payments: paymentRows.map((p) => ({ method: p.method, amountPaise: moneyInput(p.amount), reference: p.reference || null })),
    notes: state.notes || null,
    sendReceipt: state.sendReceipt,
  };
  return { payload, paymentRows };
}

const EMPTY = {
  client: null, lines: [], couponInput: '', couponCode: '', manualDiscount: '', manualDiscountType: 'PERCENT', redeemPoints: '',
  // null until the catalogue loads and gives the branch's default rate.
  taxRate: null,
  payments: [newPayment()], notes: '', sendReceipt: false,
};

export default function PosPage() {
  const { branchId, canManage } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get('appointmentId');
  const catalogue = useBillCatalogue();
  const staff = useActiveStaff();

  const [state, setState] = useState({ ...EMPTY, payments: [newPayment()] });
  const [done, setDone] = useState(null);
  const [submitErrors, setSubmitErrors] = useState({});
  const set = (patch) => {
    setSubmitErrors({});
    setState((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));
  };

  const taxes = catalogue.data?.taxes ?? [];
  const taxRates = [...new Set(taxes.map((t) => Number(t.ratePct)))].sort((a, b) => a - b);

  // Start with the branch's default service GST rate (Settings → Billing), if any.
  useEffect(() => {
    if (!catalogue.data || state.taxRate !== null) return;
    const fallback = taxes.find((t) => t.id === catalogue.data.defaults.serviceTaxId);
    setState((s) => ({ ...s, taxRate: fallback ? String(Number(fallback.ratePct)) : '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue.data]);

  const appointment = useQuery({
    queryKey: [branchId, 'appointment', appointmentId],
    queryFn: () => api(`/appointments/${appointmentId}`),
    enabled: Boolean(appointmentId),
  });

  // Prefill from ?appointmentId= once both the appointment and the catalogue are loaded.
  const prefilled = useRef(null);
  useEffect(() => {
    const appt = appointment.data;
    if (!appt || !catalogue.data || prefilled.current === appt.id) return;
    prefilled.current = appt.id;
    const lines = appt.items.map((item) => {
      const service = catalogue.data.services.find((s) => s.id === item.serviceId);
      const custom = canManage && service && item.pricePaise !== service.pricePaise && item.pricePaise !== service.memberPricePaise;
      return newLine({
        kind: 'SERVICE',
        refId: item.serviceId,
        name: item.service?.name ?? service?.name ?? 'Service',
        staffId: item.staffId ?? '',
        catalogPaise: service?.pricePaise ?? item.pricePaise,
        price: custom ? paiseToRupees(item.pricePaise) : '',
      });
    });
    setState((s) => ({ ...s, client: appt.client, lines }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointment.data, catalogue.data]);

  const linkedAppointment = appointmentId && appointment.data && state.client?.id === appointment.data.clientId ? appointment.data : null;
  const { payload, paymentRows } = toPayload({ ...state, appointmentId: linkedAppointment?.id }, taxes);
  const parsed = billSchema.safeParse(payload);
  const localErrors = state.client && state.lines.length && !parsed.success ? fieldErrors(parsed.error) : {};
  const previewKey = useDebounced(parsed.success ? JSON.stringify(payload) : '', 300);
  const preview = useQuery({
    queryKey: [branchId, 'bill-preview', previewKey],
    queryFn: () => api('/bills/preview', { method: 'POST', body: JSON.parse(previewKey) }),
    enabled: Boolean(previewKey),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const priced = previewKey && preview.data ? preview.data : null;
  const errors = { ...localErrors, ...(preview.error?.details ?? {}), ...(priced?.errors ?? {}), ...submitErrors };

  const create = useMutation({
    mutationFn: () => api('/bills', { method: 'POST', body: payload }),
    onSuccess: (bill) => {
      toast.success(`Bill ${bill.number} created`);
      billingKeys(branchId, bill.clientId).forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      queryClient.invalidateQueries({ queryKey: [branchId, 'bill-catalogue'] });
      setDone(bill);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.details) setSubmitErrors(err.details);
      toast.error(err.message);
    },
  });

  const submit = () => {
    if (!parsed.success) {
      const first = Object.values(fieldErrors(parsed.error))[0];
      toast.error(first ?? 'Please fix the highlighted fields');
      return;
    }
    create.mutate();
  };

  const startOver = () => {
    setDone(null);
    setSubmitErrors({});
    setState((s) => ({ ...EMPTY, taxRate: s.taxRate, payments: [newPayment()] }));
    prefilled.current = null;
    if (appointmentId) navigate('/billing/new', { replace: true });
  };

  if (done) return <BillCreated bill={done} onNew={startOver} />;

  const updateLine = (key, patch) => set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const addLine = (line) => set((s) => ({ lines: [...s.lines, line] }));
  const redeem = (pkg, item) =>
    set((s) => {
      const existing = s.lines.find((l) => l.clientPackageItemId === item.clientPackageItemId);
      if (existing) {
        return { lines: s.lines.map((l) => (l === existing ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l)) };
      }
      return {
        lines: [
          ...s.lines,
          newLine({ kind: 'SERVICE', refId: item.serviceId, clientPackageItemId: item.clientPackageItemId, name: `${item.serviceName} (package)`, packageName: pkg.name }),
        ],
      };
    });

  const setClient = (client) =>
    set((s) => ({
      client,
      // Package redemptions, points and wallet payments belong to the previous client.
      lines: s.lines.filter((l) => !isRedemption(l)),
      redeemPoints: '',
      payments: s.payments.filter((p) => p.method !== 'WALLET'),
    }));

  const canSubmit = Boolean(state.client && state.lines.length);

  return (
    // Bottom padding below lg keeps the form clear of the fixed checkout bar.
    <div className="pb-24 lg:pb-0">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader
            title="Generate new bill"
            actions={
              <Button variant="secondary" size="sm" onClick={() => navigate('/bills')}>
                <Receipt className="size-4" /> All bills
              </Button>
            }
          />

          <div className="space-y-3 px-4 py-4 sm:px-5">
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-500">Client</span>
              <ClientPicker client={state.client} onChange={setClient} disabled={Boolean(linkedAppointment)} />
              {errors.clientId && <p className="mt-1 text-xs text-rose-600">{errors.clientId}</p>}
            </div>
            {appointmentId && appointment.isPending && <Spinner className="mx-auto" />}
            {linkedAppointment && (
              <p className="flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
                <CalendarCheck className="size-4" />
                Appointment on {formatDate(linkedAppointment.date)} at {linkedAppointment.startTime}
              </p>
            )}
            {errors.appointmentId && <p className="text-sm text-rose-600">{errors.appointmentId}</p>}
          </div>

          <LineItems
            lines={state.lines}
            priced={priced}
            staff={staff.data ?? []}
            errors={errors}
            canManage={canManage}
            onChange={updateLine}
            onRemove={(key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) }))}
            adder={<ItemSearch catalogue={catalogue} onAdd={addLine} />}
          />

          <div className="grid gap-x-6 gap-y-4 border-t border-slate-100 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div className="order-2 space-y-3 md:order-1">
              <Textarea rows={3} aria-label="Notes" placeholder="Write notes about this bill…" value={state.notes} onChange={(e) => set({ notes: e.target.value })} />
              {errors.notes && <p className="text-xs text-rose-600">{errors.notes}</p>}
              <Checkbox
                label="Send receipt to client"
                description="WhatsApp/SMS with the amount and a feedback link."
                checked={state.sendReceipt}
                onChange={(e) => set({ sendReceipt: e.target.checked })}
              />
            </div>
            <Summary
              className="order-1 md:order-2"
              state={state}
              set={set}
              priced={priced}
              fetching={preview.isFetching}
              previewError={preview.error}
              errors={errors}
              paymentRows={paymentRows}
              taxRates={taxRates}
            />
          </div>

          <div className="hidden justify-end border-t border-slate-100 px-5 py-3 lg:flex">
            <Button onClick={submit} loading={create.isPending} disabled={!canSubmit}>
              <Receipt className="size-4" /> Create bill{priced ? ` · ${formatINR(priced.totalPaise)}` : ''}
            </Button>
          </div>
        </Card>

        {/* Below the 3rem sticky menu bar. */}
        <div className="lg:sticky lg:top-16">
          <Client360 client={state.client} onRedeem={redeem} lines={state.lines} />
        </div>
      </div>

      {/* Phones and tablets: total and the create button stay in reach while scrolling the form. */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgb(15_23_42/0.06)] backdrop-blur lg:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500">Total</p>
          <p className="truncate text-lg font-semibold text-slate-900 tabular-nums">
            {priced ? formatINR(priced.totalPaise) : '—'}
            {priced?.duePaise > 0 && <span className="ml-1.5 text-sm font-medium text-amber-700">· due {formatINR(priced.duePaise)}</span>}
          </p>
        </div>
        <Button onClick={submit} loading={create.isPending} disabled={!canSubmit}>
          Create bill
        </Button>
      </div>
    </div>
  );
}

const KIND_ORDER = { SERVICE: 0, PACKAGE: 1, PRODUCT: 2, MEMBERSHIP: 3 };

/** One search box for everything sellable; suggestions only appear while typing. */
function ItemSearch({ catalogue, onAdd }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const data = catalogue.data;

  const options = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!data || !term) return [];
    const all = [
      ...data.services.map((s) => ({ kind: 'SERVICE', id: s.id, name: s.name, sub: s.category?.name, pricePaise: s.pricePaise })),
      ...data.packages.map((p) => ({ kind: 'PACKAGE', id: p.id, name: p.name, sub: p.items.map((i) => i.service.name).join(', '), pricePaise: p.pricePaise })),
      ...data.products.map((p) => ({ kind: 'PRODUCT', id: p.id, name: p.name, sub: p.brand, barcode: p.barcode, pricePaise: p.salePricePaise })),
      ...data.membershipPlans.map((p) => ({ kind: 'MEMBERSHIP', id: p.id, name: p.name, sub: `${p.durationDays} days`, pricePaise: p.pricePaise })),
    ];
    const starts = (o) => (o.name.toLowerCase().startsWith(term) ? 0 : 1);
    return all
      .filter((o) => o.name.toLowerCase().includes(term) || o.sub?.toLowerCase().includes(term) || o.barcode === query.trim())
      .sort((a, b) => starts(a) - starts(b) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [data, query]);

  const pick = (option) => {
    onAdd(newLine({ kind: option.kind, refId: option.id, name: option.name, catalogPaise: option.pricePaise }));
    setQuery('');
    setActive(0);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && options[active]) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showList = open && query.trim() !== '';
  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <Input
          role="combobox"
          aria-label="Add service, product or package"
          aria-expanded={showList}
          aria-controls="pos-item-options"
          aria-autocomplete="list"
          aria-activedescendant={showList && options[active] ? `pos-item-${active}` : undefined}
          placeholder={catalogue.isPending ? 'Loading catalogue…' : 'Add service / product / package'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="pl-9"
        />
        {showList && (
          <ul id="pos-item-options" role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {catalogue.error ? (
              <li className="px-3 py-2 text-sm text-rose-600">{catalogue.error.message}</li>
            ) : options.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-500">Nothing matches “{query.trim()}”.</li>
            ) : (
              options.map((option, i) => (
                <li
                  key={`${option.kind}:${option.id}`}
                  id={`pos-item-${i}`}
                  role="option"
                  aria-selected={i === active}
                  // mousedown + preventDefault keeps focus in the input, so the list doesn't close before the click lands.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(option);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cx('flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm', i === active && 'bg-brand-50')}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">{option.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {ITEM_KIND_LABELS[option.kind]}{option.sub ? ` · ${option.sub}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-slate-700 tabular-nums">{formatINR(option.pricePaise)}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <Button variant="secondary" onClick={() => onAdd(newLine({ kind: 'GIFT_CARD', name: 'Gift card' }))}>
        <Gift className="size-4" /> Gift card
      </Button>
    </div>
  );
}

const ROW_COLUMNS = '@2xl:grid-cols-[minmax(0,1.6fr)_minmax(7.5rem,1.4fr)_3.5rem_6.5rem_5.5rem_6rem_2rem]';

function FieldLabel({ children }) {
  return <span className="mb-1 block text-xs font-medium text-slate-500 @2xl:sr-only">{children}</span>;
}

/**
 * Item rows. A table-like row once the form is wide enough; below that each row wraps into a small card with
 * labelled fields. Sized by the form's width (@container), since the form shares the screen with the client panel.
 */
function LineItems({ lines, priced, staff, errors, canManage, onChange, onRemove, adder }) {
  return (
    <div className="@container border-t border-slate-100">
      <div className={cx('hidden gap-3 bg-brand-50/60 px-5 py-2 text-xs font-semibold tracking-wide text-brand-900/60 uppercase @2xl:grid', ROW_COLUMNS)}>
        <span>Item</span>
        <span>Staff</span>
        <span>Qty</span>
        <span>Discount</span>
        <span>Price (₹)</span>
        <span className="text-right">Amount</span>
        <span className="sr-only">Remove</span>
      </div>

      <ul className="divide-y divide-slate-100 text-sm">
        {lines.map((line, index) => {
          const computed = priced?.lines[index];
          const lineErrors = Object.entries(errors).filter(([key]) => key.startsWith(`items.${index}.`) || key === `items.${index}`);
          const priceEditable = line.kind === 'GIFT_CARD' || (canManage && !isRedemption(line));
          const shownPrice = computed && computed.kind === line.kind ? computed.unitPricePaise : line.catalogPaise;
          const remove = (className) => (
            <Button variant="ghost" size="icon" className={className} onClick={() => onRemove(line.key)} aria-label={`Remove ${line.name}`}>
              <Trash2 className="size-3.5" />
            </Button>
          );
          return (
            <li key={line.key} className={cx('grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 sm:px-5 @2xl:items-center @2xl:py-2', ROW_COLUMNS)}>
              <div className="col-span-2 flex items-start gap-2 @2xl:col-span-1">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words text-slate-900">{line.name}</p>
                  {(isRedemption(line) || line.kind !== 'SERVICE' || computed?.memberDiscount) && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {(isRedemption(line) || line.kind !== 'SERVICE') && (
                        <Badge tone={isRedemption(line) ? 'blue' : 'slate'}>{isRedemption(line) ? 'From package' : ITEM_KIND_LABELS[line.kind]}</Badge>
                      )}
                      {computed?.memberDiscount && <Badge tone="brand">Member price</Badge>}
                    </div>
                  )}
                </div>
                {remove('-mt-1 -mr-2 shrink-0 @2xl:hidden')}
              </div>

              <div className="min-w-0">
                <FieldLabel>Staff</FieldLabel>
                {line.kind === 'GIFT_CARD' ? (
                  <span className="block py-2 text-slate-400">—</span>
                ) : (
                  <Select aria-label="Staff" value={line.staffId} onChange={(e) => onChange(line.key, { staffId: e.target.value })}>
                    <option value="">—</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                )}
              </div>
              <div className="min-w-0">
                <FieldLabel>Qty</FieldLabel>
                <Input
                  aria-label="Quantity"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  disabled={line.kind === 'GIFT_CARD' || line.kind === 'MEMBERSHIP'}
                  value={line.qty}
                  onChange={(e) => onChange(line.key, { qty: e.target.value })}
                />
              </div>
              <div className="min-w-0">
                <FieldLabel>Discount</FieldLabel>
                {fixedLine(line) ? (
                  <span className="block py-2 text-slate-400">—</span>
                ) : (
                  <div className="flex">
                    <Input
                      aria-label="Discount"
                      inputMode="decimal"
                      placeholder="0"
                      value={line.discount}
                      onChange={(e) => onChange(line.key, { discount: e.target.value })}
                      className="min-w-0 rounded-r-none"
                    />
                    <button
                      type="button"
                      title="Switch between percent and rupees"
                      onClick={() => onChange(line.key, { discountType: line.discountType === 'PERCENT' ? 'FLAT' : 'PERCENT' })}
                      className="rounded-r-lg border border-l-0 border-slate-300 bg-slate-50 px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {line.discountType === 'PERCENT' ? '%' : '₹'}
                    </button>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <FieldLabel>Price (₹)</FieldLabel>
                {priceEditable ? (
                  <Input
                    aria-label={line.kind === 'GIFT_CARD' ? 'Gift card value' : 'Unit price'}
                    inputMode="decimal"
                    placeholder={line.kind === 'GIFT_CARD' ? 'Value' : paiseToRupees(shownPrice)}
                    value={line.price}
                    onChange={(e) => onChange(line.key, { price: e.target.value })}
                  />
                ) : (
                  <span className="block py-2 tabular-nums">{formatINR(isRedemption(line) ? 0 : shownPrice)}</span>
                )}
              </div>
              <div className="col-span-2 flex items-baseline justify-between gap-2 @2xl:col-span-1 @2xl:block @2xl:text-right">
                <FieldLabel>Amount</FieldLabel>
                {computed ? (
                  <span className="tabular-nums">
                    <span className="font-semibold text-slate-900">{formatINR(computed.totalPaise)}</span>
                    {computed.discountPaise > 0 && <span className="block text-xs text-emerald-700">−{formatINR(computed.discountPaise)}</span>}
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </div>
              <div className="hidden @2xl:block">{remove('')}</div>

              {lineErrors.map(([key, message]) => (
                <p key={key} role="alert" className="col-span-full text-xs text-rose-600">{message}</p>
              ))}
            </li>
          );
        })}

        <li className="px-4 py-3 sm:px-5">
          {adder}
          {lines.length === 0 && <p className="mt-2 text-xs text-slate-500">Type a service, product or package name to add it to the bill.</p>}
        </li>
      </ul>
    </div>
  );
}

/** A label on the left, its value or control on the right — the bill's totals and payment rows. */
function Row({ label, hint, children, className }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 py-2', className)}>
      <div className="min-w-0 pt-0.5">
        <p>{label}</p>
        {hint && <p className="text-xs font-normal text-slate-500">{hint}</p>}
      </div>
      <div className="flex min-w-0 shrink-0 justify-end text-right tabular-nums">{children}</div>
    </div>
  );
}

function Summary({ className, state, set, priced, fetching, previewError, errors, paymentRows, taxRates }) {
  const ready = Boolean(state.client && state.lines.length);
  const money = (paise) => (priced ? formatINR(paise) : '—');
  const pointValue = priced?.pointValue;
  const fieldError = (key) => errors[key] && <p className="pb-1 text-right text-xs text-rose-600">{errors[key]}</p>;

  return (
    <div className={cx('text-sm text-slate-700', className)}>
      <div className={cx('divide-y divide-slate-100 transition-opacity', fetching && 'opacity-60')}>
        <Row label="Subtotal">{money(priced?.subtotalPaise)}</Row>
        {priced?.discountPaise > 0 && (
          <Row label="Discounts" className="text-emerald-700">−{formatINR(priced.discountPaise)}</Row>
        )}

        <Row label="Coupon" hint={priced?.coupon ? `${priced.coupon.code}: −${formatINR(priced.couponDiscountPaise)}` : undefined}>
          <div className="flex w-44 gap-1.5">
            <Input
              aria-label="Coupon code"
              value={state.couponInput}
              invalid={!!errors.couponCode}
              onChange={(e) => set({ couponInput: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && set({ couponCode: state.couponInput.trim().toUpperCase() })}
              className="min-w-0 uppercase"
            />
            {state.couponCode ? (
              <Button variant="secondary" size="sm" onClick={() => set({ couponCode: '', couponInput: '' })}>Remove</Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => set({ couponCode: state.couponInput.trim().toUpperCase() })} disabled={!state.couponInput.trim()}>
                Apply
              </Button>
            )}
          </div>
        </Row>
        {fieldError('couponCode')}

        {/* Inputs are w-full by default, so sizes go on wrappers. */}
        <Row
          label="Discount"
          hint={state.manualDiscountType === 'PERCENT' && priced?.manualDiscountPaise > 0 ? `${state.manualDiscount}% = −${formatINR(priced.manualDiscountPaise)}` : undefined}
        >
          <div className="flex w-32">
            <Input
              aria-label="Extra discount"
              inputMode="decimal"
              placeholder="0"
              value={state.manualDiscount}
              invalid={!!(errors.manualDiscountPaise || errors.manualDiscountPct)}
              onChange={(e) => set({ manualDiscount: e.target.value })}
              className="min-w-0 rounded-r-none text-right"
            />
            <button
              type="button"
              title="Switch between percent and rupees"
              onClick={() => set((s) => ({ manualDiscountType: s.manualDiscountType === 'PERCENT' ? 'FLAT' : 'PERCENT' }))}
              className="rounded-r-lg border border-l-0 border-slate-300 bg-slate-50 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {state.manualDiscountType === 'PERCENT' ? '%' : '₹'}
            </button>
          </div>
        </Row>
        {fieldError('manualDiscountPaise')}
        {fieldError('manualDiscountPct')}

        {priced?.pointsBalance > 0 && (
          <>
            <Row
              label="Redeem points"
              hint={`${priced.pointsBalance} available${pointValue ? ` · ${pointValue.points} = ${formatINR(pointValue.valuePaise)}` : ''}`}
            >
              <div className="w-28">
                <Input aria-label="Redeem points" type="number" min={0} placeholder="0" value={state.redeemPoints} invalid={!!errors.redeemPoints} onChange={(e) => set({ redeemPoints: e.target.value })} className="text-right" />
              </div>
            </Row>
            {fieldError('redeemPoints')}
          </>
        )}

        <Row label="Taxes" hint={priced?.taxPaise > 0 ? `GST ${formatINR(priced.taxPaise)}` : undefined}>
          <div className="w-32">
            <Select aria-label="Taxes" value={state.taxRate ?? ''} onChange={(e) => set({ taxRate: e.target.value })}>
              <option value="">No tax</option>
              {taxRates.map((rate) => (
                <option key={rate} value={String(rate)}>GST {rate}%</option>
              ))}
            </Select>
          </div>
        </Row>

        {priced?.roundOffPaise !== 0 && priced && <Row label="Round off">{formatINR(priced.roundOffPaise)}</Row>}
        <Row label="Total" className="my-1 items-center! rounded-lg border-0! bg-linear-to-r from-brand-600 to-fuchsia-600 px-3 text-base font-semibold text-white shadow-sm shadow-brand-600/25">
          {money(priced?.totalPaise)}
        </Row>
        {priced?.advancePaise > 0 && <Row label="Advance received">−{formatINR(priced.advancePaise)}</Row>}
      </div>

      <Payments state={state} set={set} priced={priced} errors={errors} paymentRows={paymentRows} />

      <div className="divide-y divide-slate-100 border-t border-slate-100">
        <Row label="Amount due" className={cx('font-semibold', priced?.duePaise > 0 ? 'text-amber-700' : 'text-emerald-700')}>{money(priced?.duePaise)}</Row>
      </div>
      {priced?.pointsEarned > 0 && <p className="text-right text-xs text-slate-500">Client earns {priced.pointsEarned} points.</p>}
      {!ready && <p className="pt-1 text-right text-xs text-slate-500">Pick a client and add items to see the total.</p>}
      {ready && !priced && previewError && <p className="pt-1 text-right text-xs text-rose-600">{previewError.message}</p>}
    </div>
  );
}

function Payments({ state, set, priced, errors, paymentRows }) {
  const update = (key, patch) => set((s) => ({ payments: s.payments.map((p) => (p.key === key ? { ...p, ...patch } : p)) }));
  const errorOf = (row, name) => {
    const index = paymentRows.indexOf(row);
    return index >= 0 ? errors[`payments.${index}.${name}`] : undefined;
  };
  const payBalance = (key) => {
    if (!priced) return;
    const others = state.payments.filter((p) => p.key !== key).reduce((sum, p) => sum + (Number(moneyInput(p.amount)) || 0), 0);
    update(key, { amount: paiseToRupees(Math.max(0, priced.totalPaise - priced.advancePaise - others)) });
  };

  return (
    <div className="space-y-2 border-t border-slate-100 py-2">
      <div className="flex items-center justify-between">
        <p>Amount paid</p>
        <Button size="sm" variant="ghost" onClick={() => set((s) => ({ payments: [...s.payments, newPayment('UPI')] }))}>
          <Plus className="size-3.5" /> Split
        </Button>
      </div>
      {state.payments.map((p) => (
        <div key={p.key} className="space-y-1.5">
          <div className="flex gap-1.5">
            <div className="w-32 shrink-0">
              <Select aria-label="Payment method" value={p.method} onChange={(e) => update(p.key, { method: e.target.value })}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{METHOD_LABELS[m]}</option>
                ))}
              </Select>
            </div>
            <Input
              aria-label="Amount (₹)"
              inputMode="decimal"
              placeholder="Amount ₹"
              value={p.amount}
              invalid={!!errorOf(p, 'amountPaise')}
              onChange={(e) => update(p.key, { amount: e.target.value })}
              className="min-w-0 text-right"
            />
            {state.payments.length > 1 && (
              <Button variant="ghost" size="icon" aria-label="Remove payment" onClick={() => set((s) => ({ payments: s.payments.filter((x) => x.key !== p.key) }))}>
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
          {needsReference(p.method) && (
            <Input
              aria-label="Reference"
              placeholder={p.method === 'GIFT_CARD' ? 'Gift card code' : 'Transaction id'}
              value={p.reference}
              invalid={!!errorOf(p, 'reference')}
              onChange={(e) => update(p.key, { reference: e.target.value })}
            />
          )}
          {[errorOf(p, 'amountPaise'), errorOf(p, 'reference'), errorOf(p, 'method')].filter(Boolean).map((message) => (
            <p key={message} role="alert" className="text-xs text-rose-600">{message}</p>
          ))}
          <button type="button" className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50" disabled={!priced} onClick={() => payBalance(p.key)}>
            Pay full balance
          </button>
        </div>
      ))}
      {errors.payments && <p role="alert" className="text-xs text-rose-600">{errors.payments}</p>}
      {paymentRows.length === 0 && priced?.totalPaise > 0 && (
        <p className="text-xs text-amber-700">No payment entered: the full amount will be recorded as due.</p>
      )}
    </div>
  );
}

/** Everything about the client that matters at the counter, plus their packages to redeem. */
function Client360({ client, onRedeem, lines }) {
  const account = useClientAccount(client?.id);
  const a = account.data;
  const inBill = (cpiId) => lines.filter((l) => l.clientPackageItemId === cpiId).reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  const row = (label, value, tone) => (
    <div className="flex justify-between gap-3 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={cx('text-right font-medium tabular-nums', tone ?? 'text-slate-900')}>{value}</dd>
    </div>
  );

  return (
    <Card>
      <CardHeader title="Client 360° view" />
      {!client ? (
        <div className="flex flex-col items-center gap-2 px-5 py-8 text-center text-sm text-slate-500">
          <UserRound className="size-8 text-slate-300" aria-hidden />
          Pick a client to see their visits, wallet, points and packages.
        </div>
      ) : account.isPending ? (
        <Spinner className="mx-auto my-6" />
      ) : account.error ? (
        <p className="p-5 text-sm text-rose-600">{account.error.message}</p>
      ) : (
        <div className="px-5 pb-4 text-sm">
          <dl className="divide-y divide-slate-100">
            {row('Last visit', a.lastVisitAt ? formatDateTime(a.lastVisitAt) : '—')}
            {row('Total visits', a.visits)}
            {row('Total spent', formatINR(a.totalSpentPaise), 'text-brand-700')}
            {row('Wallet', formatINR(a.walletBalancePaise), 'text-emerald-700')}
            {row('Reward points', a.pointsBalance, 'text-amber-700')}
            {a.duePaise > 0 && row('Pending dues', formatINR(a.duePaise), 'text-rose-600')}
            {row('Membership', a.membership ? `${a.membership.name} · till ${formatDate(a.membership.endsOn)}` : '—')}
          </dl>

          {a.packages.length > 0 && (
            <div className="mt-2 space-y-2">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Active packages</p>
              {a.packages.map((pkg) => (
                <div key={pkg.id} className="rounded-lg border border-slate-200 p-3">
                  <p className="font-medium text-slate-900">{pkg.name}</p>
                  <p className="mb-2 text-xs text-slate-500">Expires {formatDate(pkg.expiresOn)}</p>
                  <ul className="space-y-1">
                    {pkg.items.map((item) => {
                      const left = item.totalQty - item.usedQty - inBill(item.clientPackageItemId);
                      return (
                        <li key={item.clientPackageItemId} className="flex items-center justify-between gap-2">
                          <span className="min-w-0">{item.serviceName} <span className="text-slate-500">· {left} left</span></span>
                          <Button size="sm" variant="secondary" disabled={left <= 0} onClick={() => onRedeem(pkg, item)}>Redeem</Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {a.giftCards.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">Gift cards: {a.giftCards.map((g) => `${g.code} (${formatINR(g.balancePaise)})`).join(', ')}</p>
          )}
        </div>
      )}
    </Card>
  );
}

function BillCreated({ bill, onNew }) {
  const summary = [
    `Hi ${bill.client.name.split(' ')[0]}, thank you for visiting ${bill.branch?.salonName ?? 'us'}!`,
    `Bill ${bill.number}: ${formatINR(bill.totalPaise)}${bill.duePaise > 0 ? ` (balance due ${formatINR(bill.duePaise)})` : ''}.`,
    ...bill.giftCardsIssued.map((g) => `Gift card ${g.code} worth ${formatINR(g.initialPaise)}, valid till ${formatDate(g.expiresOn)}.`),
    `Tell us how we did: ${bill.feedbackLink}`,
  ].join('\n');

  return (
    <Card className="mx-auto max-w-lg p-8 text-center">
      <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
      <h1 className="mt-3 text-xl font-semibold text-slate-900">Bill {bill.number} created</h1>
      <p className="mt-1 text-sm text-slate-500">{bill.client.name}</p>
      <dl className="mx-auto mt-5 grid max-w-xs grid-cols-3 gap-3 text-sm">
        <div><dt className="text-slate-500">Total</dt><dd className="font-semibold tabular-nums">{formatINR(bill.totalPaise)}</dd></div>
        <div><dt className="text-slate-500">Paid</dt><dd className="font-semibold tabular-nums">{formatINR(bill.paidPaise)}</dd></div>
        <div>
          <dt className="text-slate-500">Due</dt>
          <dd className={cx('font-semibold tabular-nums', bill.duePaise > 0 && 'text-amber-700')}>{formatINR(bill.duePaise)}</dd>
        </div>
      </dl>
      {bill.giftCardsIssued.length > 0 && (
        <div className="mt-5 rounded-lg bg-brand-50 p-3 text-sm text-brand-800">
          {bill.giftCardsIssued.map((g) => (
            <p key={g.code}>Gift card <span className="font-mono font-semibold">{g.code}</span> · {formatINR(g.initialPaise)}</p>
          ))}
        </div>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={() => window.open(`/bills/${bill.id}/print`, '_blank', 'noopener')}>
          <Printer className="size-4" /> Print
        </Button>
        <Button variant="secondary" onClick={() => window.open(whatsappLink(bill.client.phone, summary), '_blank', 'noopener')}>
          <MessageCircle className="size-4" /> WhatsApp
        </Button>
        <Button onClick={onNew}><Plus className="size-4" /> New bill</Button>
      </div>
    </Card>
  );
}
