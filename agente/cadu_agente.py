"""
Agente do Cadu físico (roda no PC Windows).

- Serve a interface (../web/index.html) para o J3.
- Executa as ações dos botões definidas em config.json.
- Notícias por categoria com avisos (módulo noticias.py).
- Conexão por CABO (adb reverse) ou por WI-FI (mesma rede de casa).

Segurança:
- Pelo cabo, o J3 chega como 127.0.0.1 (o próprio PC).
- Pelo Wi-Fi, toda requisição precisa do token secreto. O token só é entregue
  pelo cabo (/api/token), então o J3 precisa ser pareado uma vez no cabo.
- Os comandos dos botões vêm só do config.json, nunca do celular.

Uso:  python cadu_agente.py
"""
import json
import re
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import chrome
from noticias import Noticias
from pet import Pet
import cerebro
from agenda import Agenda
from voz import Ouvido
import clima
from conversa import Conversa

PASTA = Path(__file__).resolve().parent
WEB = PASTA.parent / "web"
CONFIG = PASTA / "config.json"
ARQ_TOKEN = PASTA / "token.txt"
ARQ_PREFS = PASTA / "prefs.json"
ARQ_JOGO = PASTA / "jogo.json"
PREFS_PADRAO = {"tela": "mundo3d", "tour": True, "som": True, "estilo": "bolinha"}


def ler_prefs():
    try:
        return dict(PREFS_PADRAO, **json.loads(ARQ_PREFS.read_text(encoding="utf-8")))
    except Exception:
        return dict(PREFS_PADRAO)
PORTA_BEACON = 8766
TIPOS = {".js": "application/javascript", ".css": "text/css", ".woff": "font/woff", ".woff2": "font/woff2",
         ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain; charset=utf-8",
         ".html": "text/html; charset=utf-8", ".css": "text/css", ".mp3": "audio/mpeg", ".ttf": "font/ttf", ".gif": "image/gif", ".jpg": "image/jpeg"}
PAGINAS = {"/": "index.html", "/index.html": "index.html", "/teste3d.html": "teste3d.html"}


def achar_apk():
    """APK mais novo disponível no PC (pasta apk/ do projeto ou Downloads)."""
    cands = list((PASTA.parent / "apk").glob("*.apk"))
    dl = Path(os.environ.get("USERPROFILE", "")) / "Downloads"
    if dl.is_dir():
        cands += list(dl.glob("cadu-fisico*.apk"))
    cands = [c for c in cands if c.is_file()]
    return max(cands, key=lambda c: c.stat().st_mtime) if cands else None


def todos_botoes(cfg):
    """Perfis do Chrome primeiro, depois os botões do config.json."""
    return chrome.botoes(cfg) + list(cfg["botoes"])


def carregar_config():
    with open(CONFIG, encoding="utf-8-sig") as f:   # aceita config salvo pelo Bloco de Notas (com BOM)
        return json.load(f)


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- token (Wi-Fi)
def obter_token():
    if ARQ_TOKEN.exists():
        t = ARQ_TOKEN.read_text(encoding="utf-8").strip()
        if len(t) >= 20:
            return t
    t = secrets.token_urlsafe(24)
    ARQ_TOKEN.write_text(t, encoding="utf-8")
    return t


TOKEN = None  # definido no main()
VISTOS = {}   # IP -> última vez que o celular chegou pelo Wi-Fi (para o log)


def ips_locais():
    ips = []
    try:  # descobre o IP da placa de rede usada para sair (não envia nada)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    return ips


def anunciar_na_rede(porta):
    """Grita na rede de casa a cada 3 s: 'o Cadu está aqui'. O J3 escuta e acha o PC."""
    msg = ("CADU|%d" % porta).encode()
    while True:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            # 255.255.255.255 no Windows sai só pela placa "principal"; manda também para a sub-rede de
            # cada placa (x.y.z.255), para achar o celular mesmo em outra rede ou com VPN/placas virtuais
            alvos = ["255.255.255.255"] + [ip.rsplit(".", 1)[0] + ".255" for ip in ips_locais() if ip.count(".") == 3]
            for alvo in dict.fromkeys(alvos):
                try:
                    s.sendto(msg, (alvo, PORTA_BEACON))
                except Exception:
                    pass
            s.close()
        except Exception:
            pass
        time.sleep(3)


