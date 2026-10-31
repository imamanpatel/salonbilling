import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { CalendarCheck, CheckCircle2, Gift, MessageCircle, Plus, Printer, Receipt, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { fieldErrors, formatINR, paiseToRupees, PAYMENT_METHODS } from '@salon/shared';
import { billSchema } from '@salon/shared/billing';
import {
  Badge, Button, Card, CardHeader, Checkbox, cx, EmptyState, Field, Input, PageHeader, Select, Spinner, Tabs, Textarea,
} from '../../components/ui.jsx';
import { api, ApiError } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, moneyInput, whatsappLink } from '../../lib/format.js';
import { useDebounced } from '../../lib/hooks.js';
import ClientPicker from './ClientPicker.jsx';
import { billingKeys, useActiveStaff, useBillCatalogue, useClientAccount } from './hooks.js';
import { ITEM_KIND_LABELS, METHOD_LABELS, needsReference } from './labels.js';

const ADD_TABS = [
  { value: 'SERVICE', label: 'Services' },
  { value: 'PRODUCT', label: 'Products' },
  { value: 'PACKAGE', label: 'Packages' },
  { value: 'MEMBERSHIP', label: 'Memberships' },
  { value: 'GIFT_CARD', label: 'Gift card' },
];

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
  taxRateId: '',
  ...fields,
});
const newPayment = (method = 'CASH') => ({ key: (lineSeq += 1), method, amount: '', reference: '' });

const taxCategory = (kind) => (kind === 'PRODUCT' ? 'PRODUCT' : 'SERVICE');
const isRedemption = (line) => Boolean(line.clientPackageItemId);
const fixedLine = (line) => isRedemption(line) || line.kind === 'GIFT_CARD';

/** POS state -> billSchema payload. Payment rows without an amount are left out (`paymentRows` maps indexes back). */
function toPayload(state) {
  const paymentRows = state.payments.filter((p) => p.amount !== '');
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
        taxRateId: fixedLine(line) ? null : line.taxRateId || null,
      };
    }),
    couponCode: state.couponCode || null,
    manualDiscountPaise: state.manualDiscount.trim() === '' ? 0 : moneyInput(state.manualDiscount),
    redeemPoints: state.redeemPoints.trim() === '' ? 0 : state.redeemPoints,
    payments: paymentRows.map((p) => ({ method: p.method, amountPaise: moneyInput(p.amount), reference: p.reference || null })),
    notes: state.notes || null,
    sendReceipt: state.sendReceipt,
  };
  return { payload, paymentRows };
}

