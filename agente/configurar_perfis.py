"""
Liga cada perfil do Chrome ao botão certo do Cadu (Felipe pessoal / Felipe profissional).
Mostra os perfis deste PC, pergunta qual é qual e grava no config.json.

Uso (PowerShell, na pasta cadu-fisico-main):  python agente\\configurar_perfis.py
"""
import json
from collections import OrderedDict
from pathlib import Path

import chrome

CONFIG = Path(__file__).resolve().parent / "config.json"


def escolher(perfis, pergunta, proibido=None):
    while True:
        r = input(pergunta).strip()
        if r.isdigit() and 1 <= int(r) <= len(perfis) and int(r) - 1 != proibido:
            return int(r) - 1
        print("  Digite um número da lista.")


def main():
    perfis = chrome.listar_perfis()
    if not perfis:
        print("Nenhum perfil do Chrome encontrado neste PC.")
        return
    print("\nPerfis do Chrome encontrados:\n")
    for i, p in enumerate(perfis, 1):
        print("  %d) %-20s %-30s (pasta: %s)" % (i, p["nome"], p["email"] or "sem e-mail", p["dir"]))
    print("\nDica: se os nomes forem iguais, use o e-mail para diferenciar.\n")
    pes = escolher(perfis, "Qual número é o FELIPE PESSOAL (WhatsApp)? ")
    pro = escolher(perfis, "Qual número é o FELIPE PROFISSIONAL (MegaADM)? ", proibido=pes)

    cfg = json.loads(CONFIG.read_text(encoding="utf-8"), object_pairs_hook=OrderedDict)
    conf = cfg.setdefault("chrome", OrderedDict())
    antigos = conf.get("perfis") or {}
    modelo_pes = antigos.get("PERFIL_PESSOAL") or next((v for v in antigos.values() if v.get("nome") == "Felipe pessoal"), {})
    modelo_pro = antigos.get("PERFIL_PROFISSIONAL") or next((v for v in antigos.values() if v.get("nome") == "Felipe profissional"), {})
    novos = OrderedDict()
    novos[perfis[pes]["dir"]] = modelo_pes or {"nome": "Felipe pessoal", "icone": "whatsapp", "links": ["https://web.whatsapp.com"]}
    novos[perfis[pro]["dir"]] = modelo_pro or {"nome": "Felipe profissional", "icone": "briefcase", "links": []}
    # os demais perfis ficam ocultos no Cadu (para não poluir os botões)
    for i, p in enumerate(perfis):
        if i not in (pes, pro):
            novos[p["dir"]] = {"ocultar": True}
    conf["perfis"] = novos
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("\nPronto! Pessoal = %s · Profissional = %s" % (perfis[pes]["dir"], perfis[pro]["dir"]))
    print("O Cadu já mostra os botões novos (abra o menu de novo no celular).")


if __name__ == "__main__":
    main()
