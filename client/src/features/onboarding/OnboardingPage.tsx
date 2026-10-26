import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, LogOut, ShieldCheck } from 'lucide-react';
import { authApi, meApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { BrandMark } from '../../components/layout/BrandMark';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DetailList } from '../../components/ui/Card';
import { Field, Input, Select, Textarea } from '../../components/ui/Form';
import { Switch } from '../../components/ui/Switch';
import { PageLoader } from '../../components/ui/PageLoader';
import { cn } from '../../components/ui/cn';
import type { BloodGroup, CleaningSlot, AssistantLanguage, Gender, StudentProfileFields } from '../../types';
import { INDIAN_STATES_AND_UTS, GUARDIAN_RELATIONS, SCHOOL_SUGGESTIONS } from './profileOptions';

const THIS_YEAR = new Date().getFullYear();
const PHONE = /^\d{10}$/;
const PIN = /^[1-9]\d{5}$/;
const FALLBACK_NOTICE_VERSION = '2026-10';

type Draft = Omit<StudentProfileFields, 'admission_year' | 'expected_graduation_year'> & {
  admission_year: string;
  expected_graduation_year: string;
};

const EMPTY: Draft = {
  school: '',
  programme: '',
  admission_year: String(THIS_YEAR),
  expected_graduation_year: String(THIS_YEAR + 4),
  gender: '' as Gender,
  date_of_birth: '',
  guardian_name: '',
  guardian_relation: '',
  guardian_phone: '',
  local_guardian_name: '',
  local_guardian_phone: '',
  permanent_city: '',
  permanent_state: '',
  permanent_pincode: '',
  preferred_cleaning_slot: 'ANY',
  preferred_language: 'en',
  health_consent: false,
  blood_group: null,
  medical_notes: '',
};

const STEPS = [
  { key: 'studies', title: 'Your studies' },
  { key: 'about', title: 'About you' },
  { key: 'emergency', title: 'Emergency contacts' },
  { key: 'address', title: 'Home address' },
  { key: 'preferences', title: 'Preferences and health' },
  { key: 'review', title: 'Review and consent' },
] as const;

const GENDER_LABEL: Record<Gender, string> = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other', UNDISCLOSED: 'Prefer not to say' };
const SLOT_LABEL: Record<CleaningSlot, string> = { MORNING: 'Morning (8–12)', AFTERNOON: 'Afternoon (12–4)', EVENING: 'Evening (4–8)', ANY: 'Any time' };
const LANGUAGE_LABEL: Record<AssistantLanguage, string> = { en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu' };
const BLOOD_GROUPS: BloodGroup[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const ageOn = (dob: string) => (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000);

/** Problems with one step, keyed by field. Mirrors the API's rules. */
function stepErrors(step: number, d: Draft): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 0) {
    if (!d.school.trim()) e.school = 'Choose your school.';
    if (!d.programme.trim()) e.programme = 'Enter your programme, e.g. B.Tech CSE.';
    const adm = Number(d.admission_year);
    const grad = Number(d.expected_graduation_year);
    if (grad < adm || grad > adm + 7) e.expected_graduation_year = 'Graduation year must be within 7 years after admission.';
  }
  if (step === 1) {
    if (!d.gender) e.gender = 'Choose an option.';
    if (!d.date_of_birth) e.date_of_birth = 'Enter your date of birth.';
    else if (ageOn(d.date_of_birth) < 15 || ageOn(d.date_of_birth) > 70) e.date_of_birth = 'Date of birth looks wrong.';
  }
  if (step === 2) {
    if (!d.guardian_name.trim()) e.guardian_name = "Enter a parent or guardian's name.";
    if (!d.guardian_relation) e.guardian_relation = 'Choose how they are related to you.';
    if (!PHONE.test(d.guardian_phone)) e.guardian_phone = 'Enter a 10-digit phone number.';
    if (d.local_guardian_phone && !PHONE.test(d.local_guardian_phone)) e.local_guardian_phone = 'Enter a 10-digit phone number.';
  }
  if (step === 3) {
    if (!d.permanent_city.trim()) e.permanent_city = 'Enter your home city.';
    if (!d.permanent_state) e.permanent_state = 'Choose your state or union territory.';
    if (!PIN.test(d.permanent_pincode)) e.permanent_pincode = 'Enter a 6-digit PIN code.';
  }
  return e;
}

