import { Boxes, Store, Truck } from 'lucide-react';
import { ROLES } from '@salon/shared';
import ProductsPage from './ProductsPage.jsx';
import PurchasesPage from './PurchasesPage.jsx';
import VendorsPage from './VendorsPage.jsx';

const MANAGERS = [ROLES.SUPERADMIN, ROLES.ADMIN];

// Inventory (M5): products & stock for everyone; purchases and vendors for managers.
export default {
  routes: [
    { path: 'products', element: <ProductsPage /> },
    { path: 'purchases', element: <PurchasesPage />, roles: MANAGERS },
    { path: 'vendors', element: <VendorsPage />, roles: MANAGERS },
  ],
  nav: [
    { group: 'Inventory', label: 'Products & stock', to: '/products', icon: Boxes, order: 10 },
    { group: 'Inventory', label: 'Purchases', to: '/purchases', icon: Truck, order: 20, roles: MANAGERS },
    { group: 'Inventory', label: 'Vendors', to: '/vendors', icon: Store, order: 30, roles: MANAGERS },
  ],
};
