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
    with open(CONFIG, encoding="utf-8") as f:
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
            s.sendto(msg, ("255.255.255.255", PORTA_BEACON))
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


def abrir_app(nome, url_reserva, rotulo):
    """Abre um aplicativo instalado pelo nome que aparece no Menu Iniciar (ex.: "Claude").
    Funciona para apps comuns e da Microsoft Store. Se não achar, abre o site reserva."""
    if nome not in _apps:
        try:
            cmd = "(Get-StartApps | Where-Object { $_.Name -eq '%s' } | Select-Object -First 1).AppID" % nome.replace("'", "")
            r = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=20,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            _apps[nome] = (r.stdout or "").strip() or None
        except Exception:
            _apps[nome] = None
    app_id = _apps[nome]
    if app_id:
        subprocess.Popen(["explorer.exe", "shell:AppsFolder\\" + app_id])
        return True, rotulo + ": aberto."
    if url_reserva:
        webbrowser.open(url_reserva)
        return True, rotulo + ": app não encontrado, abri o site."
    return False, "App %s não encontrado no PC." % nome
def executar(botao, cfg):
    tipo = botao.get("tipo")
    if tipo == "comando":
        subprocess.Popen(os.path.expandvars(botao["comando"]), shell=True)
        return True, botao["rotulo"] + ": aberto."
    if tipo == "url":
        webbrowser.open(botao["url"])
        return True, botao["rotulo"] + ": aberto no navegador."
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
    if tipo == "app":
        return abrir_app(botao["app"], botao.get("url_reserva"), botao["rotulo"])
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
        if u.path == "/api/ping":  # usado pelo app para achar o PC (não revela nada)
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
            return self._json({"erro": "não autorizado"}, 403)

        cfg = carregar_config()
        if u.path in PAGINAS:
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
        elif u.path == "/api/notas":
            self._json(AGENDA.lista())
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
    log("[chrome] perfis encontrados: %s" % ", ".join("%s (%s)" % (p["nome"], p["dir"]) for p in chrome.listar_perfis()))
    log("Cadu agente rodando na porta %d — cabo e Wi-Fi (%s)  (Ctrl+C para parar)"
        % (porta, ", ".join(ips_locais()) or "sem rede"))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
