# Running FixMaster

A runbook for whoever is on call. For setup and the settings themselves see
`.env.example`; for what the system does see `docs/README.md`.

## What is running

| Part | What it is | Where state lives |
|---|---|---|
| API | Node 22, Express 5, stateless | PostgreSQL |
| Web app | Static files behind nginx | none |
| PostgreSQL | The only required store | the database |
| Redis (optional) | Shares rate-limit counters between several API servers | counters only, safe to lose |
| AI providers (optional) | Groq, Gemini, OpenRouter, or a local CPU model | none; every feature works without them |

The API can run as several identical instances behind a load balancer. Set
`TRUST_PROXY`, and `REDIS_URL` once there is more than one, so limits count
across all of them. Without Redis each instance counts for itself.

## Is it healthy?

- `GET /api/health/live`: the process is up. Never touches the database; use it for restart checks.
- `GET /api/health`: the database answers (503 if not). Includes `redis: up|down` when Redis is configured; Redis down does not fail readiness.
- `GET /api/metrics`: Prometheus text. In production it exists only when `METRICS_TOKEN` is set; scrape with `Authorization: Bearer <token>`.

### Suggested alerts

| Alert | Condition | First look |
|---|---|---|
| API errors | `rate(fixmaster_http_server_errors_total[5m]) > 0.05` for 10 min | the error webhook message and the log line with that request id |
| Slow | p95 of `fixmaster_http_request_duration_seconds` above 0.3 s for 15 min | `fixmaster_db_pool_connections{state="waiting"}` (raise `DB_POOL_MAX`?), then the slowest route label |
| Database down | `fixmaster_db_up == 0` | the database host; the API recovers by itself |
| Pool exhausted | `waiting` above 0 for 5 min | long queries; `statement_timeout` is already set |
| AI degraded | `fixmaster_ai_success_ratio_hour < 0.7` | Insights, then the AI health banner; nothing is broken for users, features fall back |
| Backlog | `fixmaster_open_tickets` far above its usual level | dispatch; the Staffing report |

Unexpected server errors are also sent to `ERROR_WEBHOOK_URL` (Slack, Teams,
Google Chat or Mattermost): the route pattern, the error message and the request
id, each distinct failure once and then at most every 5 minutes. Nothing the
person sent is included.

## Common situations

**The AI is down or misbehaving.** Managers see the AI health banner. Nothing
needs doing: the assistant uses its keyword matcher, the briefing its fixed
rules, the autopilot suggests only. To rehearse or to switch it all off at once:
chief warden or administrator, AI health, "Start outage drill" (or `POST
/api/ai/drill`). An AI error never affects priority: priority comes from the
issue catalogue and nowhere else.

**The top bar says "AI partly off".** A provider has failed at least three times in the last hour and more often than it answered, or it is paused, out of today's allowance or out of keys. Hover the chip, or read the banner on the overview, for which one and why; the others are covering, so nothing stops. A couple of slow answers are not enough to raise it. The daily briefing is allowed 20 s per attempt (live requests 8 s), because the free Gemini tier is sometimes slower than 8 s on the longer prompt.

**A provider's free allowance ran out.** The gateway counts calls per provider
per day across all servers and moves to the next provider in the task's chain
(`AI_ROUTE_*`). Raise a limit only after checking the provider's console.

**Rotating a provider key.** Change the environment variable and restart the API
instances one at a time. Keys are never written to the call log.

**Many failed sign-ins.** Login limits are per account and address and fail
safe: when Redis is down they are skipped, and the per-account lockout still
applies.

**A resident asks for their data or erasure.** Account, Your data (the resident
does it themselves). Erasure is an administrator action: Administration,
Privacy requests. It is refused while the resident still has a room or an open
ticket, and says why.

## The two hostels

The men's and the ladies' hostel are separate in the data (migration 016). A block belongs to one hostel (`hostel_blocks.hostel_type` MENS or LADIES) or, for an academic block such as PRP, to neither; its `block_kind` is `RESIDENTIAL` (floors and rooms), `HOSTEL_WIDE` (the complete hostel, e.g. MH; one per hostel) or `ACADEMIC`. Hostel-wide and academic blocks have shared areas only: the database refuses to add rooms to them.

