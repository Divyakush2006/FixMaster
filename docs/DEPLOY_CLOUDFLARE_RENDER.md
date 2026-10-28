# Deploying FixMaster: Cloudflare Pages + Render + Neon

```
 browser ──► divyakush.info (Cloudflare Pages)
                 ├─ static web app  (client/dist)
                 └─ /api/*  ──► Pages Function (client/functions/api/[[path]].js)
                                    └──► fixmaster-api.onrender.com (Render, always on)
                                              ├─► Neon PostgreSQL
                                              ├─► Cloudflare R2   (ticket photos)
                                              ├─► Brevo SMTP      (sign-up and reset email)
                                              └─► Groq / Gemini / OpenRouter (optional AI)
```

The browser only ever talks to `divyakush.info`, so sign-in cookies, CSRF and CORS work with no
special settings. The function passes each visitor's real address to the API (shared secret
`EDGE_PROXY_SECRET`) so rate limiting is per user, not one bucket for everyone.

Cost: $0. This guide uses only free plans: Render free, Neon free, Cloudflare Pages and R2 (10 GB) and Brevo
(300 mails a day). See "Limits to know" for what the free plans cost you in behaviour.

Do the steps in order. Each ends with a check.

---

## 1. Database (Neon)

1. In the Neon console, open the project that will hold production data. **Make a branch first** (for example
   `before-first-deploy`) so there is a restore point; the first deploy applies all migrations.
2. Copy the **direct** connection string (Connection details, turn *Pooled connection* **off**). The API
   takes a lock while migrating, which a pooler can break. It looks like
   `postgresql://user:password@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
3. Note the region. This project is in `aws-us-east-2` (Ohio), so `render.yaml` uses Render's Ohio region.

## 2. Photo storage (Cloudflare R2)

Render's disk is wiped on every deploy, so photos need a bucket.

1. Cloudflare dashboard, **R2 Object Storage**, create a bucket (for example `fixmaster-photos`). Keep it **private**.
2. **Manage R2 API Tokens**, create a token with *Object Read & Write* on that bucket. Copy the **Access Key ID**,
   **Secret Access Key** and the S3 endpoint `https://<account-id>.r2.cloudflarestorage.com`.

## 3. Email (Brevo) from your own domain

Mail sent "from" a gmail.com address through Brevo is likely to be treated as spam. Use your domain:

1. Brevo, **Senders, Domains & Dedicated IPs, Domains**, add `divyakush.info` and **Authenticate**. Brevo shows
   DNS records (a Brevo code, DKIM and DMARC). Add them in Cloudflare DNS (DNS only, not proxied).
2. Add the sender `no-reply@divyakush.info` under Senders.
3. Your SMTP login and SMTP key are the ones already in your local `.env` (`SMTP_USER`, `SMTP_PASS`).

## 4. The API (Render)

1. Push the repository to GitHub (it is on the `final` branch of `Divyakush2006/FixMaster`).
2. Render dashboard, **New, Blueprint**, pick the repository and branch `final`. Render reads
   [`render.yaml`](../render.yaml) and creates the service `fixmaster-api` (Docker, **free** plan).
