# Liga o agente do Cadu no PC. O J3 precisa estar no cabo USB com o app Cadu instalado.
# Uso: clique com o botão direito > "Executar com o PowerShell"  (ou: powershell -ExecutionPolicy Bypass -File iniciar.ps1)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
if (-not $py) { Write-Host "Python nao encontrado. Instale em https://www.python.org/downloads/ (marque 'Add to PATH')." -ForegroundColor Red; pause; exit 1 }

Write-Host "Iniciando o Cadu..." -ForegroundColor Cyan
& $py.Source "agente\cadu_agente.py"