- **Who sees what.** A chief warden runs every block of their hostel plus the academic blocks. A supervisor runs the blocks assigned to them, or every residential block of their hostel when none is assigned. Administrators run everything. An account with no hostel keeps the pre-016 behaviour (a chief warden or an unassigned supervisor sees every block), so nothing changes for installations that do not set hostels. Tickets, the register, analytics, the briefing, the autopilot and notifications all use this scope.
- **Setting it up.** Administration, Users and access: pick a supervisor or chief warden, Hostel (and blocks). There is one chief warden per hostel; moving a supervisor to the other hostel takes away their blocks there. A block's hostel and kind are changed under Administration, Blocks and rooms (administrator only).
- **Block ids.** Both hostels have an A-Block, and block ids are unique across the campus, so a ladies' residential block's id has an L in front (`LA_BLOCK`, `LS_BLOCK`; room `LA-101`). The men's L-Block stays `L_BLOCK`. The migration removes the empty `S_BLOCK` (S is a ladies' block); if rooms or tickets already refer to it, it is kept and handed to the ladies' hostel.
- **Block settings.** Supervisors and chief wardens manage floors, rooms and shared areas of the blocks they run (Hostel, Block settings; `/api/infrastructure/*`). Every change is audited (`room.create`, `room.close`, `floor.add`, `area.create`, `area.close`, `block.rename`, ...).
- **Dispatch settings.** Per block and trade, as before; the first group in the list is "A whole hostel at once" (one save writes the setting to every block of that hostel the caller runs, MH included, PRP not). The campus default reaches both hostels, so only an administrator or a chief warden with no hostel can change it; a hostel's chief warden uses "every block of the ... hostel". A block added to a hostel later follows the campus default until the hostel setting is saved again.
- **Charts and tables.** Block figures carry `hostel_type` and `block_kind` (`GET /api/analytics/kpi`) and are ordered men's, ladies', academic. On the overview the men's blocks are labelled A to T, the ladies' LA to LS, plus MH and PRP, with a Both / Men's / Ladies' switch.
- **Residents.** A resident can request, and the office can allot, only a room in the hostel of the gender on their profile (MALE or FEMALE; other answers are not restricted). They can report faults in their own hostel's shared areas and in academic blocks, never in the other hostel's.

## Automatic dispatch

A trade in a block set to Automatic (Dispatch settings) is assigned by the autopilot's rules and score, with no model involved: it is explainable and costs nothing. It acts in three places:

- **When a ticket is raised or sent back** (immediately, as before).
- **Every minute, for tickets that nobody could take** (`src/services/autopilot/sweeper.js`). A ticket raised while everyone was at their limit, off shift or on leave, or raised before its block was switched to Automatic, used to wait for a supervisor indefinitely. The sweeper takes open tickets on Automatic, urgent and oldest first, up to `AUTOPILOT_SWEEP_BATCH` (100) per pass, through the same dispatch as a live assignment. `AUTOPILOT_SWEEP_SECONDS=0` switches it off. Several API instances are safe: one holds a database lock per pass.
- **On demand**: Dispatch settings has a "What Automatic is doing" panel (assigned in the last 24 hours, tickets still waiting and the reason for each, "Run now"). It is limited to the caller's blocks (`GET /api/autopilot/status`, `POST /api/autopilot/sweep`).

Out of the box every block is on **Suggest** (the policy in ROADMAP section 6: move a trade to Automatic once supervisors rarely override it), so nothing is automatic until someone turns it on. The page says so when a selection has no trade on Automatic and offers "Turn on for every trade". Tickets on Suggest or Off are never assigned by the autopilot; escalated tickets (a resident rejected the work twice) always wait for a supervisor.

## How a new ticket is handled

Each ticket carries a handling trail (`ticket_handling_steps`, migration 017; `GET /api/complaints/:id/handling`). Residents see it on their ticket ("How your request was handled"), supervisors in the ticket drawer ("Automatic handling", with scores added). In order:

1. **Request received**: the reference and the priority it was registered with. A second resident reporting the same issue is acknowledged on the existing ticket.
2. **Review**: the AI model reads what the resident wrote (names, phone numbers and emails removed first) and answers with an urgency and a yes/no for "could someone be hurt". The step names the model that answered ("Groq · gpt-oss-20b"). A fixed list of danger words (sparks, burning smell, flooding, stuck in a lift ...) is checked at the same time. The review may only **raise** a priority (the model by up to two levels, the danger words by one, the most a resident could choose for themselves) and never above High; it never lowers one, never sets Emergency, never chooses a technician. An answer below 70% confidence, or text that tried to instruct the model, raises nothing. With no model available the danger words still apply and the step says "Checked by safety rules"; a one-tap request with no description needs no review. The safety advice shown to the resident is reviewed text, not generated.
3. **Dispatch**: Automatic assigns the best technician and says who; Suggest-only and Off say the ticket is waiting for a supervisor (and who the suggestion is); when nobody is free the step says why ("4 off duty, 1 on leave"), the ticket is retried every minute (see autopilot/sweeper.js), and a changed reason is written once, not every minute.
4. **Flagged to the supervisors**: after `TICKET_WAIT_ALERT_MINUTES` (30) without a technician.

