import { useParams } from 'react-router';
import { ArrowLeft, Printer } from 'lucide-react';
import { formatINR } from '@salon/shared';
import { Button, Spinner } from '../../components/ui.jsx';
import { formatDateTime } from '../../lib/format.js';
import { useBill } from './BillDetailModal.jsx';
import { METHOD_LABELS } from './labels.js';

/** Printable tax invoice (A4 / thermal-friendly), rendered without the app layout. */
export default function PrintBillPage() {
  const { id } = useParams();
  const bill = useBill(id);

  if (bill.isPending) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner className="size-8" />
      </div>
    );
  }
  if (bill.error) return <p className="p-8 text-center text-sm text-rose-600">{bill.error.message}</p>;

  const b = bill.data;
  const shop = b.branch;
  const discount = b.items.some((i) => i.discountPaise > 0);
  const tax = b.taxPaise > 0;

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-3xl justify-between gap-2 px-4 print:hidden">
        <Button variant="ghost" onClick={() => (window.history.length > 1 ? window.history.back() : window.close())}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" /> Print
        </Button>
      </div>

      <article className="mx-auto max-w-3xl bg-white p-8 text-sm text-slate-800 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-300 pb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{shop.salonName}</h1>
            <p className="text-slate-600">{shop.name}</p>
            {shop.address && <p className="max-w-xs whitespace-pre-line text-slate-600">{shop.address}</p>}
            <p className="text-slate-600">{[shop.phone, shop.email].filter(Boolean).join(' · ')}</p>
            {shop.gstin && <p className="font-medium">GSTIN: {shop.gstin}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold tracking-wide uppercase">{tax ? 'Tax invoice' : 'Invoice'}</p>
            <p>No. <span className="font-semibold">{b.number}</span></p>
            <p>{formatDateTime(b.billedAt)}</p>
            {b.status === 'VOID' && <p className="mt-1 font-bold text-rose-600">VOID — {b.voidReason}</p>}
          </div>
        </header>

        <section className="border-b border-slate-300 py-3">
          <p className="text-xs text-slate-500 uppercase">Billed to</p>
          <p className="font-medium text-slate-900">{b.client.name}</p>
          <p>{b.client.phone}</p>
          {b.client.address && <p className="text-slate-600">{b.client.address}</p>}
        </section>

        <table className="mt-3 w-full text-left">
          <thead className="border-b border-slate-300 text-xs text-slate-500 uppercase">
            <tr>
              <th className="py-1.5 pr-2">#</th>
              <th className="py-1.5 pr-2">Item</th>
              <th className="py-1.5 pr-2 text-right">Qty</th>
              <th className="py-1.5 pr-2 text-right">Rate</th>
              {discount && <th className="py-1.5 pr-2 text-right">Discount</th>}
              {tax && <th className="py-1.5 pr-2 text-right">Taxable</th>}
              {tax && <th className="py-1.5 pr-2 text-right">GST</th>}
              <th className="py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 tabular-nums">
            {b.items.map((item, index) => (
              <tr key={item.id} className="align-top">
                <td className="py-1.5 pr-2">{index + 1}</td>
                <td className="py-1.5 pr-2">
                  {item.name}
                  {item.staff && <span className="block text-xs text-slate-500">by {item.staff.name}</span>}
                </td>
                <td className="py-1.5 pr-2 text-right">{item.qty}</td>
                <td className="py-1.5 pr-2 text-right">{formatINR(item.unitPricePaise)}</td>
                {discount && <td className="py-1.5 pr-2 text-right">{item.discountPaise ? `−${formatINR(item.discountPaise)}` : '—'}</td>}
                {tax && <td className="py-1.5 pr-2 text-right">{formatINR(item.taxablePaise)}</td>}
                {tax && <td className="py-1.5 pr-2 text-right">{item.taxPaise ? `${formatINR(item.taxPaise)} (${item.taxPct}%)` : '—'}</td>}
                <td className="py-1.5 text-right font-medium">{formatINR(item.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex flex-wrap justify-between gap-6 border-t border-slate-300 pt-3">
          <div className="min-w-56 flex-1">
            {b.taxBreakdown.length > 0 && (
              <table className="w-full text-xs tabular-nums">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left font-medium">GST rate</th>
                    <th className="text-right font-medium">Taxable</th>
                    <th className="text-right font-medium">CGST</th>
                    <th className="text-right font-medium">SGST</th>
                  </tr>
                </thead>
                <tbody>
                  {b.taxBreakdown.map((g) => (
                    <tr key={g.ratePct}>
                      <td>{g.ratePct}%</td>
                      <td className="text-right">{formatINR(g.taxablePaise)}</td>
                      <td className="text-right">{formatINR(g.cgstPaise)} ({g.ratePct / 2}%)</td>
                      <td className="text-right">{formatINR(g.sgstPaise)} ({g.ratePct / 2}%)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {b.payments.length > 0 && (
              <div className="mt-3 text-xs">
                <p className="mb-1 font-medium text-slate-500 uppercase">Payments</p>
                {b.payments.map((p) => (
                  <p key={p.id} className="tabular-nums">
                    {METHOD_LABELS[p.method]}{p.reference ? ` (${p.reference})` : ''}: {formatINR(p.amountPaise)}
                  </p>
                ))}
              </div>
            )}
          </div>
          <dl className="w-64 space-y-1 tabular-nums">
            <Line label="Subtotal" value={formatINR(b.subtotalPaise)} />
            {b.discountPaise > 0 && <Line label="Discount" value={`−${formatINR(b.discountPaise)}`} />}
            {b.couponCode && <Line label={`Coupon ${b.couponCode}`} value={`−${formatINR(b.couponDiscountPaise)}`} small />}
            {b.pointsRedeemed > 0 && <Line label={`${b.pointsRedeemed} points`} value={`−${formatINR(b.pointsDiscountPaise)}`} small />}
            {tax && <Line label="CGST" value={formatINR(b.gst.cgstPaise)} />}
            {tax && <Line label="SGST" value={formatINR(b.gst.sgstPaise)} />}
            {b.roundOffPaise !== 0 && <Line label="Round off" value={formatINR(b.roundOffPaise)} />}
            <Line label="Total" value={formatINR(b.totalPaise)} strong />
            <Line label="Paid" value={formatINR(b.paidPaise)} />
            {b.duePaise > 0 && b.status !== 'VOID' && <Line label="Balance due" value={formatINR(b.duePaise)} strong />}
          </dl>
        </div>

        {b.giftCardsIssued.length > 0 && (
          <p className="mt-4 text-xs">
            Gift card{b.giftCardsIssued.length > 1 ? 's' : ''}: {b.giftCardsIssued.map((g) => `${g.code} (${formatINR(g.initialPaise)})`).join(', ')}
          </p>
        )}
        {b.pointsEarned > 0 && <p className="mt-2 text-xs text-slate-600">You earned {b.pointsEarned} reward points on this visit.</p>}
        <p className="mt-6 border-t border-slate-300 pt-3 text-center text-slate-600">Thank you for visiting {shop.salonName}! We hope to see you again soon.</p>
      </article>
    </div>
  );
}

function Line({ label, value, strong, small }) {
  return (
    <div className={strong ? 'flex justify-between border-t border-slate-300 pt-1 font-semibold text-slate-900' : small ? 'flex justify-between pl-3 text-xs text-slate-600' : 'flex justify-between'}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
