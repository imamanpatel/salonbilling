import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { DEPARTMENTS, formatINR, GENDERS, paiseToRupees, STAFF_KINDS, staffSchema } from '@salon/shared';
import { Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { formatDate, GENDER_LABELS, moneyInput, todayIso } from '../lib/format.js';
import { useDebounced } from '../lib/hooks.js';
import { useApiForm } from '../lib/useApiForm.js';

const KIND_TABS = [
  { value: STAFF_KINDS.SERVICE_PROVIDER, label: 'Service providers' },
  { value: STAFF_KINDS.STAFF, label: 'Other staff' },
];

export default function StaffPage() {
  const { branchId, canManage } = useAuth();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState(STAFF_KINDS.SERVICE_PROVIDER);
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const q = useDebounced(search.trim());
  const isProvider = kind === STAFF_KINDS.SERVICE_PROVIDER;

  const params = { kind, status, q };
  const staff = useQuery({ queryKey: [branchId, 'staff', params], queryFn: () => api(`/staff?${new URLSearchParams(params)}`) });

  const toggleStatus = useMutation({
    mutationFn: (member) => api(`/staff/${member.id}/status`, { method: 'PATCH', body: { isActive: !member.isActive } }),
    onSuccess: (member) => {
      toast.success(`${member.name} ${member.isActive ? 'activated' : 'deactivated'}`);
      queryClient.invalidateQueries({ queryKey: [branchId, 'staff'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (s) => (
        <div>
          <div className="font-medium text-slate-900">{s.name}</div>
          <div className="text-xs text-slate-500">{(isProvider ? s.designation : s.department) || GENDER_LABELS[s.gender]}</div>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', render: (s) => <a href={`tel:${s.phone}`} className="hover:text-brand-700">{s.phone}</a> },
    { key: 'shift', header: 'Shift', className: 'whitespace-nowrap', render: (s) => (s.shiftStart && s.shiftEnd ? `${s.shiftStart} – ${s.shiftEnd}` : '—') },
    { key: 'joinedOn', header: 'Joined', className: 'whitespace-nowrap', render: (s) => formatDate(s.joinedOn) },
    isProvider && {
      key: 'commission',
      header: 'Commission',
      render: (s) => (
        <span className="text-xs">
          {s.serviceCommissionPct}% services · {s.productCommissionPct}% products
        </span>
      ),
    },
    canManage && { key: 'salary', header: 'Monthly salary', className: 'text-right tabular-nums', render: (s) => formatINR(s.monthlySalaryPaise) },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge active={s.isActive} /> },
    canManage && {
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
    },
  ].filter(Boolean);

  const noun = isProvider ? 'service provider' : 'staff member';

  return (
    <>
      <PageHeader
        title="Staff"
        description="Service providers do the services and earn commission; other staff run the front desk and back office."
        actions={
          canManage && (
            <Button onClick={() => setEditing({})}>
              <Plus className="size-4" /> Add {noun}
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <Tabs tabs={KIND_TABS} value={kind} onChange={setKind} />
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input type="search" placeholder="Search name or phone" aria-label="Search staff" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-auto">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={staff.data}
          loading={staff.isPending}
          error={staff.error}
          empty={
            <EmptyState
              icon={UserCog}
              title={q || status !== 'active' ? `No ${noun}s match` : `No ${noun}s yet`}
              action={canManage && !q && <Button onClick={() => setEditing({})}>Add {noun}</Button>}
            />
          }
        />
      </Card>

      {editing && <StaffFormModal member={editing} kind={kind} onClose={() => setEditing(null)} />}
    </>
  );
}

function StaffFormModal({ member, kind, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const isNew = !member.id;
  const staffKind = member.kind ?? kind;
  const isProvider = staffKind === STAFF_KINDS.SERVICE_PROVIDER;
  const noun = isProvider ? 'service provider' : 'staff member';

  const form = useApiForm({
    schema: staffSchema,
    defaultValues: {
      name: member.name ?? '',
      phone: member.phone ?? '',
      email: member.email ?? '',
      gender: member.gender ?? 'FEMALE',
      dob: member.dob ?? '',
      joinedOn: member.joinedOn ?? todayIso(),
      address: member.address ?? '',
      emergencyName: member.emergencyName ?? '',
      emergencyPhone: member.emergencyPhone ?? '',
      monthlySalaryPaise: isNew ? '' : paiseToRupees(member.monthlySalaryPaise),
      shiftStart: member.shiftStart ?? '',
      shiftEnd: member.shiftEnd ?? '',
      serviceCommissionPct: member.serviceCommissionPct ?? 0,
      productCommissionPct: member.productCommissionPct ?? 0,
      designation: member.designation ?? '',
      department: member.department ?? '',
      attendanceCode: member.attendanceCode ?? '',
    },
    toPayload: (values) => ({
      ...values,
      kind: staffKind,
      monthlySalaryPaise: moneyInput(values.monthlySalaryPaise),
      isActive: member.isActive ?? true,
      ...(isProvider ? { department: null } : { designation: null, serviceCommissionPct: 0, productCommissionPct: 0 }),
    }),
    onSubmit: async (payload) => {
      await api(isNew ? '/staff' : `/staff/${member.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? `${payload.name} added` : 'Changes saved');
      queryClient.invalidateQueries({ queryKey: [branchId, 'staff'] });
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={isNew ? `Add ${noun}` : `Edit ${member.name}`}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="staff-form" loading={isSubmitting}>{isNew ? `Add ${noun}` : 'Save changes'}</Button>
        </>
      }
    >
      <form id="staff-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Full name" error={errors.name?.message} required>
          <Input autoFocus invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field label="Phone" error={errors.phone?.message} required>
          <Input type="tel" inputMode="tel" placeholder="10-digit mobile" invalid={!!errors.phone} {...register('phone')} />
        </Field>
        <Field label="Gender" error={errors.gender?.message} required>
          <Select {...register('gender')}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{GENDER_LABELS[g]}</option>
            ))}
          </Select>
        </Field>

        {isProvider ? (
          <Field label="Designation" hint="e.g. Senior stylist, Beautician" error={errors.designation?.message}>
            <Input invalid={!!errors.designation} {...register('designation')} />
          </Field>
        ) : (
          <Field label="Department" error={errors.department?.message}>
            <Select {...register('department')}>
              <option value="">—</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" invalid={!!errors.email} {...register('email')} />
        </Field>
        <Field label="Attendance ID" hint="ID on the biometric device, if any" error={errors.attendanceCode?.message}>
          <Input invalid={!!errors.attendanceCode} {...register('attendanceCode')} />
        </Field>

        <Field label="Date of joining" error={errors.joinedOn?.message} required>
          <Input type="date" invalid={!!errors.joinedOn} {...register('joinedOn')} />
        </Field>
        <Field label="Date of birth" error={errors.dob?.message}>
          <Input type="date" invalid={!!errors.dob} {...register('dob')} />
        </Field>
        <Field label="Monthly salary (₹)" error={errors.monthlySalaryPaise?.message} required>
          <Input inputMode="decimal" placeholder="0.00" invalid={!!errors.monthlySalaryPaise} {...register('monthlySalaryPaise')} />
        </Field>

        <Field label="Shift starts" error={errors.shiftStart?.message}>
          <Input type="time" invalid={!!errors.shiftStart} {...register('shiftStart')} />
        </Field>
        <Field label="Shift ends" error={errors.shiftEnd?.message}>
          <Input type="time" invalid={!!errors.shiftEnd} {...register('shiftEnd')} />
        </Field>
        <div className="hidden lg:block" />

        {isProvider && (
          <>
            <Field label="Commission on services (%)" error={errors.serviceCommissionPct?.message}>
              <Input type="number" min={0} max={100} step="0.5" invalid={!!errors.serviceCommissionPct} {...register('serviceCommissionPct')} />
            </Field>
            <Field label="Commission on products (%)" error={errors.productCommissionPct?.message}>
              <Input type="number" min={0} max={100} step="0.5" invalid={!!errors.productCommissionPct} {...register('productCommissionPct')} />
            </Field>
            <div className="hidden lg:block" />
          </>
        )}

        <Field label="Emergency contact name" error={errors.emergencyName?.message}>
          <Input invalid={!!errors.emergencyName} {...register('emergencyName')} />
        </Field>
        <Field label="Emergency contact phone" error={errors.emergencyPhone?.message}>
          <Input type="tel" inputMode="tel" invalid={!!errors.emergencyPhone} {...register('emergencyPhone')} />
        </Field>
        <Field label="Address" error={errors.address?.message} className="sm:col-span-2 lg:col-span-3">
          <Textarea rows={2} invalid={!!errors.address} {...register('address')} />
        </Field>
      </form>
    </Modal>
  );
}