const EMPTY = {
  client: null, lines: [], couponInput: '', couponCode: '', manualDiscount: '', redeemPoints: '',
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

  const appointment = useQuery({
    queryKey: [branchId, 'appointment', appointmentId],
    queryFn: () => api(`/appointments/${appointmentId}`),
    enabled: Boolean(appointmentId),
  });

  const taxes = catalogue.data?.taxes ?? [];
  const defaultTaxId = (kind, product) => {
    const ids = kind === 'PRODUCT' ? [product?.taxRateId, catalogue.data?.defaults.productTaxId] : [catalogue.data?.defaults.serviceTaxId];
    const category = taxCategory(kind);
    return ids.find((id) => id && taxes.some((t) => t.id === id && (t.appliesTo === 'ALL' || t.appliesTo === category))) ?? '';
  };

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
        taxRateId: defaultTaxId('SERVICE'),
      });
    });
    setState((s) => ({ ...s, client: appt.client, lines }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointment.data, catalogue.data]);

  const linkedAppointment = appointmentId && appointment.data && state.client?.id === appointment.data.clientId ? appointment.data : null;
  const { payload, paymentRows } = toPayload({ ...state, appointmentId: linkedAppointment?.id });
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
  const paymentError = (row, name) => {
    const index = paymentRows.indexOf(row);
    return index >= 0 ? errors[`payments.${index}.${name}`] : undefined;
  };

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
    setState({ ...EMPTY, payments: [newPayment()] });
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

  return (
    <>
      <PageHeader
        title="New bill"
        description="Pick the client, add what they had, take payment."
        actions={
          <Button variant="secondary" onClick={() => navigate('/bills')}>
            <Receipt className="size-4" /> All bills
          </Button>
        }
      />

      {appointmentId && appointment.isPending && <Spinner className="mx-auto my-6" />}
      {linkedAppointment && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800">
          <CalendarCheck className="size-4" />
          Billing the appointment on {formatDate(linkedAppointment.date)} at {linkedAppointment.startTime}
          {priced?.advancePaise > 0 && <span className="font-medium">· advance paid {formatINR(priced.advancePaise)}</span>}
        </div>
      )}
      {errors.appointmentId && <p className="mb-4 text-sm text-rose-600">{errors.appointmentId}</p>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Client" />
            <div className="p-5">
              <ClientPicker client={state.client} onChange={setClient} disabled={Boolean(linkedAppointment)} />
              {errors.clientId && <p className="mt-2 text-xs text-rose-600">{errors.clientId}</p>}
            </div>
          </Card>

          <ItemAdder catalogue={catalogue} onAdd={addLine} defaultTaxId={defaultTaxId} />

          <Card>
            <CardHeader title="Items" description={state.lines.length ? undefined : 'Nothing added yet.'} />
            {state.lines.length === 0 ? (
              <EmptyState icon={Receipt} title="Add services or products" description="Use the tabs above, or redeem a package from the client's account." />
            ) : (
              <LinesTable
                lines={state.lines}
                priced={priced}
                taxes={taxes}
                staff={staff.data ?? []}
                errors={errors}
                canManage={canManage}
                onChange={updateLine}
                onRemove={(key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) }))}
              />
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-4">
          {state.client && <AccountPanel clientId={state.client.id} onRedeem={redeem} lines={state.lines} />}
          <Card className="p-4">
            <DiscountsPanel state={state} set={set} errors={errors} priced={priced} />
          </Card>
          <Card className="p-4">
            <Totals priced={priced} fetching={preview.isFetching} ready={Boolean(state.client && state.lines.length)} error={preview.error} />
          </Card>
          <Card className="p-4">
            <PaymentsPanel state={state} set={set} priced={priced} errors={errors} paymentError={paymentError} paymentRows={paymentRows} />
          </Card>
          <Card className="space-y-3 p-4">
            <Field label="Notes" error={errors.notes}>
              <Textarea rows={2} value={state.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
            <Checkbox
              label="Send receipt to client"
              description="WhatsApp/SMS with the bill amount and a feedback link."
              checked={state.sendReceipt}
              onChange={(e) => set({ sendReceipt: e.target.checked })}
            />
            <Button className="w-full" onClick={submit} loading={create.isPending} disabled={!state.client || !state.lines.length}>
              Create bill{priced ? ` · ${formatINR(priced.totalPaise)}` : ''}
            </Button>
          </Card>
        </div>
      </div>
    </>
  );
}

