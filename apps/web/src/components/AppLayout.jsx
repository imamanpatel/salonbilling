import { useEffect, useState } from 'react';
import { Link, matchPath, NavLink, Outlet, useLocation } from 'react-router';
import {
  Building2, ChevronDown, KeyRound, LayoutDashboard, ListChecks, LogOut, Menu, Scissors, Settings, ShieldCheck, UserCog, UserPlus, Users, X,
} from 'lucide-react';
import { ROLES } from '@salon/shared';
import { useAuth } from '../lib/auth.jsx';
import { APP_INITIAL, APP_NAME } from '../lib/brand.js';
import { ROLE_LABELS } from '../lib/format.js';
import { moduleNav } from '../modules.js';
import { Button, cx, Select } from './ui.jsx';

const MANAGERS = [ROLES.SUPERADMIN, ROLES.ADMIN];

// Menu groups in display order. Feature modules add items to these groups (see src/modules.js).
const GROUPS = ['', 'Front desk', 'Catalogue', 'Inventory', 'Team', 'Business', 'Admin'];
// Shown as direct links in the top menu when there is room; every other group is a dropdown.
const DIRECT_GROUP = 'Front desk';

const CORE_NAV = [
  { group: '', to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, order: 0 },
  { group: 'Front desk', to: '/today', label: 'Today', icon: ListChecks, order: 10 },
  { group: 'Front desk', to: '/clients', label: 'Clients', icon: Users, order: 40 },
  { group: 'Front desk', to: '/enquiries', label: 'Enquiries', icon: UserPlus, order: 50 },
  { group: 'Catalogue', to: '/services', label: 'Services', icon: Scissors, order: 10 },
  { group: 'Team', to: '/staff', label: 'Staff', icon: UserCog, order: 10, roles: MANAGERS },
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

// Each menu group has its own colour, used for its icons so pages are easy to tell apart at a glance.
const GROUP_TONES = {
  '': 'bg-brand-100 text-brand-600',
  'Front desk': 'bg-rose-100 text-rose-600',
  Catalogue: 'bg-violet-100 text-violet-600',
  Inventory: 'bg-amber-100 text-amber-700',
  Team: 'bg-sky-100 text-sky-600',
  Business: 'bg-emerald-100 text-emerald-600',
  Admin: 'bg-slate-200 text-slate-600',
};
const ACTIVE_PILL = 'bg-linear-to-r from-brand-600 to-fuchsia-600 text-white shadow-sm shadow-brand-600/25';

const topLinkClass = ({ isActive }) =>
  cx(
    'rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
    isActive ? ACTIVE_PILL : 'text-slate-600 hover:bg-brand-50 hover:text-brand-700',
  );

function IconChip({ icon: Icon, group }) {
  return (
    <span className={cx('grid size-7 shrink-0 place-items-center rounded-lg', GROUP_TONES[group] ?? GROUP_TONES[''])}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

/** Dropdown in the top menu. A <details> element, closed on outside click and route change by AppLayout. */
function NavMenu({ title, items, pathname }) {
  const active = items.some((item) => matchPath({ path: item.to, end: Boolean(item.end) }, pathname));
  return (
    <details className="group relative">
      <summary
        className={cx(
          'flex cursor-pointer list-none items-center gap-1 rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors [&::-webkit-details-marker]:hidden',
          active ? ACTIVE_PILL : 'text-slate-600 hover:bg-brand-50 hover:text-brand-700',
        )}
      >
        {title}
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="absolute left-0 z-40 mt-2 w-60 rounded-xl border border-brand-100 bg-white p-1.5 shadow-xl shadow-brand-900/10">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cx('flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm', isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700 hover:bg-slate-50')
            }
          >
            <IconChip icon={item.icon} group={title} />
            {item.label}
          </NavLink>
        ))}
      </div>
    </details>
  );
}

