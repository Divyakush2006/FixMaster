import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { BrandMark } from '../../components/layout/BrandMark';
import { cn } from '../../components/ui/cn';

interface AuthLayoutProps {
  /** Brand panel copy (left side, large screens only). */
  panelTitle: string;
  panelText: string;
  panelPoints: string[];
  panelTag?: string;
  /** Form column width. */
  width?: 'sm' | 'md';
  children: React.ReactNode;
}

/** Split-screen frame shared by every sign-in and registration page. */
export const AuthLayout: React.FC<AuthLayoutProps> = ({ panelTitle, panelText, panelPoints, panelTag, width = 'sm', children }) => (
  <div className="flex min-h-screen bg-white">
    <aside className="relative hidden w-[44%] max-w-[640px] flex-col justify-between overflow-hidden bg-navy-900 p-12 text-white lg:flex">
      {/* Quiet engineering-grid texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-600/25 blur-3xl" />

      <BrandMark tone="light" subtitle="Hostel Facilities Management" className="relative" />

      <div className="relative max-w-md">
        {panelTag && (
          <span className="mb-5 inline-flex rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80">{panelTag}</span>
        )}
        <h2 className="text-[32px] font-semibold leading-tight tracking-tight">{panelTitle}</h2>
        <p className="mt-4 text-[15px] leading-relaxed text-white/65">{panelText}</p>
        <ul className="mt-8 space-y-3.5">
          {panelPoints.map((point) => (
            <li key={point} className="flex items-start gap-3 text-sm text-white/80">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" aria-hidden />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-white/40">© {new Date().getFullYear()} VIT Vellore · Hostel Estates Office</p>
    </aside>

    <main className="flex flex-1 flex-col">
      <div className="flex items-center px-6 pt-6 lg:hidden">
        <BrandMark />
      </div>
      <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
        <div className={cn('w-full', width === 'sm' ? 'max-w-[400px]' : 'max-w-[520px]')}>{children}</div>
      </div>
      <p className="px-6 pb-6 text-center text-xs text-slate-400 lg:hidden">© {new Date().getFullYear()} VIT Vellore · Hostel Estates Office</p>
    </main>
  </div>
);

/** Heading block at the top of each auth form. */
export const AuthHeading: React.FC<{ title: string; subtitle: React.ReactNode }> = ({ title, subtitle }) => (
  <div className="mb-7">
    <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
    <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>
  </div>
);

/** Development-only helper listing seeded demo accounts. */
export const DemoAccounts: React.FC<{ accounts: { id: string; who: string }[]; onPick: (id: string) => void }> = ({ accounts, onPick }) => (
  <div className="mt-6 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
    <p className="text-xs font-medium text-slate-600">
      Demo accounts <span className="font-normal text-slate-400">· development only · password Password@123</span>
    </p>
    <div className="mt-2 flex flex-wrap gap-1.5">
      {accounts.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => onPick(d.id)}
          title={d.who}
          className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[11px] text-slate-700 transition-colors hover:border-brand-400 hover:text-brand-700"
        >
          {d.id}
        </button>
      ))}
    </div>
  </div>
);