3. Fill in the values it asks for:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the Neon direct string from step 1 |
   | `SMTP_USER`, `SMTP_PASS` | the Brevo SMTP login and key |
   | `MAIL_FROM` | `FixMaster <no-reply@divyakush.info>` (after step 3) |
   | `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | from step 2 |
   | `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | your AI keys (optional; leave empty to skip) |

   Already set by the Blueprint: `NODE_ENV=production`, `TRUST_PROXY=1`, `SMTP_PORT=2525` (Render's free plan blocks 25, 465 and 587; Brevo also answers on 2525), `CORS_ORIGIN` and `APP_URL`
   (`https://divyakush.info`), a generated `JWT_SECRET`, `EDGE_PROXY_SECRET` and `METRICS_TOKEN`.
   If you also serve `https://www.divyakush.info`, set `CORS_ORIGIN` to both, comma separated.
4. Deploy. The container applies the database migrations, then starts.
5. **Check:** open `https://fixmaster-api.onrender.com/api/health`. Expect `{"status":"ok", ...}`.
   Then **copy the value of `EDGE_PROXY_SECRET`** (Environment tab, reveal) for step 6.

## 5. First administrator

Run this on your own computer, in the project folder, against the production database. Your passwords then
never leave your machine. (PowerShell shown.)

```powershell
$env:DATABASE_URL = "<the Neon direct string>"
npm run db:provision -- --yes --admin-only --require-change --admin-email you@yourmail.com --web-url https://divyakush.info --out "$HOME\fixmaster-admin.txt"
```

This creates one administrator, `ADMIN_01`, with a random password in that file; it must be changed at first
sign-in, and "Forgot password" mails `you@yourmail.com`. It adds no sample residents or rooms.
Delete the file after you have signed in. Close the PowerShell window so the connection string is forgotten.

Everyone else is created from the app, so every real account has a real email:

- **Residents** register themselves at `/register` (email verification code).
- **Supervisors, chief wardens, technicians**: Admin, *Users & access*, create a user with their real email and a
  starting password, and keep "must choose their own password" ticked. Give them the starting password yourself;
  from then on "Forgot password" reaches their email.
- **Hostel layout**: Admin, *Blocks & rooms* (rooms and shared areas per block).

## 6. The web app (Cloudflare Pages)

1. Cloudflare dashboard, **Workers & Pages, Create, Pages, Connect to Git**, pick the repository.
2. Build settings:

   | Setting | Value |
   |---|---|
   | Production branch | `final` |
   | Root directory | `client` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

3. **Environment variables** (Production):

   | Variable | Value |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `API_ORIGIN` | `https://fixmaster-api.onrender.com` (your service's address, no trailing slash) |
   | `EDGE_PROXY_SECRET` | the value copied from Render (add it as a **Secret**) |

   Leave `VITE_API_BASE_URL` unset: the app must call `/api` on its own address.
4. Save and deploy. In the project, **Functions** should list the route `/api/[[path]]`.
5. **Custom domains**, add `divyakush.info` (and `www.divyakush.info` if wanted). The domain must use
   Cloudflare's nameservers; Cloudflare adds the DNS record for you.
6. **Check:** `https://divyakush.info/api/health/live` returns `{"status":"ok"}` (that is the API, through the function).

## 7. Keep the API awake (free plan)

A free Render service sleeps after 15 minutes without traffic, takes about a minute to wake, and the retry sweeper
that re-tries unassigned tickets does not run while it sleeps. A pinger keeps it up:

1. Create a free account at uptimerobot.com, **Add New Monitor**, type *HTTP(s)*.
2. URL `https://fixmaster-api.onrender.com/api/health/live`, interval 5 minutes.

The 750 free instance hours a month cover one service running all month (about 720 hours). Do not add a second
free service in the same Render workspace, or the hours run out around mid-month and both are suspended.

## 8. Smoke test (five minutes)

1. `https://divyakush.info/admin`: sign in as `ADMIN_01`; choose a new password when asked.
2. Create a supervisor and a technician with real emails; use "Forgot password" for one of them and check the mail arrives.
3. Add a block's rooms (Blocks & rooms) and switch the autopilot on for a block (Autopilot settings, as a supervisor).
4. Register a resident at `/register`; the verification mail arrives; sign in; raise a ticket with a photo.
5. The ticket shows its handling trail (received, AI review, assigned); sign in as the technician and see it.
6. Open the photo again after a Render redeploy: it is still there (R2).
7. `https://divyakush.info/api/auth/capabilities` shows `"password_reset": true` and `"student_signup": true`.

## Updating later

- Push to `final`: both Render and Pages build automatically. Pages publishes the web app; Render runs
  migrations and rolls the API over. Releases that add API endpoints should reach Render first (watch the deploy log
  until live), then Pages.
- Roll back: Render, *Events*, redeploy an earlier deploy; Pages, *Deployments*, *Rollback*.
- Database: Neon keeps point-in-time history; restore by branching from a past time.

## Limits to know

- **Cloudflare Functions free plan: 100,000 requests a day** across the whole site's `/api` calls. The
  ticket page refreshes every 2 seconds only while the AI review is pending, but a busy campus can still pass
  100,000. If the Functions tab shows you near the limit, the Workers Paid plan ($5 a month) lifts it to 10 million a month.
- **Render free** sleeps when idle (step 7 prevents it), has no shell and no disk that survives a deploy (photos
  are in R2, the first administrator is created from your own computer), and gives 750 instance hours a month.
  If the pinger ever fails, the first visitor after 15 idle minutes waits about a minute.
- **Brevo free** sends 300 mails a day.
- **Groq/Gemini/OpenRouter free tiers** have daily allowances; the app falls back to rule-based handling when they run out.

## When something is wrong

| Symptom | Cause and fix |
|---|---|
| Any `/api` call returns 503 `API_UNAVAILABLE` | `API_ORIGIN` is missing or has no `https://` in Pages variables. Fix and redeploy Pages. |
| Returns 502 `API_UNAVAILABLE` | Render is deploying or down. Check the service's Logs. |
| Sign-in works but the next page is "session no longer valid" | The page was opened on an address not in `CORS_ORIGIN` (for example `www`). Add it, or redirect `www` to the main address. |
| 403 `ORIGIN` on every action | `CORS_ORIGIN` does not match the address in the browser exactly (`https://divyakush.info`, no trailing slash). |
| Everyone gets "too many attempts" together | `EDGE_PROXY_SECRET` differs between Render and Pages, so all users appear to share one address. Make them identical. |
| Render fails at start with "CORS_ORIGIN must be set" or "JWT_SECRET" | A required variable was cleared. The message names it. |
| Sign-up and "Forgot password" say they are unavailable | Mail settings are missing. Fill the `SMTP_*` and `MAIL_FROM` variables and redeploy. |
| Photos vanish after a deploy | `S3_BUCKET` is not set, so photos went to Render's disk. Set the R2 variables. |
| Mail fails with a timeout or "connection" error | `SMTP_PORT` is 587 or 465, which Render free blocks. Use 2525. |
| Mail goes to spam | The domain is not authenticated in Brevo (step 3), or `MAIL_FROM` is a gmail.com address. |
