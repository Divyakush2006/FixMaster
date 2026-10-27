# Local open-source models (CPU only)

FixMaster can run every AI feature on open-source models on your own
hardware, alongside or instead of the hosted free tiers (Groq, Gemini,
OpenRouter). This folder sets that up so that **no model ever touches a GPU**.

## How CPU-only is enforced

Three independent layers, so one mistake cannot put a model on the GPU:

1. **The runtime cannot see the GPU.** The setup scripts start Ollama with
   `CUDA_VISIBLE_DEVICES=-1` and `HIP_VISIBLE_DEVICES=-1`.
2. **Every request asks for zero GPU layers.** The API's Ollama adapter sends
   `options.num_gpu = 0` on every call (`src/services/ai/providers.js`). Only
   setting `LOCAL_AI_NUM_GPU` deliberately changes that.
3. **Nothing is called unless you opt in.** The `ollama` and `local` providers
   stay disabled until `OLLAMA_BASE_URL` / `LOCAL_AI_BASE_URL` is set.

## Recommended models

Chosen for good JSON output, Indian-English and Hinglish input, and speed on
a laptop CPU (4-bit quantised, as Ollama ships them).

| Task | Route name | Model | Size | Why |
|---|---|---|---|---|
| Student assistant drafts | `INTAKE` | `qwen2.5:3b-instruct` | ~2 GB | Fast enough on CPU (a few seconds), reliable JSON, multilingual |
| Review comment tags | `FEEDBACK_TAGS` | `qwen2.5:1.5b-instruct` | ~1 GB | Short batch classification; runs overnight |
| Daily briefings | `BRIEFING` | `qwen2.5:7b-instruct` | ~4.7 GB | Better writing; runs once a day, so speed does not matter |
| "Ask FixMaster" | `ASK` | `qwen2.5:7b-instruct` | ~4.7 GB | Picks a report and fills parameters; tool-style JSON |

Alternatives that fit the same slots: `llama3.2:3b` (intake), `phi3.5` (tags),
`llama3.1:8b` (briefings). Pick by running the evaluation suite, not by name.

## Set up (when you are ready)

Windows (PowerShell):

```powershell
./scripts/local-ai/setup-ollama.ps1          # starts Ollama CPU-only and pulls the models above
```

Linux / macOS:

```bash
./scripts/local-ai/setup-ollama.sh
```

Then add to `.env` (local first, hosted as fallback, or the other way round):

```ini
OLLAMA_BASE_URL=http://127.0.0.1:11434
LOCAL_AI_NUM_GPU=0
LOCAL_AI_TIMEOUT_MS=45000
AI_ROUTE_INTAKE="ollama:qwen2.5:3b-instruct,groq:openai/gpt-oss-20b,gemini:gemini-flash-lite-latest"
AI_ROUTE_FEEDBACK_TAGS="ollama:qwen2.5:1.5b-instruct,gemini:gemini-flash-lite-latest"
AI_ROUTE_BRIEFING="ollama:qwen2.5:7b-instruct,gemini:gemini-flash-lite-latest"
AI_ROUTE_ASK="ollama:qwen2.5:7b-instruct,groq:openai/gpt-oss-120b"
```

Other OpenAI-compatible servers (llama.cpp `llama-server`, vLLM, LM Studio)
use the `local` provider. Start them CPU-only yourself, e.g.
`llama-server -m model.gguf -ngl 0 --port 8080`, then set
`LOCAL_AI_BASE_URL=http://127.0.0.1:8080/v1` and use `local:<model>` in a route.

## Check it

`GET /api/ai/health` (as a supervisor or administrator) lists each provider,
whether it is configured, its circuit breaker, and today's calls. The admin
"AI health" panel shows the same.
