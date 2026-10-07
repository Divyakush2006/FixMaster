import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Role } from '../../types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: Role[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { isAuthenticated, isLoading, user, getHomeRouteForRole } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mb-4" />
        <p className="text-xs text-slate-400 font-medium">Loading session...</p>
      </div>
    );
  }

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
