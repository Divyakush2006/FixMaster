import React, { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ErrorBoundary } from '../ErrorBoundary';
import { PageLoader } from '../ui/PageLoader';

export const AppShell: React.FC = () => {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  // A route change closes the mobile navigation and starts the page at the top.
  useEffect(() => {
    setNavOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow-overlay"
      >
        Skip to content
      </a>
      <Sidebar mobileOpen={navOpen} onCloseMobile={() => setNavOpen(false)} />
      <div className="flex min-h-screen flex-col md:pl-60">
        <Topbar onOpenNav={() => setNavOpen(true)} />
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {/* Keyed by path: a crash on one page doesn't stick when you navigate away. */}
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
        <footer className="border-t border-slate-200 px-4 py-4 text-xs text-slate-400 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2">
            <span>© {new Date().getFullYear()} VIT Vellore · Hostel Estates Office</span>
            <span>FixMaster Facilities Management</span>
          </div>
        </footer>
      </div>
    </div>
  );
};
