import { Route, Routes } from 'react-router';
import { ROLES } from '@salon/shared';
import AppLayout from './components/AppLayout.jsx';
import { Spinner } from './components/ui.jsx';
import { useAuth } from './lib/auth.jsx';
import AccountPage from './pages/AccountPage.jsx';
import BranchesPage from './pages/BranchesPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import ServicesPage from './pages/ServicesPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import StaffPage from './pages/StaffPage.jsx';
import UsersPage from './pages/UsersPage.jsx';

const MANAGERS = [ROLES.SUPERADMIN, ROLES.ADMIN];

function RequireRole({ roles, children }) {
  const { user } = useAuth();
  return roles.includes(user.role) ? children : <NotFoundPage />;
}

export default function App() {
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
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="settings" element={<RequireRole roles={MANAGERS}><SettingsPage /></RequireRole>} />
        <Route path="users" element={<RequireRole roles={MANAGERS}><UsersPage /></RequireRole>} />
        <Route path="branches" element={<RequireRole roles={[ROLES.SUPERADMIN]}><BranchesPage /></RequireRole>} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
