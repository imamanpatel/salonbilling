import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useWatch } from 'react-hook-form';
import { Link } from 'react-router';
import { Eye, Plus, Trash2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR, paiseToRupees } from '@salon/shared';
import { purchasePaymentSchema, purchaseSchema, purchaseTotals } from '@salon/shared/inventory';
import { Badge, Button, Card, cx, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Textarea } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, moneyInput, todayIso } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { invalidateStock, ProductPicker, productSize } from './common.jsx';

const useVendors = () => {
  const { branchId } = useAuth();
  const params = { status: 'all' };
  return useQuery({ queryKey: [branchId, 'vendors', params], queryFn: () => api(`/vendors?${new URLSearchParams(params)}`) });
};

export default function PurchasesPage() {
  const { branchId } = useAuth();
  const vendors = useVendors();
  const [filters, setFilters] = useState({ from: '', to: '', vendorId: '' });
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState(null);

  const params = { ...filters, page };
  const purchases = useQuery({
    queryKey: [branchId, 'purchases', params],
    queryFn: () => api(`/purchases?${new URLSearchParams(params)}`),
    placeholderData: keepPreviousData,
  });
  const setFilter = (key) => (e) => {
    setFilters((current) => ({ ...current, [key]: e.target.value }));
    setPage(1);
  };
  const summary = purchases.data?.summary;

  const columns = [
    { key: 'date', header: 'Date', className: 'whitespace-nowrap', render: (p) => formatDate(p.purchasedOn) },
    {
      key: 'vendor',
      header: 'Vendor',
      render: (p) => (
        <button type="button" onClick={() => setViewingId(p.id)} className="text-left font-medium text-slate-900 hover:text-brand-700">
          {p.vendor.name}
        </button>
      ),
    },
    { key: 'invoice', header: 'Invoice', render: (p) => p.invoiceNo ?? '—' },
    { key: 'items', header: 'Items', className: 'text-right tabular-nums', render: (p) => p._count.items },
    { key: 'total', header: 'Total', className: 'text-right tabular-nums', render: (p) => formatINR(p.totalPaise) },
    { key: 'paid', header: 'Paid', className: 'text-right tabular-nums', render: (p) => formatINR(p.paidPaise) },
    {
      key: 'outstanding',
      header: 'Outstanding',
      className: 'text-right tabular-nums',
      render: (p) => (p.outstandingPaise > 0 ? <span className="font-medium text-rose-700">{formatINR(p.outstandingPaise)}</span> : <Badge tone="green">Paid</Badge>),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (p) => (
        <Button variant="ghost" size="sm" onClick={() => setViewingId(p.id)}>
          <Eye className="size-3.5" /> View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Purchases"
        description="Stock bought from vendors. Each purchase adds stock and updates cost prices."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New purchase
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="From" className="w-40">
            <Input type="date" value={filters.from} max={filters.to || undefined} onChange={setFilter('from')} />
          </Field>
          <Field label="To" className="w-40">
            <Input type="date" value={filters.to} min={filters.from || undefined} onChange={setFilter('to')} />
          </Field>
          <Field label="Vendor" className="min-w-48">
            <Select value={filters.vendorId} onChange={setFilter('vendorId')}>
              <option value="">All vendors</option>
              {vendors.data?.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
          </Field>
          {summary && (
            <dl className="ml-auto flex gap-6 text-sm">
              <div>
                <dt className="text-slate-500">Total</dt>
                <dd className="font-semibold text-slate-900 tabular-nums">{formatINR(summary.totalPaise)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Outstanding</dt>
                <dd className={cx('font-semibold tabular-nums', summary.outstandingPaise > 0 ? 'text-rose-700' : 'text-slate-900')}>
                  {formatINR(summary.outstandingPaise)}
                </dd>
              </div>
            </dl>
          )}
        </div>
        <DataTable
          columns={columns}
          rows={purchases.data?.items}
          loading={purchases.isPending}
          error={purchases.error}
          empty={
            filters.from || filters.to || filters.vendorId ? (
              <EmptyState title="No purchases match these filters" />
            ) : (
              <EmptyState
                icon={Truck}
                title="No purchases yet"
                description="Record stock you buy from vendors to keep stock and cost prices up to date."
                action={<Button onClick={() => setCreating(true)}>New purchase</Button>}
              />
            )
          }
        />
        {purchases.data && <Pagination page={purchases.data.page} pageSize={purchases.data.pageSize} total={purchases.data.total} onChange={setPage} />}
      </Card>

      {creating && (
        <NewPurchaseModal
          vendors={(vendors.data ?? []).filter((v) => v.isActive)}
          onClose={() => setCreating(false)}
          onCreated={(purchase) => {
            setCreating(false);
            setViewingId(purchase.id);
          }}
        />
      )}
      {viewingId && <PurchaseDetailModal purchaseId={viewingId} onClose={() => setViewingId(null)} />}
    </>
  );
}

const emptyRow = () => ({ productId: '', productName: '', qty: 1, costPricePaise: '', mrpPaise: '', lotNo: '', expiresOn: '' });
const paiseOrZero = (value) => {
  const paise = moneyInput(value);
  return Number.isInteger(paise) ? paise : 0;
};

function NewPurchaseModal({ vendors, onClose, onCreated }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();

  const form = useApiForm({
    schema: purchaseSchema,
    defaultValues: {
      vendorId: vendors[0]?.id ?? '',
      invoiceNo: '',
      purchasedOn: todayIso(),
      items: [emptyRow()],
      discountPaise: '',
      taxPaise: '',
      shippingPaise: '',
      paidPaise: '',
      notes: '',
    },
    toPayload: (values) => ({
      ...values,
      items: values.items.map(({ productName, ...item }) => ({
        ...item,
        costPricePaise: moneyInput(item.costPricePaise),
        mrpPaise: moneyInput(item.mrpPaise),
      })),
      discountPaise: moneyInput(values.discountPaise) ?? 0,
      taxPaise: moneyInput(values.taxPaise) ?? 0,
      shippingPaise: moneyInput(values.shippingPaise) ?? 0,
      paidPaise: moneyInput(values.paidPaise) ?? 0,
    }),
    onSubmit: async (payload) => {
      const purchase = await api('/purchases', { method: 'POST', body: payload });
      toast.success('Purchase recorded and stock updated');
      queryClient.invalidateQueries({ queryKey: [branchId, 'purchases'] });
      queryClient.invalidateQueries({ queryKey: [branchId, 'vendors'] });
      invalidateStock(queryClient, branchId);
      onCreated(purchase);
    },
  });
  const { register, control, setValue, getValues, clearErrors, formState: { errors, isSubmitting } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const values = useWatch({ control });

  const rows = values.items ?? [];
  const totals = purchaseTotals({
    items: rows.map((row) => ({ qty: Number(row.qty), costPricePaise: paiseOrZero(row.costPricePaise) })),
    discountPaise: paiseOrZero(values.discountPaise),
    taxPaise: paiseOrZero(values.taxPaise),
    shippingPaise: paiseOrZero(values.shippingPaise),
  });
  const due = totals.totalPaise - paiseOrZero(values.paidPaise);

  function pickProduct(index, product) {
    setValue(`items.${index}.productId`, product.id);
    setValue(`items.${index}.productName`, product.name);
    if (getValues(`items.${index}.costPricePaise`) === '' && product.costPricePaise) {
      setValue(`items.${index}.costPricePaise`, paiseToRupees(product.costPricePaise));
    }
    if (getValues(`items.${index}.mrpPaise`) === '') setValue(`items.${index}.mrpPaise`, paiseToRupees(product.mrpPaise));
    clearErrors(`items.${index}.productId`);
  }

  if (!vendors.length) {
    return (
      <Modal title="New purchase" onClose={onClose}>
        <p className="text-sm text-slate-600">
          Add a vendor first. <Link to="/vendors" className="font-medium text-brand-700 hover:underline">Go to vendors</Link>
        </p>
      </Modal>
    );
  }

  const rowError = (index, key) => errors.items?.[index]?.[key]?.message;

  return (
    <Modal
      title="New purchase"
      description="Stock is added to this branch as soon as you save."
      onClose={onClose}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="purchase-form" loading={isSubmitting}>Save purchase</Button>
        </>
      }
    >
      <form id="purchase-form" onSubmit={form.submit} noValidate className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Vendor" error={errors.vendorId?.message} required>
            <Select invalid={!!errors.vendorId} {...register('vendorId')}>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Invoice no." error={errors.invoiceNo?.message}>
            <Input invalid={!!errors.invoiceNo} {...register('invoiceNo')} />
          </Field>
          <Field label="Purchase date" error={errors.purchasedOn?.message} required>
            <Input type="date" max={todayIso()} invalid={!!errors.purchasedOn} {...register('purchasedOn')} />
          </Field>
        </div>

        <div>
          <div className="mb-1.5 hidden gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase lg:grid lg:grid-cols-[minmax(0,1fr)_4.5rem_6.5rem_6.5rem_6rem_9rem_6rem_2rem]">
            <span>Product</span>
            <span>Qty</span>
            <span>Cost ₹</span>
            <span>MRP ₹</span>
            <span>Lot</span>
            <span>Expiry</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          <div className="space-y-3 lg:space-y-2">
            {fields.map((field, index) => {
              const row = rows[index] ?? {};
              const amount = (Number.isInteger(Number(row.qty)) ? Number(row.qty) : 0) * paiseOrZero(row.costPricePaise);
              return (
                <div
                  key={field.id}
                  className="grid grid-cols-2 items-start gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,1fr)_4.5rem_6.5rem_6.5rem_6rem_9rem_6rem_2rem] lg:border-0 lg:p-0"
                >
                  <div className="col-span-2 sm:col-span-3 lg:col-span-1">
                    <ProductPicker
                      value={row.productId ? { id: row.productId, name: row.productName } : null}
                      invalid={!!rowError(index, 'productId')}
                      onSelect={(product) => pickProduct(index, product)}
                    />
                    <RowError message={rowError(index, 'productId')} />
                  </div>
                  <div>
                    <Input type="number" min={1} aria-label="Quantity" invalid={!!rowError(index, 'qty')} {...register(`items.${index}.qty`)} />
                    <RowError message={rowError(index, 'qty')} />
                  </div>
                  <div>
                    <Input inputMode="decimal" placeholder="Cost" aria-label="Cost price (₹)" invalid={!!rowError(index, 'costPricePaise')} {...register(`items.${index}.costPricePaise`)} />
                    <RowError message={rowError(index, 'costPricePaise')} />
                  </div>
                  <div>
                    <Input inputMode="decimal" placeholder="MRP" aria-label="MRP (₹)" invalid={!!rowError(index, 'mrpPaise')} {...register(`items.${index}.mrpPaise`)} />
                    <RowError message={rowError(index, 'mrpPaise')} />
                  </div>
                  <div>
                    <Input placeholder="Lot" aria-label="Lot number" invalid={!!rowError(index, 'lotNo')} {...register(`items.${index}.lotNo`)} />
                    <RowError message={rowError(index, 'lotNo')} />
                  </div>
                  <div>
                    <Input type="date" aria-label="Expiry date" invalid={!!rowError(index, 'expiresOn')} {...register(`items.${index}.expiresOn`)} />
                    <RowError message={rowError(index, 'expiresOn')} />
                  </div>
                  <div className="self-center text-right text-sm font-medium text-slate-900 tabular-nums">{formatINR(amount)}</div>
                  <Button variant="ghost" size="icon" className="justify-self-end" aria-label="Remove item" disabled={fields.length === 1} onClick={() => remove(index)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>
          {errors.items?.message && <p role="alert" className="mt-1 text-xs text-rose-600">{errors.items.message}</p>}
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => append(emptyRow())}>
            <Plus className="size-3.5" /> Add item
          </Button>
        </div>

        <div className="grid gap-6 border-t border-slate-100 pt-5 md:grid-cols-2">
          <Field label="Notes" error={errors.notes?.message}>
            <Textarea rows={4} invalid={!!errors.notes} {...register('notes')} />
          </Field>
          <dl className="space-y-2 text-sm">
            <TotalRow label="Subtotal" value={formatINR(totals.subtotalPaise)} />
            <MoneyRow label="Discount" error={errors.discountPaise?.message} {...register('discountPaise')} />
            <MoneyRow label="Tax" error={errors.taxPaise?.message} {...register('taxPaise')} />
            <MoneyRow label="Shipping" error={errors.shippingPaise?.message} {...register('shippingPaise')} />
            <TotalRow label="Total" value={formatINR(totals.totalPaise)} strong />
            <MoneyRow
              label={
                <span className="flex items-center gap-2">
                  Paid now
                  <button
                    type="button"
                    className="text-xs font-medium text-brand-700 hover:underline"
                    onClick={() => setValue('paidPaise', paiseToRupees(Math.max(totals.totalPaise, 0)))}
                  >
                    Pay in full
                  </button>
                </span>
              }
              error={errors.paidPaise?.message}
              {...register('paidPaise')}
            />
            <TotalRow label="Due to vendor" value={formatINR(due)} />
          </dl>
        </div>
      </form>
    </Modal>
  );
}

function RowError({ message }) {
  return message ? <span role="alert" className="mt-1 block text-xs text-rose-600">{message}</span> : null;
}

function TotalRow({ label, value, strong }) {
  return (
    <div className={cx('flex items-center justify-between gap-4', strong && 'border-t border-slate-100 pt-2 text-base font-semibold text-slate-900')}>
      <dt className={strong ? '' : 'text-slate-600'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function MoneyRow({ label, error, ...inputProps }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <dt className="text-slate-600">{label}</dt>
        <dd className="w-32">
          <Input inputMode="decimal" placeholder="0.00" className="py-1.5 text-right" invalid={!!error} {...inputProps} />
        </dd>
      </div>
      {error && <p role="alert" className="mt-1 text-right text-xs text-rose-600">{error}</p>}
    </div>
  );
}

function PurchaseDetailModal({ purchaseId, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const purchase = useQuery({ queryKey: [branchId, 'purchase', purchaseId], queryFn: () => api(`/purchases/${purchaseId}`) });
  const p = purchase.data;

  const columns = [
    {
      key: 'product',
      header: 'Product',
      render: (item) => (
        <div>
          <div className="font-medium text-slate-900">{item.product.name}</div>
          <div className="text-xs text-slate-500">{[item.product.brand, productSize(item.product)].filter(Boolean).join(' · ')}</div>
        </div>
      ),
    },
    { key: 'lot', header: 'Lot', render: (item) => item.lotNo ?? '—' },
    { key: 'expiry', header: 'Expiry', className: 'whitespace-nowrap', render: (item) => (item.expiresOn ? formatDate(item.expiresOn) : '—') },
    { key: 'qty', header: 'Qty', className: 'text-right tabular-nums', render: (item) => item.qty },
    { key: 'cost', header: 'Cost', className: 'text-right tabular-nums', render: (item) => formatINR(item.costPricePaise) },
    { key: 'mrp', header: 'MRP', className: 'text-right tabular-nums', render: (item) => formatINR(item.mrpPaise) },
    { key: 'amount', header: 'Amount', className: 'text-right tabular-nums', render: (item) => formatINR(item.qty * item.costPricePaise) },
  ];

  return (
    <Modal
      title={p ? `Purchase from ${p.vendor.name}` : 'Purchase'}
      description={p && `${formatDate(p.purchasedOn)}${p.invoiceNo ? ` · Invoice ${p.invoiceNo}` : ''}${p.createdBy ? ` · Recorded by ${p.createdBy.name}` : ''}`}
      onClose={onClose}
      size="xl"
      focusForm={false}
    >
      {purchase.isPending ? (
        <Spinner className="mx-auto my-8" />
      ) : purchase.error ? (
        <p className="text-sm text-rose-600">{purchase.error.message}</p>
      ) : (
        <div className="space-y-5">
          <div className="-mx-6 border-y border-slate-100">
            <DataTable columns={columns} rows={p.items} />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="text-sm text-slate-600">
              {p.notes && (
                <>
                  <p className="font-medium text-slate-900">Notes</p>
                  <p className="whitespace-pre-line">{p.notes}</p>
                </>
              )}
            </div>
            <dl className="space-y-2 text-sm">
              <TotalRow label="Subtotal" value={formatINR(p.subtotalPaise)} />
              {p.discountPaise > 0 && <TotalRow label="Discount" value={`− ${formatINR(p.discountPaise)}`} />}
              {p.taxPaise > 0 && <TotalRow label="Tax" value={formatINR(p.taxPaise)} />}
              {p.shippingPaise > 0 && <TotalRow label="Shipping" value={formatINR(p.shippingPaise)} />}
              <TotalRow label="Total" value={formatINR(p.totalPaise)} strong />
              <TotalRow label="Paid" value={formatINR(p.paidPaise)} />
              <TotalRow label="Outstanding" value={formatINR(p.outstandingPaise)} strong />
            </dl>
          </div>
          {p.outstandingPaise > 0 && (
            <PaymentForm
              purchase={p}
              onPaid={(updated) => {
                queryClient.setQueryData([branchId, 'purchase', purchaseId], updated);
                queryClient.invalidateQueries({ queryKey: [branchId, 'purchases'] });
                queryClient.invalidateQueries({ queryKey: [branchId, 'vendors'] });
              }}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

function PaymentForm({ purchase, onPaid }) {
  const form = useApiForm({
    schema: purchasePaymentSchema,
    defaultValues: { amountPaise: paiseToRupees(purchase.outstandingPaise) },
    toPayload: (values) => ({ amountPaise: moneyInput(values.amountPaise) }),
    onSubmit: async (payload) => {
      const updated = await api(`/purchases/${purchase.id}/payments`, { method: 'POST', body: payload });
      toast.success(`Payment of ${formatINR(payload.amountPaise)} recorded`);
      form.reset({ amountPaise: paiseToRupees(updated.outstandingPaise) });
      onPaid(updated);
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <form onSubmit={form.submit} noValidate className="flex flex-wrap items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <Field label="Record payment (₹)" error={errors.amountPaise?.message} className="w-48">
        <Input inputMode="decimal" invalid={!!errors.amountPaise} {...register('amountPaise')} />
      </Field>
      <Button type="submit" className="mt-7" loading={isSubmitting}>Record payment</Button>
    </form>
  );
}
