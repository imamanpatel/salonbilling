import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  AlertTriangle, CalendarDays, CheckCircle2, Circle, IndianRupee, PackageX, ReceiptText, UserPlus, Users, Wallet,
} from 'lucide-react';
import { formatINR, ROLES, STAFF_KINDS } from '@salon/shared';
import { Card, CardHeader, cx, EmptyState, PageHeader, Spinner } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { formatDate } from '../lib/format.js';
import { BarChart, Tile } from '../modules/reports/components.jsx';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const STATUS_WORDS = { BOOKED: 'booked', CHECKED_IN: 'checked in', BILLED: 'billed', REQUESTED: 'requested', NO_SHOW: 'no-show' };

function appointmentHint(byStatus) {
  const parts = Object.entries(STATUS_WORDS).filter(([status]) => byStatus[status] > 0).map(([status, word]) => `${byStatus[status]} ${word}`);
  return parts.join(' · ') || 'None booked';
}

function SetupChecklist({ role, hasServices, hasProviders }) {
  const checklist = [
    role === ROLES.SUPERADMIN && { label: 'Add your branch details and GSTIN', to: '/branches', done: false },
    { label: 'Review GST rates and loyalty settings', to: '/settings', done: false },
    { label: 'Add service categories and services (or import from Excel)', to: '/services', done: hasServices },
    { label: 'Add your service providers', to: '/staff', done: hasProviders },
    { label: 'Create logins for your front desk team', to: '/users', done: false },
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader title="Get set up" description="Finish these so your team can start billing." />
      <ul className="divide-y divide-slate-100">
        {checklist.map((item) => (
          <li key={item.label}>
            <Link to={item.to} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50">
              {item.done ? (
                <CheckCircle2 className="size-5 text-emerald-500" aria-label="Done" />
              ) : (
                <Circle className="size-5 text-slate-300" aria-label="To do" />
              )}
              <span className={cx(item.done && 'text-slate-400 line-through')}>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function DashboardPage() {
  const { user, branch, branchId, canManage } = useAuth();
  const dashboard = useQuery({ queryKey: [branchId, 'dashboard'], queryFn: () => api('/dashboard'), refetchInterval: 5 * 60_000 });
  const services = useQuery({ queryKey: [branchId, 'services', { status: 'active' }], queryFn: () => api('/services?status=active'), enabled: canManage });
  const staff = useQuery({ queryKey: [branchId, 'staff', { status: 'active' }], queryFn: () => api('/staff?status=active'), enabled: canManage });

  const hasServices = services.data?.length > 0;
  const hasProviders = staff.data?.some((s) => s.kind === STAFF_KINDS.SERVICE_PROVIDER) ?? false;
  const needsSetup = canManage && services.isSuccess && staff.isSuccess && (!hasServices || !hasProviders);

  const header = <PageHeader title={`Hello, ${user.name.split(' ')[0]}`} description={`Here's how ${branch?.name ?? 'your branch'} is doing today.`} />;

  if (dashboard.isPending) {
    return (
      <>
        {header}
        <Spinner className="mx-auto mt-16 size-8" />
      </>
    );
  }
  if (dashboard.error) {
    return (
      <>
        {header}
        <p className="text-sm text-rose-600">{dashboard.error.message}</p>
      </>
    );
  }

  const { today, duesOutstandingPaise, lowStockCount, last30Days, topServicesThisMonth } = dashboard.data;
  const chartTotal = last30Days?.reduce((sum, day) => sum + day.salesPaise, 0) ?? 0;

  return (
    <>
      {header}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {canManage && (
          <>
            <Tile color="emerald" icon={IndianRupee} label="Sales today" value={formatINR(today.salesPaise)} hint={plural(today.bills, 'bill')} to="/reports?report=daily-summary&preset=today" />
            <Tile color="sky" icon={Wallet} label="Cash collected today" value={formatINR(today.collectionsPaise)} hint="Excludes wallet and gift cards" to="/reports?report=collections&preset=today" />
            <Tile color="violet" icon={ReceiptText} label="Bills today" value={today.bills} to="/bills" />
          </>
        )}
        <Tile color="brand" icon={CalendarDays} label="Appointments today" value={today.appointments.total} hint={appointmentHint(today.appointments.byStatus)} to="/appointments" />
        <Tile color="rose" icon={Users} label="Client visits" value={today.clientVisits} hint={`${plural(today.newClients, 'new client')} added today`} to="/clients" />
        <Tile color="amber" icon={UserPlus} label="New enquiries" value={today.newEnquiries} to="/enquiries" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Tile
          icon={AlertTriangle}
          label="Dues outstanding"
          value={formatINR(duesOutstandingPaise)}
          hint="Unpaid balances on bills"
          to="/bills?status=DUE"
          color="slate"
          tone={duesOutstandingPaise > 0 ? 'alert' : 'default'}
        />
        <Tile
          icon={PackageX}
          label="Low stock"
          value={plural(lowStockCount, 'product')}
          hint="At or below their alert level"
          to="/products?lowStock=true"
          color="slate"
          tone={lowStockCount > 0 ? 'alert' : 'default'}
        />
      </div>

      {(canManage || needsSetup) && (
        <div className="mt-6 grid gap-6 xl:grid-cols-3">
          {canManage && last30Days && (
            <Card className="xl:col-span-2">
              <CardHeader title="Sales, last 30 days" description={`${formatINR(chartTotal)} in total`} />
              <div className="p-5">
                <BarChart
                  label="Sales per day for the last 30 days"
                  bars={last30Days.map((day) => ({
                    key: day.date,
                    value: day.salesPaise,
                    title: `${formatDate(day.date)}: ${formatINR(day.salesPaise)} · ${plural(day.bills, 'bill')}`,
                  }))}
                  startLabel={formatDate(last30Days[0].date)}
                  endLabel="Today"
                />
              </div>
            </Card>
          )}
          {canManage && topServicesThisMonth && (
            <Card>
              <CardHeader title="Top services this month" />
              {topServicesThisMonth.length === 0 ? (
                <EmptyState title="No services billed yet this month" />
              ) : (
                <ol className="divide-y divide-slate-100">
                  {topServicesThisMonth.map((service, index) => (
                    <li key={service.serviceId} className="flex items-center gap-3 px-5 py-3 text-sm">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900">{service.name}</p>
                        <p className="text-xs text-slate-500">{plural(service.qty, 'time')}</p>
                      </div>
                      <span className="font-medium text-slate-900 tabular-nums">{formatINR(service.salesPaise)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}
          {needsSetup && <SetupChecklist role={user.role} hasServices={hasServices} hasProviders={hasProviders} />}
        </div>
      )}
    </>
  );
}