/**
 * First-run resident profile (and, later, its edit screen). The API keeps
 * every other screen closed until this is saved once.
 */
export const OnboardingPage: React.FC = () => {
  const { user, updateUser, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const { data: existing, isLoading } = useQuery({ queryKey: ['my-profile'], queryFn: meApi.getProfile });
  const { data: caps } = useQuery({ queryKey: ['auth-capabilities'], queryFn: authApi.capabilities, staleTime: 5 * 60_000 });
  const noticeVersion = caps?.privacy_notice_version ?? FALLBACK_NOTICE_VERSION;

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const editing = !!existing?.profile;

  useEffect(() => {
    const p = existing?.profile;
    if (!p) return;
    setDraft({
      ...EMPTY,
      ...p,
      admission_year: String(p.admission_year),
      expected_graduation_year: String(p.expected_graduation_year),
      local_guardian_name: p.local_guardian_name ?? '',
      local_guardian_phone: p.local_guardian_phone ?? '',
      medical_notes: p.medical_notes ?? '',
    });
  }, [existing]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const save = useMutation({
    mutationFn: () =>
      meApi.saveProfile({
        ...draft,
        admission_year: Number(draft.admission_year),
        expected_graduation_year: Number(draft.expected_graduation_year),
        local_guardian_name: draft.local_guardian_name?.trim() || null,
        local_guardian_phone: draft.local_guardian_phone || null,
        blood_group: draft.health_consent ? draft.blood_group : null,
        medical_notes: draft.health_consent ? draft.medical_notes?.trim() || null : null,
        privacy_consent: consent,
        privacy_notice_version: noticeVersion,
      }),
    onSuccess: (res) => {
      updateUser({ account_status: 'ACTIVE', profile_complete: true });
      showToast(editing ? 'Profile updated' : 'You are all set', 'success', res.message);
      navigate('/student', { replace: true });
    },
    onError: (err) => setServerError(err instanceof Error ? err.message : 'Could not save your profile.'),
  });

  const next = () => {
    const errs = stepErrors(step, draft);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0 });
  };

  const years = useMemo(() => Array.from({ length: 10 }, (_, i) => THIS_YEAR - 8 + i), []);

  if (isLoading) return <PageLoader fullScreen label="Loading your profile" />;

  const isLast = step === STEPS.length - 1;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <BrandMark subtitle="Resident profile" />
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {editing ? 'Update your resident profile' : `Welcome, ${user?.full_name.split(' ')[0] ?? 'there'}`}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {editing
            ? 'Keep these details current so the hostel office can reach your family in an emergency.'
            : 'The hostel office keeps this record for every resident. It takes about two minutes, and you only do it once.'}
        </p>

        <ol className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.key} aria-current={i === step ? 'step' : undefined}>
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                className={cn(
                  'flex w-full flex-col items-start gap-1 rounded-md border px-2.5 py-2 text-left text-xs transition',
                  i === step && 'border-brand-600 bg-brand-50 text-brand-800',
                  i < step && 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-300',
                  i > step && 'border-slate-200 bg-white text-slate-500'
                )}
              >
                <span className="flex items-center gap-1 font-mono text-[11px]">
                  {i < step ? <Check className="h-3 w-3" aria-hidden /> : null}
                  Step {i + 1}
                </span>
                <span className="font-medium leading-tight">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>

        <Card className="mt-6 p-5 sm:p-6">
          <h2 className="mb-4 text-base font-semibold text-slate-900">{STEPS[step].title}</h2>

          {step === 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="School" required error={errors.school} hint="e.g. SCOPE">
                {(a) => (
                  <>
                    <Input {...a} list="school-options" value={draft.school} onChange={(e) => set('school', e.target.value.toUpperCase())} maxLength={20} />
                    <datalist id="school-options">
                      {SCHOOL_SUGGESTIONS.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
              <Field label="Programme" required error={errors.programme}>
                {(a) => <Input {...a} value={draft.programme} onChange={(e) => set('programme', e.target.value)} placeholder="B.Tech Computer Science" maxLength={100} />}
              </Field>
              <Field label="Year of admission" required error={errors.admission_year}>
                {(a) => (
                  <Select {...a} value={draft.admission_year} onChange={(e) => set('admission_year', e.target.value)}>
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Expected graduation" required error={errors.expected_graduation_year}>
                {(a) => (
                  <Select {...a} value={draft.expected_graduation_year} onChange={(e) => set('expected_graduation_year', e.target.value)}>
                    {Array.from({ length: 8 }, (_, i) => Number(draft.admission_year) + i).map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Gender" required error={errors.gender} hint="Used to match you to the right hostel.">
                {(a) => (
                  <Select {...a} value={draft.gender} onChange={(e) => set('gender', e.target.value as Gender)}>
                    <option value="">Choose…</option>
                    {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => (
                      <option key={g} value={g}>
                        {GENDER_LABEL[g]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Date of birth" required error={errors.date_of_birth}>
                {(a) => <Input {...a} type="date" value={draft.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} max={`${THIS_YEAR - 15}-12-31`} />}
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Parent or guardian" required error={errors.guardian_name} className="sm:col-span-1">
                  {(a) => <Input {...a} value={draft.guardian_name} onChange={(e) => set('guardian_name', e.target.value)} autoComplete="off" maxLength={100} />}
                </Field>
                <Field label="Relation" required error={errors.guardian_relation}>
                  {(a) => (
                    <Select {...a} value={draft.guardian_relation} onChange={(e) => set('guardian_relation', e.target.value)}>
                      <option value="">Choose…</option>
                      {GUARDIAN_RELATIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Their phone" required error={errors.guardian_phone}>
                  {(a) => (
                    <Input {...a} type="tel" inputMode="numeric" maxLength={10} value={draft.guardian_phone} onChange={(e) => set('guardian_phone', e.target.value.replace(/\D/g, ''))} />
                  )}
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Local guardian (optional)" hint="Someone near campus.">
                  {(a) => <Input {...a} value={draft.local_guardian_name ?? ''} onChange={(e) => set('local_guardian_name', e.target.value)} maxLength={100} />}
                </Field>
                <Field label="Local guardian's phone" error={errors.local_guardian_phone}>
                  {(a) => (
                    <Input
                      {...a}
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      value={draft.local_guardian_phone ?? ''}
                      onChange={(e) => set('local_guardian_phone', e.target.value.replace(/\D/g, ''))}
                    />
                  )}
                </Field>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="City" required error={errors.permanent_city}>
                {(a) => <Input {...a} value={draft.permanent_city} onChange={(e) => set('permanent_city', e.target.value)} autoComplete="address-level2" maxLength={60} />}
              </Field>
              <Field label="State or UT" required error={errors.permanent_state}>
                {(a) => (
                  <Select {...a} value={draft.permanent_state} onChange={(e) => set('permanent_state', e.target.value)}>
                    <option value="">Choose…</option>
                    {INDIAN_STATES_AND_UTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="PIN code" required error={errors.permanent_pincode}>
                {(a) => (
                  <Input {...a} inputMode="numeric" maxLength={6} value={draft.permanent_pincode} onChange={(e) => set('permanent_pincode', e.target.value.replace(/\D/g, ''))} autoComplete="postal-code" />
                )}
              </Field>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Best time for room cleaning" hint="Housekeeping plans its rounds around this.">
                  {(a) => (
                    <Select {...a} value={draft.preferred_cleaning_slot} onChange={(e) => set('preferred_cleaning_slot', e.target.value as CleaningSlot)}>
                      {(Object.keys(SLOT_LABEL) as CleaningSlot[]).map((s) => (
                        <option key={s} value={s}>
                          {SLOT_LABEL[s]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Language for the request assistant">
                  {(a) => (
                    <Select {...a} value={draft.preferred_language} onChange={(e) => set('preferred_language', e.target.value as AssistantLanguage)}>
                      {(Object.keys(LANGUAGE_LABEL) as AssistantLanguage[]).map((l) => (
                        <option key={l} value={l}>
                          {LANGUAGE_LABEL[l]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Share health details with the wardens</p>
                    <p className="mt-0.5 text-xs text-slate-600">Optional. Only wardens and the hostel office can see them, and only to help in an emergency. Turn this off at any time to delete them.</p>
                  </div>
                  <Switch checked={draft.health_consent} onChange={(v) => set('health_consent', v)} label="Share health details" />
                </div>
                {draft.health_consent && (
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Blood group">
                      {(a) => (
                        <Select {...a} value={draft.blood_group ?? ''} onChange={(e) => set('blood_group', (e.target.value || null) as BloodGroup | null)}>
                          <option value="">Not given</option>
                          {BLOOD_GROUPS.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Conditions a warden should know about" className="sm:col-span-2" aside={`${(draft.medical_notes ?? '').length}/500`}>
                      {(a) => (
                        <Textarea {...a} rows={2} maxLength={500} value={draft.medical_notes ?? ''} onChange={(e) => set('medical_notes', e.target.value)} placeholder="e.g. Asthma; inhaler in the desk drawer" />
                      )}
                    </Field>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-5">
              <DetailList
                columns={2}
                items={[
                  { label: 'Studies', value: `${draft.programme} · ${draft.school} · ${draft.admission_year}–${draft.expected_graduation_year}` },
                  { label: 'Date of birth', value: draft.date_of_birth, mono: true },
                  { label: 'Emergency contact', value: `${draft.guardian_name} (${draft.guardian_relation}) · ${draft.guardian_phone}` },
                  { label: 'Home', value: `${draft.permanent_city}, ${draft.permanent_state} ${draft.permanent_pincode}` },
                  { label: 'Cleaning time', value: SLOT_LABEL[draft.preferred_cleaning_slot] },
                  { label: 'Health details', value: draft.health_consent ? 'Shared with wardens' : 'Not shared' },
                ]}
              />
              <section aria-labelledby="notice-title" className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-[13px] leading-relaxed text-slate-700">
                <h3 id="notice-title" className="mb-2 flex items-center gap-2 font-semibold text-slate-900">
                  <ShieldCheck className="h-4 w-4 text-brand-700" aria-hidden />
                  Privacy notice <span className="font-mono text-xs font-normal text-slate-500">v{noticeVersion}</span>
                </h3>
                <ul className="list-disc space-y-1 pl-5">
                  <li>The hostel office keeps this record to run your accommodation and to contact your family in an emergency.</li>
                  <li>Wardens, supervisors for your block and the hostel office can see it. Technicians see only your room number.</li>
                  <li>Health details are kept only while you agree to share them.</li>
                  <li>Nothing here is sent to the request assistant or any outside service.</li>
                  <li>You can view and correct it at any time from your account, and ask the hostel office to delete it when you leave the hostel.</li>
                </ul>
              </section>
              <label className="flex items-start gap-3 text-sm text-slate-800">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>I have read the privacy notice and agree to the hostel office keeping this record.</span>
              </label>
              {serverError && <Alert tone="danger">{serverError}</Alert>}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              Back
            </Button>
            {isLast ? (
              <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!consent}>
                {editing ? 'Save changes' : 'Finish and continue'}
              </Button>
            ) : (
              <Button onClick={next}>Continue</Button>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
};
