# Instala (ou atualiza) o app Cadu no J3 conectado no USB.
# Uso: powershell -ExecutionPolicy Bypass -File instalar-apk.ps1 -Apk "C:\caminho\cadu-fisico.apk"
param([Parameter(Mandatory = $true)][string]$Apk)

$adb = "$env:USERPROFILE\platform-tools\adb.exe"
if (-not (Test-Path $adb)) { $adb = "adb" }
if (-not (Test-Path $Apk)) { Write-Host "APK nao encontrado: $Apk" -ForegroundColor Red; exit 1 }

Write-Host "Instalando $((Get-Item $Apk).Name) ($((Get-Item $Apk).Length) bytes)..."
& $adb wait-for-device
$saida = (& $adb install -r $Apk 2>&1 | Out-String)
Write-Host $saida

if ($saida -notmatch "Success") {
    # Versao antiga com outra assinatura: remove e instala limpo (o pareamento refaz sozinho no cabo).
    Write-Host "Atualizacao recusada pelo Android. Removendo a versao antiga e instalando de novo..." -ForegroundColor Yellow
    & $adb uninstall br.cadu.fisico.voz | Out-Null
    $saida = (& $adb install $Apk 2>&1 | Out-String)
    Write-Host $saida
    if ($saida -notmatch "Success") { Write-Host "FALHOU a instalacao. Mande esta tela para o Cadu." -ForegroundColor Red; exit 1 }
}

& $adb shell am start -n br.cadu.fisico/.MainActivity | Out-Null
$ver = (& $adb shell dumpsys package br.cadu.fisico | Select-String "versionName" | Select-Object -First 1).ToString().Trim()
Write-Host "Instalado: $ver" -ForegroundColor Green
Write-Host "Na primeira vez que apertar o botao Home do J3, escolha 'Cadu' e 'Sempre'." -ForegroundColor Green
