import { BarChart3 } from 'lucide-react';
import { ROLES } from '@salon/shared';
import ReportsPage from './ReportsPage.jsx';

const MANAGERS = [ROLES.SUPERADMIN, ROLES.ADMIN];

export default {
  routes: [{ path: 'reports', element: <ReportsPage />, roles: MANAGERS }],
  nav: [{ group: 'Business', label: 'Reports', to: '/reports', icon: BarChart3, order: 10, roles: MANAGERS }],
};
