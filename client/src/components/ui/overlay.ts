import { useEffect, useRef } from 'react';

// Stacked overlays (a confirm dialog over a modal) share one scroll lock:
// the page scrolls again only when the last overlay closes.
let lockCount = 0;
let previousOverflow = '';

function lockScroll() {
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = previousOverflow;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared overlay behaviour: scroll lock, Escape to close (topmost only),
 * initial focus inside the panel, Tab kept inside it, and focus returned to
 * whatever opened it.
 */
export function useOverlay(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    lockScroll();

    const panel = panelRef.current;
    // Prefer an explicit target, then the first form field; otherwise the
    // panel itself (so screen readers announce the dialog, not its close button).
    const first =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ||
      panel?.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])');
    (first || panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (!panel) return;
      // Only the topmost overlay reacts.
      const overlays = document.querySelectorAll('[data-overlay]');
      if (overlays[overlays.length - 1] !== panel.closest('[data-overlay]')) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
        if (items.length === 0) return;
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstItem) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      unlockScroll();
      opener?.focus?.();
    };
  }, [open]);

  return panelRef;
}
