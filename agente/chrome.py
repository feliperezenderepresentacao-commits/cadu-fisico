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


def botoes(cfg):
    """Botões dinâmicos, um por perfil do Chrome."""
    conf = cfg.get("chrome") or {}
    if conf.get("ativo") is False or not achar_chrome():
        return []
    ocultar = {_sem_acento(x) for x in conf.get("ocultar", [])}
    saida = []
    for p in listar_perfis():
        if _sem_acento(p["nome"]) in ocultar:
            continue
        saida.append({"id": "chrome:" + p["dir"], "rotulo": p["nome"], "icone": icone_para(p["nome"]),
                      "cor": "#4285f4", "tipo": "chrome"})
    return saida


def abrir(dir_perfil, cfg):
    perfis = {p["dir"]: p for p in listar_perfis()}
    if dir_perfil not in perfis:  # só abre perfis que existem de verdade
        return False, "Perfil do Chrome não encontrado."
    exe = achar_chrome()
    if not exe:
        return False, "Chrome não encontrado neste PC."
    nome = perfis[dir_perfil]["nome"]
    links = ((cfg.get("chrome") or {}).get("links") or {})
    urls = links.get(nome) or links.get(dir_perfil) or []
    urls = [u for u in urls if isinstance(u, str) and u.startswith(("http://", "https://"))]
    subprocess.Popen([exe, "--profile-directory=" + dir_perfil] + urls)
    return True, "Chrome · %s aberto." % nome
