# Fase 2 — liga o "cérebro" do Cadu (FreeLLMAPI: junta APIs de IA gratuitas num endereço só).
# Antes: instale o FreeLLMAPI (app de Windows em github.com/tashfeenahmed/freellmapi/releases),
#        abra o painel (http://localhost:3001), cadastre 1+ chaves gratuitas em "Keys"
#        e copie a chave unificada (começa com "freellmapi-").
# Uso: powershell -ExecutionPolicy Bypass -File configurar-cerebro.ps1
$arq = Join-Path $PSScriptRoot "agente\cerebro_chave.txt"
$chave = Read-Host "Cole a chave do FreeLLMAPI (freellmapi-...)"
if (-not $chave.StartsWith("freellmapi-")) { Write-Host "Essa chave nao parece do FreeLLMAPI." -ForegroundColor Yellow }
Set-Content -Path $arq -Value $chave.Trim() -Encoding UTF8 -NoNewline
try {
    $r = Invoke-RestMethod -Uri "http://localhost:3001/v1/chat/completions" -Method Post -ContentType "application/json" `
        -Headers @{ Authorization = "Bearer $($chave.Trim())" } `
        -Body '{"model":"auto","messages":[{"role":"user","content":"Responda so: ok"}],"max_tokens":5}'
    Write-Host "Cerebro respondeu: $($r.choices[0].message.content)" -ForegroundColor Green
} catch {
    Write-Host "Chave salva, mas o FreeLLMAPI nao respondeu em localhost:3001 (ele esta aberto?)." -ForegroundColor Yellow
}
Write-Host "Chave salva fora do GitHub em $arq"
