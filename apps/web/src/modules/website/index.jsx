import { Globe, Upload } from 'lucide-react';
import { ROLES } from '@salon/shared';
import BookingPage from './BookingPage.jsx';
import FeedbackPage from './FeedbackPage.jsx';
import ImportsPage from './ImportsPage.jsx';
import WebsitePage from './WebsitePage.jsx';

// M9: public booking and feedback pages (no sign-in), website admin and data migration.
const MANAGERS = [ROLES.SUPERADMIN, ROLES.ADMIN];

export default {
  routes: [
    { path: 'website', element: <WebsitePage />, roles: MANAGERS },
    { path: 'imports', element: <ImportsPage />, roles: MANAGERS },
    { path: 'book/:slug', element: <BookingPage />, layout: 'public' },
    { path: 'feedback/:token', element: <FeedbackPage />, layout: 'public' },
  ],
  nav: [
    { group: 'Business', label: 'Website', to: '/website', icon: Globe, order: 30, roles: MANAGERS },
    { group: 'Admin', label: 'Data import', to: '/imports', icon: Upload, order: 30, roles: MANAGERS },
  ],
};
