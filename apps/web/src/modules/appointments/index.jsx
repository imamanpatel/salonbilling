import { CalendarClock } from 'lucide-react';
import AppointmentsPage from './AppointmentsPage.jsx';
import ClientAppointments from './ClientAppointments.jsx';

export default {
  routes: [{ path: 'appointments', element: <AppointmentsPage /> }],
  nav: [{ group: 'Front desk', label: 'Appointments', to: '/appointments', icon: CalendarClock, order: 20 }],
  clientSections: [ClientAppointments],
};
