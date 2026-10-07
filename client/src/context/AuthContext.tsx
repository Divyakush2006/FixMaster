import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, RegisterPayload, Portal } from '../types';
import { authApi } from '../api/endpoints';
import { queryClient } from '../api/queryClient';
import {
  clearSession,
  getStoredUser,
  getToken,
  isTokenExpired,
  replaceToken,
  saveSession,
  SESSION_TOKEN_KEY,
} from '../api/session';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Sign in through one of the three portals; each only accepts its own accounts. */
  login: (portal: Portal, reg_or_emp_id: string, password: string) => Promise<User>;
  register: (payload: RegisterPayload) => Promise<User>;
  logout: () => void;
  /** After a password change the server issues a new token (old ones are revoked). */
  updateToken: (token: string) => void;
  getHomeRouteForRole: (role?: string) => string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const storedToken = getToken();
    const storedUser = getStoredUser();
    // An expired token would only fail on the first API call; drop it up front
    // so the user lands on the login page instead of a screen of errors.
    if (storedToken && storedUser && !isTokenExpired(storedToken)) {
      setToken(storedToken);
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
      if (e.key !== SESSION_TOKEN_KEY && e.key !== null) return;
      const next = getToken();
      if (!next) {
        queryClient.clear();
        setToken(null);
        setUser(null);
      } else if (next !== token) {
        const nextUser = getStoredUser();
        if (nextUser && user && nextUser.user_id === user.user_id) {
          setToken(next); // same person, refreshed token (e.g. password change)
        } else {
          window.location.reload();
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [token, user]);

  const getHomeRouteForRole = (role?: string): string => {
    switch (role || user?.role) {
      case 'STUDENT':
        return '/student';
      case 'STAFF':
        return '/staff';
      case 'SUPERVISOR':
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
    saveSession(res.token, res.user);
    setToken(res.token);
    setUser(res.user);
    return res.user;
  };

  const register = async (payload: RegisterPayload): Promise<User> => {
    const res = await authApi.registerStudent(payload);
    return res.user;
  };

  const logout = useCallback(() => {
    // Revoke the token on the server first (the request reads it from
    // storage synchronously), then forget it locally. A failure here must not
    // keep the user signed in on this device.
    if (getToken()) authApi.logout().catch(() => undefined);
    clearSession();
    queryClient.clear();
    setToken(null);
    setUser(null);
  }, []);

  const updateToken = useCallback((newToken: string) => {
    replaceToken(newToken);
    setToken(newToken);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token && !!user,
        isLoading,
        login,
        register,
        logout,
        updateToken,
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
