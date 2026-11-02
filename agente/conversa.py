"""
Status das conversas com o Claude no celular — todas as conversas, não só uma.

Cada conversa grava um arquivo no ramo "status" do repositório no GitHub:
    sessoes/<nome-da-conversa>.json  →  {"estado": "executando"|"esperando"|"terminou", "titulo": "...", "quando": epoch}
(o script scripts/claude-status.sh faz isso). Este módulo lista a pasta a cada 15 s com ETag
(respostas 304 não gastam o limite da API do GitHub) e só baixa os arquivos que mudaram.
"""
import json
import time
import urllib.error
import urllib.request

REPO = "feliperezenderepresentacao-commits/cadu-fisico"
API = "https://api.github.com/repos/%s/contents/%s?ref=status"
PRIORIDADE = {"esperando": 0, "executando": 1, "terminou": 2}


class Conversa:
    def __init__(self, cfg_fn, log=print, ao_mudar=None):
        self.cfg_fn, self.log, self.ao_mudar = cfg_fn, log, ao_mudar
        self.sessoes = {}          # nome -> {estado, titulo, quando, sha}
        self.etag = None
        self.seq = 0
        self.ok = False
        self.estado = self._resumo()

    def _get(self, url, etag=None, raw=False):
        req = urllib.request.Request(url, headers={"User-Agent": "cadu-fisico",
                                                   "Accept": "application/vnd.github.raw+json" if raw else "application/vnd.github+json"})
        if etag:
            req.add_header("If-None-Match", etag)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.headers.get("ETag"), json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 304:
                return etag, None
            if e.code == 404:
                return None, []
            raise

    def _resumo(self):
        lista = sorted(({"nome": n, **{k: v for k, v in d.items() if k != "sha"}} for n, d in self.sessoes.items()),
                       key=lambda s: (PRIORIDADE.get(s["estado"], 3), -s.get("quando", 0)))
        principal = lista[0] if lista else {"estado": "", "titulo": "", "quando": 0, "nome": ""}
        return dict(principal, seq=self.seq, ok=self.ok, sessoes=lista[:6])

    def _atualizar(self):
        repo = self.cfg_fn().get("status_github") or REPO
        etag, itens = self._get(API % (repo, "sessoes"), self.etag)
        self.ok = True
        if itens is None:
            return []          # nada mudou
        self.etag = etag
        mudadas = []
        vistos = set()
        for it in itens:
            if not it.get("name", "").endswith(".json"):
                continue
            nome = it["name"][:-5]
            vistos.add(nome)
            if self.sessoes.get(nome, {}).get("sha") == it.get("sha"):
                continue
            _, d = self._get(API % (repo, "sessoes/" + it["name"]), raw=True)
            if not isinstance(d, dict):
                continue
            antes = self.sessoes.get(nome)
            self.sessoes[nome] = {"estado": d.get("estado", ""), "titulo": str(d.get("titulo", ""))[:120],
                                  "quando": d.get("quando", 0), "sha": it.get("sha")}
            if antes is not None or self.seq > 0:
                mudadas.append(dict(self.sessoes[nome], nome=nome))
        for nome in list(self.sessoes):
            if nome not in vistos:
                self.sessoes.pop(nome)
        return mudadas

    def rodar(self):
        while True:
            try:
                primeira = self.seq == 0
                mudadas = self._atualizar()
                if mudadas or primeira:
                    self.seq += 1
                for m in ([] if primeira else mudadas):
                    self.log("[conversa] %s · %s: %s" % (m["nome"], m["estado"], m["titulo"]))
                    if self.ao_mudar:
                        self.ao_mudar(m)
            except Exception:
                self.ok = False
            self.estado = self._resumo()
            time.sleep(15)
