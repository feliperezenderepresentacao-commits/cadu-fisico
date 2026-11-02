# Diagnóstico do Wi-Fi do Cadu (o celular não tem navegador: o teste é feito pelo cabo, via adb).
# Uso: celular NO CABO, depois:  powershell -ExecutionPolicy Bypass -File diagnostico-rede.ps1
# Gera diagnostico.txt nesta pasta (mande o conteúdo para o Claude).
$saida = Join-Path $PSScriptRoot "diagnostico.txt"
$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $adb) { $adb = Join-Path $env:USERPROFILE "platform-tools\adb.exe" }
function T($titulo) { "`n===== $titulo =====" }
& {
    T "PC: redes e IPs"
    Get-NetConnectionProfile | ForEach-Object {
        $ip = (Get-NetIPAddress -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
        "{0} | IP {1} | tipo {2} | placa {3}" -f $_.Name, $ip, $_.NetworkCategory, $_.InterfaceAlias
    }
    T "PC: Cadu ouvindo?"
    Get-NetTCPConnection -LocalPort 8765, 8767 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "{0}:{1} processo {2}" -f $_.LocalAddress, $_.LocalPort, $_.OwningProcess }
    T "PC: firewall (regras do Cadu e bloqueios do Python)"
    Get-NetFirewallRule -DisplayName "Cadu*" -ErrorAction SilentlyContinue | ForEach-Object { "{0} | {1} | perfil {2} | ativa {3}" -f $_.DisplayName, $_.Action, $_.Profile, $_.Enabled }
    Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -match "python" } |
        Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq "Inbound" } |
        ForEach-Object { "python: {0} | {1} | perfil {2}" -f $_.DisplayName, $_.Action, $_.Profile }
    T "Celular: conectado no cabo?"
    & $adb devices
    T "Celular: versão do app"
    & $adb shell "dumpsys package br.cadu.fisico.voz | grep versionName"
    T "Celular: Wi-Fi"
    & $adb shell "ip -f inet addr show wlan0"
    & $adb shell "dumpsys wifi | grep -m 3 -E 'mWifiInfo|SSID:'"
    $pcIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.*" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
    T "Celular -> PC ($pcIp) pelo Wi-Fi (ping)"
    & $adb shell "ping -c 3 -W 2 $pcIp"
    T "Celular: últimas tentativas do app (inclusive com o cabo fora)"
    & $adb logcat -d -s cadu:* | Select-Object -Last 60
    T "Cadu no PC: log"
    Get-Content (Join-Path $PSScriptRoot "agente\cadu.log") -Tail 40 -ErrorAction SilentlyContinue
} *>&1 | Out-File -FilePath $saida -Encoding utf8
Get-Content $saida
Write-Host "`nSalvo em $saida" -ForegroundColor Green
