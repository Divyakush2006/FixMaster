import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/queryClient';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/ui/Toast';
import { ConfirmProvider } from './components/ui/ConfirmDialog';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageLoader } from './components/ui/PageLoader';

// Every page is its own chunk: a student never downloads the supervisor
// dashboard's charting library, and the first paint only needs the login page.
const named = <T extends Record<string, React.ComponentType<any>>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(() => loader().then((m) => ({ default: m[name] as React.ComponentType<any> })));

const LoginScreen = named(() => import('./features/auth/LoginScreen'), 'LoginScreen');
const RegisterScreen = named(() => import('./features/auth/RegisterScreen'), 'RegisterScreen');
const AdminLoginScreen = named(() => import('./features/auth/AdminLoginScreen'), 'AdminLoginScreen');
const StudentHome = named(() => import('./features/student/StudentHome'), 'StudentHome');
const NewComplaintForm = named(() => import('./features/student/NewComplaintForm'), 'NewComplaintForm');
const MyComplaints = named(() => import('./features/student/MyComplaints'), 'MyComplaints');
const StaffQueue = named(() => import('./features/staff/StaffQueue'), 'StaffQueue');
const SupervisorDashboard = named(() => import('./features/supervisor/SupervisorDashboard'), 'SupervisorDashboard');
const AllComplaintsTable = named(() => import('./features/supervisor/AllComplaintsTable'), 'AllComplaintsTable');
const HotspotsTable = named(() => import('./features/supervisor/HotspotsTable'), 'HotspotsTable');
const EscalatedQueue = named(() => import('./features/supervisor/EscalatedQueue'), 'EscalatedQueue');
const AccountPage = named(() => import('./features/account/AccountPage'), 'AccountPage');
const UsersPage = named(() => import('./features/admin/UsersPage'), 'UsersPage');
const AllotmentsPage = named(() => import('./features/admin/AllotmentsPage'), 'AllotmentsPage');
const InfrastructurePage = named(() => import('./features/admin/InfrastructurePage'), 'InfrastructurePage');
const AuditLogPage = named(() => import('./features/admin/AuditLogPage'), 'AuditLogPage');
const NotFoundPage = named(() => import('./features/NotFoundPage'), 'NotFoundPage');

const RoleRedirect: React.FC = () => {
  const { user, getHomeRouteForRole, isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <PageLoader fullScreen />;
  if (!isAuthenticated || !user) return <Navigate to="/login" replace />;
  return <Navigate to={getHomeRouteForRole(user.role)} replace />;
};

const guard = (roles: Parameters<typeof ProtectedRoute>[0]['allowedRoles'], page: React.ReactNode) => (
  <ProtectedRoute allowedRoles={roles}>{page}</ProtectedRoute>
);

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <BrowserRouter>
              <ErrorBoundary>
                <Suspense fallback={<PageLoader fullScreen />}>
                  <Routes>
                    {/* Sign-in: /login has the Student and Staff sign-ins, /admin is the
                        separate administrator sign-in. */}
                    <Route path="/login" element={<LoginScreen />} />
                    <Route path="/register" element={<RegisterScreen />} />
                    <Route path="/admin" element={<AdminLoginScreen />} />

                    {/* Protected App Shell */}
                    <Route element={<AppShell />}>
                      <Route path="/" element={<RoleRedirect />} />

                      {/* Every signed-in role */}
                      <Route path="/account" element={guard(undefined, <AccountPage />)} />

                      {/* Student Portal */}
                      <Route path="/student" element={guard(['STUDENT'], <StudentHome />)} />
                      <Route path="/student/new" element={guard(['STUDENT'], <NewComplaintForm />)} />
                      <Route path="/student/complaints" element={guard(['STUDENT'], <MyComplaints />)} />

                      {/* Staff Portal */}
                      <Route path="/staff" element={guard(['STAFF'], <StaffQueue />)} />

                      {/* Supervisor / Admin Portal */}
                      <Route path="/supervisor" element={guard(['SUPERVISOR', 'ADMIN'], <SupervisorDashboard />)} />
                      <Route path="/supervisor/all-complaints" element={guard(['SUPERVISOR', 'ADMIN'], <AllComplaintsTable />)} />
                      <Route path="/supervisor/hotspots" element={guard(['SUPERVISOR', 'ADMIN'], <HotspotsTable />)} />
                      <Route path="/supervisor/escalated" element={guard(['SUPERVISOR', 'ADMIN'], <EscalatedQueue />)} />

                      {/* Administration (signed in through /admin) */}
                      <Route path="/admin/dashboard" element={guard(['ADMIN'], <SupervisorDashboard />)} />
                      <Route path="/admin/users" element={guard(['ADMIN'], <UsersPage />)} />
                      <Route path="/admin/allotments" element={guard(['ADMIN'], <AllotmentsPage />)} />
                      <Route path="/admin/infrastructure" element={guard(['ADMIN'], <InfrastructurePage />)} />
                      <Route path="/admin/audit" element={guard(['ADMIN'], <AuditLogPage />)} />

                      {/* Unknown address: a 404 page when signed in, the sign-in page otherwise. */}
                      <Route path="*" element={guard(undefined, <NotFoundPage />)} />
                    </Route>
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </BrowserRouter>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
};
