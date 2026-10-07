# FIX_MASTER — Frontend Notes

React 18 + TypeScript + Vite + TanStack Query + Tailwind, in `client/`.
The full audit and its fixes are in [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md).

## Design system

An enterprise service-desk look: a navy sidebar, a light workspace, compact
data tables, Inter type and one corporate blue (`brand-*` in
`tailwind.config.js`). Light theme only.

- **Primitives** live in `src/components/ui/`: `Button`/`ButtonLink`/`IconButton`,
  form controls with labelled `Field` (+ `PasswordInput`), `Card`/`CardHeader`/
  `DetailList`, `PageHeader` (breadcrumbs + actions), `Badge`, `Alert`, `Tabs`/
  `Segmented`, `Table` parts, `Modal`, `Drawer` (record side panel), `StatCard`,
  `Switch`, `Avatar`, `Toast`, `EmptyState`, `Skeleton`, `Pagination`.
- **Confirmations** use `useConfirm()` (`ConfirmDialog.tsx`) - never
  `window.confirm`/`prompt`.
- **Dialogs and drawers** share `overlay.ts`: scroll lock, Escape closes the
  topmost one, focus moves in, Tab stays inside, focus returns on close.
- **Vocabulary** is centralised in `src/utils/labels.ts` (status, priority,
  trade, role and room-type labels, `ticketRef()` -> `TKT-00A3F9`,
  `ticketLocation()`). Screens show these labels, never raw enum codes.
- **Navigation** per role is defined once in `components/layout/navigation.ts`;
  the sidebar becomes a slide-in drawer below the `md` breakpoint.

## How it talks to the API

- All requests go to the **same-origin path `/api`** (`src/api/client.ts`).
  In development Vite proxies it to `http://localhost:5000` (override with
  `API_PROXY_TARGET`); in production the nginx image proxies it to the API
  container. Set `VITE_API_BASE_URL` only if the API lives on another origin.
- **401 vs 403.** Only a 401 (no/invalid/expired/revoked token, or a
  deactivated account) signs the user out. A 403 is an ordinary "not allowed"
  error shown in place - it must never sign anyone out.
- **Session state** lives in one module, `src/api/session.ts`. Sign-in and
  sign-out clear all of it plus the query cache (`src/api/queryClient.ts`), so
  the next person on a shared hostel computer inherits nothing.
- An expired session sends the user back to the sign-in page of their own area
  (`/admin` for admin pages, `/login` otherwise). A failed sign-in attempt never
  ends a session that is already open.
- **Sign-out** calls `POST /api/auth/logout` so the token is revoked on the
  server, then clears local state. Signing out in one tab signs out all tabs
  (`storage` event in `AuthContext`).
- **Idle sign-out** (`components/layout/IdleSignOut.tsx`): 30 min admin,
  60 min supervisor, 2 h student, 4 h technician, with a one-minute warning.
  Only real input counts as activity - a reload does not.
- **Large lists** (ticket register, users, allotments, audit log) are searched
  and paged on the server: `apiFetchPage()` returns `{ items, total }` from the
  `X-Total-Count` header.
- **Accessibility**: every screen passes axe-core WCAG 2.1 AA. Secondary text
  uses `slate-500`, which is overridden in `tailwind.config.js` to a shade that
  meets 4.5:1 on the canvas; keep using it rather than `slate-400` for text.
- A password change returns a new token (the server revokes all older ones);
  `AuthContext.updateToken` swaps it in so the current session continues.

## Screens

| Route | Role | Notes |
|---|---|---|
| `/login` | public | Two separate sign-ins: **Student** tab and **Staff** tab (`?portal=staff`). Demo accounts are listed only in development builds. |
| `/register` | public | Student self-registration (the only self-registration). |
| `/admin` | public | **Administrator sign-in**, separate from `/login` and not linked from it. |
| `/student`, `/student/new`, `/student/complaints` | STUDENT | Room tickets and 1-click actions use the student's **real allotment** (`GET /me/allotment`). With no allotment the student can still report common-area problems. |
| `/staff` | STAFF | Floor-ordered queue, start work, mark done, on/off duty toggle. |
| `/supervisor/*` | SUPERVISOR, ADMIN | Operations overview, all tickets (dispatch side panel with activity history), escalations, recurring issues. |
| `/admin/dashboard` | ADMIN | KPI dashboard (admin home). |
| `/admin/users`, `/admin/allotments` | ADMIN | Create staff/supervisor accounts, deactivate, reset passwords; allot and move students between rooms. |
| `/admin/infrastructure` | ADMIN | Blocks A-T, floors (Ground + 1-10, add more), rooms added per floor with generated numbers (`G01`, `428`). |
| `/admin/audit` | ADMIN | Append-only log of account, allotment and infrastructure changes, admin sign-ins and lockouts. |
| any unknown path | signed in | 404 page (signed-out visitors go to the sign-in page). |
| `/account` | everyone | Profile and password change. |

Every page is lazy-loaded (its own chunk) and wrapped in an error boundary.

## Commands

```bash
npm run dev      # dev server on :3000
npm run lint     # type-check
npm test         # unit tests (vitest)
npm run build    # production build into dist/
```

## Known limitation

The JWT is kept in `localStorage`, so an XSS bug could read it. The strict CSP
served by nginx (`script-src 'self'`, no inline scripts in the build) is the
mitigation. Moving to httpOnly cookies is the recommended next step - see
item 1 under *Not done* in the readiness audit.
