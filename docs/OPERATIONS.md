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

## AI provider keys

`GROQ_API_KEY`, `OPENROUTER_API_KEY` and `GEMINI_API_KEY` each accept one key or several, comma-separated (`GROQ_API_KEY="gsk_a,gsk_b"`), typically one per free account. Keys are used in the order written. When a provider answers 429 (rate limited) or 401/402 (key refused / no credit), the same request - same prompt, model and schema - is sent again with the next key; the spent key rests for the provider's `Retry-After` (one minute if absent; an hour if refused) and then returns to service. Other failures (timeouts, 5xx, invalid output) do not rotate keys; they follow the task's provider chain as before. When every key of a provider is resting, the provider is skipped without a call. Rotation happens inside one logged attempt, so the quota ledger is unaffected; `AI_DAILY_LIMIT_<PROVIDER>` is per key and is multiplied by the number of keys. Resting state is per API process. `npm run ai:keys` sends one tiny request per key and reports which work, are rate limited or are refused (keys shown by position only). `GET /api/ai/health` reports `keys_total` and `keys_available` per provider, never the keys.

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
