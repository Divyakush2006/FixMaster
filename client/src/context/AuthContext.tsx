import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, RegisterPayload, Portal, RegisterResponse } from '../types';
import { authApi } from '../api/endpoints';
import { queryClient } from '../api/queryClient';
import { clearSession, getStoredUser, hasSession, saveSession, SESSION_KEY, updateSessionExpiry, updateStoredUser } from '../api/session';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Sign in through one of the three portals; each only accepts its own accounts. */
  login: (portal: Portal, reg_or_emp_id: string, password: string) => Promise<User>;
  register: (payload: RegisterPayload) => Promise<RegisterResponse>;
  /** Confirms the emailed sign-up code; opens the session. */
  verifyEmail: (reg_or_emp_id: string, code: string) => Promise<User>;
  /** After university sign-in: reads the session the browser was just given and starts the app from it. */
  completeSso: () => Promise<User>;
  /** Merges fresh account details (e.g. account_status after onboarding) into the session. */
  updateUser: (patch: Partial<User>) => void;
  logout: () => void;
  /** After a password change the server re-issues the session cookie; record its new end time. */
  renewSession: (expiresAt: string) => void;
  getHomeRouteForRole: (role?: string) => string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const storedUser = getStoredUser();
    // A session that has already ended would only fail on the first API call;
    // drop it up front so the user lands on the login page, not a screen of errors.
    if (storedUser && hasSession()) {
      setUser(storedUser);
    } else {
      clearSession();
    }
    setIsLoading(false);
  }, []);

  // Keep every open tab on the same session: signing out in one tab signs
  // out all of them, and a different account signing in elsewhere reloads
  // this tab so it never keeps showing the previous person's data.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_KEY && e.key !== null) return;
      const next = getStoredUser();
      if (!next) {
        queryClient.clear();
        setUser(null);
      } else if (!user || next.user_id !== user.user_id) {
        window.location.reload();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user]);

  const getHomeRouteForRole = (role?: string): string => {
    switch (role || user?.role) {
      case 'STUDENT':
        return '/student';
      case 'STAFF':
        return '/staff';
      case 'SUPERVISOR':
      case 'CHIEF_WARDEN':
        return '/supervisor';
      case 'ADMIN':
        return '/admin/dashboard';
      default:
        return '/login';
    }
  };

  const login = async (portal: Portal, reg_or_emp_id: string, password: string): Promise<User> => {
    const res = await authApi.login(portal, { reg_or_emp_id, password });
    // Nothing cached by a previous user on this browser may survive.
    queryClient.clear();
    saveSession(res.user, res.expires_at);
    setUser(res.user);
    return res.user;
  };

  const register = (payload: RegisterPayload) => authApi.registerStudent(payload);

  const verifyEmail = async (reg_or_emp_id: string, code: string): Promise<User> => {
    const res = await authApi.verifyEmail(reg_or_emp_id, code);
    queryClient.clear();
    saveSession(res.user, res.expires_at);
    setUser(res.user);
    return res.user;
  };

  const completeSso = async (): Promise<User> => {
    const res = await authApi.session();
    queryClient.clear();
    saveSession(res.user, res.expires_at);
    setUser(res.user);
    return res.user;
  };

  const updateUser = useCallback((patch: Partial<User>) => {
    updateStoredUser(patch);
    setUser((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const logout = useCallback(() => {
    // Revoke the session on the server (which also clears the cookies), then
    // forget it locally. A failure here must not keep the user signed in on
    // this device.
    if (hasSession()) authApi.logout().catch(() => undefined);
    clearSession();
    queryClient.clear();
    setUser(null);
  }, []);

  const renewSession = useCallback((expiresAt: string) => updateSessionExpiry(expiresAt), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        verifyEmail,
        completeSso,
        updateUser,
        logout,
        renewSession,
        getHomeRouteForRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
