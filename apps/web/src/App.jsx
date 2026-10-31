import { Route, Routes } from 'react-router';
import { ROLES } from '@salon/shared';
import AppLayout from './components/AppLayout.jsx';
import { Spinner } from './components/ui.jsx';
import { useAuth } from './lib/auth.jsx';
import { moduleRoutes } from './modules.js';
import AccountPage from './pages/AccountPage.jsx';
import BranchesPage from './pages/BranchesPage.jsx';
import ClientsPage from './pages/ClientsPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import EnquiriesPage from './pages/EnquiriesPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import ServicesPage from './pages/ServicesPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import StaffPage from './pages/StaffPage.jsx';
import TodayPage from './pages/TodayPage.jsx';
import UsersPage from './pages/UsersPage.jsx';

const MANAGERS = [ROLES.SUPERADMIN, ROLES.ADMIN];
const routesFor = (layout) => moduleRoutes.filter((r) => (r.layout ?? 'app') === layout);

function RequireRole({ roles, children }) {
  const { user } = useAuth();
  return !roles || roles.includes(user.role) ? children : <NotFoundPage />;
}

function moduleRouteElements(layout) {
  return routesFor(layout).map((r) => (
    <Route key={r.path} path={r.path} element={<RequireRole roles={r.roles}>{r.element}</RequireRole>} />
  ));
}

function SignedInApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner className="size-8" />
      </div>
    );
  }
  if (!user) return <LoginPage />;

  return (
    <Routes>
      {moduleRouteElements('bare')}
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="today" element={<TodayPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="enquiries" element={<EnquiriesPage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="staff" element={<RequireRole roles={MANAGERS}><StaffPage /></RequireRole>} />
        <Route path="settings" element={<RequireRole roles={MANAGERS}><SettingsPage /></RequireRole>} />
        <Route path="users" element={<RequireRole roles={MANAGERS}><UsersPage /></RequireRole>} />
        <Route path="branches" element={<RequireRole roles={[ROLES.SUPERADMIN]}><BranchesPage /></RequireRole>} />
        <Route path="account" element={<AccountPage />} />
        {moduleRouteElements('app')}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public pages (online booking, feedback) never ask for sign-in. */}
      {routesFor('public').map((r) => (
        <Route key={r.path} path={r.path} element={r.element} />
      ))}
      <Route path="*" element={<SignedInApp />} />
    </Routes>
  );
}
