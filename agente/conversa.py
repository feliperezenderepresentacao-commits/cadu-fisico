"""
Status das conversas com o Claude (o "Cadu" da nuvem) no celular.

O Claude grava um arquivo status.json no ramo "status" do repositório no GitHub
({"estado": "executando"|"esperando"|"terminou", "titulo": "...", "quando": epoch}).
Este módulo consulta esse arquivo a cada 15 s com ETag (respostas 304 não gastam o limite da API do GitHub).
"""
import json
import threading
import time
import urllib.error
import urllib.request

REPO = "feliperezenderepresentacao-commits/cadu-fisico"


class Conversa:
    def __init__(self, cfg_fn, log=print, ao_mudar=None):
        self.cfg_fn, self.log, self.ao_mudar = cfg_fn, log, ao_mudar
        self.estado = {"estado": "", "titulo": "", "quando": 0, "seq": 0, "ok": False}
        self.etag = None

    def _buscar(self):
        repo = (self.cfg_fn().get("status_github") or REPO)
        req = urllib.request.Request("https://api.github.com/repos/%s/contents/status.json?ref=status" % repo,
                                     headers={"User-Agent": "cadu-fisico", "Accept": "application/vnd.github.raw+json"})
        if self.etag:
            req.add_header("If-None-Match", self.etag)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                self.etag = r.headers.get("ETag")
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 304:
                return None
            raise

    def rodar(self):
        while True:
            try:
                d = self._buscar()
                self.estado["ok"] = True
                if d and (d.get("quando"), d.get("estado")) != (self.estado.get("quando"), self.estado.get("estado")):
                    primeira = self.estado["seq"] == 0
                    self.estado.update(estado=d.get("estado", ""), titulo=str(d.get("titulo", ""))[:120], quando=d.get("quando", 0))
                    self.estado["seq"] += 1
                    if not primeira:
                        self.log("[conversa] %s: %s" % (self.estado["estado"], self.estado["titulo"]))
                        if self.ao_mudar:
                            self.ao_mudar(dict(self.estado))
            except Exception as e:
                self.estado["ok"] = False
            time.sleep(15)
