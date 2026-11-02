# Conserta o Wi-Fi do Cadu em QUALQUER rede (casa, trabalho, hotspot).
# O que faz (precisa de administrador; ele pede sozinho):
#   1. mostra a rede atual, o IP do PC e se a rede está como Pública ou Privada;
#   2. apaga regras do Firewall que BLOQUEIAM o Python (o Windows cria quando alguém clica "Cancelar" no aviso);
#   3. libera o Cadu (portas 8765/8767 e o próprio Python) em todos os tipos de rede.
# Uso: powershell -ExecutionPolicy Bypass -File consertar-rede.ps1

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$PSCommandPath`""
    exit
}

Write-Host "`n=== Rede atual ===" -ForegroundColor Cyan
Get-NetConnectionProfile | ForEach-Object {
    $ip = (Get-NetIPAddress -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
    Write-Host ("{0}  |  IP do PC: {1}  |  tipo: {2}" -f $_.Name, $ip, $_.NetworkCategory)
}

Write-Host "`n=== Regras que bloqueiam o Python ===" -ForegroundColor Cyan
$bloqueios = Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -match "python" } |
    Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq "Inbound" -and $_.Action -eq "Block" }
if ($bloqueios) {
    $bloqueios | ForEach-Object { Write-Host ("apagando: {0}" -f $_.DisplayName) -ForegroundColor Yellow; Remove-NetFirewallRule -Name $_.Name }
} else {
    Write-Host "nenhuma (ok)"
}

Write-Host "`n=== Liberando o Cadu em todas as redes ===" -ForegroundColor Cyan
Remove-NetFirewallRule -DisplayName "Cadu agente" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "Cadu python" -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "Cadu agente" -Direction Inbound -Protocol TCP -LocalPort 8765,8767 -Action Allow -Profile Any | Out-Null
$progs = @()
foreach ($nome in "python", "pythonw", "py", "pyw") {
    $c = Get-Command $nome -ErrorAction SilentlyContinue
    if ($c) {
        $progs += $c.Source
        $w = Join-Path (Split-Path $c.Source) "pythonw.exe"
        if (Test-Path $w) { $progs += $w }
    }
}
foreach ($p in ($progs | Sort-Object -Unique)) {
    New-NetFirewallRule -DisplayName "Cadu python" -Direction Inbound -Program $p -Action Allow -Profile Any | Out-Null
    Write-Host "liberado: $p"
}
Write-Host "portas 8765 e 8767 liberadas (Pública e Privada)" -ForegroundColor Green

Write-Host "`n=== Cadu rodando? ===" -ForegroundColor Cyan
$escuta = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
if ($escuta) { Write-Host ("sim, ouvindo em {0}:8765" -f $escuta[0].LocalAddress) -ForegroundColor Green }
else { Write-Host "NÃO — inicie o Cadu (pythonw agente\cadu_agente.py)" -ForegroundColor Red }

Write-Host "`nPronto. No celular (sem cabo), abra no navegador:  http://IP-DO-PC:8765/api/ping" -ForegroundColor Cyan
Write-Host "Se aparecer {""ok"": true, ""cadu"": 1}, o Wi-Fi está liberado. Se não abrir, o roteador isola os aparelhos."
