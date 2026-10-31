import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Crown, Pencil, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR, paiseToRupees } from '@salon/shared';
import { membershipPlanSchema } from '@salon/shared/catalogue';
import {
  Badge, Button, Card, Checkbox, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, StatusBadge, Tabs, Textarea,
} from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, moneyInput } from '../../lib/format.js';
import { useApiForm } from '../../lib/useApiForm.js';
import { formatDays, STATUS_FILTERS } from './format.js';

const TABS = [
  { value: 'plans', label: 'Plans' },
  { value: 'members', label: 'Members' },
];

/** Short benefit list for the plans table. */
function benefits(plan) {
  const list = [];
  if (plan.useMemberPrices) list.push('Member prices on services');
  if (plan.productDiscountPct > 0) list.push(`${plan.productDiscountPct}% off products`);
  if (plan.packageDiscountPct > 0) list.push(`${plan.packageDiscountPct}% off packages`);
  if (plan.pointsMultiplier > 1) list.push(`${plan.pointsMultiplier}× reward points`);
  if (plan.rewardPoints > 0) list.push(`${plan.rewardPoints} welcome points`);
  return list;
}

export default function MembershipsPage() {
  const [tab, setTab] = useState('plans');
  return (
    <>
      <PageHeader
        title="Memberships"
        description="Paid plans that give clients member prices, discounts and bonus reward points for a period."
        actions={<Tabs tabs={TABS} value={tab} onChange={setTab} />}
      />
      {tab === 'plans' ? <PlansTab /> : <MembersTab />}
    </>
  );
}

