# Starts Ollama with no GPU visible and pulls FixMaster's recommended models.
# Safe to run while the GPU is busy: the server cannot see the GPU, and the
# API asks for zero GPU layers on every request as well (see README.md).
#
#   ./scripts/local-ai/setup-ollama.ps1                 # default model set
#   ./scripts/local-ai/setup-ollama.ps1 -Models qwen2.5:3b-instruct

param(
    [string[]]$Models = @('qwen2.5:3b-instruct', 'qwen2.5:1.5b-instruct', 'qwen2.5:7b-instruct'),
    [string]$Address = '127.0.0.1:11434'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Error 'Ollama is not installed. Get it from https://ollama.com/download, then run this again.'
}

# Hide every GPU from the Ollama server process and its children.
$env:CUDA_VISIBLE_DEVICES = '-1'
$env:HIP_VISIBLE_DEVICES = '-1'
$env:OLLAMA_HOST = $Address

$running = $false
try { Invoke-RestMethod "http://$Address/api/version" -TimeoutSec 2 | Out-Null; $running = $true } catch { }
if ($running) {
    Write-Warning "An Ollama server is already running on $Address. It was not started by this script, so it may see the GPU. Stop it (tray icon > Quit) and run this again to be sure it is CPU-only."
} else {
    Write-Host "Starting Ollama on $Address with no GPU visible..."
    Start-Process -FilePath (Get-Command ollama).Source -ArgumentList 'serve' -WindowStyle Hidden
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        try { Invoke-RestMethod "http://$Address/api/version" -TimeoutSec 2 | Out-Null; $running = $true; break } catch { }
    }
    if (-not $running) { Write-Error 'Ollama did not start.' }
}

foreach ($m in $Models) {
    Write-Host "Pulling $m ..."
    ollama pull $m
}

Write-Host ''
Write-Host 'Done. Add to .env:'
Write-Host "  OLLAMA_BASE_URL=http://$Address"
Write-Host '  LOCAL_AI_NUM_GPU=0'
Write-Host 'and put ollama:<model> into the AI_ROUTE_* chains (see scripts/local-ai/README.md).'
