import { BadgePercent, Crown, Gift, Package } from 'lucide-react';
import CouponsPage from './CouponsPage.jsx';
import GiftCardsPage from './GiftCardsPage.jsx';
import MembershipsPage from './MembershipsPage.jsx';
import PackagesPage from './PackagesPage.jsx';

// Catalogue extras: what Billing sells besides services and products (packages, memberships, gift cards) and coupons.
export default {
  routes: [
    { path: 'packages', element: <PackagesPage /> },
    { path: 'memberships', element: <MembershipsPage /> },
    { path: 'coupons', element: <CouponsPage /> },
    { path: 'gift-cards', element: <GiftCardsPage /> },
  ],
  nav: [
    { group: 'Catalogue', label: 'Packages', to: '/packages', icon: Package, order: 20 },
    { group: 'Catalogue', label: 'Memberships', to: '/memberships', icon: Crown, order: 30 },
    { group: 'Catalogue', label: 'Coupons', to: '/coupons', icon: BadgePercent, order: 40 },
    { group: 'Catalogue', label: 'Gift cards', to: '/gift-cards', icon: Gift, order: 50 },
  ],
};
