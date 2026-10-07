import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Role } from '../../types';
import { PageLoader } from '../ui/PageLoader';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: Role[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { isAuthenticated, isLoading, user, getHomeRouteForRole } = useAuth();
  const location = useLocation();

  if (isLoading) return <PageLoader fullScreen label="Loading your session" />;

  if (!isAuthenticated || !user) {
    // Each area sends you to its own sign-in: /admin/* to the administrator
    // sign-in, everything else to the student/staff page.
    const signIn = location.pathname.startsWith('/admin') ? '/admin' : '/login';
    return <Navigate to={signIn} state={{ from: location }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Redirect user to their own portal home
    return <Navigate to={getHomeRouteForRole(user.role)} replace />;
  }

  return <>{children}</>;
};
