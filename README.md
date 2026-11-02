# Cadu físico

Galaxy J3 (SM-J320M, Android 5.1) transformado em companheiro de mesa: rosto com olhos animados que, ao toque, vira um painel de botões que controla o PC.

## Peças
| Pasta | O que é |
|---|---|
| `android/` | App "casca": tela cheia, liga direto no Cadu (launcher), mostra a interface servida pelo PC. Compilado pelo GitHub Actions. |
| `web/index.html` | Interface (rosto + botões). Mudou aqui → o J3 atualiza sozinho, sem recompilar. |
| `agente/` | Agente Python no PC: serve a interface, executa os botões (`config.json`) e mantém o túnel USB (`adb reverse`). |

## Usar
1. Baixe o `cadu-fisico.apk` da release **ultima** do repositório.
2. `powershell -ExecutionPolicy Bypass -File instalar-apk.ps1 -Apk "<caminho do apk>"`
3. `powershell -ExecutionPolicy Bypass -File iniciar.ps1`
4. Toque no rosto → botões. 20 s sem uso → volta ao rosto.

## Personalizar
Edite `agente/config.json`: `vps_url` (status da VPS) e a lista `botoes`
(tipos: `comando`, `url`, `status_vps`). Reinicie o agente.

## Fases
- [x] Fase 1 — corpo: rosto + painel de botões via USB.
- [ ] Fase 2 — voz: ouvir, pensar (IA via VPS), falar.
- [ ] Fase 3 — câmera e SMS.
