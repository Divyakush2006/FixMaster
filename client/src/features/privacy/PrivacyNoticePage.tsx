import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { metaApi } from '../../api/endpoints';
import { Alert } from '../../components/ui/Alert';
import { Skeleton } from '../../components/ui/PageLoader';
import { useAuth } from '../../context/AuthContext';

/**
 * The privacy notice, in full. Public: a student reads it before they have an
 * account. The text and the retention periods come from the API, so this page
 * always says what the system actually does.
 */
export const PrivacyNoticePage: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { data, isLoading, isError } = useQuery({ queryKey: ['privacy-notice'], queryFn: metaApi.getPrivacyNotice });

  return (
    <div className="min-h-screen bg-canvas px-4 py-10">
      <main className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-card sm:p-10">
        <p className="mb-4 text-[13px]">
          <Link to={isAuthenticated ? '/' : '/login'} className="font-medium text-brand-700 hover:underline">
            ← {isAuthenticated ? 'Back to FixMaster' : 'Back to sign in'}
          </Link>
        </p>
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : isError || !data ? (
          <Alert tone="danger">The privacy notice could not be loaded. Please try again.</Alert>
        ) : (
          <article>
            <header className="mb-6 border-b border-slate-100 pb-5">
              <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-brand-700">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Privacy notice · version <span className="font-mono">{data.version}</span>
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{data.title}</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-slate-700">{data.intro}</p>
            </header>
            <div className="space-y-7">
              {data.sections.map((s) => (
                <section key={s.id} aria-labelledby={`notice-${s.id}`}>
                  <h2 id={`notice-${s.id}`} className="mb-2 text-lg font-semibold text-slate-900">
                    {s.title}
                  </h2>
                  <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-slate-700">
                    {s.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <footer className="mt-8 border-t border-slate-100 pt-5 text-[14px] text-slate-600">
              Questions about your information: contact {data.contact}.
            </footer>
          </article>
        )}
      </main>
    </div>
  );
};
