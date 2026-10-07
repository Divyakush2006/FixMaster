import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { ArrowLeft, UserPlus, CheckCircle2, AlertCircle } from 'lucide-react';

// This screen only ever registers STUDENT accounts. The backend's
// POST /auth/register forces role=STUDENT for any caller that isn't already
// authenticated as ADMIN (see authController.register) - so a public role
// picker here would let someone pick STAFF/SUPERVISOR/ADMIN, submit, and
// silently get back a STUDENT account with no explanation. STAFF and
// SUPERVISOR accounts are provisioned by an ADMIN out of band.
export const RegisterScreen: React.FC = () => {
  const [regOrEmpId, setRegOrEmpId] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, login, getHomeRouteForRole } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const validate = () => {
    const errs: Record<string, string> = {};

    if (!regOrEmpId.trim()) errs.regOrEmpId = 'Register No or Employee ID is required.';
    if (!fullName.trim()) errs.fullName = 'Full Name is required.';

    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = 'Valid email address is required (e.g. name@vitstudent.ac.in).';
    }

    if (!phone.trim() || !/^\d{10}$/.test(phone.trim())) {
      errs.phone = 'Phone number must be exactly 10 digits.';
    }

    if (!password || password.length < 8) {
      errs.password = 'Password must be at least 8 characters long.';
    } else if (new TextEncoder().encode(password).length > 72) {
      errs.password = 'Password must be at most 72 bytes.';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsLoading(true);
    setServerError(null);

    try {
      await register({
        reg_or_emp_id: regOrEmpId.trim(),
        full_name: fullName.trim(),
        email: email.trim(),
        phone_number: phone.trim(),
        password,
      });

      showToast('Account registered successfully! Logging you in...', 'success');

      // Auto login after registration
      const user = await login(regOrEmpId.trim(), password);
      navigate(getHomeRouteForRole(user.role), { replace: true });
    } catch (err: any) {
      const msg = err.message || 'Registration failed.';
      setServerError(msg);
      if (msg.includes('already exists') || msg.includes('Register') || msg.includes('Email')) {
        setErrors((prev) => ({
          ...prev,
          regOrEmpId: 'ID or Email is already registered.',
          email: 'ID or Email is already registered.',
        }));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 py-8 font-sans relative">
      <div className="w-full max-w-lg bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 mb-6 transition-colors font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Login</span>
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-2xl bg-cyan-600/20 border border-cyan-500/30 text-cyan-400">
            <UserPlus className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-100">Create FIX_MASTER Account</h1>
            <p className="text-xs text-slate-400">VIT Vellore Hostel Portal</p>
          </div>
        </div>

        {serverError && (
          <div className="mb-6 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Register No / Emp ID *
              </label>
              <input
                type="text"
                value={regOrEmpId}
                onChange={(e) => setRegOrEmpId(e.target.value)}
                placeholder="21BCE0843"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-500"
              />
              {errors.regOrEmpId && <p className="text-[11px] text-rose-400 mt-1">{errors.regOrEmpId}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Full Name *</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Vihaan Sharma"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-500"
              />
              {errors.fullName && <p className="text-[11px] text-rose-400 mt-1">{errors.fullName}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vihaan@vitstudent.ac.in"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-500"
              />
              {errors.email && <p className="text-[11px] text-rose-400 mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Phone Number *</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9876543210"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-500"
              />
              {errors.phone && <p className="text-[11px] text-rose-400 mt-1">{errors.phone}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Password *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
              className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-500"
            />
            {errors.password && <p className="text-[11px] text-rose-400 mt-1">{errors.password}</p>}
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
            This form creates a <strong className="text-slate-300">STUDENT</strong> account.
            Staff and supervisor accounts are created by an administrator.
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/25 flex items-center justify-center gap-2 disabled:opacity-50 transition-all mt-4"
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Register Account</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
