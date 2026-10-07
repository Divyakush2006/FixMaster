import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
  /** Small inline element after the title, e.g. a count badge. */
  meta?: React.ReactNode;
}

/** Standard page title block: breadcrumbs, title, one-line description, actions. */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, breadcrumbs, actions, meta }) => (
  <header className="mb-6">
    {breadcrumbs && breadcrumbs.length > 0 && (
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
          {breadcrumbs.map((c, i) => (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-slate-500" aria-hidden />}
              {c.to ? (
                <Link to={c.to} className="hover:text-slate-800 hover:underline underline-offset-2">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined} className="text-slate-600">
                  {c.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    )}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[22px] font-semibold leading-8 tracking-tight text-slate-900">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  </header>
);
