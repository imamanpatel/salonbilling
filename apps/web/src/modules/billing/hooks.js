import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';

/** Services, products, packages, plans and taxes the POS can sell. */
export function useBillCatalogue() {
  const { branchId } = useAuth();
  return useQuery({ queryKey: [branchId, 'bill-catalogue'], queryFn: () => api('/bills/catalogue'), staleTime: 60_000 });
}

/** Active staff of the branch, for "done by" pickers. */
export function useActiveStaff() {
  const { branchId } = useAuth();
  return useQuery({ queryKey: [branchId, 'staff', 'active'], queryFn: () => api('/staff'), staleTime: 5 * 60_000 });
}

/** Wallet, points, membership, packages, gift cards and dues of a client. */
export function useClientAccount(clientId) {
  const { branchId } = useAuth();
  return useQuery({
    queryKey: [branchId, 'client-account', clientId],
    queryFn: () => api(`/client-accounts/${clientId}`),
    enabled: Boolean(clientId),
  });
}

/** Query keys to refresh after a bill or payment changes money balances. */
export const billingKeys = (branchId, clientId) => [
  [branchId, 'bills'],
  [branchId, 'bill'],
  [branchId, 'client-account', clientId],
  [branchId, 'appointments'],
];