/** Desktop menu bar. The front-desk pages are direct links on wide screens and a dropdown on narrower ones. */
function TopNav({ role }) {
  const { pathname } = useLocation();
  return (
    <nav className="flex h-12 items-center gap-0.5" aria-label="Main">
      {navFor(role).map((group) => {
        if (!group.title) {
          return group.items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={topLinkClass}>{item.label}</NavLink>
          ));
        }
        const menu = <NavMenu key={group.title} title={group.title} items={group.items} pathname={pathname} />;
        if (group.title !== DIRECT_GROUP) return menu;
        return [
          <div key="direct" className="hidden items-center gap-0.5 xl:flex">
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={topLinkClass}>{item.label}</NavLink>
            ))}
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          </div>,
          <div key="menu" className="xl:hidden">{menu}</div>,
        ];
      })}
    </nav>
  );
}

/** Phone/tablet drawer: every page, grouped. */
function DrawerNav({ role }) {
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
                      'flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                    )
                  }
                >
                  <IconChip icon={item.icon} group={group.title} />
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
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full p-1 pr-3 hover:bg-white/10 [&::-webkit-details-marker]:hidden">
        <span className="grid size-8 place-items-center rounded-full bg-white text-xs font-bold text-brand-700 ring-2 ring-white/40">{initials}</span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm leading-tight font-medium text-white">{user.name}</span>
          <span className="block text-xs leading-tight text-white/70">{ROLE_LABELS[user.role]}</span>
        </span>
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
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

const closeMenus = (except) =>
  document.querySelectorAll('details[open]').forEach((el) => {
    if (!except || !el.contains(except)) el.removeAttribute('open');
  });

export default function AppLayout() {
  const { user, organization, branches, branchId, switchBranch } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
    closeMenus();
  }, [location.pathname]);

  // Dropdowns close on a click elsewhere (which also closes the previous one when another opens) and on Escape.
  useEffect(() => {
    const onPointer = (e) => closeMenus(e.target);
    const onKey = (e) => e.key === 'Escape' && closeMenus();
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // `dark` = on the gradient header (white text); otherwise on white (the phone drawer).
  const brand = (dark) => (
    <Link to="/" className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-brand-400 to-fuchsia-600 text-base font-bold text-white shadow-md ring-2 ring-white/30">{APP_INITIAL}</span>
      <span className="hidden min-w-0 sm:block">
        <span className={cx('block text-sm leading-tight font-semibold', dark ? 'text-white' : 'text-slate-900')}>{APP_NAME}</span>
        <span className={cx('block truncate text-xs leading-tight', dark ? 'text-white/70' : 'text-slate-500')}>Billing & bookings</span>
      </span>
    </Link>
  );
  const container = 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8';

  return (
    <div className="min-h-screen">
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
              {brand(false)}
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <X className="size-4" />
              </Button>
            </div>
            <DrawerNav role={user.role} />
          </aside>
        </div>
      )}

      {/* Phones: this bar stays on screen. Desktop: it scrolls away and the menu bar below stays. */}
      <header className="sticky top-0 z-30 bg-linear-to-r from-[#3d0a26] via-brand-800 to-fuchsia-800 text-white shadow-md lg:static">
        <div className={cx(container, 'flex h-16 items-center gap-3')}>
          <button type="button" className="grid size-9 place-items-center rounded-lg hover:bg-white/10 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          {brand(true)}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <Building2 className="hidden size-4 text-white/70 sm:block" aria-hidden />
            {branches.length > 1 ? (
              // `!` overrides the white input style for the dark header; options keep dark text in the open list.
              <Select
                aria-label="Branch"
                value={branchId ?? ''}
                onChange={(e) => switchBranch(e.target.value)}
                className="min-w-0 border-white/25! bg-white/10! font-medium text-white! focus:ring-white/20! sm:w-auto sm:max-w-56 [&>option]:text-slate-900"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            ) : (
              <span className="truncate text-sm font-medium text-white/90">{branches[0]?.name ?? 'No branch'}</span>
            )}
          </div>
          <UserMenu />
        </div>
      </header>

      <div className="sticky top-0 z-30 hidden border-b border-brand-100 bg-white/90 shadow-sm shadow-brand-900/5 backdrop-blur lg:block">
        <div className={container}>
          <TopNav role={user.role} />
        </div>
      </div>

      <main className={cx(container, 'py-6')}>
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
