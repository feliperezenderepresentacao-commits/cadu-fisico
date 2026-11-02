# Faz o agente do Cadu ligar sozinho, escondido, junto com o Windows.
# Ele fica esperando: assim que o J3 é conectado no cabo, o Cadu acorda em ~3 s.
# Uso: powershell -ExecutionPolicy Bypass -File ativar-inicio-automatico.ps1
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "agente\cadu_agente.py"

# pythonw = Python sem janela
$pyw = Get-Command pythonw -ErrorAction SilentlyContinue
if (-not $pyw) { $pyw = Get-Command pyw -ErrorAction SilentlyContinue }
if (-not $pyw) {
    $py = Get-Command python -ErrorAction SilentlyContinue
    if ($py) { $cand = Join-Path (Split-Path $py.Source) "pythonw.exe"; if (Test-Path $cand) { $pyw = Get-Item $cand } }
}
if (-not $pyw) { Write-Host "Nao achei o pythonw. Instale o Python (python.org) marcando 'Add to PATH'." -ForegroundColor Red; exit 1 }
$pywPath = if ($pyw.Source) { $pyw.Source } else { $pyw.FullName }

# Atalho na pasta Inicializar do Windows
$startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $startup "Cadu agente.lnk"
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = $pywPath
$s.Arguments = "`"$script`""
$s.WorkingDirectory = Split-Path $script
$s.Description = "Agente do Cadu fisico (J3)"
$s.Save()

# Libera a porta 8765 no firewall do Windows (modo Wi-Fi). Pede permissao de administrador (clique em "Sim").
$regra = "Remove-NetFirewallRule -DisplayName 'Cadu agente' -ErrorAction SilentlyContinue; " +
         "New-NetFirewallRule -DisplayName 'Cadu agente' -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow -Profile Any | Out-Null"
try {
    Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -Command `"$regra`""
    Write-Host "Firewall liberado para o modo Wi-Fi." -ForegroundColor Green
} catch {
    Write-Host "Firewall nao foi liberado (permissao negada). O cabo funciona; o Wi-Fi pode nao funcionar." -ForegroundColor Yellow
}

# Para qualquer agente que esteja rodando e liga a versao escondida agora
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "cadu_agente\.py" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep 1
Start-Process -FilePath $pywPath -ArgumentList "`"$script`"" -WorkingDirectory (Split-Path $script)

Write-Host "Pronto! O agente do Cadu agora liga sozinho com o Windows." -ForegroundColor Green
Write-Host "Conecte o J3 no cabo e ele acorda em poucos segundos."
Write-Host "Registro de funcionamento: $(Split-Path $script)\cadu.log"
