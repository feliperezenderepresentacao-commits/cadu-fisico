"""
Status das conversas com o Claude no celular — todas as conversas, não só uma.

Cada conversa grava um arquivo no ramo "status" do repositório no GitHub:
    sessoes/<nome-da-conversa>.json  →  {"estado": "executando"|"esperando"|"terminou", "titulo": "...", "quando": epoch}
(o script scripts/claude-status.sh faz isso). A cada 10 s este módulo olha o SHA do ramo pelo protocolo
do git (sem o limite de 60 chamadas/hora da API) e só quando muda lista a pasta e baixa os arquivos.
"""
import json
import re
import time
import urllib.error
import urllib.request

REPO = "feliperezenderepresentacao-commits/cadu-fisico"
API = "https://api.github.com/repos/%s/contents/%s?ref=status"
PRIORIDADE = {"esperando": 0, "executando": 1, "terminou": 2}


class Conversa:
    def __init__(self, cfg_fn, log=print, ao_mudar=None):
        self.cfg_fn, self.log, self.ao_mudar = cfg_fn, log, ao_mudar
        self.sessoes = {}          # nome -> {estado, titulo, quando}
        self.sha = None
        self.erro = ""
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
        return dict(principal, seq=self.seq, ok=self.ok, erro=getattr(self, "erro", ""), sessoes=lista[:6])

    def _sha_ramo(self, repo):
        """SHA atual do ramo "status" pelo protocolo do git (não tem o limite de 60/h da API do GitHub)."""
        req = urllib.request.Request("https://github.com/%s.git/info/refs?service=git-upload-pack" % repo,
                                     headers={"User-Agent": "git/2.40 (cadu-fisico)"})
        with urllib.request.urlopen(req, timeout=10) as r:
            for linha in r.read().split(b"\n"):
                if linha.endswith(b" refs/heads/status"):
                    return linha[4:44].decode()
        return None

    def _bruto(self, repo, sha, nome):
        """Arquivo exato daquele commit (endereço com o SHA não fica velho em cache)."""
        url = "https://raw.githubusercontent.com/%s/%s/sessoes/%s" % (repo, sha, nome)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cadu-fisico"}), timeout=10) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise

    def _nomes_feed(self, repo):
        req = urllib.request.Request("https://github.com/%s/commits/status.atom" % repo, headers={"User-Agent": "cadu-fisico"})
        with urllib.request.urlopen(req, timeout=10) as r:
            texto = r.read().decode("utf-8", "ignore")
        return re.findall(r"<title>\s*status ([a-z0-9-]+):", texto)

    def _atualizar(self):
        repo = self.cfg_fn().get("status_github") or REPO
        sha = self._sha_ramo(repo)
        self.ok = True
        if not sha or sha == self.sha:
            return []          # nada mudou
        # lista a pasta (só quando o ramo mudou: poucas chamadas por hora). Se a API recusar, relê as conhecidas.
        try:
            _, itens = self._get((API % (repo, "sessoes")).replace("ref=status", "ref=" + sha))
            nomes = [it["name"] for it in itens if it.get("name", "").endswith(".json")]
        except Exception as e:
            # sem a API (limite de 60/h): descobre as conversas pelo feed de commits do ramo (sem limite)
            self.log("[conversa] API do GitHub recusou a lista (%s); usando o feed de commits" % e)
            nomes = sorted(set([n + ".json" for n in self.sessoes] + [n + ".json" for n in self._nomes_feed(repo)]))
            itens = None
            if not nomes:
                return []      # tenta de novo na próxima volta
        mudadas, vistos = [], set()
        for arq in nomes:
            nome = arq[:-5]
            d = self._bruto(repo, sha, arq)
            if not isinstance(d, dict):
                continue
            vistos.add(nome)
            novo = {"estado": d.get("estado", ""), "titulo": str(d.get("titulo", ""))[:120], "quando": d.get("quando", 0)}
            antes = self.sessoes.get(nome)
            self.sessoes[nome] = novo
            if antes != novo and (antes is not None or self.seq > 0):
                mudadas.append(dict(novo, nome=nome))
        if itens is not None:
            for nome in list(self.sessoes):
                if nome not in vistos:
                    self.sessoes.pop(nome)
        self.sha = sha
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
                self.erro = ""
            except Exception as e:
                if not self.erro:
                    self.log("[conversa] não consegui ler o status no GitHub: %s" % e)
                self.ok, self.erro = False, str(e)[:120]
            self.estado = self._resumo()
            time.sleep(10)