function ItemAdder({ catalogue, onAdd, defaultTaxId }) {
  const [tab, setTab] = useState('SERVICE');
  const [search, setSearch] = useState('');
  const [giftValue, setGiftValue] = useState('');
  const data = catalogue.data;

  const options = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const rows = {
      SERVICE: data.services.map((s) => ({ id: s.id, name: s.name, sub: s.category?.name, pricePaise: s.pricePaise, row: s })),
      PRODUCT: data.products.map((p) => ({ id: p.id, name: p.name, sub: [p.brand, p.barcode].filter(Boolean).join(' · '), pricePaise: p.salePricePaise, row: p })),
      PACKAGE: data.packages.map((p) => ({
        id: p.id, name: p.name, sub: p.items.map((i) => `${i.qty}× ${i.service.name}`).join(', '), pricePaise: p.pricePaise, row: p,
      })),
      MEMBERSHIP: data.membershipPlans.map((p) => ({ id: p.id, name: p.name, sub: `${p.durationDays} days`, pricePaise: p.pricePaise, row: p })),
    }[tab] ?? [];
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.sub?.toLowerCase().includes(q) || r.row.barcode === search.trim());
  }, [data, tab, search]);

  const add = (option) =>
    onAdd(newLine({ kind: tab, refId: option.id, name: option.name, catalogPaise: option.pricePaise, taxRateId: defaultTaxId(tab, option.row) }));

  const addGiftCard = (e) => {
    e.preventDefault();
    if (!giftValue.trim()) return;
    onAdd(newLine({ kind: 'GIFT_CARD', name: 'Gift card', price: giftValue.trim(), catalogPaise: Number(moneyInput(giftValue)) || 0 }));
    setGiftValue('');
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <Tabs tabs={ADD_TABS} value={tab} onChange={(value) => { setTab(value); setSearch(''); }} />
        {tab !== 'GIFT_CARD' && (
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input type="search" placeholder="Search" aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        )}
      </div>
      {tab === 'GIFT_CARD' ? (
        <form onSubmit={addGiftCard} className="flex flex-wrap items-end gap-3 p-5">
          <Field label="Gift card value (₹)" hint="A code is generated when the bill is saved. Valid for one year." className="w-56">
            <Input inputMode="decimal" value={giftValue} onChange={(e) => setGiftValue(e.target.value)} placeholder="e.g. 2000" />
          </Field>
          <Button type="submit" className="mb-5">
            <Gift className="size-4" /> Add gift card
          </Button>
        </form>
      ) : catalogue.isPending ? (
        <Spinner className="mx-auto my-6" />
      ) : catalogue.error ? (
        <p className="p-5 text-sm text-rose-600">{catalogue.error.message}</p>
      ) : options.length === 0 ? (
        <p className="p-5 text-sm text-slate-500">{search ? 'Nothing matches.' : 'Nothing set up here yet.'}</p>
      ) : (
        <ul className="grid max-h-72 gap-1 overflow-y-auto p-3 sm:grid-cols-2">
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => add(option)}
                className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-900">{option.name}</span>
                  {option.sub && <span className="block truncate text-xs text-slate-500">{option.sub}</span>}
                </span>
                <span className="shrink-0 text-slate-700 tabular-nums">{formatINR(option.pricePaise)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LinesTable({ lines, priced, taxes, staff, errors, canManage, onChange, onRemove }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
          <tr>
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Staff</th>
            <th className="px-3 py-2">Qty</th>
            <th className="px-3 py-2">Price (₹)</th>
            <th className="px-3 py-2">Discount</th>
            <th className="px-3 py-2">Tax</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((line, index) => {
            const computed = priced?.lines[index];
            const lineErrors = Object.entries(errors).filter(([key]) => key.startsWith(`items.${index}.`) || key === `items.${index}`);
            const category = taxCategory(line.kind);
            const lineTaxes = taxes.filter((t) => t.appliesTo === 'ALL' || t.appliesTo === category);
            const priceEditable = line.kind === 'GIFT_CARD' || (canManage && !isRedemption(line));
            const shownPrice = computed && computed.kind === line.kind ? computed.unitPricePaise : line.catalogPaise;
            return (
              <tr key={line.key} className="align-top">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{line.name}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    <Badge tone={isRedemption(line) ? 'blue' : 'slate'}>{isRedemption(line) ? 'From package' : ITEM_KIND_LABELS[line.kind]}</Badge>
                    {computed?.memberDiscount && <Badge tone="brand">Member discount</Badge>}
                  </div>
                  {lineErrors.map(([key, message]) => (
                    <p key={key} role="alert" className="mt-1 text-xs text-rose-600">{message}</p>
                  ))}
                </td>
                <td className="px-3 py-2">
                  {line.kind === 'GIFT_CARD' ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <Select aria-label="Staff" value={line.staffId} onChange={(e) => onChange(line.key, { staffId: e.target.value })} className="w-36">
                      <option value="">—</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </Select>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Input
                    aria-label="Quantity"
                    type="number"
                    min={1}
                    disabled={line.kind === 'GIFT_CARD' || line.kind === 'MEMBERSHIP'}
                    value={line.qty}
                    onChange={(e) => onChange(line.key, { qty: e.target.value })}
                    className="w-16"
                  />
                </td>
                <td className="px-3 py-2">
                  {priceEditable ? (
                    <Input
                      aria-label="Unit price"
                      inputMode="decimal"
                      placeholder={paiseToRupees(shownPrice)}
                      value={line.price}
                      onChange={(e) => onChange(line.key, { price: e.target.value })}
                      className="w-24"
                    />
                  ) : (
                    <span className="block py-2 tabular-nums">{formatINR(isRedemption(line) ? 0 : shownPrice)}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {fixedLine(line) ? (
                    <span className="block py-2 text-slate-400">—</span>
                  ) : (
                    <div className="flex w-32">
                      <Input
                        aria-label="Discount"
                        inputMode="decimal"
                        value={line.discount}
                        onChange={(e) => onChange(line.key, { discount: e.target.value })}
                        className="rounded-r-none"
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
                </td>
                <td className="px-3 py-2">
                  {fixedLine(line) ? (
                    <span className="block py-2 text-slate-400">No tax</span>
                  ) : (
                    <Select aria-label="Tax" value={line.taxRateId} onChange={(e) => onChange(line.key, { taxRateId: e.target.value })} className="w-32">
                      <option value="">No tax</option>
                      {lineTaxes.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </Select>
                  )}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                  {computed ? (
                    <>
                      <span className="block font-medium text-slate-900">{formatINR(computed.totalPaise)}</span>
                      {computed.discountPaise > 0 && <span className="block text-xs text-emerald-700">−{formatINR(computed.discountPaise)}</span>}
                      {computed.taxPaise > 0 && <span className="block text-xs text-slate-500">incl. tax {formatINR(computed.taxPaise)}</span>}
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Button variant="ghost" size="icon" onClick={() => onRemove(line.key)} aria-label={`Remove ${line.name}`}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AccountPanel({ clientId, onRedeem, lines }) {
  const account = useClientAccount(clientId);
  const a = account.data;
  if (account.isPending) return <Card className="p-4"><Spinner className="mx-auto" /></Card>;
  if (account.error) return <Card className="p-4 text-sm text-rose-600">{account.error.message}</Card>;

  const inBill = (cpiId) => lines.filter((l) => l.clientPackageItemId === cpiId).reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  return (
    <Card className="space-y-3 p-4 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Wallet" value={formatINR(a.walletBalancePaise)} />
        <Stat label="Points" value={a.pointsBalance} />
        {a.duePaise > 0 && <Stat label="Previous dues" value={formatINR(a.duePaise)} tone="text-rose-600" />}
      </div>
      {a.membership && (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-brand-800">
          <span className="font-medium">{a.membership.name}</span> member until {formatDate(a.membership.endsOn)}
        </p>
      )}
      {a.packages.map((pkg) => (
        <div key={pkg.id} className="rounded-lg border border-slate-200 p-3">
          <p className="font-medium text-slate-900">{pkg.name}</p>
          <p className="mb-2 text-xs text-slate-500">Expires {formatDate(pkg.expiresOn)}</p>
          <ul className="space-y-1">
            {pkg.items.map((item) => {
              const left = item.totalQty - item.usedQty - inBill(item.clientPackageItemId);
              return (
                <li key={item.clientPackageItemId} className="flex items-center justify-between gap-2">
                  <span>{item.serviceName} <span className="text-slate-500">· {left} left</span></span>
                  <Button size="sm" variant="secondary" disabled={left <= 0} onClick={() => onRedeem(pkg, item)}>Redeem</Button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {a.giftCards.length > 0 && (
        <p className="text-xs text-slate-500">
          Gift cards: {a.giftCards.map((g) => `${g.code} (${formatINR(g.balancePaise)})`).join(', ')}
        </p>
      )}
    </Card>
  );
}

function Stat({ label, value, tone = 'text-slate-900' }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cx('font-semibold tabular-nums', tone)}>{value}</p>
    </div>
  );
}

function DiscountsPanel({ state, set, errors, priced }) {
  const pointValue = priced?.pointValue;
  return (
    <div className="space-y-3">
      <Field label="Coupon" error={errors.couponCode} as="div">
        <div className="flex gap-2">
          <Input
            aria-label="Coupon code"
            value={state.couponInput}
            invalid={!!errors.couponCode}
            onChange={(e) => set({ couponInput: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') set({ couponCode: state.couponInput.trim().toUpperCase() });
            }}
            className="uppercase"
          />
          {state.couponCode ? (
            <Button variant="secondary" onClick={() => set({ couponCode: '', couponInput: '' })}>Remove</Button>
          ) : (
            <Button variant="secondary" onClick={() => set({ couponCode: state.couponInput.trim().toUpperCase() })} disabled={!state.couponInput.trim()}>
              Apply
            </Button>
          )}
        </div>
        {priced?.coupon && <span className="mt-1 block text-xs text-emerald-700">{priced.coupon.code} applied: −{formatINR(priced.couponDiscountPaise)}</span>}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Redeem points"
          error={errors.redeemPoints}
          hint={priced ? `${priced.pointsBalance} available${pointValue ? ` · ${pointValue.points} = ${formatINR(pointValue.valuePaise)}` : ''}` : undefined}
        >
          <Input type="number" min={0} value={state.redeemPoints} invalid={!!errors.redeemPoints} onChange={(e) => set({ redeemPoints: e.target.value })} />
        </Field>
        <Field label="Extra discount (₹)" error={errors.manualDiscountPaise}>
          <Input inputMode="decimal" value={state.manualDiscount} invalid={!!errors.manualDiscountPaise} onChange={(e) => set({ manualDiscount: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

function Totals({ priced, fetching, ready, error }) {
  if (!ready) return <p className="text-sm text-slate-500">Pick a client and add items to see the total.</p>;
  if (!priced) {
    return error ? <p className="text-sm text-rose-600">{error.message}</p> : <Spinner className="mx-auto" />;
  }
  const row = (label, value, className) => (
    <div className={cx('flex justify-between gap-3', className)}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
  return (
    <dl className={cx('space-y-1.5 text-sm text-slate-700 transition-opacity', fetching && 'opacity-60')}>
      {row('Subtotal', formatINR(priced.subtotalPaise))}
      {priced.discountPaise > 0 && row('Discounts', `−${formatINR(priced.discountPaise)}`, 'text-emerald-700')}
      {priced.couponDiscountPaise > 0 && row(<span className="pl-3 text-xs">Coupon</span>, <span className="text-xs">−{formatINR(priced.couponDiscountPaise)}</span>)}
      {priced.pointsDiscountPaise > 0 && row(<span className="pl-3 text-xs">{priced.pointsRedeemed} points</span>, <span className="text-xs">−{formatINR(priced.pointsDiscountPaise)}</span>)}
      {priced.manualDiscountPaise > 0 && row(<span className="pl-3 text-xs">Extra</span>, <span className="text-xs">−{formatINR(priced.manualDiscountPaise)}</span>)}
      {priced.taxPaise > 0 && row('Tax (GST)', formatINR(priced.taxPaise))}
      {priced.roundOffPaise !== 0 && row('Round off', formatINR(priced.roundOffPaise))}
      {row('Total', formatINR(priced.totalPaise), 'border-t border-slate-200 pt-2 text-base font-semibold text-slate-900')}
      {priced.advancePaise > 0 && row('Advance paid', `−${formatINR(priced.advancePaise)}`)}
      {row('Balance due', formatINR(priced.duePaise), priced.duePaise > 0 ? 'font-medium text-amber-700' : 'text-emerald-700')}
      {priced.pointsEarned > 0 && <p className="pt-1 text-xs text-slate-500">Client earns {priced.pointsEarned} points.</p>}
      {error && <p className="text-xs text-rose-600">{error.message}</p>}
    </dl>
  );
}

function PaymentsPanel({ state, set, priced, errors, paymentError, paymentRows }) {
  const update = (key, patch) => set((s) => ({ payments: s.payments.map((p) => (p.key === key ? { ...p, ...patch } : p)) }));
  const payBalance = (key) => {
    if (!priced) return;
    const others = state.payments.filter((p) => p.key !== key).reduce((sum, p) => sum + (Number(moneyInput(p.amount)) || 0), 0);
    update(key, { amount: paiseToRupees(Math.max(0, priced.totalPaise - priced.advancePaise - others)) });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Payment</h3>
        <Button size="sm" variant="ghost" onClick={() => set((s) => ({ payments: [...s.payments, newPayment('UPI')] }))}>
          <Plus className="size-3.5" /> Split
        </Button>
      </div>
      {state.payments.map((p) => (
        <div key={p.key} className="space-y-2 rounded-lg bg-slate-50 p-2.5">
          <div className="flex gap-2">
            <Select aria-label="Payment method" value={p.method} onChange={(e) => update(p.key, { method: e.target.value })} className="w-36">
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{METHOD_LABELS[m]}</option>
              ))}
            </Select>
            <Input
              aria-label="Amount (₹)"
              inputMode="decimal"
              placeholder="Amount ₹"
              value={p.amount}
              invalid={!!paymentError(p, 'amountPaise')}
              onChange={(e) => update(p.key, { amount: e.target.value })}
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
              placeholder={p.method === 'GIFT_CARD' ? 'Gift card code' : 'Reference / transaction id'}
              value={p.reference}
              invalid={!!paymentError(p, 'reference')}
              onChange={(e) => update(p.key, { reference: e.target.value })}
            />
          )}
          {[paymentError(p, 'amountPaise'), paymentError(p, 'reference'), paymentError(p, 'method')].filter(Boolean).map((message) => (
            <p key={message} role="alert" className="text-xs text-rose-600">{message}</p>
          ))}
          <button type="button" className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50" disabled={!priced} onClick={() => payBalance(p.key)}>
            Pay balance
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
