import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  Sparkles,
  PlusCircle,
  ListOrdered,
  ListTodo,
  LayoutDashboard,
  AlertTriangle,
  Flame,
  Users,
} from 'lucide-react';

export const BottomNav: React.FC = () => {
  const { user } = useAuth();
  if (!user) return null;

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center py-2 px-1 text-[10px] font-semibold transition-colors flex-1 ${
      isActive ? 'text-cyan-400 font-bold' : 'text-slate-400 hover:text-slate-200'
    }`;

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-14 bg-slate-950/95 border-t border-slate-800 backdrop-blur-lg md:hidden z-40 flex items-center justify-around px-2">
      {user.role === 'STUDENT' && (
        <>
          <NavLink to="/student" end className={itemClass}>
            <Sparkles className="w-5 h-5 mb-0.5" />
            <span>Quick</span>
          </NavLink>
          <NavLink to="/student/new" className={itemClass}>
            <PlusCircle className="w-5 h-5 mb-0.5" />
            <span>File</span>
          </NavLink>
          <NavLink to="/student/complaints" className={itemClass}>
            <ListOrdered className="w-5 h-5 mb-0.5" />
            <span>My Tickets</span>
          </NavLink>
        </>
      )}

      {user.role === 'STAFF' && (
        <NavLink to="/staff" end className={itemClass}>
          <ListTodo className="w-5 h-5 mb-0.5" />
          <span>My Walking Queue</span>
        </NavLink>
      )}

      {(user.role === 'SUPERVISOR' || user.role === 'ADMIN') && (
        <>
          <NavLink to={user.role === 'ADMIN' ? '/admin/dashboard' : '/supervisor'} end className={itemClass}>
            <LayoutDashboard className="w-5 h-5 mb-0.5" />
            <span>KPIs</span>
          </NavLink>
          <NavLink to="/supervisor/all-complaints" className={itemClass}>
            <ListOrdered className="w-5 h-5 mb-0.5" />
            <span>Tickets</span>
          </NavLink>
          <NavLink to="/supervisor/escalated" className={itemClass}>
            <AlertTriangle className="w-5 h-5 mb-0.5" />
            <span>Escalated</span>
          </NavLink>
          <NavLink to="/supervisor/hotspots" className={itemClass}>
            <Flame className="w-5 h-5 mb-0.5" />
            <span>Hotspots</span>
          </NavLink>
          {user.role === 'ADMIN' && (
            <NavLink to="/admin/users" className={itemClass}>
              <Users className="w-5 h-5 mb-0.5" />
              <span>Admin</span>
            </NavLink>
          )}
        </>
      )}
    </nav>
  );
};
