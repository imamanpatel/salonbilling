import { FileText, Receipt } from 'lucide-react';
import BillsPage from './BillsPage.jsx';
import ClientBillingSection from './ClientBillingSection.jsx';
import PosPage from './PosPage.jsx';
import PrintBillPage from './PrintBillPage.jsx';

export default {
  routes: [
    { path: 'billing/new', element: <PosPage /> },
    { path: 'bills', element: <BillsPage /> },
    { path: 'bills/:id/print', element: <PrintBillPage />, layout: 'bare' },
  ],
  nav: [
    { group: 'Front desk', label: 'New bill', to: '/billing/new', icon: Receipt, order: 30 },
    { group: 'Front desk', label: 'Bills', to: '/bills', icon: FileText, order: 35 },
  ],
  clientSections: [ClientBillingSection],
};
