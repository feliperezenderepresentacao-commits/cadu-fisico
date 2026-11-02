"""
Agenda do Cadu (Fase 2): o que você fala vira post-it na área de trabalho,
notificação do Windows e, se tiver hora, um lembrete que toca na hora certa
(no PC e falado em voz alta no celular).

Interpretação: com o cérebro (FreeLLMAPI) quando configurado; senão, regras locais em português.
Estado em notas.json (fica no PC, não vai para o GitHub).
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path

import cerebro

PASTA = Path(__file__).resolve().parent
ARQ = PASTA / "notas.json"
SEM_JANELA = getattr(subprocess, "CREATE_NO_WINDOW", 0)

NUMEROS = {"um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5, "seis": 6, "sete": 7, "oito": 8,
           "nove": 9, "dez": 10, "onze": 11, "doze": 12, "quinze": 15, "vinte": 20, "trinta": 30, "quarenta": 40, "meia": 30}
DIAS = {"segunda": 0, "terca": 1, "quarta": 2, "quinta": 3, "sexta": 4, "sabado": 5, "domingo": 6}
PERGUNTA = re.compile(r"^(o que|que |qual|quais|quem|como|quanto|quantos|quantas|quando|onde|por que|porque|pra que|me (diz|fala|explica)|voce sabe)")


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower()


def _num(t):
    t = sem_acento(t)
    return int(t) if t.isdigit() else NUMEROS.get(t)


def limpar_chamado(frase):
    """Tira o "Cadu," do começo (e variações que a transcrição costuma trazer)."""
    f = frase.strip()
    f = re.sub(r"^\s*(ei|oi|ok|ô|o)?[\s,]*(cadu|cadú|kadu|cad[uú]h?|caduu|ca du)[\s,.!:;-]*", "", f, flags=re.I)
    return f.strip()


def interpretar_local(frase, agora=None):
    """Regras simples: 'amanhã às 9', 'sexta 15h30', 'daqui a 20 minutos', 'dia 15 às 10', 'hoje à noite'."""
    agora = agora or datetime.now()
    s = sem_acento(frase)
    data, hora, minuto, achou_rel = None, None, 0, None
    m = re.search(r"daqui (?:a |uns |umas )?(\d+|\w+)\s*(?:e meia\s*)?(minutos?|min|horas?|h)\b", s)
    if m and _num(m.group(1)):
        n = _num(m.group(1))
        achou_rel = agora + (timedelta(minutes=n) if m.group(2).startswith("m") else timedelta(hours=n))
        if "e meia" in m.group(0):
            achou_rel += timedelta(minutes=30)
    if "depois de amanha" in s:
        data = (agora + timedelta(days=2)).date()
    elif "amanha" in s:
        data = (agora + timedelta(days=1)).date()
    elif re.search(r"\bhoje\b", s):
        data = agora.date()
    else:
        for nome, wd in DIAS.items():
            if re.search(r"\b%s(-feira)?\b" % nome, s):
                dias = (wd - agora.weekday()) % 7 or 7
                data = (agora + timedelta(days=dias)).date()
                break
        m = re.search(r"\bdia (\d{1,2})\b", s)
        if m and not data:
            d = int(m.group(1))
            try:
                cand = agora.replace(day=d)
                if cand.date() < agora.date():
                    mes = agora.month % 12 + 1
                    cand = cand.replace(month=mes, year=agora.year + (1 if mes == 1 else 0))
                data = cand.date()
            except ValueError:
                pass
    m = (re.search(r"\b(?:as|a|ao)\s+(\d{1,2})(?:[:h]\s?(\d{2}))?\s*(?:h|hs|horas?)?\b", s)
         or re.search(r"\b(\d{1,2})\s?(?:h|:)\s?(\d{2})?\b", s)
         or re.search(r"\b(?:as|a)\s+(\w+)(?:\s+e\s+(meia|\w+))?\s*(?:horas?)?\b", s))
    if m and _num(m.group(1)) is not None and _num(m.group(1)) <= 23:
        hora = _num(m.group(1))
        if m.group(2):
            minuto = _num(m.group(2)) or 0
    if "meio-dia" in s or "meio dia" in s:
        hora, minuto = 12, (30 if "meio dia e meia" in s or "meio-dia e meia" in s else 0)
    if "meia-noite" in s or "meia noite" in s:
        hora, minuto = 0, 0
    if hora is not None and hora < 12 and re.search(r"da tarde|da noite|a noite|de noite", s):
        hora += 12
    if hora is None and re.search(r"(de|a|pela) manha", s) and data:
        hora = 9
    if hora is None and re.search(r"(a|de|pela) noite", s) and data:
        hora = 19
    quando = achou_rel
    if not quando and (data or hora is not None):
        if hora is None:
            hora = 9
        base = data or agora.date()
        quando = datetime(base.year, base.month, base.day, hora, minuto)
        if not data and quando <= agora:
            quando += timedelta(days=1)
    lembrar = bool(re.search(r"lembr|lembrete|avisa|alarme|nao esquecer|nao me deixa esquecer", s))
    if PERGUNTA.search(s) or frase.strip().endswith("?"):
        tipo = "pergunta"
    elif quando or lembrar:
        tipo = "lembrete"
    else:
        tipo = "nota"
    # texto limpo: tira o pedido e as expressões de tempo
    t = re.sub(r"^(me )?(lembr\w*|lembrete|anota\w*|avisa\w*|nao (me deixa )?esquecer)( (de|que|pra|para|do|da)\b)?\s*", "", frase.strip(), flags=re.I)
    t = re.sub(r"\b(depois de amanh[ãa]|amanh[ãa]|hoje|daqui (a |uns |umas )?\S+ (e meia )?(minutos?|min|horas?|h))\b", "", t, flags=re.I)
    t = re.sub(r"\b(na |no |nesta |neste )?(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(-feira)?\b", "", t, flags=re.I)
    t = re.sub(r"\b([àa]s?|ao) (\d{1,2}([:h]\d{2})?\s*(h|hs|horas?)?|meio[- ]dia( e meia)?|meia[- ]noite)\b", "", t, flags=re.I)
    t = re.sub(r"\b\d{1,2}h(\d{2})?\b|\bdia \d{1,2}\b|\b(da|de|à|a) (manh[ãa]|tarde|noite)\b", "", t, flags=re.I)
    t = re.sub(r"\b([àa]s?) (\w+)( e (meia|\w+))?( horas?)?\b",
               lambda m: "" if _num(m.group(2)) is not None else m.group(0), t, flags=re.I)
    t = re.sub(r"\s{2,}", " ", t).strip(" ,.-")
    t = re.sub(r"^(de|que|pra|para|do|da)\s+", "", t, flags=re.I).strip(" ,.-")
    t = (t[:1].upper() + t[1:]) if t else frase.strip()
    return {"tipo": tipo, "texto": t, "quando": quando, "resposta": ""}


def quando_falado(q, agora=None):
    if not q:
        return ""
    agora = agora or datetime.now()
    dia = "hoje" if q.date() == agora.date() else ("amanhã" if q.date() == (agora + timedelta(days=1)).date()
                                                   else ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"][q.weekday()] + " dia %d" % q.day)
    return "%s às %dh%s" % (dia, q.hour, ("%02d" % q.minute) if q.minute else "")


# ---------------------------------------------------------------- avisos no Windows
def notificar(titulo, texto, segundos=15):
    """Aviso no canto da tela do PC (janelinha do Cadu com som). Não depende do PowerShell,
    que neste PC é bloqueado ("Acesso negado") quando chamado pelo agente escondido."""
    if os.name != "nt":
        print("[notificação]", titulo, "-", texto)
        return
    exe = sys.executable.replace("python.exe", "pythonw.exe")
    try:
        subprocess.Popen([exe, str(PASTA / "aviso.py"), titulo[:80], texto[:300], str(segundos)], creationflags=SEM_JANELA,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        print("[agenda] notificação falhou:", e)


class Agenda:
    def __init__(self, cfg_fn, log=print):
        self.cfg_fn = cfg_fn
        self.log = log
        self.trava = threading.RLock()
        self.notas = self._carregar()
        self.seq = max([n["id"] for n in self.notas] + [0])
        self.eventos = []          # para a tela do Cadu: [{seq, tipo, texto, quando_txt, disparo}]
        self.seq_ev = 0
        self.falar_no_celular = None  # definido pelo ouvido (voz.py)
        self.postits = {}

    def _carregar(self):
        try:
            return json.loads(ARQ.read_text(encoding="utf-8"))
        except Exception:
            return []

    def _salvar(self):
        tmp = ARQ.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.notas, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(ARQ)

    def _evento(self, **kv):
        self.seq_ev += 1
        kv["seq"] = self.seq_ev
        self.eventos = (self.eventos + [kv])[-30:]

    # ------------------------------------------------ entrada principal
    def processar(self, frase_bruta, agora=None):
        """Recebe a frase transcrita e devolve (texto_para_falar, nota|None).
        agora = momento em que a frase foi falada (gravações feitas sem PC chegam depois)."""
        frase = limpar_chamado(frase_bruta)
        if len(frase) < 2:
            return "Não entendi. Fala de novo?", None
        cfg = self.cfg_fn()
        r = None
        if cerebro.disponivel(cfg):
            try:
                r = cerebro.interpretar(cfg, frase, agora)
            except Exception as e:
                self.log("[agenda] cérebro falhou (%s) — usando regras locais" % e)
        if r is None:
            r = interpretar_local(frase, agora)
        if r["tipo"] == "pergunta":
            resp = r["resposta"] or ("Ainda não tenho o cérebro ligado para responder. Anotei a pergunta."
                                     if not cerebro.disponivel(cfg) else "Não sei responder isso agora.")
            self._evento(tipo="pergunta", texto=frase, resposta=resp)
            if not r["resposta"]:
                self.criar("nota", frase, None, agora)
            return resp, None
        nota = self.criar(r["tipo"], r["texto"], r["quando"], agora)
        fala = r["resposta"] or ("Anotado: %s%s." % (nota["texto"], (", " + quando_falado(r["quando"])) if r["quando"] else ""))
        return fala, nota

    def criar(self, tipo, texto, quando, agora=None):
        with self.trava:
            self.seq += 1
            n = {"id": self.seq, "tipo": tipo, "texto": texto, "criado": agora.timestamp() if agora else time.time(),
                 "quando": quando.timestamp() if quando else None, "disparado": False, "feito": False}
            self.notas.append(n)
            self._salvar()
        qtxt = quando_falado(quando) if quando else ""
        self._evento(tipo=tipo, texto=texto, quando_txt=qtxt, id=n["id"])
        notificar("Cadu anotou" + (" · " + qtxt if qtxt else ""), texto)
        self.abrir_postit(n)
        self.log("[agenda] %s #%d: %s %s" % (tipo, n["id"], texto, qtxt))
        return n

    def feito(self, nid):
        with self.trava:
            for n in self.notas:
                if n["id"] == nid:
                    n["feito"] = True
            self._salvar()
        p = self.postits.pop(nid, None)
        if p and p.poll() is None:
            p.terminate()

    def piscar(self, nid):
        """Pede para o post-it do PC piscar e vir para a frente (abre de novo se tinha sido fechado)."""
        alvo = None
        with self.trava:
            for n in self.notas:
                if n["id"] == nid and not n["feito"]:
                    n["piscar"] = time.time()
                    alvo = n
            self._salvar()
        if alvo:
            self.abrir_postit(alvo, 0)
        return bool(alvo)

    def adiar(self, nid, minutos=10):
        with self.trava:
            for n in self.notas:
                if n["id"] == nid:
                    n["quando"] = time.time() + minutos * 60
                    n["disparado"] = False
                    if n["tipo"] == "nota":
                        n["tipo"] = "lembrete"
            self._salvar()

    def lista(self):
        with self.trava:
            pend = [n for n in self.notas if not n["feito"]]
        return [dict(n, quando_txt=quando_falado(datetime.fromtimestamp(n["quando"])) if n["quando"] else "") for n in pend]

    # ------------------------------------------------ post-its
    def abrir_postit(self, n, idx=None):
        if os.name != "nt" or n["feito"]:
            return
        if n["id"] in self.postits and self.postits[n["id"]].poll() is None:
            return
        exe = sys.executable.replace("python.exe", "pythonw.exe")
        pos = idx if idx is not None else len([p for p in self.postits.values() if p.poll() is None])
        try:
            self.postits[n["id"]] = subprocess.Popen([exe, str(PASTA / "postit.py"), str(n["id"]), str(pos)], creationflags=SEM_JANELA,
                                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            self.log("[agenda] post-it falhou: %s" % e)

    def reabrir_postits(self):
        pend = [n for n in self.notas if not n["feito"] and not (n["quando"] and not n["disparado"] and n["quando"] - time.time() > 86400 * 7)]
        for i, n in enumerate(pend[-8:]):
            self.abrir_postit(n, i)

    # ------------------------------------------------ relógio dos lembretes
    def rodar(self):
        self.reabrir_postits()
        while True:
            agora = time.time()
            vencidas = []
            with self.trava:
                for n in self.notas:
                    if n["quando"] and not n["disparado"] and not n["feito"] and n["quando"] <= agora:
                        n["disparado"] = True
                        vencidas.append(n)
                if vencidas:
                    self._salvar()
            for n in vencidas:
                atraso = agora - n["quando"]
                if atraso > 6 * 3600:   # PC estava desligado: avisa, mas sem alarde
                    notificar("Lembrete atrasado", n["texto"])
                    continue
                self.log("[agenda] LEMBRETE #%d: %s" % (n["id"], n["texto"]))
                notificar("⏰ Lembrete do Cadu", n["texto"])
                self._evento(tipo="disparo", texto=n["texto"], id=n["id"])
                self.piscar(n["id"])
                if self.falar_no_celular:
                    self.falar_no_celular("Felipe, lembrete: " + n["texto"])
            time.sleep(10)
