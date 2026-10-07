# FIX_MASTER — Frontend Notes

React 18 + TypeScript + Vite + TanStack Query + Tailwind, in `client/`.
The full audit and its fixes are in [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md).

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
| `/supervisor/*` | SUPERVISOR, ADMIN | KPIs, all complaints, escalations, hotspots, dispatch. |
| `/admin/dashboard` | ADMIN | KPI dashboard (admin home). |
| `/admin/users`, `/admin/allotments` | ADMIN | Create staff/supervisor accounts, deactivate, reset passwords; allot and move students between rooms. |
| `/admin/infrastructure` | ADMIN | Blocks A-T, floors (Ground + 1-10, add more), rooms added per floor with generated numbers (`G01`, `428`). |
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
