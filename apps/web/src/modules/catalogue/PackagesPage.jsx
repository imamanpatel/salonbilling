import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray } from 'react-hook-form';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR, paiseToRupees } from '@salon/shared';
import { packageSchema } from '@salon/shared/catalogue';
import { Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { moneyInput } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { formatDays, packageServicesLabel, STATUS_FILTERS } from './format.js';

const MAX_ITEMS = 30;

export default function PackagesPage() {
  const { branchId, canManage } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('active');
  const [editing, setEditing] = useState(null); // null | {} (new) | package

  const packages = useQuery({ queryKey: [branchId, 'packages', { status }], queryFn: () => api(`/packages?status=${status}`) });

  const toggleStatus = useMutation({
    mutationFn: (pkg) => api(`/packages/${pkg.id}/status`, { method: 'PATCH', body: { isActive: !pkg.isActive } }),
    onSuccess: (pkg) => {
      toast.success(`${pkg.name} ${pkg.isActive ? 'activated' : 'deactivated'}`);
      queryClient.invalidateQueries({ queryKey: [branchId, 'packages'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const columns = [
    {
      key: 'name',
      header: 'Package',
      render: (p) => (
        <div className="max-w-xs">
          <div className="font-medium text-slate-900">{p.name}</div>
          {p.description && <div className="truncate text-xs text-slate-500">{p.description}</div>}
        </div>
      ),
    },
    { key: 'services', header: 'Services', render: (p) => <div className="max-w-sm text-sm">{packageServicesLabel(p.items)}</div> },
    {
      key: 'price',
      header: 'Price',
      className: 'text-right tabular-nums',
      render: (p) => (
        <div>
          <div className="font-medium text-slate-900">{formatINR(p.pricePaise)}</div>
          {p.servicesValuePaise > p.pricePaise ? (
            <div className="text-xs text-emerald-700">
              Worth {formatINR(p.servicesValuePaise)} · save {formatINR(p.servicesValuePaise - p.pricePaise)}
            </div>
          ) : (
            <div className="text-xs text-slate-500">Worth {formatINR(p.servicesValuePaise)}</div>
          )}
        </div>
      ),
    },
    { key: 'validity', header: 'Valid for', render: (p) => formatDays(p.validityDays) },
    { key: 'sold', header: 'Sold', className: 'text-right tabular-nums', render: (p) => p.soldCount },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge active={p.isActive} /> },
  ];
  if (canManage) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (p) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toggleStatus.mutate(p)} disabled={toggleStatus.isPending}>
            {p.isActive ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Packages"
        description="Bundles of services sold upfront at a package price. Clients redeem the sessions on later visits."
        actions={
          canManage && (
            <Button onClick={() => setEditing({})}>
              <Plus className="size-4" /> Add package
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
          rows={packages.data}
          loading={packages.isPending}
          error={packages.error}
          empty={
            status !== 'active' ? (
              <EmptyState title="No packages match this filter" />
            ) : (
              <EmptyState
                icon={Package}
                title="No packages yet"
                description="Create a package such as “5 haircuts for the price of 4” to sell it at billing."
                action={canManage && <Button onClick={() => setEditing({})}>Add package</Button>}
              />
            )
          }
        />
      </Card>

      {editing && <PackageFormModal pkg={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PackageFormModal({ pkg, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const isNew = !pkg.id;

  const services = useQuery({ queryKey: [branchId, 'services', { status: 'active' }], queryFn: () => api('/services?status=active') });
  // Services already in the package stay pickable even if they were deactivated since.
  const options = [...(services.data ?? [])];
  for (const item of pkg.items ?? []) {
    if (!options.some((s) => s.id === item.service.id)) options.push({ ...item.service, inactive: true });
  }
  const priceOf = new Map(options.map((s) => [s.id, s.pricePaise]));

  const form = useApiForm({
    schema: packageSchema,
    defaultValues: {
      name: pkg.name ?? '',
      description: pkg.description ?? '',
      pricePaise: isNew ? '' : paiseToRupees(pkg.pricePaise),
      validityDays: pkg.validityDays ?? 90,
      items: pkg.items?.map((item) => ({ serviceId: item.serviceId, qty: item.qty })) ?? [{ serviceId: '', qty: 1 }],
    },
    toPayload: (values) => ({
      ...values,
      pricePaise: moneyInput(values.pricePaise),
      items: values.items.map((item) => ({ serviceId: item.serviceId || undefined, qty: item.qty })),
      isActive: pkg.isActive ?? true,
    }),
    onSubmit: async (payload) => {
      await api(isNew ? '/packages' : `/packages/${pkg.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? 'Package added' : 'Package updated');
      queryClient.invalidateQueries({ queryKey: [branchId, 'packages'] });
      onClose();
    },
  });
  const { register, control, watch, formState: { errors, isSubmitting } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const items = watch('items');
  const valuePaise = items.reduce((sum, item) => sum + (priceOf.get(item.serviceId) ?? 0) * (Number.parseInt(item.qty, 10) || 0), 0);
  const pricePaise = moneyInput(watch('pricePaise'));
  const savingPaise = typeof pricePaise === 'number' ? valuePaise - pricePaise : 0;
  const itemsError = errors.items?.message ?? errors.items?.root?.message;

  return (
    <Modal
      title={isNew ? 'Add package' : 'Edit package'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="package-form" loading={isSubmitting}>{isNew ? 'Add package' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="package-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Package name" error={errors.name?.message} required className="sm:col-span-2">
          <Input autoFocus placeholder="e.g. Hair spa × 5" invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
          <Textarea rows={2} placeholder="Shown on the bill and to staff" invalid={!!errors.description} {...register('description')} />
        </Field>

        <Field as="div" label="Services included" error={itemsError} required className="sm:col-span-2">
          <div className="space-y-2">
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2">
                <div className="flex-1">
                  <Select
                    aria-label={`Service ${index + 1}`}
                    invalid={!!errors.items?.[index]?.serviceId}
                    {...register(`items.${index}.serviceId`)}
                  >
                    <option value="">{services.isPending ? 'Loading services…' : 'Pick a service'}</option>
                    {options.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {formatINR(s.pricePaise)}{s.inactive ? ' (inactive)' : ''}
                      </option>
                    ))}
                  </Select>
                  {errors.items?.[index]?.serviceId && (
                    <span role="alert" className="mt-1 block text-xs text-rose-600">{errors.items[index].serviceId.message}</span>
                  )}
                </div>
                <div className="w-24">
                  <Input type="number" min={1} max={100} aria-label={`Sessions of service ${index + 1}`} invalid={!!errors.items?.[index]?.qty} {...register(`items.${index}.qty`)} />
                  {errors.items?.[index]?.qty && (
                    <span role="alert" className="mt-1 block text-xs text-rose-600">{errors.items[index].qty.message}</span>
                  )}
                </div>
                <Button variant="ghost" size="icon" className="mt-0.5" disabled={fields.length === 1} onClick={() => remove(index)} aria-label={`Remove service ${index + 1}`}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            {fields.length < MAX_ITEMS && (
              <Button variant="secondary" size="sm" onClick={() => append({ serviceId: '', qty: 1 })}>
                <Plus className="size-3.5" /> Add service
              </Button>
            )}
          </div>
          <span className="mt-2 block text-xs text-slate-500">The number next to each service is how many sessions the client gets.</span>
        </Field>

        <Field label="Package price (₹)" error={errors.pricePaise?.message} required>
          <Input inputMode="decimal" placeholder="0.00" invalid={!!errors.pricePaise} {...register('pricePaise')} />
        </Field>
        <Field label="Valid for (days)" hint="Counted from the day it is bought" error={errors.validityDays?.message} required>
          <Input type="number" min={1} max={3650} invalid={!!errors.validityDays} {...register('validityDays')} />
        </Field>

        <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600 sm:col-span-2">
          Services worth <span className="font-medium text-slate-900 tabular-nums">{formatINR(valuePaise)}</span> at regular prices
          {savingPaise > 0 && (
            <>
              {' '}— the client saves <span className="font-medium text-emerald-700 tabular-nums">{formatINR(savingPaise)}</span>
            </>
          )}
          .
        </div>
      </form>
    </Modal>
  );
}
