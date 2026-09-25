'use client';

// auth.tsx holds who is signed in.
//
// Successor to the Firebase app's useAuth, which read a Firestore member
// document. It now reads /me, and the "not linked to an organisation" case
// arrives as a 401 from login rather than as a permission-denied read.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { ApiError, api } from './api';
import type { Me } from './types';

type AuthState = {
  me: Me | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/me'));
      setError(null);
    } catch (e) {
      setMe(null);
      // A 401 here is "not signed in", which is a state, not an error to show.
      if (!(e instanceof ApiError && e.status === 401)) {
        setError(e instanceof Error ? e.message : 'Could not load your account');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ me, loading, error, refresh, logout }),
    [me, loading, error, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/** Roles that may create and edit. Mirrors the API's ranked RolesGuard. */
export function canWrite(role?: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'entry';
}

export function canAdmin(role?: string): boolean {
  return role === 'owner' || role === 'admin';
}
