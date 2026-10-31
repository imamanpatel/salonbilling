import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR } from '@salon/shared';
import { staffTransferSchema } from '@salon/shared/hr';
import { Button, DataTable, EmptyState, Field, Modal, Select } from '../../components/ui.jsx';
import { api, ApiError } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, todayIso } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { formatMonth, thisMonth } from './labels.js';

// Staff page actions for managers (M6): move a staff member to another branch, and this month's commission.

export function TransferModal({ member, onClose }) {
  const { branchId, branches } = useAuth();
  const queryClient = useQueryClient();
  const [blocked, setBlocked] = useState('');
  const options = branches.filter((b) => b.id !== branchId);

  const form = useApiForm({
    schema: staffTransferSchema,
    defaultValues: { toBranchId: options[0]?.id ?? '' },
    onSubmit: async (payload) => {
      setBlocked('');
      try {
        await api(`/staff/${member.id}/transfer`, { method: 'POST', body: payload });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setBlocked(err.message);
          return;
        }
        throw err;
      }
      const target = options.find((b) => b.id === payload.toBranchId);
      toast.success(`${member.name} moved to ${target?.name ?? 'the new branch'}`);
      queryClient.invalidateQueries({ queryKey: [branchId, 'staff'] });
      queryClient.invalidateQueries({ queryKey: [payload.toBranchId, 'staff'] });
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={`Transfer ${member.name}`}
      description="Past attendance, salary and bills stay with this branch."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {options.length > 0 && <Button type="submit" form="transfer-form" loading={isSubmitting}>Transfer</Button>}
        </>
      }
    >
      {options.length ? (
        <form id="transfer-form" onSubmit={form.submit} noValidate className="space-y-4">
          <Field label="Move to branch" error={errors.toBranchId?.message} required>
            <Select invalid={!!errors.toBranchId} {...register('toBranchId', { onChange: () => setBlocked('') })}>
              {options.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
          {blocked && (
            <p role="alert" className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {blocked}
            </p>
          )}
        </form>
      ) : (
        <p className="text-sm text-slate-600">There is no other branch you can move staff to.</p>
      )}
    </Modal>
  );
}

const KIND_LABELS = { SERVICE: 'Service', PRODUCT: 'Product', PACKAGE: 'Package', MEMBERSHIP: 'Membership', GIFT_CARD: 'Gift card' };

export function CommissionModal({ member, onClose }) {
  const { branchId } = useAuth();
  const month = thisMonth();
  const from = `${month}-01`;
  const to = todayIso();
  const commission = useQuery({
    queryKey: [branchId, 'commissions', member.id, from, to],
    queryFn: () => api(`/commissions/${member.id}?${new URLSearchParams({ from, to })}`),
  });
  const summary = commission.data?.summary;

  const stats = summary && [
    ['Services done', summary.servicesCount],
    ['Service sales', formatINR(summary.serviceSalesPaise)],
    ['Product sales', formatINR(summary.productSalesPaise)],
    ['Commission', formatINR(summary.commissionPaise)],
  ];

  const columns = [
    { key: 'date', header: 'Date', className: 'whitespace-nowrap', render: (l) => formatDate(l.date) },
    { key: 'billNumber', header: 'Bill', className: 'whitespace-nowrap' },
    {
      key: 'name',
      header: 'Item',
      render: (l) => (
        <div>
          <div className="text-slate-900">{l.name}</div>
          <div className="text-xs text-slate-500">{KIND_LABELS[l.kind] ?? l.kind}</div>
        </div>
      ),
    },
    { key: 'qty', header: 'Qty', className: 'text-right tabular-nums' },
    { key: 'taxable', header: 'Taxable', className: 'text-right whitespace-nowrap tabular-nums', render: (l) => formatINR(l.taxablePaise) },
    { key: 'commission', header: 'Commission', className: 'text-right whitespace-nowrap tabular-nums font-medium', render: (l) => formatINR(l.commissionPaise) },
  ];

  return (
    <Modal
      title={`${member.name} · commission`}
      description={`${formatMonth(month)}, up to ${formatDate(to)}. Void bills are not counted.`}
      onClose={onClose}
      size="xl"
      focusForm={false}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {stats && (
        <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 px-3 py-2">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="mt-0.5 text-base font-semibold text-slate-900 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="-mx-6">
        <DataTable
          columns={columns}
          rows={commission.data?.lines}
          loading={commission.isPending}
          error={commission.error}
          empty={<EmptyState icon={Receipt} title="No billed items this month" />}
        />
      </div>
    </Modal>
  );
}
