# Instala (ou atualiza) o app Cadu no J3 conectado no USB.
# Uso: powershell -ExecutionPolicy Bypass -File instalar-apk.ps1 -Apk "C:\caminho\cadu-fisico.apk"
param([Parameter(Mandatory = $true)][string]$Apk)

$adb = "$env:USERPROFILE\platform-tools\adb.exe"
if (-not (Test-Path $adb)) { $adb = "adb" }

& $adb wait-for-device
& $adb install -r $Apk
& $adb shell am start -n br.cadu.fisico/.MainActivity
Write-Host "Pronto. Na primeira vez que apertar o botao Home do J3, escolha 'Cadu' e 'Sempre'." -ForegroundColor Green
