import React, { useState } from 'react';
import { Navigate, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { GraduationCap, HardHat, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input, PasswordInput } from '../../components/ui/Form';
import { Segmented } from '../../components/ui/Tabs';
import { AuthHeading, AuthLayout, DemoAccounts } from './AuthLayout';

type PublicPortal = 'student' | 'staff';

const PORTAL_UI: Record<PublicPortal, { label: string; idLabel: string; placeholder: string; icon: React.ElementType }> = {
  student: { label: 'Student', idLabel: 'Registration number', placeholder: 'e.g. 21BCE0843', icon: GraduationCap },
  staff: { label: 'Staff', idLabel: 'Employee ID', placeholder: 'e.g. EMP_ELEC_01', icon: HardHat },
};

// Demo credentials are only ever shown in development builds (or when a
// deployment explicitly opts in for a demo), never on a production sign-in page.
const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';
const DEMO_ACCOUNTS: Record<PublicPortal, { id: string; who: string }[]> = {
  student: [{ id: '21BCE0843', who: 'Student, room L-843' }],
  staff: [
    { id: 'EMP_ELEC_01', who: 'Electrician' },
    { id: 'SUP_LBLOCK_01', who: 'L-Block supervisor' },
  ],
};

/**
 * /login - two separate sign-ins on one page: Student and Staff (technicians
 * and supervisors). Each tab calls its own API endpoint, which only accepts
 * that kind of account. Administrators sign in at /admin, not here.
 */
export const LoginScreen: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const portal: PublicPortal = searchParams.get('portal') === 'staff' ? 'staff' : 'student';
  const [regOrEmpId, setRegOrEmpId] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [suggestedPortal, setSuggestedPortal] = useState<PublicPortal | null>(null);

  const { login, getHomeRouteForRole, isAuthenticated, isLoading: authLoading, user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const isExpired = searchParams.get('expired') === '1';
  const ui = PORTAL_UI[portal];

  if (!authLoading && isAuthenticated && user && user.role !== 'ADMIN') {
    return <Navigate to={getHomeRouteForRole(user.role)} replace />;
  }

  const switchPortal = (next: PublicPortal) => {
    setErrorMsg(null);
    setSuggestedPortal(null);
    setPassword('');
    setSearchParams(next === 'staff' ? { portal: 'staff' } : {}, { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regOrEmpId.trim() || !password) {
      setErrorMsg(`Enter your ${ui.idLabel.toLowerCase()} and password.`);
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    setSuggestedPortal(null);
    try {
      const loggedUser = await login(portal, regOrEmpId.trim(), password);
      showToast(`Welcome back, ${loggedUser.full_name.split(' ')[0]}`, 'success');
      navigate(getHomeRouteForRole(loggedUser.role), { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed.';
      setErrorMsg(message);
      // The API names the right tab (only after the password checked out).
      if (err instanceof ApiError && err.status === 403) {
        if (/Staff tab/.test(message)) setSuggestedPortal('staff');
        if (/Student tab/.test(message)) setSuggestedPortal('student');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      panelTag="Service desk"
      panelTitle="Hostel maintenance, handled end to end."
      panelText="Report an issue in seconds, follow it through dispatch and repair, and confirm the fix yourself - every step on record."
      panelPoints={[
        'Requests routed to the right trade automatically',
        'Live status from registration to sign-off',
        'Technician work queues ordered floor by floor',
      ]}
    >
      <AuthHeading title="Sign in" subtitle="Choose your account type to continue." />

      <Segmented
        ariaLabel="Account type"
        className="mb-6 w-full"
        value={portal}
        onChange={switchPortal}
        items={(['student', 'staff'] as PublicPortal[]).map((p) => ({ value: p, label: PORTAL_UI[p].label, icon: PORTAL_UI[p].icon }))}
      />

      <div className="space-y-3">
        {isExpired && !errorMsg && (
          <Alert tone="warning" title="Your session has ended">
            Please sign in again to continue.
          </Alert>
        )}
        {errorMsg && (
          <Alert
            tone="danger"
            action={
              suggestedPortal && (
                <Button size="sm" variant="secondary" onClick={() => switchPortal(suggestedPortal)}>
                  Use {PORTAL_UI[suggestedPortal].label} sign-in
                </Button>
              )
            }
          >
            {errorMsg}
          </Alert>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4" aria-label={`${ui.label} sign-in`} noValidate>
        <Field label={ui.idLabel} required>
          {(a) => (
            <Input
              {...a}
              type="text"
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck={false}
              value={regOrEmpId}
              onChange={(e) => setRegOrEmpId(e.target.value)}
              placeholder={ui.placeholder}
              className="h-10"
            />
          )}
        </Field>

        <Field label="Password" required>
          {(a) => (
            <PasswordInput
              {...a}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="h-10"
            />
          )}
        </Field>

        <Button type="submit" size="lg" block loading={isLoading} iconRight={ArrowRight}>
          Sign in as {ui.label.toLowerCase()}
        </Button>
      </form>

      <p className="mt-4 text-center text-xs text-slate-500">Forgotten your password? The hostel office can reset it for you.</p>

      {SHOW_DEMO && (
        <DemoAccounts
          accounts={DEMO_ACCOUNTS[portal]}
          onPick={(id) => {
            setRegOrEmpId(id);
            setPassword('Password@123');
          }}
        />
      )}

      <div className="mt-8 border-t border-slate-200 pt-6 text-center text-[13px] text-slate-600">
        {portal === 'student' ? (
          <p>
            New to FixMaster?{' '}
            <Link to="/register" className="link">
              Create a student account
            </Link>
          </p>
        ) : (
          <p className="text-slate-500">Staff accounts are issued by the hostel office. Contact your administrator for access.</p>
        )}
      </div>
    </AuthLayout>
  );
};