# ---------------------------------------------------------------- adb reverse (cabo)
def achar_adb():
    candidatos = [
        shutil.which("adb"),
        os.path.join(os.environ.get("USERPROFILE", ""), "platform-tools", "adb.exe"),
    ]
    for c in candidatos:
        if c and os.path.isfile(c):
            return c
    return None


def manter_tunel_usb(porta):
    """A cada 3 s garante 'adb reverse' (pelo cabo, o J3 acessa 127.0.0.1:porta = este PC).
    É isso que faz o Cadu "acordar" sozinho quando o cabo é conectado."""
    adb = achar_adb()
    if not adb:
        log("[aviso] adb não encontrado — modo cabo indisponível (Wi-Fi segue funcionando).")
        return
    ultimo = None
    while True:
        try:
            r = subprocess.run([adb, "reverse", "tcp:%d" % porta, "tcp:%d" % porta],
                               capture_output=True, text=True, timeout=10,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if r.returncode == 0:  # Fase 2: o ouvido (microfone) usa a porta 8767
                subprocess.run([adb, "reverse", "tcp:8767", "tcp:8767"], capture_output=True, timeout=10,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            estado = "conectado no cabo" if r.returncode == 0 else "fora do cabo"
        except Exception:
            estado = "fora do cabo"
        if estado != ultimo:
            log("[usb] %s J3 %s" % (time.strftime("%H:%M:%S"), estado))
            ultimo = estado
        time.sleep(3)


# ---------------------------------------------------------------- status VPS
_cache_vps = {"t": 0, "dados": None}


def checar_vps(url):
    if not url:
        return None
    agora = time.time()
    if agora - _cache_vps["t"] < 25:
        return _cache_vps["dados"]
    inicio = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "cadu-fisico"})
        with urllib.request.urlopen(req, timeout=6) as r:
            ok = r.status < 500
    except urllib.error.HTTPError as e:
        ok = e.code < 500
    except Exception:
        ok = False
    dados = {"ok": ok, "ms": int((time.time() - inicio) * 1000)}
    _cache_vps.update(t=agora, dados=dados)
    return dados


def hora_de_dormir(cfg):
    d = cfg.get("dormir") or {}
    if not d.get("ativo"):
        return False
    h = time.localtime().tm_hour
    de, ate = d.get("de", 0), d.get("ate", 6)
    return de <= h < ate if de <= ate else (h >= de or h < ate)


# ---------------------------------------------------------------- ações dos botões
_apps = {}


def _achar_atalho(nome):
    """Procura o atalho do app no Menu Iniciar (é assim que o Windows abre apps instalados)."""
    alvo = nome.lower()
    pastas = [Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs",
              Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "Microsoft/Windows/Start Menu/Programs",
              Path(os.environ.get("USERPROFILE", "")) / "Desktop", Path(os.environ.get("PUBLIC", r"C:\Users\Public")) / "Desktop"]
    for pasta in pastas:
        if not pasta.is_dir():
            continue
        for lnk in pasta.rglob("*.lnk"):
            if lnk.stem.lower() == alvo:
                return str(lnk)
    return None


def _protocolo_registrado(proto):
    try:
        import winreg
        winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, proto))
        return True
    except Exception:
        return False


