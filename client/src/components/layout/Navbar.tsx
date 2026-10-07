import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { RoleBadge } from '../common/Badges';
import { LogOut, Wrench } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Each user is returned to the sign-in page they came in through.
  const handleLogout = () => {
    const signIn = user?.role === 'ADMIN' ? '/admin' : user?.role === 'STUDENT' ? '/login' : '/login?portal=staff';
    logout();
    navigate(signIn, { replace: true });
  };

  return (
    <header className="h-16 bg-slate-950/90 border-b border-slate-800 backdrop-blur-md sticky top-0 z-40 px-4 sm:px-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 shadow-md shadow-cyan-500/20 text-white">
          <Wrench className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-extrabold tracking-tight bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
              FIX_MASTER
            </h1>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
              VIT VELLORE
            </span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium hidden sm:block">
            Hostel Maintenance & Service Dispatch System
          </p>
        </div>
      </div>

      {user && (
        <div className="flex items-center gap-3">
          <Link to="/account" title="My account" className="flex items-center gap-3 rounded-xl px-1.5 py-1 hover:bg-slate-900">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold text-slate-100">{user.full_name}</div>
              <div className="text-[10px] text-slate-400 font-mono">{user.reg_or_emp_id}</div>
            </div>
            <RoleBadge role={user.role} />
          </Link>

          <button
            onClick={handleLogout}
            title="Log out"
            className="p-2 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors ml-1"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      )}
    </header>
  );
};
