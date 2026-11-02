"""
Módulo de notícias do Cadu.

- Busca manchetes no Google Notícias (RSS público, pt-BR) por categoria.
- Categorias ligadas/desligadas e "urgente" (⭐) ficam salvas em noticias.json.
- Manchete nova numa categoria ligada vira um "aviso" que o J3 mostra.
  Urgente = aviso chamativo; normal = aviso discreto.
- Guarda só título, fonte e link (nunca o texto da matéria).
"""
import hashlib
import json
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path

PASTA = Path(__file__).resolve().parent
ARQ = PASTA / "noticias.json"

BASE = "https://news.google.com/rss"
SUFIXO = "hl=pt-BR&gl=BR&ceid=BR:pt-419"

PADRAO = [
    {"id": "brasil",     "nome": "Brasil",         "topico": "NATION",     "ativa": False},
    {"id": "goias",      "nome": "Goiás/Goiânia",  "busca": "Goiás OR Goiânia", "ativa": True},
    {"id": "economia",   "nome": "Economia",       "topico": "BUSINESS",   "ativa": True},
    {"id": "politica",   "nome": "Política",       "busca": "política",    "ativa": False},
    {"id": "tecnologia", "nome": "Tecnologia",     "topico": "TECHNOLOGY", "ativa": False},
    {"id": "ia",         "nome": "IA",             "busca": "inteligência artificial", "ativa": True},
    {"id": "mundo",      "nome": "Mundo",          "topico": "WORLD",      "ativa": False},
    {"id": "esportes",   "nome": "Esportes",       "topico": "SPORTS",     "ativa": False},
]

MAX_AVISOS_POR_RODADA = 3   # por categoria, para não inundar a tela


