import { CalendarCheck, IndianRupee, Wallet } from 'lucide-react';
import { ROLES } from '@salon/shared';
import AttendancePage from './AttendancePage.jsx';
import ExpensesPage from './ExpensesPage.jsx';
import SalariesPage from './SalariesPage.jsx';

// M6 Team & expenses: attendance, salaries and expenses.
const MANAGERS = [ROLES.SUPERADMIN, ROLES.ADMIN];

export default {
  routes: [
    { path: 'attendance', element: <AttendancePage /> },
    { path: 'salaries', element: <SalariesPage />, roles: MANAGERS },
    { path: 'expenses', element: <ExpensesPage />, roles: MANAGERS },
  ],
  nav: [
    { group: 'Team', label: 'Attendance', to: '/attendance', icon: CalendarCheck, order: 20 },
    { group: 'Team', label: 'Salaries', to: '/salaries', icon: Wallet, order: 30, roles: MANAGERS },
    { group: 'Business', label: 'Expenses', to: '/expenses', icon: IndianRupee, order: 20, roles: MANAGERS },
  ],
};
