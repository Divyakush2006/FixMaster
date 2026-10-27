import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { PageLoader } from '../../components/ui/PageLoader';

/**
 * /auth/sso/done - where the university sends the browser back to. The API has
 * already opened the session (a cookie); this page asks who it is for, then goes
 * to that person's home, or to the profile form if they have not completed it.
 */
export const SsoDonePage: React.FC = () => {
  const { completeSso, getHomeRouteForRole } = useAuth();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeSso()
      .then((user) => navigate(user.account_status === 'ACTIVE' ? getHomeRouteForRole(user.role) : '/onboarding', { replace: true }))
      .catch(() => navigate('/login?sso=failed', { replace: true }));
  }, [completeSso, getHomeRouteForRole, navigate]);

  return <PageLoader fullScreen />;
};
