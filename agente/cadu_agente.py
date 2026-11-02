"""
Agente do Cadu físico (roda no PC Windows).

- Serve a interface (../web/index.html) para o J3.
- Executa as ações dos botões definidas em config.json.
- Mantém o túnel USB ativo ("adb reverse"), refazendo se o cabo for reconectado.

Só aceita conexões do próprio PC (127.0.0.1): o J3 chega pelo cabo USB via adb,
nada fica exposto na rede. Os comandos vêm apenas do config.json, nunca do celular.

Uso:  python cadu_agente.py
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PASTA = Path(__file__).resolve().parent
WEB = PASTA.parent / "web"
CONFIG = PASTA / "config.json"


def carregar_config():
    with open(CONFIG, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------- adb reverse
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
    """A cada 3 s garante 'adb reverse' (o J3 acessa 127.0.0.1:porta = este PC).
    É isso que faz o Cadu "acordar" sozinho quando o cabo é conectado."""
    adb = achar_adb()
    if not adb:
        print("[aviso] adb não encontrado — rode 'adb reverse tcp:%d tcp:%d' manualmente." % (porta, porta))
        return
    ultimo = None
    while True:
        try:
            r = subprocess.run([adb, "reverse", "tcp:%d" % porta, "tcp:%d" % porta],
                               capture_output=True, text=True, timeout=10,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            estado = "conectado" if r.returncode == 0 else "sem celular"
        except Exception:
            estado = "sem celular"
        if estado != ultimo:
            print("[usb] %s J3 %s" % (time.strftime("%H:%M:%S"), estado))
            ultimo = estado
        time.sleep(3)  # cabo conectado -> Cadu acorda em poucos segundos


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


# ---------------------------------------------------------------- ações
def executar(botao, cfg):
    tipo = botao.get("tipo")
    if tipo == "comando":
        subprocess.Popen(os.path.expandvars(botao["comando"]), shell=True)
        return True, botao["rotulo"] + ": aberto."
    if tipo == "url":
        webbrowser.open(botao["url"])
        return True, botao["rotulo"] + ": aberto no navegador."
    if tipo == "status_vps":
        _cache_vps["t"] = 0
        v = checar_vps(cfg.get("vps_url"))
        if v is None:
            return False, "Configure vps_url no config.json."
        return v["ok"], ("VPS no ar (%d ms)." % v["ms"]) if v["ok"] else "VPS FORA DO AR!"
    return False, "Tipo de ação desconhecido: %s" % tipo


# ---------------------------------------------------------------- servidor
class Handler(BaseHTTPRequestHandler):
    def _json(self, obj, codigo=200):
        corpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        cfg = carregar_config()
        if self.path in ("/", "/index.html"):
            corpo = (WEB / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
        elif self.path == "/api/botoes":
            # Só o que a tela precisa; os comandos ficam no PC.
            self._json([{k: b.get(k) for k in ("id", "icone", "rotulo", "cor")} for b in cfg["botoes"]])
        elif self.path == "/api/status":
            self._json({"hora": time.strftime("%H:%M"),
                        "vps": checar_vps(cfg.get("vps_url")),
                        "dormir": hora_de_dormir(cfg)})
        else:
            self._json({"erro": "não encontrado"}, 404)

    def do_POST(self):
        if self.path != "/api/acao":
            return self._json({"erro": "não encontrado"}, 404)
        try:
            tam = int(self.headers.get("Content-Length") or 0)
            pedido = json.loads(self.rfile.read(tam) or b"{}")
            cfg = carregar_config()
            botao = next((b for b in cfg["botoes"] if b["id"] == pedido.get("id")), None)
            if not botao:
                return self._json({"ok": False, "msg": "Botão desconhecido."})
            ok, msg = executar(botao, cfg)
            print("[acao] %s -> %s" % (botao["id"], msg))
            self._json({"ok": ok, "msg": msg})
        except Exception as e:
            self._json({"ok": False, "msg": "Erro: %s" % e})

    def log_message(self, *args):
        pass  # silencioso; só as ações aparecem no console


def preparar_log():
    """Rodando escondido (pythonw) não há console: grava tudo em agente/cadu.log."""
    if sys.stdout is None or not sys.stdout.isatty():
        log = open(PASTA / "cadu.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = log
        print("\n=== %s — agente iniciado ===" % time.strftime("%d/%m/%Y %H:%M:%S"))


def main():
    preparar_log()
    cfg = carregar_config()
    porta = int(cfg.get("porta", 8765))
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", porta), Handler)
    except OSError:
        # Porta ocupada = o agente já está rodando (ex.: iniciou com o Windows). Sai quieto.
        print("Agente já está rodando na porta %d." % porta)
        return
    threading.Thread(target=manter_tunel_usb, args=(porta,), daemon=True).start()
    print("Cadu agente rodando em http://127.0.0.1:%d  (Ctrl+C para parar)" % porta)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
