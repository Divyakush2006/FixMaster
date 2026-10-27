# Choosing the AI models

Every AI feature in FixMaster has a non-AI path, so the models only have to be good, fast and cheap enough to be worth using. This page records how the default model chains in [src/config/ai.js](../src/config/ai.js) were chosen, what each model costs against the free allowances, and how to repeat the exercise when the free offers change (they change monthly).

Measured on 27 October 2026 with the project's own keys: 7 Groq, 5 OpenRouter and 5 Gemini keys.

## Method

Public leaderboards were consulted, but they do not measure what this app needs and they disagree with each other (see *Public benchmarks* below). So each candidate was run on the app's **real prompts and output schemas** (`npm run ai:bench`, [scripts/ai-benchmark](../scripts/ai-benchmark)):

| Use case | Cases | What "right" means |
|---|---|---|
| **INTAKE** (student describes a fault) | 37 | Exactly the right issue code(s), `MY_ROOM` / `COMMON_AREA`, and the right common-area code. English, Hinglish, two problems in one message, a name and phone number in the text, two prompt-injection attempts, three messages that are not maintenance problems (must produce no draft) |
| **ASK** (manager asks a question) | 32 | The right report from the 31-report catalogue, and the right block / number of days when the question names them. Questions flagged as injection attempts never reach a model, so they are not part of this set |
| **FEEDBACK_TAGS** (review comments) | 3 batches of 10 | Tag F1 and sentiment against labelled comments, English and Hinglish, one injection attempt |
| **BRIEFING** (daily summary) | 3 scopes | Valid output, every number above 5 and every block name appears in the facts given, open emergencies are mentioned |

Each answer is parsed and validated with the same JSON rules the gateway uses; a model that returns prose, a wrong enum value or an extra field fails. Calls go through the production adapters (key rotation included). Latency is wall-clock from this machine in India, so absolute times include the trip to the provider; compare models, not absolutes. Tokens are what the provider reports, with Gemini's thinking tokens added (they count against the allowance).

Stage 1 screened 16 models on a sample; stage 2 ran the finalists on every case. The raw answers are not committed; the harness writes them to `.bench/`.

## Results

### Groq and Gemini finalists (every case)

| Model | INTAKE perfect | ASK right report | FEEDBACK tag F1 / sentiment | BRIEFING grounded | p50 INTAKE | p50 ASK | Out tokens INTAKE / FEEDBACK |
|---|---|---|---|---|---|---|---|
| groq `qwen/qwen3.8-27b` | 37/37 | 32/32 | **94% / 100%** | 2/3 | **394 ms** | **242 ms** | 88 / 397 |
| groq `openai/gpt-oss-20b` | 37/37 | 32/32 | 89% / 90% | 2/3 | 628 ms | 520 ms | 89 / 520 |
| groq `openai/gpt-oss-120b` | 37/37 | 32/32 | 92% / 100% | 2/3 | 709 ms | 604 ms | 93 / 554 |
| gemini `gemini-3.1-flash-lite` | 37/37 | 32/32 | 92% / 100% | **3/3** | 2.4 s | 3.4 s | 90 / 356 |
| gemini `gemini-flash-lite-latest` | 37/37 | 32/32 | 90% / 67% (1 invalid tag) | 3/3 | 8.4 s | 8.0 s | 77 / 169 |
| gemini `gemini-3.5-flash-lite` | 37/37 | 32/32 | 92% / 100% | 3/3 | 15.1 s | 8.7 s | 76 / 250 |

All six handled every classification case, including the Hinglish, multi-problem and injection messages. The differences that matter are speed, limits, and the briefing: both Groq `gpt-oss` models and `qwen` quoted a derived figure that was not in the facts in 1 of 3 briefings (for example "91% overdue", computed from two given numbers), and `gpt-oss-20b` once left out the `actions` field. Gemini never did.

### OpenRouter (free models; small sample, because the free tier is slow and often busy)

