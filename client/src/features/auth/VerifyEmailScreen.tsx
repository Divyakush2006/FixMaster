import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { authApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Form';
import { AuthHeading, AuthLayout } from './AuthLayout';

interface VerifyState {
  regNo?: string;
  email?: string;
  minutes?: number;
}

const RESEND_SECONDS = 60;

/**
 * Step two of sign-up: the 6-digit code emailed to the student's university
 * address. A correct code signs them in and sends them to onboarding. Reached
 * from registration, or from sign-in when the account is still unconfirmed.
 */
export const VerifyEmailScreen: React.FC = () => {
  const location = useLocation();
  const state = (location.state ?? {}) as VerifyState;
  const navigate = useNavigate();
  const { verifyEmail } = useAuth();
  const { showToast } = useToast();

  const [regNo, setRegNo] = useState(state.regNo ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(state.regNo ? RESEND_SECONDS : 0);
  const submitting = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    if (!regNo.trim()) return setError('Enter your registration number.');
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from the email.');
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await verifyEmail(regNo.trim().toUpperCase(), code);
      showToast('Email confirmed', 'success', 'One more step: your resident profile.');
      navigate('/onboarding', { replace: true });
    } catch (err) {
      submitting.current = false;
      setError(err instanceof Error ? err.message : 'That code did not work.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!regNo.trim() || cooldown > 0) return;
    try {
      const res = await authApi.resendCode(regNo.trim().toUpperCase());
      showToast('Code requested', 'info', res.message);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request a new code.');
    }
  };

  return (
    <AuthLayout
      panelTag="Student registration"
      panelTitle="Confirm it is you."
      panelText="FixMaster is for VIT residents only. Confirming your university email keeps every account tied to a real student."
      panelPoints={['Codes work once', `Valid for ${state.minutes ?? 15} minutes`, 'Only the newest code counts']}
    >
      <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to sign in
      </Link>
      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700" aria-hidden>
        <MailCheck className="h-5 w-5" />
      </div>
      <AuthHeading
        title="Check your university email"
        subtitle={state.email ? `We sent a 6-digit code to ${state.email}.` : 'Enter the 6-digit code we emailed to your university address.'}
      />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <form onSubmit={submit} className="space-y-4" noValidate>
        {!state.regNo && (
          <Field label="Registration number" required>
            {(a) => <Input {...a} value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="21BCE0843" autoComplete="username" spellCheck={false} />}
          </Field>
        )}
        <Field label="Verification code" required hint="Check your spam folder if it has not arrived within a minute.">
          {(a) => (
            <Input
              {...a}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className="text-center font-mono text-lg tracking-[0.5em]"
              maxLength={6}
              autoFocus
            />
          )}
        </Field>
        <Button type="submit" size="lg" block loading={busy}>
          Confirm and continue
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-slate-600">
        Did not get it?{' '}
        <button
          type="button"
          onClick={resend}
          disabled={cooldown > 0 || !regNo.trim()}
          className="font-semibold text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
        >
          {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
        </button>
      </p>
    </AuthLayout>
  );
};
