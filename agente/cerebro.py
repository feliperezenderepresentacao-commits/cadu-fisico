"""
Cérebro do Cadu (Fase 2) — usa o FreeLLMAPI (github.com/tashfeenahmed/freellmapi),
um roteador que junta APIs de IA gratuitas num endereço só, no padrão OpenAI.

Configuração (config.json → "cerebro"):
  "url":    "http://localhost:3001/v1"   (padrão do FreeLLMAPI no PC)
  "modelo": "auto"                       (o roteador escolhe)
A chave (começa com "freellmapi-") fica FORA do código, num destes lugares:
  - arquivo agente/cerebro_chave.txt   (não vai para o GitHub)
  - variável de ambiente FREELLMAPI_KEY
Sem cérebro, a agenda continua funcionando com o interpretador local (regras).
"""
import json
import os
import re
import urllib.request
from datetime import datetime
from pathlib import Path

PASTA = Path(__file__).resolve().parent
ARQ_CHAVE = PASTA / "cerebro_chave.txt"

SISTEMA = """Você é o Cadu, um bichinho virtual que mora no celular do Felipe e cuida da agenda dele.
O Felipe falou uma frase (transcrita de áudio, pode ter erros). Classifique e responda SÓ com JSON:
{"tipo": "lembrete" | "nota" | "pergunta",
 "texto": "o que anotar, curto, em português, sem a parte da data/hora",
 "quando": "AAAA-MM-DDTHH:MM" ou null,
 "resposta": "frase curta para o Cadu falar em voz alta (máx. 2 frases)"}
Regras: "lembrete" quando houver data/hora ou pedido de lembrar; "nota" para anotação sem hora;
"pergunta" quando ele perguntar algo — aí "resposta" é a resposta direta e útil.
Datas relativas ("amanhã", "sexta", "daqui a 20 minutos") são calculadas a partir de AGORA.
Se disser só a data, use 09:00. Se disser só a hora e ela já passou hoje, use amanhã."""


def _conf(cfg):
    c = dict({"url": "http://localhost:3001/v1", "modelo": "auto", "ativo": True}, **((cfg or {}).get("cerebro") or {}))
    chave = os.environ.get("FREELLMAPI_KEY", "")
    if not chave and ARQ_CHAVE.is_file():
        chave = ARQ_CHAVE.read_text(encoding="utf-8").strip()
    c["chave"] = chave
    return c


def disponivel(cfg):
    c = _conf(cfg)
    return bool(c["ativo"] and c["chave"])


def conversar(cfg, mensagens, max_tokens=300, timeout=25):
    c = _conf(cfg)
    if not (c["ativo"] and c["chave"]):
        raise RuntimeError("cérebro desligado (sem chave do FreeLLMAPI)")
    corpo = json.dumps({"model": c["modelo"], "messages": mensagens, "max_tokens": max_tokens,
                        "temperature": 0.3}).encode("utf-8")
    req = urllib.request.Request(c["url"].rstrip("/") + "/chat/completions", data=corpo, method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + c["chave"]})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        dados = json.loads(r.read().decode("utf-8"))
    return dados["choices"][0]["message"]["content"]


def interpretar(cfg, frase, agora=None):
    """Devolve {"tipo","texto","quando"(datetime|None),"resposta"} ou levanta exceção."""
    agora = agora or datetime.now()
    msg = [{"role": "system", "content": SISTEMA},
           {"role": "user", "content": "AGORA: %s (%s)\nFRASE: %s" % (
               agora.strftime("%Y-%m-%dT%H:%M"), ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"][agora.weekday()], frase)}]
    bruto = conversar(cfg, msg)
    m = re.search(r"\{.*\}", bruto, re.S)
    if not m:
        raise ValueError("resposta sem JSON")
    d = json.loads(m.group(0))
    quando = None
    if d.get("quando"):
        try:
            quando = datetime.strptime(str(d["quando"])[:16], "%Y-%m-%dT%H:%M")
        except ValueError:
            quando = None
    tipo = d.get("tipo") if d.get("tipo") in ("lembrete", "nota", "pergunta") else "nota"
    return {"tipo": tipo, "texto": (d.get("texto") or frase).strip(), "quando": quando,
            "resposta": (d.get("resposta") or "").strip()}
