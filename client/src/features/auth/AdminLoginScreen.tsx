import React, { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { ShieldCheck, ArrowRight, AlertCircle, Lock, Info } from 'lucide-react';

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
      setErrorMsg('Please enter your administrator ID and password.');
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const admin = await login('admin', adminId.trim(), password);
      showToast(`Signed in as administrator`, 'success', admin.full_name);
      navigate(getHomeRouteForRole(admin.role), { replace: true });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-purple-700/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm bg-slate-900/95 border border-purple-500/20 rounded-3xl p-6 sm:p-8 shadow-2xl relative z-10">
        <div className="text-center mb-6">
          <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-purple-700 to-fuchsia-700 text-white shadow-lg shadow-purple-600/20 mb-3">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-extrabold text-slate-100">FIX_MASTER Administration</h1>
          <p className="text-[11px] text-slate-400 mt-1 flex items-center justify-center gap-1">
            <Lock className="w-3 h-3" />
            Restricted to hostel administrators
          </p>
        </div>

        {isExpired && (
          <div className="mb-5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Your administrator session has ended. Please sign in again.</span>
          </div>
        )}

        {signedInElsewhere && (
          <div className="mb-5 p-3 rounded-xl bg-slate-800/70 border border-slate-700 text-slate-300 text-xs">
            You are signed in as {user!.full_name}. Signing in here will end that session.
          </div>
        )}

        {errorMsg && (
          <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" aria-label="Administrator sign-in">
          <div>
            <label htmlFor="admin-id" className="block text-xs font-semibold text-slate-300 mb-1">
              Administrator ID
            </label>
            <input
              id="admin-id"
              type="text"
              autoComplete="username"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-purple-500"
              required
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="block text-xs font-semibold text-slate-300 mb-1">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-purple-500"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-700 to-fuchsia-700 hover:from-purple-600 hover:to-fuchsia-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>Sign in to Administration</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {SHOW_DEMO && (
          <button
            type="button"
            onClick={() => {
              setAdminId('ADMIN_ESTATES_01');
              setPassword('Password@123');
            }}
            className="mt-5 w-full p-2.5 rounded-xl bg-slate-800/60 border border-slate-700 text-[11px] text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1.5"
          >
            <Info className="w-3.5 h-3.5" />
            <span>Demo admin (development only): ADMIN_ESTATES_01</span>
          </button>
        )}
      </div>
    </div>
  );
};
