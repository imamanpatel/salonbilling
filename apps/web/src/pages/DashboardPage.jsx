import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CheckCircle2, Circle, FolderTree, Scissors, UserCog, Users } from 'lucide-react';
import { ROLES, STAFF_KINDS } from '@salon/shared';
import { Card, CardHeader, cx, PageHeader } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const UPCOMING = [
  ['M3', 'Appointments', 'Calendar by service provider, online booking, check-in'],
  ['M4', 'Billing', 'Bills, split payments, GST, wallet, memberships, packages, coupons'],
  ['M5', 'Inventory', 'Products, vendors, purchases, expiry and low-stock alerts'],
  ['M7', 'Messaging', 'Automatic SMS & WhatsApp for birthdays, reminders and bills'],
];

function Stat({ icon: Icon, label, value, to }) {
  return (
    <Link to={to} className="group rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-brand-200 hover:shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <Icon className="size-4 text-slate-400 group-hover:text-brand-600" aria-hidden />
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">{value ?? '—'}</p>
    </Link>
  );
}

export default function DashboardPage() {
  const { user, branch, branchId, canManage } = useAuth();
  const services = useQuery({ queryKey: [branchId, 'services', { status: 'active' }], queryFn: () => api('/services?status=active') });
  const categories = useQuery({ queryKey: [branchId, 'service-categories'], queryFn: () => api('/service-categories') });
  const staff = useQuery({ queryKey: [branchId, 'staff', { status: 'active' }], queryFn: () => api('/staff?status=active') });

  const providers = staff.data?.filter((s) => s.kind === STAFF_KINDS.SERVICE_PROVIDER).length;
  const otherStaff = staff.data?.filter((s) => s.kind === STAFF_KINDS.STAFF).length;

  const checklist = [
    user.role === ROLES.SUPERADMIN && { label: 'Add your branch details and GSTIN', to: '/branches', done: false },
    { label: 'Review GST rates and loyalty settings', to: '/settings', done: false },
    { label: 'Add service categories and services (or import from Excel)', to: '/services', done: services.data?.length > 0 },
    { label: 'Add your service providers', to: '/staff', done: providers > 0 },
    { label: 'Create logins for your front desk team', to: '/users', done: false },
  ].filter(Boolean);

  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(' ')[0]}`} description={`Here's how ${branch?.name ?? 'your branch'} is set up.`} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Scissors} label="Active services" value={services.data?.length} to="/services" />
        <Stat icon={FolderTree} label="Service categories" value={categories.data?.length} to="/services" />
        <Stat icon={UserCog} label="Service providers" value={providers} to="/staff" />
        <Stat icon={Users} label="Other staff" value={otherStaff} to="/staff" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {canManage && (
          <Card>
            <CardHeader title="Get set up" description="Finish these so your team can start using Sabilling." />
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
        )}

        <Card>
          <CardHeader title="Coming next" description="Modules being built after this foundation release." />
          <ul className="divide-y divide-slate-100">
            {UPCOMING.map(([milestone, title, text]) => (
              <li key={milestone} className="flex gap-3 px-5 py-3 text-sm">
                <span className="mt-0.5 h-fit rounded bg-brand-50 px-1.5 py-0.5 text-xs font-semibold text-brand-700">{milestone}</span>
                <div>
                  <p className="font-medium text-slate-900">{title}</p>
                  <p className="text-slate-500">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
