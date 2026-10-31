import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';
import { useAuth } from './auth.jsx';

/** Active users of the current branch, for "assigned to" pickers. */
export function useTeam() {
  const { branchId } = useAuth();
  return useQuery({ queryKey: [branchId, 'team'], queryFn: () => api('/team'), staleTime: 5 * 60_000 });
}

export function useDebounced(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
