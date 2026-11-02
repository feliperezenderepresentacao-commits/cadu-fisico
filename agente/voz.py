"""
Ouvido do Cadu no PC (Fase 2 — opção B: o celular só repassa o áudio, o PC faz tudo).

O J3 manda o microfone (PCM 16 kHz mono) pela porta 8767. Aqui:
  1. Vosk (offline, leve) fica ouvindo o tempo todo até alguém dizer "Cadu".
  2. Ao ouvir: o celular apita, e gravamos a frase até você parar de falar.
  3. faster-whisper (offline) transcreve a frase em português.
  4. A agenda transforma em post-it / notificação / lembrete, e o Cadu responde em voz alta no celular.
O áudio nunca sai da sua casa. Nada é gravado em disco.

Dependências (instaladas pelo instalar-voz.ps1):  pip install vosk faster-whisper numpy
Modelo do Vosk em agente/modelos/vosk-pt   (o Whisper baixa o dele sozinho na 1ª vez).
"""
import json
import re
import secrets
import socket
import threading
import time
import unicodedata
from collections import deque
from pathlib import Path

PASTA = Path(__file__).resolve().parent
MODELO_VOSK = PASTA / "modelos" / "vosk-pt"
PORTA_VOZ = 8767
TAXA = 16000
# como a palavra "Cadu" costuma sair na transcrição
CHAMADOS = re.compile(r"\b(cadu|cadú|kadu|kadú|cádu|cadum|cadus|ca du|cad u|cadê|cade|caju)\b")


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower()


def parece_chamado(texto_vosk):
    """Filtro rápido no texto do Vosk (que escreve "Cadu" errado): primeira ou segunda palavra
    parecida com "cadu", ou um pedido de lembrete. Quem confirma de verdade é o Whisper."""
    p = sem_acento(texto_vosk).split()
    if re.search(r"\b(lembr|lembrete|anota)", " ".join(p)):
        return True
    for w in p[:2]:
        if re.match(r"^(c|k)a[dtjsu][a-z]{0,3}$", w) or w in ("dor", "du", "cadu", "kadu"):
            return True
    return False


def tem_chamado(texto, so_no_comeco=False):
    t = (texto or "").lower()
    if so_no_comeco:
        t = " ".join(re.sub(r"[^\wáéíóúâêôãõç ]", " ", t).split()[:3])
    return bool(CHAMADOS.search(t))


