import React from 'react';
import { Compass } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ButtonLink } from '../components/ui/Button';

/** Unknown address inside the signed-in app. */
export const NotFoundPage: React.FC = () => {
  const { user, getHomeRouteForRole } = useAuth();
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <Compass className="h-6 w-6" aria-hidden />
        </div>
        <p className="eyebrow">Error 404</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">The address may be mistyped, or the page may have moved. Nothing has been changed.</p>
        <ButtonLink to={getHomeRouteForRole(user?.role)} className="mt-6">
          Go to your home page
        </ButtonLink>
      </div>
    </div>
  );
};
