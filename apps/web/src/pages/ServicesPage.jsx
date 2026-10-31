import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FolderTree, Pencil, Plus, Scissors, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { categorySchema, formatINR, paiseToRupees, SERVICE_GENDERS, serviceSchema } from '@salon/shared';
import { Button, Card, Checkbox, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, StatusBadge } from '../components/ui.jsx';
import { api, downloadFile } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { moneyInput, SERVICE_GENDER_LABELS } from '../lib/format.js';
import { useDebounced } from '../lib/hooks.js';
import { useApiForm } from '../lib/useApiForm.js';

export default function ServicesPage() {
  const { branchId, canManage } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ categoryId: '', gender: '', status: 'active' });
  const [editing, setEditing] = useState(null); // null | {} (new) | service
  const [dialog, setDialog] = useState(null); // null | 'categories' | 'import'
  const q = useDebounced(search.trim());

  const params = { ...filters, q };
  const categories = useQuery({ queryKey: [branchId, 'service-categories'], queryFn: () => api('/service-categories') });
  const services = useQuery({ queryKey: [branchId, 'services', params], queryFn: () => api(`/services?${new URLSearchParams(params)}`) });

  const toggleStatus = useMutation({
    mutationFn: (service) => api(`/services/${service.id}/status`, { method: 'PATCH', body: { isActive: !service.isActive } }),
    onSuccess: (service) => {
      toast.success(`${service.name} ${service.isActive ? 'activated' : 'deactivated'}`);
      queryClient.invalidateQueries({ queryKey: [branchId, 'services'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const setFilter = (key) => (e) => setFilters((current) => ({ ...current, [key]: e.target.value }));
  const filtered = Boolean(q || filters.categoryId || filters.gender || filters.status !== 'active');

  function addService() {
    if (!categories.data?.length) {
      toast.info('Create a category first');
      setDialog('categories');
      return;
    }
    setEditing({});
  }

  const columns = [
    {
      key: 'name',
      header: 'Service',
      render: (s) => (
        <div>
          <div className="font-medium text-slate-900">{s.name}</div>
          {!s.showOnWebsite && <div className="text-xs text-slate-500">Hidden from website</div>}
        </div>
      ),
    },
    { key: 'category', header: 'Category', render: (s) => s.category.name },
    { key: 'gender', header: 'For', render: (s) => SERVICE_GENDER_LABELS[s.gender] },
    { key: 'duration', header: 'Duration', render: (s) => `${s.durationMin} min` },
    { key: 'price', header: 'Price', className: 'text-right tabular-nums', render: (s) => formatINR(s.pricePaise) },
    { key: 'member', header: 'Member price', className: 'text-right tabular-nums', render: (s) => formatINR(s.memberPricePaise) },
    { key: 'points', header: 'Points', className: 'text-right tabular-nums', render: (s) => s.rewardPoints },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge active={s.isActive} /> },
  ];
  if (canManage) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (s) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toggleStatus.mutate(s)} disabled={toggleStatus.isPending}>
            {s.isActive ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Services"
        description="Your service menu, prices and durations for this branch."
        actions={
          canManage && (
            <>
              <Button variant="secondary" onClick={() => setDialog('categories')}>
                <FolderTree className="size-4" /> Categories
              </Button>
              <Button variant="secondary" onClick={() => setDialog('import')}>
                <Upload className="size-4" /> Import
              </Button>
              <Button onClick={addService}>
                <Plus className="size-4" /> Add service
              </Button>
            </>
          )
        }
      />

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input type="search" placeholder="Search services" aria-label="Search services" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Category" value={filters.categoryId} onChange={setFilter('categoryId')} className="sm:w-auto">
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select aria-label="For" value={filters.gender} onChange={setFilter('gender')} className="sm:w-auto">
            <option value="">Everyone</option>
            {SERVICE_GENDERS.map((g) => (
              <option key={g} value={g}>{SERVICE_GENDER_LABELS[g]}</option>
            ))}
          </Select>
          <Select aria-label="Status" value={filters.status} onChange={setFilter('status')} className="sm:w-auto">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={services.data}
          loading={services.isPending}
          error={services.error}
          empty={
            filtered ? (
              <EmptyState title="No services match these filters" />
            ) : (
              <EmptyState
                icon={Scissors}
                title="No services yet"
                description="Add services one by one or import your whole menu from Excel."
                action={
                  canManage && (
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => setDialog('import')}>Import from Excel</Button>
                      <Button onClick={addService}>Add service</Button>
                    </div>
                  )
                }
              />
            )
          }
        />
      </Card>

      {editing && <ServiceFormModal service={editing} categories={categories.data ?? []} onClose={() => setEditing(null)} />}
      {dialog === 'categories' && <CategoriesModal categories={categories.data ?? []} onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportServicesModal onClose={() => setDialog(null)} />}
    </>
  );
}

function ServiceFormModal({ service, categories, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const isNew = !service.id;

  const form = useApiForm({
    schema: serviceSchema,
    defaultValues: {
      categoryId: service.categoryId ?? categories[0]?.id ?? '',
      name: service.name ?? '',
      gender: service.gender ?? 'UNISEX',
      durationMin: service.durationMin ?? 30,
      pricePaise: isNew ? '' : paiseToRupees(service.pricePaise),
      memberPricePaise: isNew ? '' : paiseToRupees(service.memberPricePaise),
      rewardPoints: service.rewardPoints ?? 0,
      showOnWebsite: service.showOnWebsite ?? true,
    },
    toPayload: (values) => ({
      ...values,
      pricePaise: moneyInput(values.pricePaise),
      memberPricePaise: moneyInput(values.memberPricePaise === '' ? values.pricePaise : values.memberPricePaise),
      isActive: service.isActive ?? true,
    }),
    onSubmit: async (payload) => {
      await api(isNew ? '/services' : `/services/${service.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? 'Service added' : 'Service updated');
      queryClient.invalidateQueries({ queryKey: [branchId, 'services'] });
      queryClient.invalidateQueries({ queryKey: [branchId, 'service-categories'] });
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={isNew ? 'Add service' : 'Edit service'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="service-form" loading={isSubmitting}>{isNew ? 'Add service' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="service-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Service name" error={errors.name?.message} required className="sm:col-span-2">
          <Input autoFocus invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field label="Category" error={errors.categoryId?.message} required>
          <Select invalid={!!errors.categoryId} {...register('categoryId')}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="For" error={errors.gender?.message} required>
          <Select invalid={!!errors.gender} {...register('gender')}>
            {SERVICE_GENDERS.map((g) => (
              <option key={g} value={g}>{SERVICE_GENDER_LABELS[g]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Duration (minutes)" error={errors.durationMin?.message} required>
          <Input type="number" min={5} step={5} invalid={!!errors.durationMin} {...register('durationMin')} />
        </Field>
        <Field label="Reward points" hint="Points the client earns for this service" error={errors.rewardPoints?.message}>
          <Input type="number" min={0} invalid={!!errors.rewardPoints} {...register('rewardPoints')} />
        </Field>
        <Field label="Price (₹, excluding tax)" error={errors.pricePaise?.message} required>
          <Input inputMode="decimal" placeholder="0.00" invalid={!!errors.pricePaise} {...register('pricePaise')} />
        </Field>
        <Field label="Member price (₹)" hint="Leave blank to use the regular price" error={errors.memberPricePaise?.message}>
          <Input inputMode="decimal" placeholder="Same as price" invalid={!!errors.memberPricePaise} {...register('memberPricePaise')} />
        </Field>
        <Checkbox
          className="sm:col-span-2"
          label="Show on website"
          description="Clients can see and book this service online."
          {...register('showOnWebsite')}
        />
      </form>
    </Modal>
  );
}

function CategoriesModal({ categories, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(null); // { id, name }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [branchId, 'service-categories'] });
    queryClient.invalidateQueries({ queryKey: [branchId, 'services'] });
  };

  const addForm = useApiForm({
    schema: categorySchema,
    defaultValues: { name: '' },
    onSubmit: async (payload) => {
      await api('/service-categories', { method: 'POST', body: payload });
      toast.success(`Category "${payload.name}" added`);
      addForm.reset();
      refresh();
    },
  });

  const rename = useMutation({
    mutationFn: ({ id, name }) => api(`/service-categories/${id}`, { method: 'PUT', body: { name } }),
    onSuccess: () => {
      setRenaming(null);
      refresh();
      toast.success('Category renamed');
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/service-categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast.success('Category deleted');
    },
    onError: (err) => toast.error(err.message),
  });

  function submitRename(e) {
    e.preventDefault();
    const parsed = categorySchema.safeParse({ name: renaming.name });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    rename.mutate({ id: renaming.id, name: parsed.data.name });
  }

  return (
    <Modal title="Service categories" description="Categories group services on the menu, bills and reports." onClose={onClose}>
      <form onSubmit={addForm.submit} noValidate className="flex items-start gap-2">
        <Field label="New category" error={addForm.formState.errors.name?.message} className="flex-1">
          <Input placeholder="e.g. Hair, Skin, Nails" invalid={!!addForm.formState.errors.name} {...addForm.register('name')} />
        </Field>
        <Button type="submit" className="mt-7" loading={addForm.formState.isSubmitting}>Add</Button>
      </form>

      <ul className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {categories.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No categories yet.</li>}
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-4 py-2 text-sm">
            {renaming?.id === c.id ? (
              <form className="flex flex-1 gap-2" onSubmit={submitRename}>
                <Input
                  autoFocus
                  aria-label="Category name"
                  value={renaming.name}
                  onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                  className="py-1.5"
                />
                <Button type="submit" size="sm" className="h-auto" loading={rename.isPending}>Save</Button>
                <Button size="sm" variant="ghost" className="h-auto" onClick={() => setRenaming(null)}>Cancel</Button>
              </form>
            ) : (
              <>
                <span className="flex-1 font-medium text-slate-800">{c.name}</span>
                <span className="text-xs text-slate-500">
                  {c.serviceCount} service{c.serviceCount === 1 ? '' : 's'}
                </span>
                <Button size="icon" variant="ghost" onClick={() => setRenaming({ id: c.id, name: c.name })} aria-label={`Rename ${c.name}`}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={c.serviceCount > 0 || remove.isPending}
                  title={c.serviceCount > 0 ? 'Move or delete its services first' : undefined}
                  onClick={() => {
                    if (window.confirm(`Delete the "${c.name}" category?`)) remove.mutate(c.id);
                  }}
                  aria-label={`Delete ${c.name}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function ImportServicesModal({ onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);

  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('file', file);
      return api('/services/import', { method: 'POST', body });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [branchId, 'services'] });
      queryClient.invalidateQueries({ queryKey: [branchId, 'service-categories'] });
      toast.success(`Import finished: ${result.created} added, ${result.updated} updated`);
    },
    onError: (err) => toast.error(err.message),
  });
  const result = upload.data;

  async function downloadTemplate() {
    try {
      await downloadFile('/services/import-template', 'services-import-template.xlsx');
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Modal
      title="Import services from Excel"
      description="Rows matching an existing service (same category and name) update it."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{result ? 'Done' : 'Cancel'}</Button>
          <Button onClick={() => upload.mutate()} disabled={!file} loading={upload.isPending}>
            <Upload className="size-4" /> Import
          </Button>
        </>
      }
    >
      <ol className="space-y-5 text-sm text-slate-700">
        <li>
          <p className="font-medium text-slate-900">1. Download the template</p>
          <p className="mb-2 text-slate-500">Columns: Category, Service name, For, Duration, Price, Member price, Reward points.</p>
          <Button variant="secondary" size="sm" onClick={downloadTemplate}>
            <Download className="size-3.5" /> services-import-template.xlsx
          </Button>
        </li>
        <li>
          <p className="font-medium text-slate-900">2. Fill in your services</p>
          <p className="text-slate-500">New categories are created automatically. Prices are in rupees, excluding tax.</p>
        </li>
        <li>
          <p className="font-medium text-slate-900">3. Upload the file</p>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              upload.reset();
            }}
            className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
        </li>
      </ol>

      {result && (
        <div className="mt-5 rounded-lg border border-slate-200 p-4 text-sm">
          <p className="font-medium text-slate-900">
            {result.created} added · {result.updated} updated · {result.errors.length} skipped
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-rose-700">
              {result.errors.map((error) => (
                <li key={error.row}>Row {error.row}: {error.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