| Model | INTAKE | ASK | BRIEFING | Notes |
|---|---|---|---|---|
| `poolside/laguna-s-2.1:free` | 27/28 (one invented issue code) | 3/3 | 3/3 | p50 3.9 s, p95 7.5 s. Best of the free OpenRouter models tried |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 3/3 | 2/3 | 2/3 | Slow briefings (12 s); one reply wrapped the JSON in itself |
| `nvidia/nemotron-3.5-super-vl:free` | 3/3 | 2/3 | 0/3 | Often returns empty content |
| `nvidia/nemotron-3.5-lightning:free` | 0/3 | 0/3 | 0/3 | Empty content every time |
| `google/gemma-4-31b-it:free`, `gemma-4-26b-a4b-it:free` | n/a | n/a | n/a | Rate-limited upstream (HTTP 429) on nearly every call |
| `thinkingmachines/inkling:free` | n/a | n/a | n/a | HTTP 403: only available to "agentic harnesses" |

OpenRouter's own usage counters stayed at zero throughout, so the refusals are congestion at the upstream hosts of the free models, not our accounts. Its free tier is therefore the last resort in every chain, not a primary.

### Rejected in the screening stage

* `gemini-3.8-flash`: timed out (90 s) on most calls. `gemini-3.5-flash`: JSON cut off mid-way on 5 of 6 ASK calls (its thinking uses the output budget) and a low free allowance. `gemma-4-31b-it` through Gemini: HTTP 500/503 or reasoning text instead of JSON.
* `gemini-2.5-flash` answers 404 ("no longer available to new users") on newer projects.

## Tokens and the free allowances

