import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useWatch } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { paiseToRupees } from '@salon/shared';
import { PRODUCT_UNITS, productSchema, stockAdjustmentSchema, stockTransferSchema, stockUsageSchema } from '@salon/shared/inventory';
import { Badge, Button, Checkbox, cx, DataTable, EmptyState, Field, Input, Modal, Pagination, Select, Textarea } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDateTime, moneyInput } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { invalidateStock, ProductPicker, REASON_LABELS, REASON_TONES, UNIT_LABELS } from './common.jsx';

const STOCK_LINE = (product) => `${product.stockOnHand} in stock`;

export function ProductFormModal({ product, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const isNew = !product.id;
  const taxes = useQuery({ queryKey: [branchId, 'taxes'], queryFn: () => api('/settings/taxes') });
  const taxOptions = (taxes.data ?? []).filter((t) => (t.isActive && t.appliesTo !== 'SERVICE') || t.id === product.taxRateId);

  const form = useApiForm({
    schema: productSchema,
    defaultValues: {
      name: product.name ?? '',
      brand: product.brand ?? '',
      barcode: product.barcode ?? '',
      unit: product.unit ?? 'PCS',
      volume: product.volume ?? '',
      mrpPaise: isNew ? '' : paiseToRupees(product.mrpPaise),
      salePricePaise: isNew ? '' : paiseToRupees(product.salePricePaise),
      costPricePaise: isNew ? '' : paiseToRupees(product.costPricePaise),
      rewardPoints: product.rewardPoints ?? 0,
      lowStockAt: product.lowStockAt ?? 5,
      isRetail: product.isRetail ?? true,
      taxRateId: product.taxRateId ?? '',
      openingStock: 0,
    },
    toPayload: (values) => ({
      ...values,
      mrpPaise: moneyInput(values.mrpPaise),
      salePricePaise: moneyInput(values.salePricePaise === '' ? values.mrpPaise : values.salePricePaise),
      costPricePaise: values.costPricePaise === '' ? 0 : moneyInput(values.costPricePaise),
      isActive: product.isActive ?? true,
    }),
    onSubmit: async (payload) => {
      await api(isNew ? '/products' : `/products/${product.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? 'Product added' : 'Product updated');
      invalidateStock(queryClient, branchId);
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={isNew ? 'Add product' : 'Edit product'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="product-form" loading={isSubmitting}>{isNew ? 'Add product' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="product-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Product name" error={errors.name?.message} required className="sm:col-span-2">
          <Input autoFocus invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field label="Brand" error={errors.brand?.message}>
          <Input invalid={!!errors.brand} {...register('brand')} />
        </Field>
        <Field label="Barcode" hint="Scan or type the code on the pack" error={errors.barcode?.message}>
          <Input invalid={!!errors.barcode} {...register('barcode')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Size" error={errors.volume?.message}>
            <Input inputMode="decimal" placeholder="e.g. 250" invalid={!!errors.volume} {...register('volume')} />
          </Field>
          <Field label="Unit" error={errors.unit?.message}>
            <Select invalid={!!errors.unit} {...register('unit')}>
              {PRODUCT_UNITS.map((u) => (
                <option key={u} value={u}>{UNIT_LABELS[u]}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Tax" error={errors.taxRateId?.message}>
          <Select invalid={!!errors.taxRateId} {...register('taxRateId')}>
            <option value="">No tax</option>
            {taxOptions.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="MRP (₹)" error={errors.mrpPaise?.message} required>
          <Input inputMode="decimal" placeholder="0.00" invalid={!!errors.mrpPaise} {...register('mrpPaise')} />
        </Field>
        <Field label="Sale price (₹)" hint="Leave blank to sell at MRP" error={errors.salePricePaise?.message}>
          <Input inputMode="decimal" placeholder="Same as MRP" invalid={!!errors.salePricePaise} {...register('salePricePaise')} />
        </Field>
        <Field label="Cost price (₹)" hint="Updated by each purchase" error={errors.costPricePaise?.message}>
          <Input inputMode="decimal" placeholder="0.00" invalid={!!errors.costPricePaise} {...register('costPricePaise')} />
        </Field>
        <Field label="Reward points" error={errors.rewardPoints?.message}>
          <Input type="number" min={0} invalid={!!errors.rewardPoints} {...register('rewardPoints')} />
        </Field>
        <Field label="Low stock alert at" hint="Alert when stock falls to this level" error={errors.lowStockAt?.message}>
          <Input type="number" min={0} invalid={!!errors.lowStockAt} {...register('lowStockAt')} />
        </Field>
        {isNew && (
          <Field label="Opening stock" hint="Quantity on the shelf right now" error={errors.openingStock?.message}>
            <Input type="number" min={0} invalid={!!errors.openingStock} {...register('openingStock')} />
          </Field>
        )}
        <Checkbox
          className="sm:col-span-2"
          label="Sold to clients (retail)"
          description="Untick for consumables that are only used in services."
          {...register('isRetail')}
        />
      </form>
    </Modal>
  );
}

export function UsageModal({ product, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const staff = useQuery({ queryKey: [branchId, 'staff', { status: 'active' }], queryFn: () => api('/staff?status=active') });

  const form = useApiForm({
    schema: stockUsageSchema,
    defaultValues: { productId: product.id, qty: 1, staffId: '', note: '' },
    onSubmit: async (payload) => {
      const movement = await api('/stock/usage', { method: 'POST', body: payload });
      toast.success(`Recorded. ${movement.stockOnHand} left in stock`);
      invalidateStock(queryClient, branchId);
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title="Use in salon"
      description={`${product.name} · ${STOCK_LINE(product)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="usage-form" loading={isSubmitting}>Record usage</Button>
        </>
      }
    >
      <form id="usage-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Quantity" error={errors.qty?.message} required>
          <Input type="number" min={1} invalid={!!errors.qty} {...register('qty')} />
        </Field>
        <Field label="Used by" error={errors.staffId?.message}>
          <Select invalid={!!errors.staffId} {...register('staffId')}>
            <option value="">—</option>
            {staff.data?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Note" error={errors.note?.message} className="sm:col-span-2">
          <Input placeholder="e.g. Hair spa for walk-in" invalid={!!errors.note} {...register('note')} />
        </Field>
      </form>
    </Modal>
  );
}

export function AdjustModal({ product, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();

  // `qtyChange` holds the unsigned quantity; `direction` gives its sign.
  const form = useApiForm({
    schema: stockAdjustmentSchema,
    defaultValues: { productId: product.id, direction: 'remove', qtyChange: '', note: '' },
    toPayload: ({ direction, qtyChange, ...values }) => ({
      ...values,
      qtyChange: qtyChange === '' ? 0 : (direction === 'remove' ? -1 : 1) * Number(qtyChange),
    }),
    onSubmit: async (payload) => {
      const movement = await api('/stock/adjustments', { method: 'POST', body: payload });
      toast.success(`Stock adjusted to ${movement.stockOnHand}`);
      invalidateStock(queryClient, branchId);
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title="Adjust stock"
      description={`${product.name} · ${STOCK_LINE(product)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="adjust-form" loading={isSubmitting}>Save adjustment</Button>
        </>
      }
    >
      <form id="adjust-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Change">
          <Select {...register('direction')}>
            <option value="remove">Remove from stock</option>
            <option value="add">Add to stock</option>
          </Select>
        </Field>
        <Field label="Quantity" error={errors.qtyChange?.message} required>
          <Input type="number" min={1} invalid={!!errors.qtyChange} {...register('qtyChange')} />
        </Field>
        <Field label="Reason" error={errors.note?.message} required className="sm:col-span-2">
          <Input placeholder="e.g. Damaged, expired, stock count" invalid={!!errors.note} {...register('note')} />
        </Field>
      </form>
    </Modal>
  );
}

export function MovementsModal({ product, onClose }) {
  const { branchId } = useAuth();
  const [page, setPage] = useState(1);
  const movements = useQuery({
    queryKey: [branchId, 'product-movements', product.id, page],
    queryFn: () => api(`/products/${product.id}/movements?page=${page}`),
    placeholderData: keepPreviousData,
  });

  const columns = [
    { key: 'createdAt', header: 'When', className: 'whitespace-nowrap', render: (m) => formatDateTime(m.createdAt) },
    { key: 'reason', header: 'Type', render: (m) => <Badge tone={REASON_TONES[m.reason]}>{REASON_LABELS[m.reason]}</Badge> },
    {
      key: 'qty',
      header: 'Qty',
      className: 'text-right tabular-nums',
      render: (m) => (
        <span className={cx('font-medium', m.qtyChange > 0 ? 'text-emerald-700' : 'text-rose-700')}>
          {m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange}
        </span>
      ),
    },
    { key: 'balance', header: 'Balance', className: 'text-right tabular-nums', render: (m) => m.balanceAfter },
    {
      key: 'note',
      header: 'Details',
      render: (m) => (
        <div className="min-w-40">
          {m.note && <div>{m.note}</div>}
          {m.staff && <div className="text-xs text-slate-500">Staff: {m.staff.name}</div>}
          {!m.note && !m.staff && '—'}
        </div>
      ),
    },
    { key: 'by', header: 'By', render: (m) => m.createdBy?.name ?? '—' },
  ];

  return (
    <Modal title="Stock history" description={`${product.name} · ${STOCK_LINE(product)}`} onClose={onClose} size="xl" focusForm={false}>
      <div className="-mx-6 -my-5">
        <DataTable
          columns={columns}
          rows={movements.data?.items}
          loading={movements.isPending}
          error={movements.error}
          empty={<EmptyState title="No stock movements yet" />}
        />
        {movements.data && (
          <Pagination page={movements.data.page} pageSize={movements.data.pageSize} total={movements.data.total} onChange={setPage} />
        )}
      </div>
    </Modal>
  );
}

export function TransferModal({ product, onClose }) {
  const { branchId, branches } = useAuth();
  const queryClient = useQueryClient();
  const targets = branches.filter((b) => b.id !== branchId);
  const newRow = (p) => ({ productId: p?.id ?? '', productName: p?.name ?? '', qty: 1 });

  const form = useApiForm({
    schema: stockTransferSchema,
    defaultValues: { toBranchId: targets[0]?.id ?? '', items: [newRow(product)], note: '' },
    toPayload: (values) => ({ ...values, items: values.items.map(({ productId, qty }) => ({ productId, qty })) }),
    onSubmit: async (payload) => {
      const result = await api('/stock/transfers', { method: 'POST', body: payload });
      toast.success(`Stock sent to ${result.toBranch.name}`);
      invalidateStock(queryClient, branchId);
      invalidateStock(queryClient, payload.toBranchId);
      onClose();
    },
  });
  const { register, control, setValue, clearErrors, formState: { errors, isSubmitting } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const rows = useWatch({ control, name: 'items' });

  return (
    <Modal
      title="Transfer stock"
      description="Send products to another branch. Products it doesn't stock yet are created there."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="transfer-form" loading={isSubmitting} disabled={!targets.length}>Transfer</Button>
        </>
      }
    >
      {targets.length === 0 ? (
        <p className="text-sm text-slate-600">You don't have access to any other branch.</p>
      ) : (
        <form id="transfer-form" onSubmit={form.submit} noValidate className="space-y-4">
          <Field label="To branch" error={errors.toBranchId?.message} required>
            <Select invalid={!!errors.toBranchId} {...register('toBranchId')}>
              {targets.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Products</p>
            <div className="space-y-2">
              {fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <ProductPicker
                      value={rows?.[index]?.productId ? { id: rows[index].productId, name: rows[index].productName } : null}
                      invalid={!!errors.items?.[index]?.productId}
                      onSelect={(p) => {
                        setValue(`items.${index}.productId`, p.id);
                        setValue(`items.${index}.productName`, p.name);
                        clearErrors(`items.${index}.productId`);
                      }}
                    />
                    {errors.items?.[index]?.productId && (
                      <span role="alert" className="mt-1 block text-xs text-rose-600">{errors.items[index].productId.message}</span>
                    )}
                  </div>
                  <div className="w-24">
                    <Input type="number" min={1} aria-label="Quantity" invalid={!!errors.items?.[index]?.qty} {...register(`items.${index}.qty`)} />
                    {errors.items?.[index]?.qty && (
                      <span role="alert" className="mt-1 block text-xs text-rose-600">{errors.items[index].qty.message}</span>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" className="mt-0.5" aria-label="Remove row" disabled={fields.length === 1} onClick={() => remove(index)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            {errors.items?.message && <p role="alert" className="mt-1 text-xs text-rose-600">{errors.items.message}</p>}
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => append(newRow())}>
              <Plus className="size-3.5" /> Add product
            </Button>
          </div>
          <Field label="Note" error={errors.note?.message}>
            <Textarea rows={2} invalid={!!errors.note} {...register('note')} />
          </Field>
        </form>
      )}
    </Modal>
  );
}
