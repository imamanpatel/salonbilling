import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { CASH_METHODS, formatINR } from '@salon/shared';
import { pointsAdjustmentSchema, walletTopupSchema } from '@salon/shared/billing';
import { Badge, Button, Field, Input, Select, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, moneyInput } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { useClientAccount } from './hooks.js';
import { BILL_STATUS_LABELS, BILL_STATUS_TONES, METHOD_LABELS } from './labels.js';

/** "Billing & balances" in the client profile: wallet, points, membership, packages, dues and recent bills. */
export default function ClientBillingSection({ client }) {
  const { canManage } = useAuth();
  const account = useClientAccount(client.id);
  const [form, setForm] = useState(null); // 'topup' | 'points'
  const a = account.data;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Billing & balances</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setForm(form === 'topup' ? null : 'topup')}>Top up wallet</Button>
          {canManage && <Button size="sm" variant="ghost" onClick={() => setForm(form === 'points' ? null : 'points')}>Adjust points</Button>}
        </div>
      </div>
      {account.isPending ? (
        <Spinner className="mx-auto my-4" />
      ) : account.error ? (
        <p className="text-sm text-rose-600">{account.error.message}</p>
      ) : (
        <div className="space-y-3">
          {form === 'topup' && <TopupForm clientId={client.id} onDone={() => setForm(null)} />}
          {form === 'points' && <PointsForm clientId={client.id} onDone={() => setForm(null)} />}

          <dl className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-4">
            <Stat label="Wallet" value={formatINR(a.walletBalancePaise)} />
            <Stat label="Reward points" value={`${a.pointsBalance} (${formatINR(Math.floor((Math.max(0, a.pointsBalance) * a.pointValue.valuePaise) / a.pointValue.points))})`} />
            <Stat label="Pending dues" value={formatINR(a.duePaise)} tone={a.duePaise > 0 ? 'text-rose-600' : undefined} />
            <Stat label="Membership" value={a.membership ? `${a.membership.name} · till ${formatDate(a.membership.endsOn)}` : '—'} />
          </dl>

          {a.packages.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {a.packages.map((pkg) => (
                <li key={pkg.id} className="px-3 py-2">
                  <span className="font-medium text-slate-900">{pkg.name}</span>
                  <span className="text-xs text-slate-500"> · expires {formatDate(pkg.expiresOn)}</span>
                  <span className="block text-slate-600">
                    {pkg.items.map((i) => `${i.serviceName}: ${i.totalQty - i.usedQty} of ${i.totalQty} left`).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {a.giftCards.length > 0 && (
            <p className="text-sm text-slate-600">
              Gift cards: {a.giftCards.map((g) => `${g.code} (${formatINR(g.balancePaise)}${g.expiresOn ? `, till ${formatDate(g.expiresOn)}` : ''})`).join(', ')}
            </p>
          )}

          {a.recentBills.length === 0 ? (
            <p className="text-sm text-slate-500">No bills yet.</p>
          ) : (
            <div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                {a.recentBills.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <Link to={`/bills?clientId=${client.id}&view=${b.id}`} className="w-32 font-medium text-slate-900 hover:text-brand-700">{b.number}</Link>
                    <span className="w-28 text-slate-500">{formatDate(b.billedAt)}</span>
                    <span className="flex-1 text-xs text-slate-500">{b.branchName}</span>
                    <span className="tabular-nums">{formatINR(b.totalPaise)}</span>
                    {b.duePaise > 0 && b.status !== 'VOID' && <span className="text-xs text-amber-700 tabular-nums">due {formatINR(b.duePaise)}</span>}
                    <Badge tone={BILL_STATUS_TONES[b.status]}>{BILL_STATUS_LABELS[b.status]}</Badge>
                  </li>
                ))}
              </ul>
              <Link to={`/bills?clientId=${client.id}`} className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">
                All bills of {client.name.split(' ')[0]}
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone = 'text-slate-900' }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-sm font-medium tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

function useRefresh(clientId) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  return (data) => queryClient.setQueryData([branchId, 'client-account', clientId], data);
}

function TopupForm({ clientId, onDone }) {
  const refresh = useRefresh(clientId);
  const form = useApiForm({
    schema: walletTopupSchema,
    defaultValues: { amountPaise: '', method: 'CASH', reference: '' },
    toPayload: (values) => ({ ...values, amountPaise: moneyInput(values.amountPaise) }),
    onSubmit: async (payload) => {
      const data = await api(`/client-accounts/${clientId}/wallet-topups`, { method: 'POST', body: payload });
      toast.success(`Wallet topped up. Balance ${formatINR(data.walletBalancePaise)}`);
      refresh(data);
      onDone();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;
  return (
    <form onSubmit={form.submit} noValidate className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-[8rem_9rem_1fr_auto] sm:items-start">
      <Field label="Amount (₹)" error={errors.amountPaise?.message}>
        <Input autoFocus inputMode="decimal" invalid={!!errors.amountPaise} {...register('amountPaise')} />
      </Field>
      <Field label="Paid by" error={errors.method?.message}>
        <Select {...register('method')}>
          {CASH_METHODS.map((m) => (
            <option key={m} value={m}>{METHOD_LABELS[m]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Reference" error={errors.reference?.message}>
        <Input invalid={!!errors.reference} {...register('reference')} />
      </Field>
      <Button type="submit" className="sm:mt-7" loading={isSubmitting}>Add money</Button>
    </form>
  );
}

function PointsForm({ clientId, onDone }) {
  const refresh = useRefresh(clientId);
  const form = useApiForm({
    schema: pointsAdjustmentSchema,
    defaultValues: { points: '', note: '' },
    onSubmit: async (payload) => {
      const data = await api(`/client-accounts/${clientId}/points-adjustments`, { method: 'POST', body: payload });
      toast.success(`Points updated. Balance ${data.pointsBalance}`);
      refresh(data);
      onDone();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;
  return (
    <form onSubmit={form.submit} noValidate className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-[9rem_1fr_auto] sm:items-start">
      <Field label="Points (+/−)" hint="Use a minus sign to remove" error={errors.points?.message}>
        <Input autoFocus type="number" invalid={!!errors.points} {...register('points')} />
      </Field>
      <Field label="Note" error={errors.note?.message}>
        <Input invalid={!!errors.note} {...register('note')} />
      </Field>
      <Button type="submit" className="sm:mt-7" loading={isSubmitting}>Save</Button>
    </form>
  );
}