The resident's confirmation waits up to `TICKET_REVIEW_WAIT_MS` (3 s) for the review so it can already show it. A priority change is also written to the ticket's history ("Priority raised to High by AI review: ...") and to `complaints.ai_priority_reasoning` / `ai_decided`. TRIAGE uses one model call per ticket that has a description; it follows the INTAKE chain (`AI_ROUTE_TRIAGE` to change it) and counts toward the same provider allowances.

## AI provider keys

Which models run, and why, is in [AI_MODELS.md](AI_MODELS.md) (`npm run ai:bench` repeats the comparison). `GROQ_API_KEY`, `OPENROUTER_API_KEY` and `GEMINI_API_KEY` each accept one key or several, comma-separated (`GROQ_API_KEY="gsk_a,gsk_b"`), typically one per free account. Keys are used in the order written. When a provider answers 429 (rate limited) or 401/402 (key refused / no credit), the same request - same prompt, model and schema - is sent again with the next key; the spent key rests for the provider's `Retry-After` (one minute if absent; an hour if refused) and then returns to service. Other failures (timeouts, 5xx, invalid output) do not rotate keys; they follow the task's provider chain as before. When every key of a provider is resting, the provider is skipped without a call. Rotation happens inside one logged attempt, so the quota ledger is unaffected; `AI_DAILY_LIMIT_<PROVIDER>` is per key and is multiplied by the number of keys. Resting state is per API process. `npm run ai:keys` sends one tiny request per key and reports which work, are rate limited or are refused (keys shown by position only). `GET /api/ai/health` reports `keys_total` and `keys_available` per provider, never the keys.

## Photo storage

Ticket photos are written to local disk (`UPLOAD_DIR`) unless `S3_BUCKET` is set,
in which case they live in an S3-compatible bucket (Amazon S3, Cloudflare R2,
MinIO, SeaweedFS ...) and any number of API instances share them. Requests are
signed with AWS Signature Version 4 by the API itself; nothing extra is installed.
Settings are in `.env.example`. Use a **private** bucket, in India for DPDP
purposes if the data must stay in the country, with encryption at rest
(`S3_SSE=true` asks for it; some stores always encrypt). A photo is only ever
served through the API, after it has checked who may see the ticket, so the bucket
needs no public access and no CORS rules. Photos already on disk are not moved
automatically: copy `UPLOAD_DIR` into the bucket under the prefix (default
`ticket-photos/`), keeping the file names (`<ticket id>.jpg|png`). Back up the
bucket the way you back up the database (versioning or a replica).

`tests/object_storage_real.test.js` runs the photo journey against a real server
when `TEST_S3_ENDPOINT`, `TEST_S3_BUCKET`, `TEST_S3_ACCESS_KEY` and
`TEST_S3_SECRET_KEY` are set (it was run against SeaweedFS, which checks
signatures itself).

## Data

**Retention.** A daily job removes what is past its period: model-call log 90
days, stored briefings 90, email codes 30, never-confirmed sign-ups 14, expired
sign-in revocations. The audit log is kept unless `RETENTION_AUDIT_DAYS` is set.
Administrators can read the periods in force at `GET /api/admin/retention-policy`;
the public privacy notice quotes the same settings.

**Backups.** `scripts/backup.sh` takes a dump, checks it can be read back and
prunes old ones; run it on a schedule against the direct (unpooled) database
address. Restore with `scripts/restore.sh`.

**The drill.** A backup that has never been restored is a hope. `npm run db:drill`
dumps a database, restores it into a scratch one and compares every table (row
counts and, for tables up to 200,000 rows, a content checksum), then removes the
scratch database. `.github/workflows/backup-drill.yml` runs it monthly on a
campus-sized database. Run it by hand after any change to how backups are taken,
and once against a copy of production before launch.

## Capacity

Measured on a development PC (database, API and load generator on one machine),
campus-sized data (about 11,000 residents, 8,500 tickets), 16 concurrent users:
about 675 requests a second, p95 44 ms, no errors. Manager dashboards reuse one
computation per 15 seconds (`DASHBOARD_CACHE_MS`), so a morning rush of
supervisors costs the database one query, not one each. Reproduce with
`npm run db:scale -- --yes` and `npm run load:test` against a non-production
database.

## Local models

CPU only by design: `scripts/local-ai/README.md`. `LOCAL_AI_NUM_GPU=0` keeps a
model off any GPU. Nothing local runs unless its address is configured.

## First deployment checklist

