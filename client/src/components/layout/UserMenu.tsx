import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, UserCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { ROLE_LABEL } from '../../utils/labels';

export const UserMenu: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  // Each user is returned to the sign-in page they came in through.
  const handleLogout = () => {
    const signIn = user.role === 'ADMIN' ? '/admin' : user.role === 'STUDENT' ? '/login' : '/login?portal=staff';
    logout();
    navigate(signIn, { replace: true });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-md py-1 pl-1 pr-2 transition-colors hover:bg-slate-100"
      >
        <Avatar name={user.full_name} />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[160px] truncate text-[13px] font-medium text-slate-900">{user.full_name}</span>
          <span className="block text-2xs text-slate-500">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-500 sm:block" aria-hidden />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-overlay animate-scale-in">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate text-sm font-semibold text-slate-900">{user.full_name}</p>
            <p className="truncate font-mono text-xs text-slate-500">{user.reg_or_emp_id}</p>
            {user.email && <p className="mt-0.5 truncate text-xs text-slate-500">{user.email}</p>}
          </div>
          <div className="py-1">
            <Link
              to="/account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
            >
              <UserCircle2 className="h-4 w-4 text-slate-500" aria-hidden />
              My account
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4 text-slate-500" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
