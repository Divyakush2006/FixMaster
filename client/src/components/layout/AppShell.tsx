import React, { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from '../ErrorBoundary';
import { PageLoader } from '../ui/PageLoader';

export const AppShell: React.FC = () => {
  const location = useLocation();
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      <Navbar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 pb-20 md:pb-8 max-w-7xl mx-auto w-full">
          {/* Keyed by path: a crash on one page doesn't stick when you navigate away. */}
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <BottomNav />
    </div>
  );
};
