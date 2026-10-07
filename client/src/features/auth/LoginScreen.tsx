import React, { useState } from 'react';
import { Navigate, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../api/client';
import { Wrench, ArrowRight, Sparkles, AlertCircle, GraduationCap, HardHat, Info } from 'lucide-react';

type PublicPortal = 'student' | 'staff';

const PORTAL_UI: Record<PublicPortal, { label: string; idLabel: string; placeholder: string; accent: string; icon: React.ElementType }> = {
  student: {
    label: 'Student',
    idLabel: 'Register Number',
    placeholder: 'e.g. 21BCE0843',
    accent: 'from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 shadow-cyan-600/25',
    icon: GraduationCap,
  },
  staff: {
    label: 'Staff',
    idLabel: 'Employee ID',
    placeholder: 'e.g. EMP_ELEC_01',
    accent: 'from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-600/25',
    icon: HardHat,
  },
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
      setErrorMsg(`Please enter your ${ui.idLabel} and password.`);
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    setSuggestedPortal(null);
    try {
      const loggedUser = await login(portal, regOrEmpId.trim(), password);
      showToast(`Welcome back, ${loggedUser.full_name}!`, 'success');
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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl relative z-10">
        <div className="text-center mb-6">
          <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-500/20 mb-3">
            <Wrench className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
            FIX_MASTER
          </h1>
          <p className="text-xs text-slate-400 font-medium mt-1">VIT Vellore Hostel Maintenance & Service Dispatch</p>
        </div>

        {/* Portal tabs */}
        <div role="tablist" aria-label="Sign in as" className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-slate-950 border border-slate-800 mb-6">
          {(['student', 'staff'] as PublicPortal[]).map((p) => {
            const Icon = PORTAL_UI[p].icon;
            const active = p === portal;
            return (
              <button
                key={p}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => switchPortal(p)}
                className={`py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                  active
                    ? p === 'student'
                      ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/40'
                      : 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{PORTAL_UI[p].label} Sign In</span>
              </button>
            );
          })}
        </div>

        {isExpired && (
          <div className="mb-5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Your session has ended. Please sign in again.</span>
          </div>
        )}

        {errorMsg && (
          <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            {suggestedPortal && (
              <button
                type="button"
                onClick={() => switchPortal(suggestedPortal)}
                className="font-bold underline underline-offset-4 text-rose-200 hover:text-white"
              >
                Switch to {PORTAL_UI[suggestedPortal].label} sign-in
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" aria-label={`${ui.label} sign-in`}>
          <div>
            <label htmlFor="login-id" className="block text-xs font-semibold text-slate-300 mb-1">
              {ui.idLabel}
            </label>
            <input
              id="login-id"
              type="text"
              autoComplete="username"
              value={regOrEmpId}
              onChange={(e) => setRegOrEmpId(e.target.value)}
              placeholder={ui.placeholder}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
              required
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-semibold text-slate-300 mb-1">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-3 px-4 rounded-xl bg-gradient-to-r ${ui.accent} text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 transition-all mt-2`}
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>Sign in as {ui.label}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {SHOW_DEMO && (
          <div className="mt-5 p-3 rounded-xl bg-slate-800/60 border border-slate-700 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5 font-semibold text-slate-300 mb-1.5">
              <Info className="w-3.5 h-3.5" />
              <span>Demo accounts (development only) - password Password@123</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DEMO_ACCOUNTS[portal].map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setRegOrEmpId(d.id);
                    setPassword('Password@123');
                  }}
                  className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-500 font-mono text-slate-200"
                  title={d.who}
                >
                  {d.id}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 pt-5 border-t border-slate-800 text-center text-xs text-slate-400">
          {portal === 'student' ? (
            <p>
              New student?{' '}
              <Link
                to="/register"
                className="font-bold text-cyan-400 hover:text-cyan-300 underline underline-offset-4 ml-1 inline-flex items-center gap-1"
              >
                <span>Create your account</span>
                <Sparkles className="w-3 h-3" />
              </Link>
            </p>
          ) : (
            <p>Staff accounts are created by the hostel office. Contact your administrator if you can't sign in.</p>
          )}
        </div>
      </div>
    </div>
  );
};
