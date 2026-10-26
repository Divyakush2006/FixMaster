import React, { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authApi } from '../../api/endpoints';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input, PasswordInput } from '../../components/ui/Form';
import { EMPTY_ROOM_CHOICE, RoomChoice, RoomPicker } from '../../components/common/RoomPicker';
import { cn } from '../../components/ui/cn';
import { AuthHeading, AuthLayout } from './AuthLayout';
import { PASSWORD_HINT, passwordProblem, passwordStrength } from '../../utils/password';

const STRENGTH_BAR = ['', 'bg-rose-500', 'bg-amber-500', 'bg-emerald-500'];

// The server is the authority on both rules; checking here only saves a round trip.
const REG_NO = /^\d{2}[A-Z]{3}\d{4}$/;
const DEFAULT_DOMAINS = ['vitstudent.ac.in'];
const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

// This screen only ever registers STUDENT accounts (POST /auth/student/register).
// Staff, supervisor and admin accounts are created by an administrator.
//
// The block / floor / room a student picks is a REQUEST for an allotment: the
// hostel office approves it (or not), and only then can the student raise room
// tickets. Choices come from the hostel infrastructure configured by the
// administrators - nothing here knows any block or room in advance.
export const RegisterScreen: React.FC = () => {
  const [regOrEmpId, setRegOrEmpId] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [room, setRoom] = useState<RoomChoice>(EMPTY_ROOM_CHOICE);
  const [hasInfrastructure, setHasInfrastructure] = useState(true);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // State updates are asynchronous: a fast double-click would pass an isLoading check twice.
  const submitting = useRef(false);

  const { register } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { data: caps } = useQuery({ queryKey: ['auth-capabilities'], queryFn: authApi.capabilities, staleTime: 5 * 60_000 });
  const domains = caps?.student_email_domains?.length ? caps.student_email_domains : DEFAULT_DOMAINS;
  const signupOff = caps?.student_signup === false;

  const strength = passwordStrength(password);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!regOrEmpId.trim()) errs.regOrEmpId = 'Enter your registration number.';
    else if (!REG_NO.test(regOrEmpId.trim().toUpperCase())) errs.regOrEmpId = 'Enter it as printed on your ID card, e.g. 21BCE0843.';
    if (!fullName.trim()) errs.fullName = 'Enter your full name.';
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = `Enter your university email, e.g. name@${domains[0]}.`;
    } else if (!domains.includes(domainOf(email.trim()))) {
      errs.email = `Use your university email address (ending in @${domains.join(' or @')}).`;
    }
    if (!phone.trim() || !/^\d{10}$/.test(phone.trim())) {
      errs.phone = 'Enter a 10-digit mobile number.';
    }
    const pwProblem = passwordProblem(password, regOrEmpId);
    if (pwProblem) errs.password = pwProblem;
    else if (confirm !== password) errs.confirm = 'The two passwords do not match.';
    if (!room.blockId) errs.block = 'Choose your hostel block.';
    else if (!room.floor) errs.floor = 'Choose your floor.';
    else if (!room.roomId) errs.room = 'Choose your room.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    if (!validate()) return;
    submitting.current = true;

    setIsLoading(true);
    setServerError(null);

    try {
      const res = await register({
        reg_or_emp_id: regOrEmpId.trim().toUpperCase(),
        full_name: fullName.trim(),
        email: email.trim(),
        phone_number: phone.trim(),
        password,
        block_id: room.blockId,
        floor_number: Number(room.floor),
        room_id: room.roomId,
      });

      // Next: prove the mailbox is theirs. The code screen signs them in.
      showToast('Check your email', 'success', `We sent a 6-digit code to ${res.verification.email}.`);
      navigate('/verify-email', {
        replace: true,
        state: { regNo: res.user.reg_or_emp_id, email: res.verification.email, minutes: res.verification.expires_in_minutes },
      });
    } catch (err) {
      submitting.current = false; // a failed attempt may be retried; a successful one is not repeated
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      setServerError(msg);
      if (/already exists/i.test(msg)) {
        setErrors((prev) => ({ ...prev, [/email/i.test(msg) ? 'email' : 'regOrEmpId']: msg }));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      width="md"
      panelTag="Student registration"
      panelTitle="Your room, looked after."
      panelText="Create your account and tell us where you live. Once the hostel office confirms your room, you can raise and track maintenance requests for it."
      panelPoints={[
        'One-tap housekeeping requests for your room',
        'Track every request through to completion',
        'Confirm the work before a ticket is closed',
      ]}
    >
      <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to sign in
      </Link>
      <AuthHeading title="Create your student account" subtitle={`Use your @${domains[0]} address. We will email you a code to confirm it.`} />

      {signupOff && (
        <Alert tone="warning" className="mb-4">
          Online sign-up is not available right now. Please contact the hostel office.
        </Alert>
      )}
      {serverError && (
        <Alert tone="danger" className="mb-4">
          {serverError}
        </Alert>
      )}
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Registration number" required error={errors.regOrEmpId}>
            {(a) => (
              <Input {...a} value={regOrEmpId} onChange={(e) => setRegOrEmpId(e.target.value)} placeholder="21BCE0843" autoComplete="username" spellCheck={false} />
            )}
          </Field>
          <Field label="Full name" required error={errors.fullName}>
            {(a) => <Input {...a} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="As on your ID card" autoComplete="name" />}
          </Field>
          <Field label="Email" required error={errors.email}>
            {(a) => (
              <Input {...a} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`name@${domains[0]}`} autoComplete="email" />
            )}
          </Field>
          <Field label="Mobile number" required error={errors.phone}>
            {(a) => (
              <Input
                {...a}
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="10 digits"
                autoComplete="tel-national"
              />
            )}
          </Field>
        </div>

        <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-[13px] font-semibold text-slate-900">Your hostel room</legend>
          <p className="text-xs text-slate-500">This is a request. The hostel office confirms your allotment before you can raise room tickets.</p>
          <RoomPicker value={room} onChange={setRoom} errors={errors} onAvailability={setHasInfrastructure} />
        </fieldset>

        <Field label="Password" required error={errors.password} hint={PASSWORD_HINT}>
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
        <Field label="Confirm password" required error={errors.confirm}>
          {(a) => <PasswordInput {...a} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />}
        </Field>

        <Button type="submit" size="lg" block loading={isLoading} disabled={!hasInfrastructure || signupOff}>
          Create account
        </Button>

        <p className="text-center text-xs text-slate-500">
          This creates a student account. Staff and supervisor accounts are issued by the hostel office. You will be asked to accept the{' '}
          <a href="/privacy" target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline">
            privacy notice
          </a>{' '}
          before you can use the service.
        </p>
      </form>
    </AuthLayout>
  );
};
