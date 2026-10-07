import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input, PasswordInput } from '../../components/ui/Form';
import { AuthHeading, AuthLayout } from './AuthLayout';
import { PASSWORD_HINT, passwordProblem } from '../../utils/password';

// This screen only ever registers STUDENT accounts (POST /auth/student/register).
// Staff, supervisor and admin accounts are created by an administrator.
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
    if (!regOrEmpId.trim()) errs.regOrEmpId = 'Enter your registration number.';
    if (!fullName.trim()) errs.fullName = 'Enter your full name.';
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = 'Enter a valid email address, e.g. name@vitstudent.ac.in.';
    }
    if (!phone.trim() || !/^\d{10}$/.test(phone.trim())) {
      errs.phone = 'Enter a 10-digit mobile number.';
    }
    const pwProblem = passwordProblem(password, regOrEmpId);
    if (pwProblem) errs.password = pwProblem;
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

      // Sign straight in with the new account.
      const user = await login('student', regOrEmpId.trim(), password);
      showToast('Your account is ready', 'success', 'You are now signed in.');
      navigate(getHomeRouteForRole(user.role), { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      setServerError(msg);
      if (msg.includes('already exists') || msg.includes('Register') || msg.includes('Email')) {
        setErrors((prev) => ({
          ...prev,
          regOrEmpId: 'This registration number or email is already registered.',
          email: 'This registration number or email is already registered.',
        }));
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
      panelText="Create your account once. When the hostel office allots your room, you can raise and track maintenance requests for it."
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
      <AuthHeading title="Create your student account" subtitle="All fields are required." />

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
              <Input {...a} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@vitstudent.ac.in" autoComplete="email" />
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

        <Field label="Password" required error={errors.password} hint={PASSWORD_HINT}>
          {(a) => <PasswordInput {...a} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
        </Field>

        <Button type="submit" size="lg" block loading={isLoading}>
          Create account
        </Button>

        <p className="text-center text-xs text-slate-500">
          This creates a student account. Staff and supervisor accounts are issued by the hostel office.
        </p>
      </form>
    </AuthLayout>
  );
};
