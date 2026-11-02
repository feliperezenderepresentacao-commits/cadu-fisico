# Desliga o início automático do agente do Cadu e para o agente que estiver rodando.
# Uso: powershell -ExecutionPolicy Bypass -File desativar-inicio-automatico.ps1
$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "Cadu agente.lnk"
if (Test-Path $lnk) { Remove-Item $lnk }
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "cadu_agente\.py" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host "Inicio automatico desativado e agente parado." -ForegroundColor Yellow
