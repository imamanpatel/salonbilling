import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller } from 'react-hook-form';
import { Pencil, Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ROLES, userCreateSchema, userUpdateSchema } from '@salon/shared';
import { Badge, Button, Card, Checkbox, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, StatusBadge } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { formatDateTime, ROLE_LABELS } from '../lib/format.js';
import { useApiForm } from '../lib/useApiForm.js';

const ROLE_TONES = { SUPERADMIN: 'brand', ADMIN: 'blue', USER: 'slate' };

export default function UsersPage() {
  const { user: me, branches: myBranches } = useAuth();
  const isSuper = me.role === ROLES.SUPERADMIN;
  const [editing, setEditing] = useState(null);

  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users') });
  const allBranches = useQuery({ queryKey: ['branches'], queryFn: () => api('/branches'), enabled: isSuper });

  // Superadmins can assign any branch (inactive ones included, so saving never drops them); admins only their own.
  const branchOptions = isSuper ? (allBranches.data ?? []) : myBranches;
  const branchNames = new Map([...myBranches, ...(allBranches.data ?? [])].map((b) => [b.id, b.name]));
  const canEdit = (u) => u.id !== me.id && u.role !== ROLES.SUPERADMIN && (isSuper || u.role === ROLES.USER);

  const columns = [
    {
      key: 'name',
      header: 'User',
      render: (u) => (
        <div>
          <div className="font-medium text-slate-900">
            {u.name} {u.id === me.id && <span className="text-xs font-normal text-slate-500">(you)</span>}
          </div>
          <div className="text-xs text-slate-500">{u.username}</div>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (u) => <Badge tone={ROLE_TONES[u.role]}>{ROLE_LABELS[u.role]}</Badge> },
    {
      key: 'branches',
      header: 'Branches',
      render: (u) => (u.role === ROLES.SUPERADMIN ? 'All branches' : u.branchIds.map((id) => branchNames.get(id) ?? 'Other').join(', ')),
    },
    { key: 'lastLoginAt', header: 'Last sign-in', render: (u) => formatDateTime(u.lastLoginAt) },
    { key: 'status', header: 'Status', render: (u) => <StatusBadge active={u.isActive} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (u) =>
        canEdit(u) && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can sign in, what they can do, and which branches they can see."
        actions={
          <Button onClick={() => setEditing({})} disabled={isSuper && allBranches.isPending}>
            <Plus className="size-4" /> Add user
          </Button>
        }
      />
      <Card>
        <DataTable
          columns={columns}
          rows={users.data}
          loading={users.isPending}
          error={users.error}
          empty={<EmptyState icon={ShieldCheck} title="No users yet" />}
        />
      </Card>
      {editing && <UserFormModal account={editing} isSuper={isSuper} branchOptions={branchOptions} onClose={() => setEditing(null)} />}
    </>
  );
}

function UserFormModal({ account, isSuper, branchOptions, onClose }) {
  const queryClient = useQueryClient();
  const isNew = !account.id;

  const form = useApiForm({
    schema: isNew ? userCreateSchema : userUpdateSchema,
    defaultValues: {
      name: account.name ?? '',
      username: account.username ?? '',
      password: '',
      role: account.role ?? ROLES.USER,
      branchIds: account.branchIds ?? (branchOptions.length === 1 ? [branchOptions[0].id] : []),
      isActive: account.isActive ?? true,
    },
    onSubmit: async (payload) => {
      await api(isNew ? '/users' : `/users/${account.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? `${payload.name} can now sign in` : 'User updated');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  const { register, control, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={isNew ? 'Add user' : `Edit ${account.name}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="user-form" loading={isSubmitting}>{isNew ? 'Create user' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="user-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.name?.message} required>
          <Input autoFocus invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field label="Username" hint={isNew ? 'Used to sign in; cannot be changed later' : undefined} error={errors.username?.message} required>
          <Input autoComplete="off" disabled={!isNew} invalid={!!errors.username} {...register('username')} />
        </Field>
        <Field
          label={isNew ? 'Password' : 'New password'}
          hint={isNew ? 'At least 8 characters' : 'Leave blank to keep the current password'}
          error={errors.password?.message}
          required={isNew}
        >
          <Input type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} />
        </Field>
        <Field label="Role" error={errors.role?.message} required>
          <Select disabled={!isSuper} {...register('role')}>
            {isSuper && <option value={ROLES.ADMIN}>{ROLE_LABELS.ADMIN} — manages services, staff, settings</option>}
            <option value={ROLES.USER}>{ROLE_LABELS.USER} — day-to-day operations</option>
          </Select>
        </Field>

        <Field as="div" label="Branch access" error={errors.branchIds?.message} required className="sm:col-span-2">
          <Controller
            control={control}
            name="branchIds"
            render={({ field }) => (
              <div className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
                {branchOptions.map((b) => (
                  <Checkbox
                    key={b.id}
                    label={b.name}
                    description={b.isActive === false ? 'Inactive branch' : undefined}
                    checked={field.value.includes(b.id)}
                    onChange={(e) =>
                      field.onChange(e.target.checked ? [...field.value, b.id] : field.value.filter((id) => id !== b.id))
                    }
                  />
                ))}
              </div>
            )}
          />
        </Field>

        {!isNew && (
          <Checkbox
            className="sm:col-span-2"
            label="Account is active"
            description="Deactivating signs the user out everywhere."
            {...register('isActive')}
          />
        )}
      </form>
    </Modal>
  );
}