def abrir_app(nome, url_reserva, rotulo):
    """Abre um app instalado (ex.: "Claude"), sem depender do PowerShell (bloqueado neste PC quando o agente
    roda escondido). Ordem: atalho do Menu Iniciar → pastas conhecidas → protocolo (claude://) → Get-StartApps → site."""
    if not hasattr(os, "startfile"):
        return False, "Só funciona no Windows."
    if nome not in _apps:
        achado = _achar_atalho(nome)
        if not achado:
            base = os.environ.get("LOCALAPPDATA", "")
            for c in [os.path.join(base, "AnthropicClaude", "claude.exe"), os.path.join(base, "Programs", "Claude", "Claude.exe"),
                      os.path.join(base, "Claude", "Claude.exe"), os.path.join(base, "Programs", nome, nome + ".exe")]:
                if os.path.isfile(c):
                    achado = c
                    break
        if not achado and _protocolo_registrado(nome.lower()):
            achado = nome.lower() + "://"
        if not achado:
            try:
                cmd = "(Get-StartApps | Where-Object { $_.Name -eq '%s' } | Select-Object -First 1).AppID" % nome.replace("'", "")
                r = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=20,
                                   stdin=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                app_id = (r.stdout or "").strip()
                if app_id:
                    achado = "shell:AppsFolder\\" + app_id
            except Exception:
                pass
        _apps[nome] = achado
        log("[app] %s -> %s" % (nome, achado or "não encontrado"))
    alvo = _apps[nome]
    if alvo:
        try:
            if alvo.startswith("shell:"):
                subprocess.Popen(["explorer.exe", alvo])
            else:
                os.startfile(alvo)
            return True, rotulo + ": aberto."
        except Exception as e:
            _apps.pop(nome, None)
            log("[app] falhou ao abrir %s: %s" % (alvo, e))
    if url_reserva:
        webbrowser.open(url_reserva)
        return True, rotulo + ": app não encontrado, abri o site."
    return False, "App %s não encontrado no PC." % nome


def executar(botao, cfg):
    tipo = botao.get("tipo")
    if tipo == "comando":
        subprocess.Popen(os.path.expandvars(botao["comando"]), shell=True)
        return True, botao["rotulo"] + ": aberto."
    if tipo == "bomdia":
        threading.Thread(target=dar_bom_dia, daemon=True).start()
        return True, "Bom dia a caminho…"
    if tipo == "protocolo":   # ex.: steam://rungameid/730 (CS2)
        try:
            os.startfile(botao["url"])
            return True, botao["rotulo"] + ": abrindo…"
        except Exception as e:
            return False, botao["rotulo"] + ": não abriu (%s)." % e
    if tipo == "url":
        webbrowser.open(botao["url"])
        return True, botao["rotulo"] + ": aberto no navegador."
    if tipo == "app" and botao.get("app"):   # app do Windows pelo nome (ex.: Claude), com site de reserva
        return abrir_app(botao["app"], botao.get("url_reserva"), botao["rotulo"])
    if tipo == "app":
        for c in botao.get("caminhos", []):
            c = os.path.expandvars(c)
            if os.path.isfile(c):
                subprocess.Popen([c])
                return True, botao["rotulo"] + ": aberto."
        if botao.get("protocolo") and hasattr(os, "startfile"):
            os.startfile(botao["protocolo"])  # ex.: claude:// abre o app instalado
            return True, botao["rotulo"] + ": aberto."
        return False, botao["rotulo"] + ": app não encontrado neste PC."
    if tipo == "chrome":
        return chrome.abrir(botao["id"].split(":", 1)[1], cfg)
    if tipo == "status_vps":
        _cache_vps["t"] = 0
        v = checar_vps(cfg.get("vps_url"))
        if v is None:
            return False, "Configure vps_url no config.json."
        return v["ok"], ("VPS no ar (%d ms)." % v["ms"]) if v["ok"] else "VPS FORA DO AR!"
    return False, "Tipo de ação desconhecido: %s" % tipo


NOTICIAS = None  # definido no main()
PET = None
AGENDA = None    # Fase 2: agenda por voz
ARQ_POSTIT = PASTA / "postit_estado.json"   # {"min": true} = todos os post-its do PC minimizados


def postits_minimizados():
    try:
        return bool(json.loads(ARQ_POSTIT.read_text(encoding="utf-8")).get("min"))
    except Exception:
        return False


