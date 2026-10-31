import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import {
  Building2, KeyRound, LayoutDashboard, ListChecks, LogOut, Menu, Scissors, Settings, ShieldCheck, UserCog, UserPlus, Users, X,
} from 'lucide-react';
import { ROLES } from '@salon/shared';
import { useAuth } from '../lib/auth.jsx';
import { ROLE_LABELS } from '../lib/format.js';
import { moduleNav } from '../modules.js';
import { Button, cx, Select } from './ui.jsx';

const MANAGERS = [ROLES.SUPERADMIN, ROLES.ADMIN];

// Sidebar groups in display order. Feature modules add items to these groups (see src/modules.js).
const GROUPS = ['', 'Front desk', 'Catalogue', 'Inventory', 'Team', 'Business', 'Admin'];

const CORE_NAV = [
  { group: '', to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, order: 0 },
  { group: 'Front desk', to: '/today', label: 'Today', icon: ListChecks, order: 10 },
  { group: 'Front desk', to: '/clients', label: 'Clients', icon: Users, order: 40 },
  { group: 'Front desk', to: '/enquiries', label: 'Enquiries', icon: UserPlus, order: 50 },
  { group: 'Catalogue', to: '/services', label: 'Services', icon: Scissors, order: 10 },
  { group: 'Team', to: '/staff', label: 'Staff', icon: UserCog, order: 10 },
  { group: 'Admin', to: '/settings', label: 'Settings', icon: Settings, end: true, order: 10, roles: MANAGERS },
  { group: 'Admin', to: '/users', label: 'Users', icon: ShieldCheck, order: 80, roles: MANAGERS },
  { group: 'Admin', to: '/branches', label: 'Branches', icon: Building2, order: 90, roles: [ROLES.SUPERADMIN] },
];

function navFor(role) {
  const items = [...CORE_NAV, ...moduleNav].filter((item) => !item.roles || item.roles.includes(role));
  return GROUPS.map((title) => ({
    title,
    items: items.filter((item) => (item.group ?? '') === title).sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
  })).filter((group) => group.items.length > 0);
}

function Sidebar({ role }) {
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4" aria-label="Main">
      {navFor(role).map((group) => (
        <div key={group.title || 'main'}>
          {group.title && <p className="mb-1 px-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">{group.title}</p>}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cx(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    )
                  }
                >
                  <item.icon className="size-4" aria-hidden />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const initials = user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
        <span className="grid size-8 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{initials}</span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm leading-tight font-medium text-slate-900">{user.name}</span>
          <span className="block text-xs leading-tight text-slate-500">{ROLE_LABELS[user.role]}</span>
        </span>
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
        <Link to="/account" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
          <KeyRound className="size-4" aria-hidden /> Account & password
        </Link>
        <button type="button" onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
          <LogOut className="size-4" aria-hidden /> Sign out
        </button>
      </div>
    </details>
  );
}

export default function AppLayout() {
  const { user, organization, branches, branchId, switchBranch } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
    document.querySelectorAll('details[open]').forEach((el) => el.removeAttribute('open'));
  }, [location.pathname]);

  const brand = (
    <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5">
      <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">S</span>
      <div className="min-w-0">
        <p className="text-sm leading-tight font-semibold text-slate-900">Sabilling</p>
        <p className="truncate text-xs leading-tight text-slate-500">{organization?.name}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        {brand}
        <Sidebar role={user.role} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="relative">
              {brand}
              <Button variant="ghost" size="icon" className="absolute top-4 right-3" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <X className="size-4" />
              </Button>
            </div>
            <Sidebar role={user.role} />
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Building2 className="hidden size-4 text-slate-400 sm:block" aria-hidden />
          {branches.length > 1 ? (
            <Select aria-label="Branch" value={branchId ?? ''} onChange={(e) => switchBranch(e.target.value)} className="sm:w-auto sm:max-w-56">
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          ) : (
            <span className="truncate text-sm font-medium text-slate-700">{branches[0]?.name ?? 'No branch'}</span>
          )}
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {branchId ? (
          <Outlet />
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            You are not assigned to an active branch yet. Ask your administrator to give you access to a branch.
          </div>
        )}
      </main>
    </div>
  );
}
