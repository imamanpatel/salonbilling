import { MessageSquare, Send } from 'lucide-react';
import { ROLES } from '@salon/shared';
import MessagesPage from './MessagesPage.jsx';
import MessagingSettingsPage from './MessagingSettingsPage.jsx';

// M7 Messaging: message log, bulk send, providers, templates and service reminders.
const MANAGERS = [ROLES.SUPERADMIN, ROLES.ADMIN];

export default {
  routes: [
    { path: 'messages', element: <MessagesPage /> },
    { path: 'settings/messaging', element: <MessagingSettingsPage />, roles: MANAGERS },
  ],
  nav: [
    { group: 'Front desk', label: 'Messages', to: '/messages', icon: MessageSquare, order: 60 },
    { group: 'Admin', label: 'Messaging', to: '/settings/messaging', icon: Send, order: 20, roles: MANAGERS },
  ],
};