class Noticias:
    def __init__(self, intervalo_min=15, log=print):
        self.intervalo = max(5, int(intervalo_min)) * 60
        self.log = log
        self.trava = threading.RLock()
        self.avisos = []          # [{seq, k, cat, catNome, titulo, fonte, link, quando, urgente}]
        self.seq = 0
        self.recentes = {}        # cat -> lista das últimas manchetes
        self._acordar = threading.Event()
        self._carregar()

    # ------------------------------------------------------------ estado
    def _carregar(self):
        estado = {}
        if ARQ.exists():
            try:
                estado = json.loads(ARQ.read_text(encoding="utf-8"))
            except Exception:
                estado = {}
        cats = estado.get("categorias") or [dict(c, urgente=False) for c in PADRAO]
        for c in cats:
            c.setdefault("urgente", False)
            c.setdefault("ativa", False)
        self.categorias = cats
        self.vistos = {k: list(v) for k, v in (estado.get("vistos") or {}).items()}

    def _salvar(self):
        dados = {"categorias": self.categorias,
                 "vistos": {k: v[-300:] for k, v in self.vistos.items()}}
        tmp = ARQ.with_suffix(".tmp")
        tmp.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(ARQ)

    # ------------------------------------------------------------ API p/ a tela
    def config(self):
        with self.trava:
            saida = []
            for c in self.categorias:
                ult = (self.recentes.get(c["id"]) or [None])[0]
                saida.append({"id": c["id"], "nome": c["nome"], "ativa": c["ativa"],
                              "urgente": c["urgente"], "custom": bool(c.get("custom")),
                              "ultima": ult["titulo"] if ult else None})
            return saida

    def alterar(self, cid, ativa=None, urgente=None):
        with self.trava:
            c = self._cat(cid)
            if not c:
                return False
            ligou = ativa is True and not c["ativa"]
            if ativa is not None:
                c["ativa"] = bool(ativa)
            if urgente is not None:
                c["urgente"] = bool(urgente)
            self._salvar()
        if ligou:  # busca já, em silêncio (marca como visto, sem disparar avisos antigos)
            threading.Thread(target=self._buscar_categoria, args=(cid, True), daemon=True).start()
        return True

    def nova(self, nome):
        nome = re.sub(r"\s+", " ", (nome or "")).strip()[:60]
        if len(nome) < 2:
            return None
        cid = "c_" + hashlib.md5(nome.lower().encode()).hexdigest()[:8]
        with self.trava:
            if self._cat(cid):
                return cid
            self.categorias.append({"id": cid, "nome": nome, "busca": nome, "ativa": True,
                                    "urgente": False, "custom": True})
            self._salvar()
        threading.Thread(target=self._buscar_categoria, args=(cid, True), daemon=True).start()
        return cid

    def remover(self, cid):
        with self.trava:
            c = self._cat(cid)
            if not c or not c.get("custom"):
                return False
            self.categorias.remove(c)
            self.vistos.pop(cid, None)
            self.recentes.pop(cid, None)
            self._salvar()
            return True

    def avisos_desde(self, desde):
        with self.trava:
            if desde < 0:  # tela acabou de abrir: não repete avisos antigos
                return {"seq": self.seq, "itens": []}
            return {"seq": self.seq, "itens": [a for a in self.avisos if a["seq"] > desde]}

    def link(self, k):
        with self.trava:
            for lista in self.recentes.values():
                for n in lista:
                    if n["k"] == k:
                        return n["link"]
        return None

    # ------------------------------------------------------------ busca
    def _cat(self, cid):
        return next((c for c in self.categorias if c["id"] == cid), None)

    @staticmethod
    def url_da(c):
        if c.get("topico"):
            return "%s/headlines/section/topic/%s?%s" % (BASE, c["topico"], SUFIXO)
        q = urllib.parse.quote_plus("%s when:1d" % c.get("busca", c["nome"]))
        return "%s/search?q=%s&%s" % (BASE, q, SUFIXO)

    @staticmethod
    def ler_rss(xml_bytes, cat):
        itens = []
        raiz = ET.fromstring(xml_bytes)
        for it in raiz.iter("item"):
            titulo = (it.findtext("title") or "").strip()
            link = (it.findtext("link") or "").strip()
            fonte = (it.findtext("source") or "").strip()
            if not titulo or not link:
                continue
            if fonte and titulo.endswith(" - " + fonte):
                titulo = titulo[: -len(" - " + fonte)]
            try:
                quando = int(parsedate_to_datetime(it.findtext("pubDate")).timestamp())
            except Exception:
                quando = int(time.time())
            k = hashlib.md5(link.encode()).hexdigest()[:12]
            itens.append({"k": k, "cat": cat["id"], "catNome": cat["nome"], "titulo": titulo,
                          "fonte": fonte, "link": link, "quando": quando})
        itens.sort(key=lambda n: n["quando"], reverse=True)
        return itens

    def _baixar(self, url):
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (cadu-fisico)"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read()

    def _buscar_categoria(self, cid, silencioso=False):
        with self.trava:
            c = self._cat(cid)
            if not c or not c["ativa"]:
                return
            c = dict(c)
        try:
            itens = self.ler_rss(self._baixar(self.url_da(c)), c)
        except Exception as e:
            self.log("[noticias] erro em %s: %s" % (c["nome"], e))
            return
        with self.trava:
            self.recentes[cid] = itens[:20]
            vistos = self.vistos.setdefault(cid, [])
            primeira_vez = not vistos
            novos = [n for n in itens if n["k"] not in vistos]
            vistos.extend(n["k"] for n in novos)
            if not (silencioso or primeira_vez):
                limite = time.time() - 6 * 3600   # só avisa o que é recente
                for n in [n for n in novos if n["quando"] >= limite][:MAX_AVISOS_POR_RODADA]:
                    self.seq += 1
                    self.avisos.append(dict(n, seq=self.seq, urgente=c["urgente"]))
                self.avisos = self.avisos[-60:]
            self._salvar()
        if novos and not (silencioso or primeira_vez):
            self.log("[noticias] %s: %d nova(s)" % (c["nome"], len(novos)))

    def rodar(self):
        """Loop em segundo plano: busca todas as categorias ligadas a cada intervalo."""
        while True:
            with self.trava:
                ids = [c["id"] for c in self.categorias if c["ativa"]]
            for cid in ids:
                self._buscar_categoria(cid)
                time.sleep(1)
            self._acordar.wait(self.intervalo)
            self._acordar.clear()
