import React, { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input, PasswordInput } from '../../components/ui/Form';
import { AuthHeading, AuthLayout, DemoAccounts } from './AuthLayout';

const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';

/**
 * /admin - the administrator sign-in, separate from the student/staff page.
 * Its API endpoint only accepts ADMIN accounts; any other account gets the
 * same "Invalid credentials" as a wrong password. Nothing on the public
 * sign-in page links here.
 */
export const AdminLoginScreen: React.FC = () => {
  const [adminId, setAdminId] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { login, isAuthenticated, isLoading: authLoading, user, getHomeRouteForRole } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isExpired = searchParams.get('expired') === '1';

  if (!authLoading && isAuthenticated && user?.role === 'ADMIN') {
    return <Navigate to={getHomeRouteForRole('ADMIN')} replace />;
  }
  const signedInElsewhere = !authLoading && isAuthenticated && user && user.role !== 'ADMIN';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminId.trim() || !password) {
      setErrorMsg('Enter your administrator ID and password.');
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const admin = await login('admin', adminId.trim(), password);
      showToast('Signed in to the administration console', 'success', admin.full_name);
      navigate(getHomeRouteForRole(admin.role), { replace: true });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      panelTag="Administration"
      panelTitle="Administration console"
      panelText="Manage accounts, hostel blocks, floors, rooms and allotments, and oversee maintenance operations across every block."
      panelPoints={[
        'Separate sign-in, isolated from student and staff access',
        'Shorter session lifetime for administrator accounts',
        'Account changes take effect immediately on every device',
      ]}
    >
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
        <Lock className="h-3.5 w-3.5" aria-hidden />
        Restricted access
      </div>
      <AuthHeading title="Administrator sign-in" subtitle="For authorised hostel administrators only." />

      <div className="space-y-3">
        {isExpired && !errorMsg && (
          <Alert tone="warning" title="Your administrator session has ended">
            Please sign in again to continue.
          </Alert>
        )}
        {signedInElsewhere && (
          <Alert tone="info">You are signed in as {user!.full_name}. Signing in here will end that session.</Alert>
        )}
        {errorMsg && <Alert tone="danger">{errorMsg}</Alert>}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4" aria-label="Administrator sign-in" noValidate>
        <Field label="Administrator ID" required>
          {(a) => (
            <Input
              {...a}
              type="text"
              autoComplete="username"
              spellCheck={false}
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
              className="h-10"
            />
          )}
        </Field>
        <Field label="Password" required>
          {(a) => (
            <PasswordInput {...a} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
          )}
        </Field>
        <Button type="submit" size="lg" block loading={isLoading} iconRight={ArrowRight}>
          Sign in to administration
        </Button>
      </form>

      {SHOW_DEMO && (
        <DemoAccounts
          accounts={[{ id: 'ADMIN_ESTATES_01', who: 'Estates administrator' }]}
          onPick={(id) => {
            setAdminId(id);
            setPassword('Password@123');
          }}
        />
      )}
    </AuthLayout>
  );
};
