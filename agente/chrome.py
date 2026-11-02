"""
Perfis do Google Chrome do PC → botões no Cadu.

Lê os perfis que já existem no Chrome (arquivo "Local State") e abre o Chrome
no perfil escolhido, opcionalmente já com links (config.json → "chrome" → "links").
"""
import json
import os
import subprocess
import unicodedata
from pathlib import Path


def _pasta_dados():
    return Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "User Data"


def achar_chrome():
    cands = [
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
    ]
    for c in cands:
        if c.is_file():
            return str(c)
    return None


def _sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower()


def listar_perfis():
    """[{dir, nome, email}] na ordem em que o Chrome mostra."""
    arq = _pasta_dados() / "Local State"
    if not arq.is_file():
        return []
    try:
        dados = json.loads(arq.read_text(encoding="utf-8"))
        cache = dados.get("profile", {}).get("info_cache", {}) or {}
        ordem = dados.get("profile", {}).get("profiles_order") or list(cache.keys())
    except Exception:
        return []
    perfis = []
    for d in ordem:
        info = cache.get(d)
        if not info:
            continue
        perfis.append({"dir": d, "nome": info.get("name") or d, "email": info.get("user_name") or ""})
    return perfis


def icone_para(nome):
    n = _sem_acento(nome)
    if "whats" in n or "zap" in n:
        return "whatsapp"
    if any(p in n for p in ("trab", "mega", "vps", "work", "empresa", "prefeitura", "sistema")):
        return "briefcase"
    if any(p in n for p in ("pessoal", "casa", "eu")):
        return "user"
    return "google-chrome"


def _ajuste(p, conf):
    """Personalização do perfil no config: chave = pasta ("Profile 1"), e-mail ou nome do perfil."""
    perfis = conf.get("perfis") or {}
    for chave in (p["dir"], p["email"], p["nome"]):
        if chave and chave in perfis:
            return perfis[chave]
    return {}


def _conf_por_nome(mapa, nome):
    """Busca no dicionário do config pelo nome do perfil, sem diferenciar acento/maiúscula."""
    alvo = _sem_acento(nome)
    for k, v in (mapa or {}).items():
        if _sem_acento(k) == alvo:
            return v
    return None


def botoes(cfg):
    """Botões dinâmicos, um por perfil do Chrome.
    config.json → "chrome":
      "somente": ["Felipe", ...]   mostra só esses perfis, nessa ordem (vazio = todos)
      "rotulos": {"Felipe": "Trabalho"}   nome que aparece no botão
      "icones":  {"Felipe": "briefcase"}  ícone (pixelarticons)
      "links":   {"Felipe": ["https://..."]}  sites que abrem junto
    """
    conf = cfg.get("chrome") or {}
    if conf.get("ativo") is False or not achar_chrome():
        return []
    perfis = listar_perfis()
    somente = conf.get("somente") or []
    if somente:
        ordem = [_sem_acento(x) for x in somente]
        perfis = sorted([p for p in perfis if _sem_acento(p["nome"]) in ordem], key=lambda p: ordem.index(_sem_acento(p["nome"])))
    ocultar = {_sem_acento(x) for x in conf.get("ocultar", [])}
    saida = []
    for p in perfis:
        if _sem_acento(p["nome"]) in ocultar:
            continue
        rotulo = _conf_por_nome(conf.get("rotulos"), p["nome"]) or p["nome"]
        saida.append({"id": "chrome:" + p["dir"], "rotulo": rotulo,
                      "icone": _conf_por_nome(conf.get("icones"), p["nome"]) or icone_para(rotulo),
                      "cor": "#4285f4", "tipo": "chrome"})
    return saida


def abrir(dir_perfil, cfg):
    perfis = {p["dir"]: p for p in listar_perfis()}
    if dir_perfil not in perfis:  # só abre perfis que existem de verdade
        return False, "Perfil do Chrome não encontrado."
    exe = achar_chrome()
    if not exe:
        return False, "Chrome não encontrado neste PC."
    conf = cfg.get("chrome") or {}
    aj = _ajuste(perfis[dir_perfil], conf)
    nome = aj.get("nome") or perfis[dir_perfil]["nome"]
    links = conf.get("links") or {}
    urls = aj.get("links") or links.get(perfis[dir_perfil]["nome"]) or links.get(dir_perfil) or []
    urls = [u for u in urls if isinstance(u, str) and u.startswith(("http://", "https://"))]
    subprocess.Popen([exe, "--profile-directory=" + dir_perfil] + urls)
    rotulo = _conf_por_nome(conf.get("rotulos"), nome) or nome
    return True, "Chrome · %s aberto." % rotulo


if __name__ == "__main__":
    # Lista os perfis do Chrome deste PC:  python chrome.py
    for p in listar_perfis():
        print("%-12s | %-25s | %s" % (p["dir"], p["nome"], p["email"]))
