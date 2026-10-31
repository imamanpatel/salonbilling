import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Store } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR } from '@salon/shared';
import { vendorSchema } from '@salon/shared/inventory';
import { Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useDebounced } from '../../lib/hooks.js';
import { useApiForm } from '../../lib/useApiForm.js';

export default function VendorsPage() {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [editing, setEditing] = useState(null);
  const q = useDebounced(search.trim());

  const params = { q, status };
  const vendors = useQuery({ queryKey: [branchId, 'vendors', params], queryFn: () => api(`/vendors?${new URLSearchParams(params)}`) });

  const toggleStatus = useMutation({
    mutationFn: (vendor) => api(`/vendors/${vendor.id}/status`, { method: 'PATCH', body: { isActive: !vendor.isActive } }),
    onSuccess: (vendor) => {
      toast.success(`${vendor.name} ${vendor.isActive ? 'activated' : 'deactivated'}`);
      queryClient.invalidateQueries({ queryKey: [branchId, 'vendors'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const columns = [
    {
      key: 'name',
      header: 'Vendor',
      render: (v) => (
        <div>
          <div className="font-medium text-slate-900">{v.name}</div>
          {v.email && <div className="text-xs text-slate-500">{v.email}</div>}
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', className: 'whitespace-nowrap', render: (v) => v.phone ?? '—' },
    { key: 'gstin', header: 'GSTIN', className: 'whitespace-nowrap', render: (v) => v.gstin ?? '—' },
    { key: 'purchases', header: 'Purchases', className: 'text-right tabular-nums', render: (v) => formatINR(v.purchasesTotalPaise) },
    {
      key: 'outstanding',
      header: 'Outstanding',
      className: 'text-right tabular-nums',
      render: (v) => <span className={v.outstandingPaise > 0 ? 'font-medium text-rose-700' : ''}>{formatINR(v.outstandingPaise)}</span>,
    },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge active={v.isActive} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (v) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(v)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toggleStatus.mutate(v)} disabled={toggleStatus.isPending}>
            {v.isActive ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Vendors"
        description="Suppliers you buy stock from, with what you still owe them."
        actions={
          <Button onClick={() => setEditing({})}>
            <Plus className="size-4" /> Add vendor
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input type="search" placeholder="Search name, phone or GSTIN" aria-label="Search vendors" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-auto">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={vendors.data}
          loading={vendors.isPending}
          error={vendors.error}
          empty={
            q || status !== 'active' ? (
              <EmptyState title="No vendors match" />
            ) : (
              <EmptyState
                icon={Store}
                title="No vendors yet"
                description="Add the distributors you buy products from to record purchases."
                action={<Button onClick={() => setEditing({})}>Add vendor</Button>}
              />
            )
          }
        />
      </Card>

      {editing && <VendorFormModal vendor={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export function VendorFormModal({ vendor, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const isNew = !vendor.id;

  const form = useApiForm({
    schema: vendorSchema,
    defaultValues: {
      name: vendor.name ?? '',
      phone: vendor.phone ?? '',
      email: vendor.email ?? '',
      gstin: vendor.gstin ?? '',
      address: vendor.address ?? '',
      notes: vendor.notes ?? '',
    },
    toPayload: (values) => ({ ...values, isActive: vendor.isActive ?? true }),
    onSubmit: async (payload) => {
      await api(isNew ? '/vendors' : `/vendors/${vendor.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? 'Vendor added' : 'Vendor updated');
      queryClient.invalidateQueries({ queryKey: [branchId, 'vendors'] });
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={isNew ? 'Add vendor' : 'Edit vendor'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="vendor-form" loading={isSubmitting}>{isNew ? 'Add vendor' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="vendor-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Vendor name" error={errors.name?.message} required className="sm:col-span-2">
          <Input autoFocus invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <Input type="tel" invalid={!!errors.phone} {...register('phone')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" invalid={!!errors.email} {...register('email')} />
        </Field>
        <Field label="GSTIN" error={errors.gstin?.message}>
          <Input className="uppercase" invalid={!!errors.gstin} {...register('gstin')} />
        </Field>
        <Field label="Address" error={errors.address?.message} className="sm:col-span-2">
          <Textarea rows={2} invalid={!!errors.address} {...register('address')} />
        </Field>
        <Field label="Notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea rows={2} placeholder="Payment terms, sales rep, …" invalid={!!errors.notes} {...register('notes')} />
        </Field>
      </form>
    </Modal>
  );
}