Input dominates: INTAKE sends about 1,160 tokens (the 25-issue catalogue and the block's 25 common areas), ASK about 890, a FEEDBACK batch about 420 in and 400-550 out, BRIEFING about 520 in and 170 out.

Allowances used for planning (third-party trackers, October 2026; confirm in each console). Groq's `x-ratelimit-*` headers confirmed 1,000 requests/day and 8,000 tokens/minute per model, and that the 7 keys are 7 separate organisations (each reported its own full quota).

| Platform | Limits | Counted per |
|---|---|---|
| Groq | 30 req/min, 1,000 req/day, 8,000 tokens/min, 200,000 tokens/day, **for each model** | organisation (account) |
| Gemini | 10-15 req/min, 500-1,000 req/day, 250,000 tokens/min for the Flash-Lite family | project, reset at midnight Pacific |
| OpenRouter | 20 req/min, 50 req/day on free models (1,000 after a one-off $10 purchase) | account, plus the upstream host's own limits |

What that means in requests per day:

| Use case | Tokens per request | Binding limit on Groq | Per Groq account, per model | All 7 accounts x 3 Groq models | Gemini 3.1 Flash-Lite, per project |
|---|---|---|---|---|---|
| INTAKE | ~1,250 | tokens/day | ~160 | ~3,300 | 500 |
| ASK | ~930 | tokens/day | ~215 | ~4,500 | 500 |
| FEEDBACK batch (10 comments) | ~800-950 | tokens/day | ~205-270 | ~4,300+ | 500 |
| BRIEFING | ~700 | tokens/day | ~260-295 | n/a (written once per scope per day) | 500 |

The practical consequence: **tokens, not requests, are the limit on Groq**, and each Groq model has its own daily pool, so the chains walk Groq's three models before leaving Groq. Gemini's Flash-Lite has no token cap on the free tier, which makes it the best home for the token-heavy daily briefing. Rate limits are applied per model by the key rotator ([src/services/ai/keyPool.js](../src/services/ai/keyPool.js)): a key resting on `qwen` still serves `gpt-oss`.

If the campus outgrows this, the cheapest levers are, in order: add Groq/Gemini accounts to the key lists; shorten the INTAKE prompt (the area list is 300 of its tokens); move to a paid tier (Groq Developer raises limits about tenfold).

## The chosen chains

| Use case | Chain (first that answers wins) | Why |
|---|---|---|
| **INTAKE** | `groq:qwen/qwen3.8-27b` -> `groq:openai/gpt-oss-20b` -> `groq:openai/gpt-oss-120b` -> `gemini:gemini-3.1-flash-lite` -> `openrouter:poolside/laguna-s-2.1:free` | Fastest exact classifier (0.4 s). Student text stays on Groq as long as possible; Gemini and OpenRouter are only fallbacks |
| **ASK** | `groq:qwen/qwen3.8-27b` -> `groq:openai/gpt-oss-120b` -> `gemini:gemini-3.1-flash-lite` -> OpenRouter laguna | A manager is waiting: 0.24 s and exact |
| **FEEDBACK_TAGS** | `groq:qwen/qwen3.8-27b` -> `groq:openai/gpt-oss-120b` -> `gemini:gemini-3.1-flash-lite` | Best tag F1 and perfect sentiment; background job, so speed hardly matters |
| **BRIEFING** | `gemini:gemini-3.1-flash-lite` -> OpenRouter laguna -> `groq:openai/gpt-oss-120b` -> `groq:qwen/qwen3.8-27b` | The only family that stayed inside the facts; the facts contain places and counts, no personal data |

Settings found necessary by the live runs live in `MODEL_TUNING` in [providers.js](../src/services/ai/providers.js): Groq `gpt-oss` models get `reasoning_effort: low` and 256 extra tokens, because their thinking otherwise uses the whole budget and Groq answers HTTP 400.

### A guard instead of trust

Because even good models occasionally quote a number they were not given, the briefing is now checked in code: [`groundingProblem`](../src/services/insights/briefing.js) rejects a reply that quotes a number above 5 or names a block that is not in the facts, or leaves out an open emergency, and the gateway then tries the next model (and finally the fixed-rule briefing). The benchmark's "grounded" score uses the same rule.

## Caveats

* Samples are small (37 and 32 cases; 3 briefings; 3 feedback batches). Differences of one case are noise; the large gaps (latency, limits, failures to return JSON) are not.
* The free offers move: models disappear (`gpt-oss-20b:free` and `gemini-2.5-flash` already did), and limits are only what third parties report. Re-run `npm run ai:bench` and `npm run ai:keys` before changing chains; override per task with `AI_ROUTE_<TASK>` without touching code.
* Google's terms for the unpaid Gemini tier allow prompts to be used to improve its products (verify the current wording before relying on this). That is why student text goes to Groq first and Gemini is a fallback for INTAKE, while the briefing sends only counts and places.
* Latencies were measured from India; hosting the API near the providers (US) will lower all of them.

## Public benchmarks (context only)

Reported scores did not settle the choice: one aggregator puts Qwen3.8-27B ahead of Gemma 4 31B overall (71.97 against 60.23, with overlapping intervals); an agent benchmark gave gpt-oss-120b its lowest score on a structured-output category; another source reports Gemma 4 31B with the cleanest tool-call results in a small GPU test; Nemotron 3 Ultra leads Gemma 4 on intelligence indexes but is slower to answer. None tests short JSON classification against a fixed catalogue, which is what this app asks, hence the local benchmark. Sources: [benchlm.ai](https://benchlm.ai/compare/gemma-4-31b-vs-qwen3-8-27b), [Artificial Analysis](https://artificialanalysis.ai/models/comparisons/nvidia-nemotron-3-ultra-550b-a55b-vs-gemma-4-31b), [kingy.ai](https://kingy.ai/blog/qwen3-8-27b-vs-qwen3-6-27b-vs-gemma-4-31b/), [arXiv 2608.26867](https://arxiv.org/pdf/2608.26867); limits: [Groq summary](https://klymentiev.com/blog/groq-api-free-tier), [OpenRouter summary](https://klymentiev.com/blog/openrouter-free-tier), [Gemini summary](https://klymentiev.com/blog/gemini-api-free-tier).
