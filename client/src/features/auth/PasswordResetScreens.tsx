import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { authApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { cn } from '../../components/ui/cn';
import { Field, Input, PasswordInput } from '../../components/ui/Form';
import { PASSWORD_HINT, passwordProblem, passwordStrength } from '../../utils/password';
import { AuthHeading, AuthLayout } from './AuthLayout';

const PANEL = {
  panelTag: 'Account recovery',
  panelTitle: 'Back in your account in a minute.',
  panelText: 'We email a one-time link to the address on file. It works once and expires after 30 minutes.',
  panelPoints: ['No one at the hostel office needs to be involved', 'Your old sessions are signed out when you finish', 'The link never leaves your inbox and your browser'],
};

/** /forgot-password - asks for the account ID; the reply never says whether it exists. */
export const ForgotPasswordScreen: React.FC = () => {
  const [id, setId] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setError('Enter your registration number or employee ID.');
    setLoading(true);
    setError(null);
    try {
      await authApi.forgotPassword(id.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout {...PANEL}>
      <AuthHeading title="Reset your password" subtitle="Enter your registration number or employee ID." />
      {sent ? (
        <div className="space-y-4" role="status">
          <Alert tone="success" title="Check your email">
            If that account exists, a reset link is on its way to the address on file. It is valid for 30 minutes.
          </Alert>
          <p className="flex items-start gap-2 text-[13px] text-slate-600">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Nothing arrived? Check your spam folder, or ask the hostel office to reset it for you.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Registration number or employee ID" required>
            {(a) => <Input {...a} autoComplete="username" autoCapitalize="characters" spellCheck={false} value={id} onChange={(e) => setId(e.target.value)} className="h-10" />}
          </Field>
          <Button type="submit" size="lg" block loading={loading}>
            Email me a reset link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-[13px]">
        <Link to="/login" className="link inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
};

const STRENGTH_BAR = ['', 'bg-rose-500', 'bg-amber-500', 'bg-emerald-500'];

/**
 * The token lives in the URL fragment (never sent to a server). Reading it must have no side
 * effect: React may render this component again (for example while a lazy chunk loads), and a
 * second render must still find the token. It is removed from the address bar in an effect.
 */
function readTokenFromUrl(): string {
  const match = /(?:^#|&)token=([\w.-]+)/.exec(window.location.hash);
  return match ? match[1] : '';
}

/** /reset-password#token=... - choose a new password. */
export const ResetPasswordScreen: React.FC = () => {
  const [token] = useState(readTokenFromUrl);
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const strength = passwordStrength(password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (confirm !== password) return setError('The two passwords do not match.');
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      await authApi.resetPassword(token, password);
      showToast('Password changed', 'success', 'Sign in with your new password.');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.');
      submitting.current = false;
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout {...PANEL}>
      <AuthHeading title="Choose a new password" subtitle="You will be signed out everywhere else." />
      {!token ? (
        <div className="space-y-4">
          <Alert tone="warning" title="This link is incomplete">
            Open the link from your email again, or request a new one.
          </Alert>
          <Link to="/forgot-password" className="link text-[13px]">
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && (
            <Alert tone="danger" action={/expired|invalid/i.test(error) ? <Link to="/forgot-password" className="link text-[13px]">Request a new link</Link> : undefined}>
              {error}
            </Alert>
          )}
          <Field label="New password" required hint={PASSWORD_HINT}>
            {(a) => <PasswordInput {...a} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
          </Field>
          {password && (
            <div className="-mt-2" aria-live="polite">
              <div className="flex gap-1" aria-hidden>
                {[1, 2, 3].map((i) => (
                  <span key={i} className={cn('h-1 flex-1 rounded-full', i <= strength.score ? STRENGTH_BAR[strength.score] : 'bg-slate-200')} />
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-600">Password strength: {strength.label}</p>
            </div>
          )}
          <Field label="Confirm new password" required>
            {(a) => <PasswordInput {...a} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />}
          </Field>
          <Button type="submit" size="lg" block loading={loading}>
            Change password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};
