import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR, paiseToRupees, PAYMENT_METHODS } from '@salon/shared';
import { billPaymentSchema, voidBillSchema } from '@salon/shared/billing';
import { Badge, Button, Field, Input, Modal, Select, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDateTime, moneyInput } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { billingKeys } from './hooks.js';
import { BILL_STATUS_LABELS, BILL_STATUS_TONES, ITEM_KIND_LABELS, METHOD_LABELS, needsReference, PAYMENT_KIND_LABELS } from './labels.js';

export function useBill(billId) {
  const { branchId } = useAuth();
  return useQuery({ queryKey: [branchId, 'bill', billId], queryFn: () => api(`/bills/${billId}`), enabled: Boolean(billId) });
}

export default function BillDetailModal({ billId, onClose }) {
  const { canManage } = useAuth();
  const bill = useBill(billId);
  const [voiding, setVoiding] = useState(false);
  const b = bill.data;

  return (
    <Modal
      title={b ? `Bill ${b.number}` : 'Bill'}
      description={b ? `${b.client.name} · ${formatDateTime(b.billedAt)} · by ${b.createdBy.name}` : undefined}
      size="xl"
      focusForm={false}
      onClose={onClose}
      footer={
        <>
          {b && canManage && b.status !== 'VOID' && !voiding && (
            <Button variant="ghost" className="mr-auto text-rose-600" onClick={() => setVoiding(true)}>
              <Ban className="size-4" /> Void bill
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {b && (
            <Button onClick={() => window.open(`/bills/${b.id}/print`, '_blank', 'noopener')}>
              <Printer className="size-4" /> Print
            </Button>
          )}
        </>
      }
    >
      {bill.isPending ? (
        <Spinner className="mx-auto my-10" />
      ) : bill.error ? (
        <p className="text-sm text-rose-600">{bill.error.message}</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={BILL_STATUS_TONES[b.status]}>{BILL_STATUS_LABELS[b.status]}</Badge>
            {b.couponCode && <Badge tone="brand">Coupon {b.couponCode}</Badge>}
            {b.appointment && <Badge tone="blue">From appointment</Badge>}
            {b.status === 'VOID' && <span className="text-sm text-slate-600">Voided {formatDateTime(b.voidedAt)}: {b.voidReason}</span>}
          </div>

          {voiding && <VoidForm bill={b} onDone={() => setVoiding(false)} />}

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Staff</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Discount</th>
                  <th className="px-3 py-2 text-right">Tax</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {b.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-900">{item.name}</span>
                      <span className="block text-xs text-slate-500">{ITEM_KIND_LABELS[item.kind]}</span>
                    </td>
                    <td className="px-3 py-2">{item.staff?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{item.qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(item.unitPricePaise)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{item.discountPaise ? `−${formatINR(item.discountPaise)}` : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{item.taxPaise ? `${formatINR(item.taxPaise)} (${item.taxPct}%)` : '—'}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{formatINR(item.totalPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Payments</h3>
              {b.payments.length === 0 ? (
                <p className="text-sm text-slate-500">No payments yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                  {b.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span>
                        {METHOD_LABELS[p.method]}
                        {p.reference && <span className="text-slate-500"> · {p.reference}</span>}
                        <span className="block text-xs text-slate-500">{PAYMENT_KIND_LABELS[p.kind]} · {formatDateTime(p.receivedAt)}</span>
                      </span>
                      <span className="font-medium tabular-nums">{formatINR(p.amountPaise)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {b.giftCardsIssued.length > 0 && (
                <p className="mt-3 text-sm text-slate-600">
                  Gift cards issued: {b.giftCardsIssued.map((g) => `${g.code} (${formatINR(g.balancePaise)} left)`).join(', ')}
                </p>
              )}
            </section>
            <section>
              <dl className="space-y-1.5 text-sm text-slate-700">
                <Row label="Subtotal" value={formatINR(b.subtotalPaise)} />
                {b.discountPaise > 0 && <Row label="Discounts" value={`−${formatINR(b.discountPaise)}`} />}
                {b.pointsRedeemed > 0 && <Row label={`incl. ${b.pointsRedeemed} points`} value={`−${formatINR(b.pointsDiscountPaise)}`} small />}
                {b.couponDiscountPaise > 0 && <Row label="incl. coupon" value={`−${formatINR(b.couponDiscountPaise)}`} small />}
                {b.taxPaise > 0 && <Row label="Tax" value={formatINR(b.taxPaise)} />}
                {b.roundOffPaise !== 0 && <Row label="Round off" value={formatINR(b.roundOffPaise)} />}
                <Row label="Total" value={formatINR(b.totalPaise)} strong />
                <Row label="Paid" value={formatINR(b.paidPaise)} />
                <Row label="Due" value={formatINR(b.duePaise)} strong={b.duePaise > 0} />
                {b.pointsEarned > 0 && <p className="pt-1 text-xs text-slate-500">{b.pointsEarned} points earned.</p>}
              </dl>
              {b.notes && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{b.notes}</p>}
            </section>
          </div>

          {b.status !== 'VOID' && b.duePaise > 0 && <CollectDueForm bill={b} />}
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value, strong, small }) {
  return (
    <div className={strong ? 'flex justify-between font-semibold text-slate-900' : small ? 'flex justify-between pl-3 text-xs' : 'flex justify-between'}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function refresh(queryClient, branchId, bill) {
  billingKeys(branchId, bill.clientId).forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
}

function CollectDueForm({ bill }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const form = useApiForm({
    schema: billPaymentSchema,
    defaultValues: { method: 'CASH', amountPaise: paiseToRupees(bill.duePaise), reference: '' },
    toPayload: (values) => ({ ...values, amountPaise: moneyInput(values.amountPaise) }),
    onSubmit: async (payload) => {
      const updated = await api(`/bills/${bill.id}/payments`, { method: 'POST', body: payload });
      toast.success(updated.duePaise ? `Collected. ${formatINR(updated.duePaise)} still due.` : 'Bill fully paid');
      queryClient.setQueryData([branchId, 'bill', bill.id], updated);
      refresh(queryClient, branchId, bill);
      form.reset({ method: 'CASH', amountPaise: paiseToRupees(updated.duePaise), reference: '' });
    },
  });
  const { register, watch, formState: { errors, isSubmitting } } = form;
  const method = watch('method');

  return (
    <form onSubmit={form.submit} noValidate className="grid gap-3 rounded-lg bg-amber-50 p-4 sm:grid-cols-[9rem_9rem_1fr_auto] sm:items-start">
      <p className="text-sm font-semibold text-amber-900 sm:col-span-4">Collect due · {formatINR(bill.duePaise)}</p>
      <Field label="Method" error={errors.method?.message}>
        <Select {...register('method')}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>{METHOD_LABELS[m]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Amount (₹)" error={errors.amountPaise?.message}>
        <Input inputMode="decimal" invalid={!!errors.amountPaise} {...register('amountPaise')} />
      </Field>
      <Field label={method === 'GIFT_CARD' ? 'Gift card code' : 'Reference'} error={errors.reference?.message}>
        <Input disabled={!needsReference(method)} invalid={!!errors.reference} {...register('reference')} />
      </Field>
      <Button type="submit" className="sm:mt-7" loading={isSubmitting}>Collect</Button>
    </form>
  );
}

function VoidForm({ bill, onDone }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const form = useApiForm({
    schema: voidBillSchema,
    defaultValues: { reason: '' },
    onSubmit: async (payload) => {
      const updated = await api(`/bills/${bill.id}/void`, { method: 'POST', body: payload });
      toast.success(`Bill ${updated.number} voided`);
      queryClient.setQueryData([branchId, 'bill', bill.id], updated);
      refresh(queryClient, branchId, bill);
      onDone();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <form onSubmit={form.submit} noValidate className="space-y-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
      <p className="text-sm text-rose-800">
        Voiding refunds wallet and gift card payments, reverses points and stock, and cancels packages, memberships and gift cards sold on
        this bill. Cash and card refunds are handled at the counter.
      </p>
      <Field label="Reason" error={errors.reason?.message} required>
        <Input autoFocus invalid={!!errors.reason} {...register('reason')} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" loading={isSubmitting}>Void bill</Button>
        <Button variant="ghost" onClick={onDone}>Keep bill</Button>
      </div>
    </form>
  );
}
