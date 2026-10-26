#!/usr/bin/env sh
# Starts Ollama with no GPU visible and pulls FixMaster's recommended models.
# The API also asks for zero GPU layers on every request (see README.md).
#
#   ./scripts/local-ai/setup-ollama.sh                       # default model set
#   MODELS="qwen2.5:3b-instruct" ./scripts/local-ai/setup-ollama.sh
set -eu

MODELS="${MODELS:-qwen2.5:3b-instruct qwen2.5:1.5b-instruct qwen2.5:7b-instruct}"
ADDRESS="${OLLAMA_HOST:-127.0.0.1:11434}"

command -v ollama >/dev/null 2>&1 || { echo "Ollama is not installed: https://ollama.com/download" >&2; exit 1; }

export CUDA_VISIBLE_DEVICES=-1
export HIP_VISIBLE_DEVICES=-1
export OLLAMA_HOST="$ADDRESS"

if curl -fsS "http://$ADDRESS/api/version" >/dev/null 2>&1; then
    echo "An Ollama server is already running on $ADDRESS and may see the GPU." >&2
    echo "Stop it (e.g. systemctl stop ollama) and run this again to be sure it is CPU-only." >&2
else
    echo "Starting Ollama on $ADDRESS with no GPU visible..."
    nohup ollama serve >/tmp/ollama-cpu.log 2>&1 &
    i=0
    until curl -fsS "http://$ADDRESS/api/version" >/dev/null 2>&1; do
        i=$((i + 1)); [ "$i" -gt 30 ] && { echo "Ollama did not start; see /tmp/ollama-cpu.log" >&2; exit 1; }
        sleep 1
    done
fi

for m in $MODELS; do
    echo "Pulling $m ..."
    ollama pull "$m"
done

echo
echo "Done. Add to .env:"
echo "  OLLAMA_BASE_URL=http://$ADDRESS"
echo "  LOCAL_AI_NUM_GPU=0"
echo "and put ollama:<model> into the AI_ROUTE_* chains (see scripts/local-ai/README.md)."
