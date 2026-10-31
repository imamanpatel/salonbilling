import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ROLES } from '@salon/shared';
import { api, setApiBranch, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);
const BRANCH_KEY = 'sabilling.branch';

function readStoredBranch() {
  try {
    return localStorage.getItem(BRANCH_KEY);
  } catch {
    return null;
  }
}

function storeBranch(branchId) {
  try {
    localStorage.setItem(BRANCH_KEY, branchId);
  } catch {
    // Storage unavailable (private mode); the branch just won't be remembered.
  }
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState(null); // { user, organization, branches }
  const [branchId, setBranchId] = useState(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((data) => {
    const stored = readStoredBranch();
    const next = data ? (data.branches.find((b) => b.id === stored) ?? data.branches[0])?.id ?? null : null;
    setApiBranch(next);
    setBranchId(next);
    setSession(data);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.clear();
      applySession(null);
    });
    api('/auth/me')
      .then(applySession)
      .catch(() => applySession(null))
      .finally(() => setLoading(false));
  }, [applySession, queryClient]);

  const login = useCallback(async (credentials) => {
    applySession(await api('/auth/login', { method: 'POST', body: credentials }));
  }, [applySession]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    queryClient.clear();
    applySession(null);
  }, [applySession, queryClient]);

  const switchBranch = useCallback((id) => {
    setApiBranch(id);
    storeBranch(id);
    setBranchId(id);
  }, []);

  /** Re-reads the session, e.g. after branches are added or renamed. */
  const refresh = useCallback(async () => {
    applySession(await api('/auth/me'));
  }, [applySession]);

  const value = useMemo(() => {
    const user = session?.user ?? null;
    const branches = session?.branches ?? [];
    return {
      user,
      organization: session?.organization ?? null,
      branches,
      branchId,
      branch: branches.find((b) => b.id === branchId) ?? null,
      canManage: Boolean(user && user.role !== ROLES.USER),
      loading,
      login,
      logout,
      switchBranch,
      refresh,
    };
  }, [session, branchId, loading, login, logout, switchBranch, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
