import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { CASH_METHODS, formatINR, paiseToRupees } from '@salon/shared';
import { SALARY_KINDS, salaryEntrySchema } from '@salon/shared/hr';
import { Badge, Button, Card, cx, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, moneyInput, todayIso } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { formatMonth, METHOD_LABELS, SALARY_KIND_LABELS, SALARY_KIND_TONES, thisMonth } from './labels.js';

const COLUMNS = [
  { key: 'salary', header: 'Salary', value: (r) => r.monthlySalaryPaise },
  { key: 'commission', header: 'Commission', value: (r) => r.commissionPaise },
  { key: 'advances', header: 'Advances', value: (r) => r.totalsByKind.ADVANCE },
  { key: 'extras', header: 'Incentive + bonus', value: (r) => r.totalsByKind.INCENTIVE + r.totalsByKind.BONUS },
  { key: 'deductions', header: 'Deductions', value: (r) => r.totalsByKind.DEDUCTION },
  { key: 'paid', header: 'Salary paid', value: (r) => r.paidSalaryPaise },
  { key: 'payable', header: 'Payable', value: (r) => r.suggestedPayablePaise },
];
const TH = 'px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-500 uppercase';

export default function SalariesPage() {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const [paying, setPaying] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  const salaries = useQuery({ queryKey: [branchId, 'salaries', month], queryFn: () => api(`/salaries?month=${month}`), enabled: Boolean(month) });

  const remove = useMutation({
    mutationFn: (id) => api(`/salaries/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Entry deleted');
      queryClient.invalidateQueries({ queryKey: [branchId, 'salaries'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const toggle = (id) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = salaries.data ?? [];
  const totals = COLUMNS.map((c) => rows.reduce((sum, r) => sum + c.value(r), 0));

  let body;
  if (salaries.isPending) {
    body = (
      <tr>
        <td colSpan={COLUMNS.length + 2} className="py-12">
          <Spinner className="mx-auto" />
        </td>
      </tr>
    );
  } else if (salaries.error) {
    body = (
      <tr>
        <td colSpan={COLUMNS.length + 2} className="px-4 py-12 text-center text-sm text-rose-600">{salaries.error.message}</td>
      </tr>
    );
  } else if (!rows.length) {
    body = (
      <tr>
        <td colSpan={COLUMNS.length + 2}>
          <EmptyState icon={Wallet} title="No staff to pay" description="Active staff appear here with their salary for the month." />
        </td>
      </tr>
    );
  } else {
    body = rows.map((r) => {
      const open = expanded.has(r.staff.id);
      return (
        <Fragment key={r.staff.id}>
          <tr className="hover:bg-slate-50/70">
            <td className="px-4 py-3">
              <button type="button" onClick={() => toggle(r.staff.id)} aria-expanded={open} className="flex items-start gap-1.5 text-left">
                {open ? <ChevronDown className="mt-0.5 size-4 text-slate-400" /> : <ChevronRight className="mt-0.5 size-4 text-slate-400" />}
                <span>
                  <span className="block font-medium text-slate-900">{r.staff.name}</span>
                  <span className="block text-xs text-slate-500">
                    {r.entries.length} {r.entries.length === 1 ? 'entry' : 'entries'}
                    {r.staff.branchId !== branchId ? ' · moved to another branch' : !r.staff.isActive ? ' · inactive' : ''}
                  </span>
                </span>
              </button>
            </td>
            {COLUMNS.map((c) => (
              <td
                key={c.key}
                className={cx('px-4 py-3 text-right whitespace-nowrap tabular-nums', c.key === 'payable' ? 'font-semibold text-slate-900' : 'text-slate-700')}
              >
                {formatINR(c.value(r))}
              </td>
            ))}
            <td className="px-4 py-3 text-right">
              <Button variant="secondary" size="sm" onClick={() => setPaying(r)}>
                <Plus className="size-3.5" /> Record payment
              </Button>
            </td>
          </tr>
          {open && (
            <tr>
              <td colSpan={COLUMNS.length + 2} className="bg-slate-50/70 px-4 py-3">
                {r.entries.length ? (
                  <ul className="divide-y divide-slate-200/70 rounded-lg border border-slate-200 bg-white">
                    {r.entries.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
                        <span className="w-28 text-slate-600 tabular-nums">{formatDate(e.paidOn)}</span>
                        <Badge tone={SALARY_KIND_TONES[e.kind]}>{SALARY_KIND_LABELS[e.kind]}</Badge>
                        <span className="text-slate-500">{METHOD_LABELS[e.method] ?? e.method}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-500">{e.note}</span>
                        <span className="font-medium text-slate-900 tabular-nums">{formatINR(e.amountPaise)}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Delete ${SALARY_KIND_LABELS[e.kind]} of ${formatINR(e.amountPaise)}`}
                          disabled={remove.isPending}
                          onClick={() => {
                            if (window.confirm(`Delete this ${SALARY_KIND_LABELS[e.kind].toLowerCase()} entry of ${formatINR(e.amountPaise)}?`)) remove.mutate(e.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">Nothing recorded for {formatMonth(month)} yet.</p>
                )}
              </td>
            </tr>
          )}
        </Fragment>
      );
    });
  }

  return (
    <>
      <PageHeader title="Salaries" description="Monthly salary, commission, advances and payments for each staff member." />
      <Card>
        <div className="flex flex-wrap items-end gap-4 border-b border-slate-100 p-4">
          <Field label="Month" className="w-48">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <p className="mb-2 max-w-md text-xs text-slate-500">
            Payable = salary + commission + incentives + bonus − advances − deductions − salary already paid.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className={cx(TH, 'text-left')}>Staff</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className={cx(TH, 'text-right whitespace-nowrap')}>{c.header}</th>
                ))}
                <th scope="col" className={TH}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">{body}</tbody>
            {rows.length > 1 && (
              <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                <tr>
                  <td className="px-4 py-3">Total</td>
                  {totals.map((t, i) => (
                    <td key={COLUMNS[i].key} className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{formatINR(t)}</td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
      {paying && <PaymentModal row={paying} month={month} onClose={() => setPaying(null)} />}
    </>
  );
}

function PaymentModal({ row, month, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();

  const form = useApiForm({
    schema: salaryEntrySchema,
    defaultValues: {
      kind: 'SALARY',
      amountPaise: row.suggestedPayablePaise > 0 ? paiseToRupees(row.suggestedPayablePaise) : '',
      method: 'CASH',
      paidOn: todayIso(),
      note: '',
    },
    toPayload: (values) => ({ ...values, staffId: row.staff.id, forMonth: month, amountPaise: moneyInput(values.amountPaise) }),
    onSubmit: async (payload) => {
      await api('/salaries', { method: 'POST', body: payload });
      toast.success(`${SALARY_KIND_LABELS[payload.kind]} of ${formatINR(payload.amountPaise)} recorded for ${row.staff.name}`);
      queryClient.invalidateQueries({ queryKey: [branchId, 'salaries'] });
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={`Record payment · ${row.staff.name}`}
      description={`For ${formatMonth(month)}. Suggested payable: ${formatINR(row.suggestedPayablePaise)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="salary-form" loading={isSubmitting}>Save entry</Button>
        </>
      }
    >
      <form id="salary-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" error={errors.kind?.message} required>
          <Select invalid={!!errors.kind} {...register('kind')}>
            {SALARY_KINDS.map((k) => (
              <option key={k} value={k}>{SALARY_KIND_LABELS[k]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (₹)" error={errors.amountPaise?.message} required>
          <Input inputMode="decimal" placeholder="0.00" invalid={!!errors.amountPaise} {...register('amountPaise')} />
        </Field>
        <Field label="Paid by" error={errors.method?.message} required>
          <Select invalid={!!errors.method} {...register('method')}>
            {CASH_METHODS.map((m) => (
              <option key={m} value={m}>{METHOD_LABELS[m]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Date" error={errors.paidOn?.message} required>
          <Input type="date" invalid={!!errors.paidOn} {...register('paidOn')} />
        </Field>
        <Field label="Note" error={errors.note?.message} className="sm:col-span-2">
          <Textarea rows={2} invalid={!!errors.note} {...register('note')} />
        </Field>
        <p className="text-xs text-slate-500 sm:col-span-2">
          Deductions reduce what is payable; record them without paying anything out.
        </p>
      </form>
    </Modal>
  );
}
