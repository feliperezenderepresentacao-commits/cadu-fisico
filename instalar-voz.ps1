# Fase 2 — instala o "ouvido" do Cadu no PC (reconhecimento de voz 100% offline).
#   - vosk           : fica ouvindo a palavra "Cadu" (leve)
#   - faster-whisper : transcreve a frase em português (bom e gratuito)
# Uso: powershell -ExecutionPolicy Bypass -File instalar-voz.ps1
$ErrorActionPreference = "Stop"
$agente = Join-Path $PSScriptRoot "agente"
$py = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $py) { Write-Host "Nao achei o Python no PATH." -ForegroundColor Red; exit 1 }

Write-Host "1/3 Instalando programas de voz (pip)..." -ForegroundColor Cyan
& $py.Source -m pip install --upgrade vosk faster-whisper numpy
if ($LASTEXITCODE -ne 0) { Write-Host "pip falhou." -ForegroundColor Red; exit 1 }

Write-Host "2/3 Baixando o modelo do Vosk em portugues (~31 MB)..." -ForegroundColor Cyan
$modelos = Join-Path $agente "modelos"
$destino = Join-Path $modelos "vosk-pt"
if (-not (Test-Path $destino)) {
    New-Item -ItemType Directory -Force $modelos | Out-Null
    $zip = Join-Path $env:TEMP "vosk-pt.zip"
    Invoke-WebRequest "https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip" -OutFile $zip
    Expand-Archive $zip $modelos -Force
    Rename-Item (Join-Path $modelos "vosk-model-small-pt-0.3") "vosk-pt"
}
Write-Host "   modelo em $destino" -ForegroundColor Green

Write-Host "3/3 Baixando o Whisper 'small' (~0,5 GB, so na primeira vez)..." -ForegroundColor Cyan
& $py.Source -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8'); print('whisper ok')"

Write-Host ""
Write-Host "Pronto! Agora rode o ativar-inicio-automatico.ps1 para reiniciar o agente." -ForegroundColor Green
