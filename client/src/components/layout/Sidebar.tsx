import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  Sparkles,
  PlusCircle,
  ListOrdered,
  ListTodo,
  LayoutDashboard,
  Flame,
  AlertTriangle,
  HelpCircle,
  Users,
  BedDouble,
  UserCircle2,
  Building,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { user } = useAuth();
  if (!user) return null;

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
      isActive
        ? 'bg-cyan-600/15 text-cyan-400 border border-cyan-500/30 shadow-md shadow-cyan-500/5'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
    }`;

  return (
    <aside className="w-64 bg-slate-950/50 border-r border-slate-800/80 p-4 hidden md:flex flex-col gap-6 shrink-0">
      {user.role === 'STUDENT' && (
        <nav className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-slate-500 px-3 tracking-wider uppercase mb-1">
            Student Portal
          </div>
          <NavLink to="/student" end className={linkClass}>
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>Quick Actions</span>
          </NavLink>
          <NavLink to="/student/new" className={linkClass}>
            <PlusCircle className="w-4 h-4 text-emerald-400" />
            <span>File New Complaint</span>
          </NavLink>
          <NavLink to="/student/complaints" className={linkClass}>
            <ListOrdered className="w-4 h-4 text-blue-400" />
            <span>My Complaints</span>
          </NavLink>
        </nav>
      )}

      {user.role === 'STAFF' && (
        <nav className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-slate-500 px-3 tracking-wider uppercase mb-1">
            Technician Queue
          </div>
          <NavLink to="/staff" end className={linkClass}>
            <ListTodo className="w-4 h-4 text-emerald-400" />
            <span>My Walking Queue</span>
          </NavLink>
        </nav>
      )}

      {(user.role === 'SUPERVISOR' || user.role === 'ADMIN') && (
        <nav className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-slate-500 px-3 tracking-wider uppercase mb-1">
            Management Portal
          </div>
          <NavLink to={user.role === 'ADMIN' ? '/admin/dashboard' : '/supervisor'} end className={linkClass}>
            <LayoutDashboard className="w-4 h-4 text-cyan-400" />
            <span>KPI Dashboard</span>
          </NavLink>
          <NavLink to="/supervisor/all-complaints" className={linkClass}>
            <ListOrdered className="w-4 h-4 text-blue-400" />
            <span>All Complaints</span>
          </NavLink>
          <NavLink to="/supervisor/escalated" className={linkClass}>
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>Escalated Queue</span>
          </NavLink>
          <NavLink to="/supervisor/hotspots" className={linkClass}>
            <Flame className="w-4 h-4 text-amber-400" />
            <span>Hotspots & Alerts</span>
          </NavLink>
        </nav>
      )}

      {user.role === 'ADMIN' && (
        <nav className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-slate-500 px-3 tracking-wider uppercase mb-1">
            Administration
          </div>
          <NavLink to="/admin/users" className={linkClass}>
            <Users className="w-4 h-4 text-purple-400" />
            <span>User Accounts</span>
          </NavLink>
          <NavLink to="/admin/infrastructure" className={linkClass}>
            <Building className="w-4 h-4 text-amber-400" />
            <span>Blocks & Rooms</span>
          </NavLink>
          <NavLink to="/admin/allotments" className={linkClass}>
            <BedDouble className="w-4 h-4 text-blue-400" />
            <span>Room Allotments</span>
          </NavLink>
        </nav>
      )}

      <nav className="flex flex-col gap-1.5">
        <NavLink to="/account" className={linkClass}>
          <UserCircle2 className="w-4 h-4 text-slate-300" />
          <span>My Account</span>
        </NavLink>
      </nav>

      <div className="mt-auto p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
        <div className="flex items-center gap-2 text-slate-300 font-semibold mb-1">
          <HelpCircle className="w-4 h-4 text-cyan-400" />
          <span>Hostel Support</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-normal">
          Closed loop maintenance dispatch. For emergencies, contact Chief Warden's Office.
        </p>
      </div>
    </aside>
  );
};
