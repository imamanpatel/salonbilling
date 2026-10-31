import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR, paiseToRupees } from '@salon/shared';
import { couponSchema } from '@salon/shared/catalogue';
import { Badge, Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, StatusBadge } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { moneyInput } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { discountLabel, STATUS_FILTERS, validityLabel } from './format.js';

export default function CouponsPage() {
  const { branchId, canManage } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('active');
  const [editing, setEditing] = useState(null); // null | {} (new) | coupon

  const coupons = useQuery({ queryKey: [branchId, 'coupons', { status }], queryFn: () => api(`/coupons?status=${status}`) });

  const toggleStatus = useMutation({
    mutationFn: (coupon) => api(`/coupons/${coupon.id}/status`, { method: 'PATCH', body: { isActive: !coupon.isActive } }),
    onSuccess: (coupon) => {
      toast.success(`${coupon.code} ${coupon.isActive ? 'activated' : 'deactivated'}`);
      queryClient.invalidateQueries({ queryKey: [branchId, 'coupons'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const columns = [
    {
      key: 'code',
      header: 'Code',
      render: (c) => (
        <div className="max-w-xs">
          <div className="font-mono font-semibold text-slate-900">{c.code}</div>
          {c.description && <div className="truncate text-xs text-slate-500">{c.description}</div>}
        </div>
      ),
    },
    { key: 'discount', header: 'Discount', render: (c) => discountLabel(c) },
    { key: 'minBill', header: 'Min bill', className: 'text-right tabular-nums', render: (c) => (c.minBillPaise ? formatINR(c.minBillPaise) : '—') },
    {
      key: 'validity',
      header: 'Valid',
      render: (c) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>{validityLabel(c.validFrom, c.validTo)}</span>
          {c.expired && <Badge tone="amber">Expired</Badge>}
        </div>
      ),
    },
    {
      key: 'used',
      header: 'Used',
      render: (c) => (
        <div className="tabular-nums">
          <div>{c.totalUsageLimit ? `${c.usedCount} / ${c.totalUsageLimit}` : c.usedCount}</div>
          {c.usageLimitPerClient && <div className="text-xs text-slate-500">{c.usageLimitPerClient}× per client</div>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (c) => <StatusBadge active={c.isActive} /> },
  ];
  if (canManage) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (c) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toggleStatus.mutate(c)} disabled={toggleStatus.isPending}>
            {c.isActive ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Coupons"
        description="Discount codes the front desk can apply at billing."
        actions={
          canManage && (
            <Button onClick={() => setEditing({})}>
              <Plus className="size-4" /> Add coupon
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-wrap justify-end gap-3 border-b border-slate-100 p-4">
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-auto">
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={coupons.data}
          loading={coupons.isPending}
          error={coupons.error}
          empty={
            status !== 'active' ? (
              <EmptyState title="No coupons match this filter" />
            ) : (
              <EmptyState
                icon={BadgePercent}
                title="No coupons yet"
                description="Create codes like DIWALI10 for festive offers or first-visit discounts."
                action={canManage && <Button onClick={() => setEditing({})}>Add coupon</Button>}
              />
            )
          }
        />
      </Card>

      {editing && <CouponFormModal coupon={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CouponFormModal({ coupon, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const isNew = !coupon.id;

  const form = useApiForm({
    schema: couponSchema,
    defaultValues: {
      code: coupon.code ?? '',
      description: coupon.description ?? '',
      discountType: coupon.discountType ?? 'PERCENT',
      discountPct: coupon.discountPct ?? '',
      discountPaise: coupon.discountPaise == null ? '' : paiseToRupees(coupon.discountPaise),
      minBillPaise: coupon.minBillPaise ? paiseToRupees(coupon.minBillPaise) : '',
      maxDiscountPaise: coupon.maxDiscountPaise == null ? '' : paiseToRupees(coupon.maxDiscountPaise),
      validFrom: coupon.validFrom ?? '',
      validTo: coupon.validTo ?? '',
      usageLimitPerClient: coupon.usageLimitPerClient ?? '',
      totalUsageLimit: coupon.totalUsageLimit ?? '',
    },
    toPayload: (values) => {
      const percent = values.discountType === 'PERCENT';
      return {
        ...values,
        // Fields of the other discount type are hidden, so they are dropped rather than validated.
        discountPct: percent ? values.discountPct : null,
        discountPaise: percent ? null : moneyInput(values.discountPaise),
        maxDiscountPaise: percent ? moneyInput(values.maxDiscountPaise) : null,
        minBillPaise: moneyInput(values.minBillPaise) ?? 0,
        isActive: coupon.isActive ?? true,
      };
    },
    onSubmit: async (payload) => {
      await api(isNew ? '/coupons' : `/coupons/${coupon.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? `Coupon ${payload.code} added` : 'Coupon updated');
      queryClient.invalidateQueries({ queryKey: [branchId, 'coupons'] });
      onClose();
    },
  });
  const { register, watch, formState: { errors, isSubmitting } } = form;
  const isPercent = watch('discountType') === 'PERCENT';

  return (
    <Modal
      title={isNew ? 'Add coupon' : 'Edit coupon'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="coupon-form" loading={isSubmitting}>{isNew ? 'Add coupon' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="coupon-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" hint="3–20 letters, numbers or dashes. Clients quote this at the counter." error={errors.code?.message} required>
          <Input autoFocus placeholder="DIWALI10" className="font-mono uppercase" invalid={!!errors.code} {...register('code')} />
        </Field>
        <Field label="Description" error={errors.description?.message}>
          <Input placeholder="e.g. Festive offer" invalid={!!errors.description} {...register('description')} />
        </Field>

        <Field label="Discount type" error={errors.discountType?.message} required>
          <Select invalid={!!errors.discountType} {...register('discountType')}>
            <option value="PERCENT">Percentage of the bill</option>
            <option value="FLAT">Flat amount</option>
          </Select>
        </Field>
        {isPercent ? (
          <Field label="Discount (%)" error={errors.discountPct?.message} required>
            <Input type="number" min={0.01} max={100} step="0.01" placeholder="10" invalid={!!errors.discountPct} {...register('discountPct')} />
          </Field>
        ) : (
          <Field label="Discount (₹)" error={errors.discountPaise?.message} required>
            <Input inputMode="decimal" placeholder="0.00" invalid={!!errors.discountPaise} {...register('discountPaise')} />
          </Field>
        )}

        <Field label="Minimum bill (₹)" hint="Leave blank to allow any bill amount" error={errors.minBillPaise?.message}>
          <Input inputMode="decimal" placeholder="No minimum" invalid={!!errors.minBillPaise} {...register('minBillPaise')} />
        </Field>
        {isPercent && (
          <Field label="Maximum discount (₹)" hint="Caps the percentage discount. Leave blank for no cap." error={errors.maxDiscountPaise?.message}>
            <Input inputMode="decimal" placeholder="No cap" invalid={!!errors.maxDiscountPaise} {...register('maxDiscountPaise')} />
          </Field>
        )}

        <Field label="Valid from" error={errors.validFrom?.message} className="sm:col-start-1">
          <Input type="date" invalid={!!errors.validFrom} {...register('validFrom')} />
        </Field>
        <Field label="Valid until" hint="Leave both blank for a coupon that never expires" error={errors.validTo?.message}>
          <Input type="date" invalid={!!errors.validTo} {...register('validTo')} />
        </Field>

        <Field label="Uses per client" hint="Blank for unlimited" error={errors.usageLimitPerClient?.message}>
          <Input type="number" min={1} placeholder="Unlimited" invalid={!!errors.usageLimitPerClient} {...register('usageLimitPerClient')} />
        </Field>
        <Field label="Total uses" hint="Across all clients. Blank for unlimited." error={errors.totalUsageLimit?.message}>
          <Input type="number" min={1} placeholder="Unlimited" invalid={!!errors.totalUsageLimit} {...register('totalUsageLimit')} />
        </Field>
      </form>
    </Modal>
  );
}
