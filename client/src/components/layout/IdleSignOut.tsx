import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getLastActivity, touchActivity } from '../../api/session';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Role } from '../../types';

/**
 * Inactivity limits per role, in minutes. Hostel common-room computers are
 * shared, so a session left open must not stay usable all day; administrators
 * hold the most power and get the shortest window.
 */
export const IDLE_LIMIT_MINUTES: Record<Role, number> = {
  ADMIN: 30,
  SUPERVISOR: 60,
  STUDENT: 120,
  STAFF: 240,
};
const WARNING_SECONDS = 60;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** Signs the user out after a period of inactivity, with a one-minute warning. */
export const IdleSignOut: React.FC = () => {
  const { user, logout } = useAuth();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const lastWrite = useRef(0);

  const limitMs = user ? IDLE_LIMIT_MINUTES[user.role] * 60_000 : 0;

  const signOut = useCallback(() => {
    if (!user) return;
    const signIn = user.role === 'ADMIN' ? '/admin' : user.role === 'STUDENT' ? '/login' : '/login?portal=staff';
    logout();
    // A full page load (not a router push): nothing from this session stays
    // in memory, and the route guard can't race this redirect.
    window.location.replace(`${signIn}${signIn.includes('?') ? '&' : '?'}idle=1`);
  }, [user, logout]);

  // Record activity (throttled; shared across tabs through localStorage).
  useEffect(() => {
    if (!user) return;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite.current > 5_000) {
        lastWrite.current = now;
        touchActivity(now);
      }
    };
    // No touch on mount: reloading or reopening the page is not activity, so
    // a session left open on a shared computer still expires on time. Signing
    // in records the first activity (saveSession).
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
  }, [user]);

  // Check once a second while the warning shows, every 15 s otherwise.
  useEffect(() => {
    if (!user) return;
    const tick = () => {
      const remaining = getLastActivity() + limitMs - Date.now();
      if (remaining <= 0) {
        setSecondsLeft(null);
        signOut();
      } else if (remaining <= WARNING_SECONDS * 1000) {
        setSecondsLeft(Math.ceil(remaining / 1000));
      } else {
        setSecondsLeft(null);
      }
    };
    tick();
    const id = window.setInterval(tick, secondsLeft !== null ? 1000 : 15_000);
    return () => window.clearInterval(id);
  }, [user, limitMs, signOut, secondsLeft !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user || secondsLeft === null) return null;

  const stay = () => {
    touchActivity();
    setSecondsLeft(null);
  };

  return (
    <Modal
      isOpen
      onClose={stay}
      title="Are you still there?"
      maxWidth="md"
      footer={
        <>
          <Button variant="secondary" onClick={signOut}>
            Sign out now
          </Button>
          <Button onClick={stay} data-autofocus>
            Stay signed in
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        For security, you will be signed out in{' '}
        <strong className="tabular text-slate-900">
          {secondsLeft} second{secondsLeft === 1 ? '' : 's'}
        </strong>{' '}
        because there has been no activity for a while.
      </p>
    </Modal>
  );
};