1. **Secrets** (`.env`): a random `JWT_SECRET` (32+ characters), `POSTGRES_PASSWORD`, `CORS_ORIGIN` (the web origin), `TRUST_PROXY` (1 behind one proxy), `METRICS_TOKEN` if `/api/metrics` is scraped. The API refuses to start without a strong secret and `CORS_ORIGIN`.
2. **Database**: `npm run db:migrate` (the API container does it on start). A fresh database already holds the blocks (A-T men's, A-H/J/S ladies', MH, PRP) and the issue catalogue (migration 018); rooms and shared areas are added by the hostel office under Block settings, or as a sample with `npm run db:provision -- --yes`.
3. **First administrator**: `docker compose --profile setup run --rm provision` (or `npm run db:provision -- --yes --admin-only`). The password is random, written to `credentials/` and must be changed at first sign-in. Create everyone else under Users and access, with "must choose their own password" ticked.
4. **Email** (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` or `SMTP_URL`, `MAIL_FROM`, `APP_URL`; setup below; check with `npm run mail:check -- --to you@example.com`): without it, resident self-registration and "Forgot password" report themselves unavailable instead of pretending to send; the hostel office then creates resident accounts. Set it before opening sign-up.
5. **AI keys** (`GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, several allowed): optional; every AI feature has a non-AI path.
6. **HTTPS** at the proxy (cookies are `Secure`, HSTS is sent), backups copied off the host (`backup` service), `npm audit` clean, `npm test` green.
7. **After the first sign-in**: delete the credentials file, switch the autopilot on per block (Autopilot, Dispatch settings), and check `/api/health`.

## Email setup (Brevo, free)

Brevo's free plan sends 300 emails a day with no monthly cap, which covers sign-up codes and password resets except in the first week of a term.

1. Create an account at brevo.com and confirm your email.
2. **Senders, Domains**: add and verify the address (quickest) or the domain (best: add the SPF and DKIM records it shows to the domain's DNS; the university IT team usually does this). Mail from an unverified sender is refused or lands in spam.
3. **SMTP & API, SMTP**: copy the *SMTP login* (looks like `123abc@smtp-brevo.com`) and generate an *SMTP key*. They are not your account email and password.
4. Put them in `.env` (never in git): `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER=<login>`, `SMTP_PASS=<key>`, `MAIL_FROM="FixMaster <the verified address>"`, and `APP_URL=<the web address>`.
5. `npm run mail:check -- --to you@example.com` connects, signs in and sends one test message, and says in plain words what is wrong if it cannot. Restart the API; the sign-up and "Forgot password" pages come back on by themselves (`GET /api/auth/capabilities` shows `student_signup: true`).
6. Watch Brevo's daily count. Past 300 a day, mail stops until the next day: switch to a paid plan or to Amazon SES, which only needs the same four `SMTP_*` settings changed.

## Accounts

`scripts/provision-accounts.js` (see its header and the README) creates accounts with random 14-character passwords and writes them to a git-ignored file. Passwords are shown only there; the database holds bcrypt hashes. Placeholder email addresses use the reserved domain `fixmaster.example` (override with `--email-domain`). An account flagged `must_change_password` can do nothing but change its password until it has (`403 PASSWORD_CHANGE_REQUIRED`); administrators can set the flag when creating an account or resetting a password.

## Deploying

1. `npm run db:migrate` (versioned, checksummed, safe to repeat).
2. Roll the API instances one at a time; each drains in-flight requests on SIGTERM.
3. Check `/api/health` and the metrics for errors before the next instance.
4. The web app is static; deploy it after the API when a release adds endpoints, before it when it only changes screens.

## Tracing

Every request gets a trace id, returned as the `X-Trace-Id` header, written to
the request log (`trace_id`) and included in error alerts, so an alert leads to
the exact request. A caller's W3C `traceparent` header is honoured: the trace
continues rather than restarting.

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (for example `http://otel-collector:4318`) to
export spans as OTLP/HTTP JSON to any OpenTelemetry-compatible backend (Grafana
Tempo, Jaeger, Honeycomb, Datadog, the OpenTelemetry Collector). Optional:
`OTEL_EXPORTER_OTLP_HEADERS` for an API key, `OTEL_SERVICE_NAME`,
`OTEL_TRACES_SAMPLER_ARG` (share of new traces kept, default 1). Without the
endpoint nothing is exported and nothing is recorded.

A trace holds one server span per request (method, route pattern, status) with
child spans for database work (the operation only, such as SELECT), AI calls
(task, provider, model) and object-storage calls. Spans never carry SQL,
parameters, prompts, model output, request or response bodies, ticket ids or
anyone's name. Export is batched and best effort: a collector that is down costs
only the spans (a warning is logged once a minute) and never slows or fails a
request. A drilled-down view in the monitoring stack is the quickest way to see
why a slow dashboard is slow.