class Ouvido:
    def __init__(self, agenda, cfg_fn, token, log=print):
        self.agenda, self.cfg_fn, self.token, self.log = agenda, cfg_fn, token, log
        self.estado = {"deps": None, "modelos": "carregando", "celular": False, "ouvindo": False, "ultimo": ""}
        self.conexao = None
        self.trava_envio = threading.Lock()
        self.vosk_modelo = None
        self.whisper = None
        self.ocupado = False
        self.espera_ate = 0
        agenda.falar_no_celular = self.falar

    # ------------------------------------------------ modelos
    def carregar(self):
        try:
            import numpy  # noqa: F401
            from vosk import Model, SetLogLevel
            from faster_whisper import WhisperModel
        except Exception as e:
            self.estado.update(deps=False, modelos="faltam programas (rode instalar-voz.ps1)")
            self.log("[voz] dependências não instaladas (%s) — rode instalar-voz.ps1" % e)
            return
        self.estado["deps"] = True
        try:
            SetLogLevel(-1)
            if not MODELO_VOSK.is_dir():
                raise RuntimeError("modelo do Vosk não encontrado em %s" % MODELO_VOSK)
            self.vosk_modelo = Model(str(MODELO_VOSK))
            conf = (self.cfg_fn().get("voz") or {})
            nome = conf.get("modelo_whisper", "small")
            self.log("[voz] carregando Whisper '%s' (na 1ª vez baixa ~0,5 GB)…" % nome)
            self.whisper = WhisperModel(nome, device="cpu", compute_type="int8")
            self.estado["modelos"] = "ok"
            self.log("[voz] pronto: diga \"Cadu\" perto do celular.")
        except Exception as e:
            self.estado["modelos"] = "erro: %s" % e
            self.log("[voz] erro ao carregar modelos: %s" % e)

    # ------------------------------------------------ rede
    def servir(self):
        threading.Thread(target=self.carregar, daemon=True).start()
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("0.0.0.0", PORTA_VOZ))
        srv.listen(2)
        self.log("[voz] ouvido esperando o celular na porta %d" % PORTA_VOZ)
        while True:
            c, end = srv.accept()
            threading.Thread(target=self.atender, args=(c, end), daemon=True).start()

    def atender(self, c, end):
        try:
            c.settimeout(10)
            cab = b""
            while not cab.endswith(b"\n") and len(cab) < 200:
                b = c.recv(1)
                if not b:
                    return
                cab += b
            partes = cab.decode("utf-8", "ignore").split()
            local = end[0] in ("127.0.0.1", "::1")
            if len(partes) < 2 or partes[0] != "CADU-AUDIO" or not (local or secrets.compare_digest(partes[1], self.token)):
                self.log("[voz] celular %s recusado (token errado — pareie pelo cabo de novo)" % end[0])
                c.close()
                return
            antiga, self.conexao = self.conexao, c
            if antiga:
                try:
                    antiga.close()
                except Exception:
                    pass
            self.estado["celular"] = True
            self.log("[voz] celular conectado (%s)" % ("cabo" if local else "wi-fi"))
            c.settimeout(30)
            self.escutar(c)
        except Exception as e:
            self.log("[voz] conexão caiu: %s" % e)
        finally:
            if self.conexao is c:
                self.conexao = None
                self.estado["celular"] = False
            try:
                c.close()
            except Exception:
                pass

    def enviar(self, linha):
        c = self.conexao
        if not c:
            return False
        with self.trava_envio:
            try:
                c.sendall((linha.replace("\n", " ") + "\n").encode("utf-8"))
                return True
            except Exception:
                return False

    def falar(self, texto):
        return self.enviar("FALA " + texto)

    # ------------------------------------------------ escuta contínua
    def escutar(self, c):
        """Ouve frase por frase (o Vosk corta nas pausas). Se a frase parece começar com "Cadu"
        (o Vosk costuma escrever "casou", "cadê", "dor"…), o Whisper confere e transcreve direito.
        Dois jeitos de falar:  "Cadu, me lembra…" (tudo junto)  ou  "Cadu" … (apito) … "me lembra…"."""
        import numpy as np
        from vosk import KaldiRecognizer
        rec = None
        frase = []                       # áudio da frase atual (desde a última pausa)
        anterior = deque(maxlen=8)       # ~0,5 s antes da frase, para não cortar o começo
        nivel_soma, nivel_n, nivel_t = 0.0, 0, time.time()
        depurar = (self.cfg_fn().get("voz") or {}).get("depurar", True)
        resto = b""
        while True:
            dados = c.recv(4096)
            if not dados:
                return
            dados = resto + dados
            n = len(dados) // 2048 * 2048
            resto = dados[n:]
            for i in range(0, n, 2048):
                bloco = dados[i:i + 2048]
                a = np.frombuffer(bloco, dtype=np.int16).astype(np.float32)
                nivel_soma += float(np.sqrt(np.mean(a * a))) if len(a) else 0.0
                nivel_n += 1
                if depurar and time.time() - nivel_t > 60:
                    self.log("[voz] microfone: nível médio %d" % (nivel_soma / max(1, nivel_n)))
                    nivel_soma, nivel_n, nivel_t = 0.0, 0, time.time()
                if self.vosk_modelo is None or self.whisper is None:
                    continue
                if rec is None:
                    rec = KaldiRecognizer(self.vosk_modelo, TAXA)
                if not frase:
                    frase.extend(anterior)
                frase.append(bloco)
                if len(frase) > int(20 * TAXA / 1024):   # frase longa demais: recomeça
                    frase = frase[-int(10 * TAXA / 1024):]
                if not rec.AcceptWaveform(bloco):
                    continue
                texto = json.loads(rec.Result()).get("text", "")
                audio, frase = b"".join(frase), []
                anterior.clear()
                anterior.extend([bloco])
                if not texto:
                    continue
                if depurar:
                    self.log("[voz] vosk ouviu: %s" % texto)
                esperando = time.time() < self.espera_ate
                if self.ocupado:
                    continue
                if esperando or parece_chamado(texto):
                    threading.Thread(target=self.entender, args=(audio, esperando), daemon=True).start()

    def entender(self, audio, ja_chamado=False):
        import numpy as np
        self.ocupado = True
        try:
            sinal = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768.0
            segs, _ = self.whisper.transcribe(sinal, language="pt", beam_size=1, vad_filter=False,
                                              initial_prompt="Conversa com o Cadu.")
            texto = " ".join(s.text.strip() for s in segs).strip()
            self.log("[voz] ouvi: %r" % texto)
            if not texto:
                return
            if not ja_chamado:
                pedido = re.match(r"^\W*(me lembr|lembr|anot|cria um lembrete|lembrete)", sem_acento(texto))
                if not tem_chamado(texto, so_no_comeco=True) and not pedido:
                    return                      # não era com o Cadu: ignora quieto
                resto = re.sub(r"[^\w ]", " ", texto).split()
                if len(resto) <= 2:             # disse só "Cadu": apita e espera a frase
                    self.espera_ate = time.time() + 8
                    self.estado["ouvindo"] = True
                    self.enviar("BIP")
                    return
            self.espera_ate = 0
            self.estado["ouvindo"] = False
            self.estado["ultimo"] = texto
            fala, _nota = self.agenda.processar(texto if not ja_chamado else "Cadu, " + texto)
            self.enviar("OK " + fala)
            self.falar(fala)
        except Exception as e:
            self.log("[voz] erro ao entender: %s" % e)
            self.enviar("ERRO")
        finally:
            self.ocupado = False
            if time.time() >= self.espera_ate:
                self.estado["ouvindo"] = False

    def gravacao_offline(self, pcm, ts):
        """Áudio gravado no celular quando o PC estava fora (botão 🎤). Não precisa dizer "Cadu"."""
        import numpy as np
        from datetime import datetime
        if self.whisper is None:
            self.log("[voz] gravação offline recebida, mas o Whisper não está pronto")
            return False
        try:
            sinal = np.frombuffer(pcm[:len(pcm) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768.0
            segs, _ = self.whisper.transcribe(sinal, language="pt", beam_size=1, vad_filter=True,
                                              initial_prompt="Anotação para o Cadu.")
            texto = " ".join(x.text.strip() for x in segs).strip()
            quando = datetime.fromtimestamp(ts) if ts else None
            self.log("[voz] gravação offline (%s): %r" % (quando.strftime("%d/%m %H:%M") if quando else "?", texto))
            if not texto:
                return True
            self.agenda.processar("Cadu, " + texto, quando)
            return True
        except Exception as e:
            self.log("[voz] erro na gravação offline: %s" % e)
            return False
