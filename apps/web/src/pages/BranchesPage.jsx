import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { branchSchema } from '@salon/shared';
import { Button, Card, Checkbox, DataTable, EmptyState, Field, Input, Modal, PageHeader, StatusBadge, Textarea } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApiForm } from '../lib/useApiForm.js';

export default function BranchesPage() {
  const [editing, setEditing] = useState(null);
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api('/branches') });

  const columns = [
    {
      key: 'name',
      header: 'Branch',
      render: (b) => (
        <div>
          <div className="font-medium text-slate-900">{b.name}</div>
          <div className="text-xs text-slate-500">{b.salonName}</div>
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      render: (b) => (
        <div className="text-xs">
          <div>{b.phone ?? '—'}</div>
          <div className="text-slate-500">{b.email}</div>
        </div>
      ),
    },
    { key: 'gstin', header: 'GSTIN', render: (b) => b.gstin ?? '—' },
    { key: 'hours', header: 'Hours', render: (b) => `${b.openTime} – ${b.closeTime}` },
    { key: 'status', header: 'Status', render: (b) => <StatusBadge active={b.isActive} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (b) => (
        <Button variant="ghost" size="sm" onClick={() => setEditing(b)}>
          <Pencil className="size-3.5" /> Edit
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Branches"
        description="Each branch has its own services, staff, taxes and settings."
        actions={
          <Button onClick={() => setEditing({})}>
            <Plus className="size-4" /> Add branch
          </Button>
        }
      />
      <Card>
        <DataTable
          columns={columns}
          rows={branches.data}
          loading={branches.isPending}
          error={branches.error}
          empty={<EmptyState icon={Building2} title="No branches yet" />}
        />
      </Card>
      {editing && <BranchFormModal branch={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function BranchFormModal({ branch, onClose }) {
  const { refresh } = useAuth();
  const queryClient = useQueryClient();
  const isNew = !branch.id;

  const form = useApiForm({
    schema: branchSchema,
    defaultValues: {
      name: branch.name ?? '',
      salonName: branch.salonName ?? '',
      phone: branch.phone ?? '',
      email: branch.email ?? '',
      website: branch.website ?? '',
      gstin: branch.gstin ?? '',
      address: branch.address ?? '',
      openTime: branch.openTime ?? '10:00',
      closeTime: branch.closeTime ?? '20:00',
      isActive: branch.isActive ?? true,
    },
    onSubmit: async (payload) => {
      await api(isNew ? '/branches' : `/branches/${branch.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? `Branch "${payload.name}" created with default GST rates` : 'Branch updated');
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      await refresh();
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={isNew ? 'Add branch' : `Edit ${branch.name}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="branch-form" loading={isSubmitting}>{isNew ? 'Create branch' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="branch-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Branch name" hint="Shown in the branch switcher, e.g. Andheri" error={errors.name?.message} required>
          <Input autoFocus invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field label="Salon name on bills" error={errors.salonName?.message} required>
          <Input invalid={!!errors.salonName} {...register('salonName')} />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <Input type="tel" invalid={!!errors.phone} {...register('phone')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" invalid={!!errors.email} {...register('email')} />
        </Field>
        <Field label="GSTIN" error={errors.gstin?.message}>
          <Input className="uppercase" maxLength={15} invalid={!!errors.gstin} {...register('gstin')} />
        </Field>
        <Field label="Website" error={errors.website?.message}>
          <Input invalid={!!errors.website} {...register('website')} />
        </Field>
        <Field label="Opens at" error={errors.openTime?.message} required>
          <Input type="time" invalid={!!errors.openTime} {...register('openTime')} />
        </Field>
        <Field label="Closes at" error={errors.closeTime?.message} required>
          <Input type="time" invalid={!!errors.closeTime} {...register('closeTime')} />
        </Field>
        <Field label="Address" error={errors.address?.message} className="sm:col-span-2">
          <Textarea rows={2} invalid={!!errors.address} {...register('address')} />
        </Field>
        {!isNew && (
          <Checkbox
            className="sm:col-span-2"
            label="Branch is active"
            description="Inactive branches disappear from the branch switcher."
            {...register('isActive')}
          />
        )}
      </form>
    </Modal>
  );
}
