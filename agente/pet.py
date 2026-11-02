"""
O bichinho Cadu (estilo Tamagotchi, personagem original).

O estado fica no PC (pet.json), então o tempo passa mesmo com o J3 desligado.
Três necessidades de 0 a 100: barriga, alegria e energia.
Ele cresce com a idade (ovo → bebê → criança → adulto) e NUNCA morre:
no máximo fica tristinho e fraco até você cuidar dele.
"""
import json
import threading
import time
from pathlib import Path

ARQ = Path(__file__).resolve().parent / "pet.json"

# quanto cada necessidade muda por hora
ACORDADO = {"barriga": -6.0, "alegria": -5.0, "energia": -4.0}
DORMINDO = {"barriga": -3.0, "alegria": 0.0, "energia": +22.0}
MINIMO = 5.0  # nunca chega a zero


class Pet:
    def __init__(self):
        self.trava = threading.RLock()
        self.e = self._carregar()

    def _carregar(self):
        agora = time.time()
        base = {"nome": "Cadu", "nasceu": agora, "ultimo": agora, "barriga": 80.0, "alegria": 80.0,
                "energia": 90.0, "dormindo": False, "carinhos": 0, "refeicoes": 0, "brincadeiras": 0}
        if ARQ.exists():
            try:
                base.update(json.loads(ARQ.read_text(encoding="utf-8")))
            except Exception:
                pass
        return base

    def _salvar(self):
        tmp = ARQ.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.e, ensure_ascii=False), encoding="utf-8")
        tmp.replace(ARQ)

    def _passar_tempo(self):
        agora = time.time()
        horas = max(0.0, (agora - self.e["ultimo"]) / 3600.0)
        taxas = DORMINDO if self.e["dormindo"] else ACORDADO
        for k, v in taxas.items():
            self.e[k] = max(MINIMO, min(100.0, self.e[k] + v * horas))
        if self.e["dormindo"] and self.e["energia"] >= 100:  # acorda sozinho descansado
            self.e["dormindo"] = False
        if not self.e["dormindo"] and self.e["energia"] <= 12:  # desmaia de sono
            self.e["dormindo"] = True
        self.e["ultimo"] = agora

    def fase(self):
        idade_h = (time.time() - self.e["nasceu"]) / 3600.0
        if idade_h < 0.1:
            return "ovo"
        if idade_h < 24:
            return "bebe"
        if idade_h < 72:
            return "crianca"
        return "adulto"

    def humor(self):
        e = self.e
        if e["dormindo"]:
            return "dormindo"
        pior = min(e["barriga"], e["alegria"], e["energia"])
        if pior < 25:
            return "triste"
        if pior < 50:
            return "ok"
        return "feliz"

    def estado(self):
        with self.trava:
            self._passar_tempo()
            self._salvar()
            d = {k: (round(v) if isinstance(v, float) else v) for k, v in self.e.items()}
            d.update(fase=self.fase(), humor=self.humor(),
                     idade_dias=round((time.time() - self.e["nasceu"]) / 86400.0, 1))
            return d

    def agir(self, acao):
        with self.trava:
            self._passar_tempo()
            e, msg = self.e, ""
            if self.fase() == "ovo" and acao != "carinho":
                msg = "Ainda é um ovo… faça carinho para chocar!"
            elif acao == "carinho":
                e["alegria"] = min(100.0, e["alegria"] + 4)
                e["carinhos"] += 1
                if self.fase() == "ovo":  # carinho ajuda a chocar
                    e["nasceu"] -= 60
                msg = "Ele gostou!"
            elif e["dormindo"] and acao != "acordar":
                msg = "Zzz… ele está dormindo."
            elif acao == "alimentar":
                if e["barriga"] > 95:
                    e["alegria"] = max(MINIMO, e["alegria"] - 2)
                    msg = "Já está cheio!"
                else:
                    e["barriga"] = min(100.0, e["barriga"] + 25)
                    e["refeicoes"] += 1
                    msg = "Nham nham!"
            elif acao == "brincar":
                if e["energia"] < 15:
                    msg = "Está cansado demais para brincar."
                else:
                    e["alegria"] = min(100.0, e["alegria"] + 15)
                    e["energia"] = max(MINIMO, e["energia"] - 10)
                    e["barriga"] = max(MINIMO, e["barriga"] - 5)
                    e["brincadeiras"] += 1
                    msg = "Que divertido!"
            elif acao == "recompensa":   # conquistas nos mundos (estrelas, tesouro, colheita, recorde)
                e["alegria"] = min(100.0, e["alegria"] + 3)
                msg = ""
            elif acao == "dormir":
                e["dormindo"] = True
                msg = "Boa noite…"
            elif acao == "acordar":
                e["dormindo"] = False
                msg = "Bom dia!"
            else:
                msg = "Ação desconhecida."
            self._salvar()
        return msg, self.estado()