def minimizar_postits(valor):
    v = (not postits_minimizados()) if valor == "alternar" else bool(valor)
    ARQ_POSTIT.write_text(json.dumps({"min": v}), encoding="utf-8")
    return v
CONVERSA = None  # status das conversas com o Claude (via GitHub)
PAREAR = {"codigo": None, "ate": 0, "erros": 0}   # pareamento sem cabo (código de 6 dígitos)


def AGENDA_notificar(titulo, texto, segundos=15):
    from agenda import notificar
    notificar(titulo, texto, segundos)
OUVIDO = None


# ---------------------------------------------------------------- servidor
class Handler(BaseHTTPRequestHandler):
    # --- utilidades
    def _pelo_cabo(self):
        return self.client_address[0] in ("127.0.0.1", "::1")

    def _autorizado(self, query):
        if self._pelo_cabo():
            return True
        t = self.headers.get("X-Cadu-Token") or (query.get("t") or [""])[0]
        return bool(t) and secrets.compare_digest(t, TOKEN)

    def _json(self, obj, codigo=200):
        corpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _arquivo(self, caminho, tipo, cache=True):
        corpo = caminho.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Cache-Control", "max-age=86400" if cache else "no-store")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _corpo(self):
        tam = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(tam) or b"{}")

    # --- GET
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/api/diag":   # a tela do celular conta por que desistiu (só registra)
            log("[web] celular: %s" % (q.get("m") or ["?"])[0][:200])
            return self._json({"ok": True})
        if u.path == "/api/ping":  # usado pelo app para achar o PC (não revela nada)
            if not self._pelo_cabo() and time.time() - VISTOS.get(self.client_address[0], 0) > 60:
                VISTOS[self.client_address[0]] = time.time()
                log("[rede] celular chegou pelo Wi-Fi (%s)" % self.client_address[0])
            return self._json({"ok": True, "cadu": 1})
        if u.path in ("/instalar", "/cadu.apk"):   # instalação sem cabo: o navegador do celular baixa o app
            a = achar_apk()
            if u.path == "/cadu.apk":
                if not a:
                    return self._json({"erro": "nenhum APK no PC"}, 404)
                return self._arquivo(a, "application/vnd.android.package-archive", cache=False)
            html = ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
                    "<body style='font-family:sans-serif;background:#0d1020;color:#f1f2f6;padding:24px;font-size:20px'>"
                    "<h2 style='color:#ffd166'>Instalar o Cadu</h2>%s"
                    "<p>1. Toque no botão e espere baixar.<br>2. Abra o arquivo baixado e toque em <b>Instalar</b>"
                    " (se pedir, libere <b>Fontes desconhecidas</b>).<br>3. Abra o Cadu e toque em <b>🔑 Parear</b>.</p>") % (
                ("<p><a href='/cadu.apk' style='display:inline-block;background:#06d6a0;color:#0d1020;padding:18px 28px;"
                 "text-decoration:none;font-weight:bold;border-radius:8px'>⬇ Baixar o app (%s)</a></p>" % a.name) if a
                else "<p style='color:#ef476f'>Nenhum APK no PC. Baixe o cadu-fisico.apk na pasta Downloads do PC.</p>")
            corpo = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
            return
        if u.path.startswith("/static/"):  # fontes, ícones e bibliotecas (públicos)
            raiz = (WEB / "static").resolve()
            alvo = (WEB / u.path.lstrip("/")).resolve()
            if raiz in alvo.parents and alvo.is_file() and alvo.suffix in TIPOS:
                return self._arquivo(alvo, TIPOS[alvo.suffix], cache=alvo.suffix in (".woff", ".woff2", ".mp3", ".ttf") or alvo.name == "three.min.js" or "/assets/" in u.path)
            return self._json({"erro": "não encontrado"}, 404)
        if not self._autorizado(q):
            if time.time() - VISTOS.get("x" + self.client_address[0], 0) > 60:
                VISTOS["x" + self.client_address[0]] = time.time()
                log("[rede] %s recusado: token errado (ligue o cabo uma vez para parear de novo)" % self.client_address[0])
            return self._json({"erro": "não autorizado"}, 403)

        cfg = carregar_config()
        if u.path in PAGINAS:
            log("[web] tela do Cadu aberta pelo %s" % ("cabo" if self._pelo_cabo() else self.client_address[0]))
            self._arquivo(WEB / PAGINAS[u.path], "text/html; charset=utf-8", cache=False)
        elif u.path == "/api/token":
            # Pareamento: só pelo cabo. O J3 guarda o token para usar no Wi-Fi.
            if not self._pelo_cabo():
                return self._json({"erro": "pareie pelo cabo"}, 403)
            self._json({"token": TOKEN, "ips": ips_locais(), "porta": cfg.get("porta", 8765)})
        elif u.path == "/api/botoes":
            self._json([{k: b.get(k) for k in ("id", "icone", "rotulo", "cor")} for b in todos_botoes(cfg)])
        elif u.path == "/api/status":
            self._json({"hora": time.strftime("%H:%M"),
                        "vps": checar_vps(cfg.get("vps_url")),
                        "dormir": hora_de_dormir(cfg),
                        "via": "cabo" if self._pelo_cabo() else "wifi",
                        # relógio do PC (o celular pode estar em outro fuso)
                        "agora_ms": int(time.time() * 1000),
                        "fuso_min": int(datetime.now().astimezone().utcoffset().total_seconds() // 60)})
        elif u.path == "/api/pet":
            self._json(PET.estado())
        elif u.path == "/api/voz":
            ev = [e for e in AGENDA.eventos if e["seq"] > int((q.get("desde") or ["0"])[0] or 0)]
            self._json(dict(OUVIDO.estado, cerebro=cerebro.disponivel(carregar_config()), eventos=ev, seq=AGENDA.seq_ev))
        elif u.path == "/api/conversa":
            self._json(CONVERSA.estado if CONVERSA else {})
        elif u.path == "/api/clima":
            self._json(clima.obter(carregar_config()) or {})
        elif u.path == "/api/notas":
            self._json(AGENDA.lista())
        elif u.path == "/api/notas/minimizado":
            self._json({"min": postits_minimizados()})
        elif u.path == "/api/prefs":
            self._json(ler_prefs())
        elif u.path == "/api/jogo":
            try:
                self._json(json.loads(ARQ_JOGO.read_text(encoding="utf-8")))
            except Exception:
                self._json({})
        elif u.path == "/api/apk":
            a = achar_apk()
            self._json({"tem": bool(a), "nome": a.name if a else None,
                        "tamanho": a.stat().st_size if a else 0,
                        "data": time.strftime("%d/%m %H:%M", time.localtime(a.stat().st_mtime)) if a else None})
        elif u.path == "/apk":
            a = achar_apk()
            if not a:
                return self._json({"erro": "nenhum APK no PC"}, 404)
            self._arquivo(a, "application/vnd.android.package-archive", cache=False)
        elif u.path == "/api/noticias/config":
            self._json(NOTICIAS.config())
        elif u.path == "/api/avisos":
            try:
                desde = int((q.get("desde") or ["-1"])[0])
            except ValueError:
                desde = -1
            self._json(NOTICIAS.avisos_desde(desde))
        else:
            self._json({"erro": "não encontrado"}, 404)

    # --- POST
    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/api/parear/pedir":   # pareamento sem cabo, passo 1: o PC mostra um código
            PAREAR.update(codigo="%06d" % secrets.randbelow(1000000), ate=time.time() + 600, erros=0)
            log("[parear] código para o celular (%s): %s" % (self.client_address[0], PAREAR["codigo"]))
            AGENDA_notificar("Código do Cadu: " + PAREAR["codigo"], "Digite este código no celular para parear (vale 10 minutos).", 120)
            return self._json({"ok": True})
        if u.path == "/api/parear":         # passo 2: o celular manda o código e recebe o token
            try:
                cod = str(self._corpo().get("codigo") or "").strip()
            except Exception:
                cod = ""
            if not PAREAR["codigo"] or time.time() > PAREAR["ate"]:
                return self._json({"ok": False, "msg": "Código vencido. Peça outro."})
            if not secrets.compare_digest(cod, PAREAR["codigo"]):
                PAREAR["erros"] += 1
                if PAREAR["erros"] >= 5:
                    PAREAR["codigo"] = None
                return self._json({"ok": False, "msg": "Código errado."})
            PAREAR["codigo"] = None
            log("[parear] celular %s pareado pelo Wi-Fi" % self.client_address[0])
            return self._json({"ok": True, "token": TOKEN, "ip": self.headers.get("Host", "").split(":")[0]})
        if not self._autorizado(urllib.parse.parse_qs(u.query)):
            return self._json({"erro": "não autorizado"}, 403)
        try:
            if u.path == "/api/voz/audio":   # gravação feita no celular sem PC (PCM 16 kHz mono)
                tam = int(self.headers.get("Content-Length") or 0)
                if tam <= 0 or tam > 4 * 1024 * 1024:
                    return self._json({"ok": False, "msg": "tamanho inválido"}, 400)
                pcm = self.rfile.read(tam)
                try:
                    ts = float((urllib.parse.parse_qs(u.query).get("ts") or ["0"])[0]) / 1000.0
                except ValueError:
                    ts = 0
                if OUVIDO.whisper is None:   # ainda não dá para transcrever: o celular guarda e manda depois
                    return self._json({"ok": False, "msg": "voz não está pronta"}, 503)
                ok = OUVIDO.gravacao_offline(pcm, ts)  # só confirma depois de virar post-it
                return self._json({"ok": ok}, 200 if ok else 500)
            pedido = self._corpo()
            if u.path == "/api/acao":
                cfg = carregar_config()
                botao = next((b for b in todos_botoes(cfg) if b["id"] == pedido.get("id")), None)
                if not botao:
                    return self._json({"ok": False, "msg": "Botão desconhecido."})
                ok, msg = executar(botao, cfg)
                log("[acao] %s -> %s" % (botao["id"], msg))
                return self._json({"ok": ok, "msg": msg})
            if u.path == "/api/pet":
                msg, estado = PET.agir(pedido.get("acao"))
                return self._json({"ok": True, "msg": msg, "pet": estado})
            if u.path == "/api/notas/piscar":
                return self._json({"ok": AGENDA.piscar(int(pedido.get("id") or 0))})
            if u.path == "/api/notas/adiar":
                AGENDA.adiar(int(pedido.get("id") or 0), max(1, min(24 * 60, int(pedido.get("min") or 10))))
                return self._json({"ok": True})
            if u.path == "/api/notas/minimizar":   # minimiza/mostra TODOS os post-its do PC
                return self._json({"ok": True, "min": minimizar_postits(pedido.get("min", "alternar"))})
            if u.path == "/api/notas/feito":
                AGENDA.feito(int(pedido.get("id") or 0))
                return self._json({"ok": True})
            if u.path == "/api/voz/frase":   # mesmo caminho da voz, mas digitado (teste / sem microfone)
                frase = str(pedido.get("frase") or "")[:500]
                fala, nota = AGENDA.processar(frase)
                OUVIDO.falar(fala)
                return self._json({"ok": True, "fala": fala, "nota": nota})
            if u.path == "/api/prefs":
                prefs = ler_prefs()
                if pedido.get("tela") in ("mundo3d", "mundo", "olhos"):
                    prefs["tela"] = pedido["tela"]
                if pedido.get("estilo") in ("bolinha", "ursinho", "mochi"):
                    prefs["estilo"] = pedido["estilo"]
                if isinstance(pedido.get("eco"), int) and 0 <= pedido["eco"] <= 600:
                    prefs["eco"] = pedido["eco"]
                if isinstance(pedido.get("ordem"), list) and len(pedido["ordem"]) <= 100:
                    prefs["ordem"] = [str(x)[:80] for x in pedido["ordem"] if x]
                if isinstance(pedido.get("olhos"), int) and 0 <= pedido["olhos"] < 20:
                    prefs["olhos"] = pedido["olhos"]
                for k in ("tour", "som"):
                    if isinstance(pedido.get(k), bool):
                        prefs[k] = pedido[k]
                ARQ_PREFS.write_text(json.dumps(prefs), encoding="utf-8")
                return self._json({"ok": True, "prefs": prefs})
            if u.path == "/api/jogo":
                # progresso dos mundos 3D (moedas, estrelas, horta, recorde)
                j = pedido.get("jogo")
                if not isinstance(j, dict) or len(json.dumps(j)) > 20000:
                    return self._json({"ok": False})
                ARQ_JOGO.write_text(json.dumps(j, ensure_ascii=False), encoding="utf-8")
                return self._json({"ok": True})
            if u.path == "/api/teste3d":
                r = {k: pedido.get(k) for k in ("webgl", "fps", "gpu", "navegador")}
                r["quando"] = time.strftime("%d/%m/%Y %H:%M")
                (PASTA / "teste3d.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
                log("[teste3d] %s" % r)
                return self._json({"ok": True})
            if u.path == "/api/noticias/alterar":
                ok = NOTICIAS.alterar(pedido.get("id"), pedido.get("ativa"), pedido.get("urgente"))
                return self._json({"ok": ok, "categorias": NOTICIAS.config()})
            if u.path == "/api/noticias/nova":
                cid = NOTICIAS.nova(pedido.get("nome"))
                return self._json({"ok": bool(cid), "categorias": NOTICIAS.config()})
            if u.path == "/api/noticias/remover":
                ok = NOTICIAS.remover(pedido.get("id"))
                return self._json({"ok": ok, "categorias": NOTICIAS.config()})
            if u.path == "/api/abrir":
                # Só abre links de manchetes que o próprio agente buscou.
                link = NOTICIAS.link(pedido.get("k"))
                if not link:
                    return self._json({"ok": False, "msg": "Notícia não encontrada."})
                webbrowser.open(link)
                return self._json({"ok": True, "msg": "Matéria aberta no PC."})
            self._json({"erro": "não encontrado"}, 404)
        except Exception as e:
            self._json({"ok": False, "msg": "Erro: %s" % e})

    def log_message(self, *args):
        pass  # silencioso; só ações e eventos aparecem no registro


def preparar_log():
    """Rodando escondido (pythonw) não há console: grava tudo em agente/cadu.log."""
    if sys.stdout is None or not sys.stdout.isatty():
        arq = open(PASTA / "cadu.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = arq
        print("\n=== %s — agente iniciado ===" % time.strftime("%d/%m/%Y %H:%M:%S"))


# ---------------------------------------------------------------- BOM DIA DO CADU
def montar_bom_dia():
    """Resumo falado: clima, lembretes de hoje, sistemas e 3 manchetes."""
    cfg = carregar_config()
    h = int(time.strftime("%H"))
    partes = [("Bom dia" if h < 12 else ("Boa tarde" if h < 18 else "Boa noite")) + ", Felipe!"]
    partes.append(clima.frase(clima.obter(cfg)))
    hoje = time.strftime("%Y-%m-%d")
    lemb = [n for n in AGENDA.lista() if n.get("quando") and time.strftime("%Y-%m-%d", time.localtime(n["quando"])) == hoje and not n.get("disparado")]
    if lemb:
        itens = ["%s às %s" % (n["texto"], time.strftime("%H:%M", time.localtime(n["quando"]))) for n in sorted(lemb, key=lambda n: n["quando"])[:4]]
        partes.append("Hoje você tem %d lembrete%s: %s." % (len(lemb), "" if len(lemb) == 1 else "s", "; ".join(itens)))
    else:
        partes.append("Nenhum lembrete marcado para hoje.")
    v = checar_vps(cfg.get("vps_url"))
    if v is not None:
        partes.append("A VPS está no ar." if v.get("ok") else "Atenção: a VPS está fora do ar!")
    manchetes = []
    with NOTICIAS.trava:
        for lista in NOTICIAS.recentes.values():
            if lista:
                manchetes.append(lista[0]["titulo"])
    if manchetes:
        partes.append("Manchetes: " + ". ".join(m.rstrip(".") for m in manchetes[:3]) + ".")
    return " ".join(partes)


def rodar_bom_dia():
    """Fala o Bom dia sozinho no horário do config ("bom_dia": "07:30"), uma vez por dia."""
    feito = None
    while True:
        try:
            alvo = (carregar_config().get("bom_dia") or "07:30").strip()
            hoje = time.strftime("%Y-%m-%d")
            if alvo and alvo != "desligado" and time.strftime("%H:%M") >= alvo and feito != hoje and time.strftime("%H:%M") < "12:00":
                feito = hoje
                dar_bom_dia()
        except Exception as e:
            log("[bomdia] erro: %s" % e)
        time.sleep(30)


def dar_bom_dia(falar=True):
    texto = montar_bom_dia()
    log("[bomdia] " + texto[:120])
    AGENDA._evento(tipo="bomdia", texto=texto)
    if falar:   # pela voz quem fala é o ouvido (voz.py), para não repetir
        OUVIDO.falar(texto)
    return texto


def main():
    global TOKEN, NOTICIAS, PET, AGENDA, OUVIDO
    preparar_log()
    cfg = carregar_config()
    porta = int(cfg.get("porta", 8765))
    try:
        srv = ThreadingHTTPServer(("0.0.0.0", porta), Handler)
    except OSError:
        # Porta ocupada = o agente já está rodando (ex.: iniciou com o Windows). Sai quieto.
        log("Agente já está rodando na porta %d." % porta)
        return
    TOKEN = obter_token()
    PET = Pet()
    NOTICIAS = Noticias((cfg.get("noticias") or {}).get("intervalo_min", 15), log=log)
    threading.Thread(target=manter_tunel_usb, args=(porta,), daemon=True).start()
    threading.Thread(target=anunciar_na_rede, args=(porta,), daemon=True).start()
    threading.Thread(target=NOTICIAS.rodar, daemon=True).start()
    AGENDA = Agenda(carregar_config, log=log)
    OUVIDO = Ouvido(AGENDA, carregar_config, TOKEN, log=log)
    threading.Thread(target=AGENDA.rodar, daemon=True).start()
    threading.Thread(target=OUVIDO.servir, daemon=True).start()
    AGENDA.comando = lambda frase: dar_bom_dia(falar=False) if re.match(r"^\W*(bom dia|boa tarde|boa noite|resumo( do dia)?|me (d[aá]|fala) o resumo)\b", frase, re.I) else None
    threading.Thread(target=rodar_bom_dia, daemon=True).start()
    global CONVERSA
    def mudou(e):   # terminou/esperando: o celular fala e o PC avisa
        nome = e.get("nome", "conversa").replace("-", " ")
        if e["estado"] == "terminou":
            OUVIDO.falar("Felipe, a conversa %s terminou: %s" % (nome, e["titulo"]))
            AGENDA_notificar("Claude terminou · " + nome, e["titulo"])
        elif e["estado"] == "esperando":
            OUVIDO.falar("Felipe, a conversa %s está esperando sua resposta." % nome)
            AGENDA_notificar("Claude espera você · " + nome, e["titulo"])
    CONVERSA = Conversa(carregar_config, log=log, ao_mudar=mudou)
    threading.Thread(target=CONVERSA.rodar, daemon=True).start()
    log("[chrome] perfis encontrados: %s" % ", ".join("%s (%s)" % (p["nome"], p["dir"]) for p in chrome.listar_perfis()))
    log("Cadu agente rodando na porta %d — cabo e Wi-Fi (%s)  (Ctrl+C para parar)"
        % (porta, ", ".join(ips_locais()) or "sem rede"))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
