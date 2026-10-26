import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Role } from '../../types';
import { PageLoader } from '../ui/PageLoader';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: Role[];
  /** The onboarding page itself: reachable before the profile is complete. */
  allowIncompleteProfile?: boolean;
}

/** True when a signed-in student still has to finish onboarding. */
export const needsOnboarding = (user: { role: Role; account_status?: string } | null) =>
  !!user && user.role === 'STUDENT' && !!user.account_status && user.account_status !== 'ACTIVE';

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles, allowIncompleteProfile }) => {
  const { isAuthenticated, isLoading, user, getHomeRouteForRole } = useAuth();
  const location = useLocation();

  if (isLoading) return <PageLoader fullScreen label="Loading your session" />;

  if (!isAuthenticated || !user) {
    // Each area sends you to its own sign-in: /admin/* to the administrator
    // sign-in, everything else to the student/staff page.
    const signIn = location.pathname.startsWith('/admin') ? '/admin' : '/login';
    return <Navigate to={signIn} state={{ from: location }} replace />;
  }

  if (needsOnboarding(user) && !allowIncompleteProfile) {
    return <Navigate to="/onboarding" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Redirect user to their own portal home
    return <Navigate to={getHomeRouteForRole(user.role)} replace />;
  }

  return <>{children}</>;
};