function PlansTab() {
  const { branchId, canManage } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('active');
  const [editing, setEditing] = useState(null); // null | {} (new) | plan

  const plans = useQuery({ queryKey: [branchId, 'membership-plans', { status }], queryFn: () => api(`/memberships?status=${status}`) });

  const toggleStatus = useMutation({
    mutationFn: (plan) => api(`/memberships/${plan.id}/status`, { method: 'PATCH', body: { isActive: !plan.isActive } }),
    onSuccess: (plan) => {
      toast.success(`${plan.name} ${plan.isActive ? 'activated' : 'deactivated'}`);
      queryClient.invalidateQueries({ queryKey: [branchId, 'membership-plans'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const columns = [
    {
      key: 'name',
      header: 'Plan',
      render: (p) => (
        <div className="max-w-xs">
          <div className="font-medium text-slate-900">{p.name}</div>
          {p.description && <div className="truncate text-xs text-slate-500">{p.description}</div>}
        </div>
      ),
    },
    { key: 'price', header: 'Price', className: 'text-right tabular-nums', render: (p) => formatINR(p.pricePaise) },
    { key: 'duration', header: 'Duration', render: (p) => formatDays(p.durationDays) },
    {
      key: 'benefits',
      header: 'Benefits',
      render: (p) => {
        const list = benefits(p);
        return list.length ? (
          <div className="flex max-w-sm flex-wrap gap-1">
            {list.map((b) => (
              <Badge key={b} tone="brand">{b}</Badge>
            ))}
          </div>
        ) : (
          <span className="text-slate-400">None</span>
        );
      },
    },
    { key: 'members', header: 'Active members', className: 'text-right tabular-nums', render: (p) => p.activeMembers },
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
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-auto">
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
          {canManage && (
            <Button onClick={() => setEditing({})}>
              <Plus className="size-4" /> Add plan
            </Button>
          )}
        </div>
        <DataTable
          columns={columns}
          rows={plans.data}
          loading={plans.isPending}
          error={plans.error}
          empty={
            status !== 'active' ? (
              <EmptyState title="No plans match this filter" />
            ) : (
              <EmptyState
                icon={Crown}
                title="No membership plans yet"
                description="Create a plan such as “Gold – 1 year” and sell it to clients at billing."
                action={canManage && <Button onClick={() => setEditing({})}>Add plan</Button>}
              />
            )
          }
        />
      </Card>

      {editing && <PlanFormModal plan={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PlanFormModal({ plan, onClose }) {
  const { branchId } = useAuth();
  const queryClient = useQueryClient();
  const isNew = !plan.id;

  const form = useApiForm({
    schema: membershipPlanSchema,
    defaultValues: {
      name: plan.name ?? '',
      description: plan.description ?? '',
      pricePaise: isNew ? '' : paiseToRupees(plan.pricePaise),
      durationDays: plan.durationDays ?? 365,
      useMemberPrices: plan.useMemberPrices ?? true,
      productDiscountPct: plan.productDiscountPct ?? 0,
      packageDiscountPct: plan.packageDiscountPct ?? 0,
      pointsMultiplier: plan.pointsMultiplier ?? 1,
      rewardPoints: plan.rewardPoints ?? 0,
    },
    toPayload: (values) => ({ ...values, pricePaise: moneyInput(values.pricePaise), isActive: plan.isActive ?? true }),
    onSubmit: async (payload) => {
      await api(isNew ? '/memberships' : `/memberships/${plan.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      toast.success(isNew ? 'Plan added' : 'Plan updated');
      queryClient.invalidateQueries({ queryKey: [branchId, 'membership-plans'] });
      onClose();
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;

  return (
    <Modal
      title={isNew ? 'Add membership plan' : 'Edit membership plan'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="plan-form" loading={isSubmitting}>{isNew ? 'Add plan' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={form.submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Plan name" error={errors.name?.message} required className="sm:col-span-2">
          <Input autoFocus placeholder="e.g. Gold – 1 year" invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
          <Textarea rows={2} invalid={!!errors.description} {...register('description')} />
        </Field>
        <Field label="Price (₹)" hint="What the client pays for the membership" error={errors.pricePaise?.message} required>
          <Input inputMode="decimal" placeholder="0.00" invalid={!!errors.pricePaise} {...register('pricePaise')} />
        </Field>
        <Field label="Duration (days)" hint="365 for a year, counted from the day it is bought" error={errors.durationDays?.message} required>
          <Input type="number" min={1} max={3650} invalid={!!errors.durationDays} {...register('durationDays')} />
        </Field>

        <div className="space-y-4 rounded-lg border border-slate-200 p-4 sm:col-span-2">
          <p className="text-sm font-semibold text-slate-900">Member benefits</p>
          <Checkbox
            label="Member prices on services"
            description="Members are billed each service's member price (set on the Services page) instead of the regular price."
            {...register('useMemberPrices')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Discount on products (%)" hint="Taken off retail products on a member's bill. 0 for none." error={errors.productDiscountPct?.message}>
              <Input type="number" min={0} max={100} step="0.01" invalid={!!errors.productDiscountPct} {...register('productDiscountPct')} />
            </Field>
            <Field label="Discount on packages (%)" hint="Taken off packages a member buys. 0 for none." error={errors.packageDiscountPct?.message}>
              <Input type="number" min={0} max={100} step="0.01" invalid={!!errors.packageDiscountPct} {...register('packageDiscountPct')} />
            </Field>
            <Field label="Reward points multiplier" hint="Points earned on bills are multiplied by this. 1 = no boost, 2 = double." error={errors.pointsMultiplier?.message}>
              <Select invalid={!!errors.pointsMultiplier} {...register('pointsMultiplier')}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n === 1 ? '1× (no boost)' : `${n}×`}</option>
                ))}
              </Select>
            </Field>
            <Field label="Welcome points" hint="Reward points credited once when the membership is bought." error={errors.rewardPoints?.message}>
              <Input type="number" min={0} invalid={!!errors.rewardPoints} {...register('rewardPoints')} />
            </Field>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function MembersTab() {
  const { branchId } = useAuth();
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);

  const params = { status, page };
  const members = useQuery({
    queryKey: [branchId, 'memberships', params],
    queryFn: () => api(`/memberships/members?${new URLSearchParams(params)}`),
    placeholderData: keepPreviousData,
  });

  const columns = [
    {
      key: 'client',
      header: 'Client',
      render: (m) => (
        <Link to={`/clients?view=${m.client.id}`} className="block">
          <span className="block font-medium text-slate-900 hover:text-brand-700">{m.client.name}</span>
          <span className="block text-xs text-slate-500">{m.client.phone}</span>
        </Link>
      ),
    },
    { key: 'plan', header: 'Plan', render: (m) => m.planName },
    { key: 'startsOn', header: 'Started', render: (m) => formatDate(m.startsOn) },
    { key: 'endsOn', header: 'Ends', render: (m) => formatDate(m.endsOn) },
    {
      key: 'status',
      header: 'Status',
      render: (m) => {
        if (m.cancelledAt) return <Badge tone="rose">Cancelled</Badge>;
        return m.active ? <Badge tone="green">Active</Badge> : <Badge>Expired</Badge>;
      },
    },
  ];

  return (
    <Card>
      <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="sm:w-auto"
        >
          <option value="active">Active</option>
          <option value="expired">Expired or cancelled</option>
          <option value="all">All</option>
        </Select>
      </div>
      <DataTable
        columns={columns}
        rows={members.data?.items}
        loading={members.isPending}
        error={members.error}
        empty={
          <EmptyState
            icon={Users}
            title={status === 'active' ? 'No active members' : 'No members match this filter'}
            description="Memberships are sold to clients at billing."
          />
        }
      />
      {members.data && <Pagination page={members.data.page} pageSize={members.data.pageSize} total={members.data.total} onChange={setPage} />}
    </Card>
  );
}
