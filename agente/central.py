"""
Central de post-its do Cadu (uma janela só, sempre por cima).

Três jeitos de ver:
  • bolinha  — um círculo com o número de post-its; arraste para onde quiser, toque para abrir o leque;
  • leque    — os post-its abertos como cartas na mão (a carta sob o mouse sobe); toque numa carta para abri-la;
  • aberto   — uma carta grande com Concluir · +10 min · voltar ao leque · minimizar.

Continua avisando: lembrete que toca (ou toque no post-it pelo celular) abre a carta certa, vem para a frente,
pisca e apita. O botão "minimizar/mostrar no PC" do celular troca entre bolinha e leque.
Uso: pythonw central.py   (o agente abre sozinho; só roda uma central por vez)
"""
import json
import math
import socket
import sys
import time
import tkinter as tk
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

PASTA = Path(__file__).resolve().parent
ARQ_NOTAS = PASTA / "notas.json"
ARQ_ESTADO = PASTA / "postit_estado.json"
try:
    PORTA = json.loads((PASTA / "config.json").read_text(encoding="utf-8-sig")).get("porta", 8765)
except Exception:
    PORTA = 8765

# uma central só: quem conseguir "segurar" esta porta é a central
try:
    _trava = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    _trava.bind(("127.0.0.1", 8769))
    _trava.listen(1)
except OSError:
    sys.exit(0)

TRANSP = "#ff00fe"
FONTE, FORTE = "Bahnschrift", "Bahnschrift SemiBold"
TEMAS = {  # fundo, faixa, texto, detalhe
    "nota": ("#fff4c2", "#ffe58f", "#3d3a2f", "#b58b00"),
    "lembrete": ("#e3f2ff", "#bfe0ff", "#20344a", "#1f6fb5"),
    "alarme": ("#ffe1df", "#ffb8b2", "#4a2020", "#d1453b"),
}
DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]
BOLA = 64                  # diâmetro da bolinha
LW, LH = 700, 430          # janela do leque
CW, CH = 168, 214          # carta no leque
AW, AH = 340, 230          # carta aberta
MAX_LEQUE = 9


# ------------------------------------------------------------------ dados
def ler_notas():
    try:
        notas = json.loads(ARQ_NOTAS.read_text(encoding="utf-8"))
    except Exception:
        return None
    pend = [n for n in notas if not n.get("feito")]
    # alarmes tocando primeiro, depois lembretes pela hora, depois anotações mais novas
    pend.sort(key=lambda n: (0 if n.get("disparado") else (1 if n.get("quando") else 2),
                             n.get("quando") or 0, -(n.get("criado") or 0)))
    return pend


def ler_estado():
    try:
        return json.loads(ARQ_ESTADO.read_text(encoding="utf-8"))
    except Exception:
        return {}


def gravar_estado(**kv):
    e = ler_estado()
    e.update(kv)
    try:
        ARQ_ESTADO.write_text(json.dumps(e), encoding="utf-8")
    except Exception:
        pass


def api(caminho, dados):
    try:
        req = urllib.request.Request("http://127.0.0.1:%d%s" % (PORTA, caminho), data=json.dumps(dados).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=3).read()
        return True
    except Exception:
        return False


def tema(n):
    return TEMAS["alarme" if n.get("disparado") else ("lembrete" if n.get("quando") else "nota")]


def icone(n):
    return "⏰" if n.get("disparado") else ("🔔" if n.get("quando") else "📝")


def quando_txt(n):
    if not n.get("quando"):
        return "Anotação"
    q, hoje = datetime.fromtimestamp(n["quando"]), datetime.now().date()
    if q.date() == hoje:
        dia = "Hoje"
    elif q.date() == hoje + timedelta(days=1):
        dia = "Amanhã"
    else:
        dia = "%s %02d/%02d" % (DIAS[q.weekday()].capitalize(), q.day, q.month)
    return "%s · %s" % (dia, q.strftime("%H:%M"))


# ------------------------------------------------------------------ janela
raiz = tk.Tk()
raiz.overrideredirect(True)
raiz.attributes("-topmost", True)
try:
    raiz.attributes("-transparentcolor", TRANSP)
except tk.TclError:
    pass
cv = tk.Canvas(raiz, bg=TRANSP, highlightthickness=0, bd=0)
cv.pack(fill="both", expand=True)
SW, SH = raiz.winfo_screenwidth(), raiz.winfo_screenheight()

E = {"modo": "bolinha", "notas": [], "aberta": None, "sobre": None, "cartas": [], "botoes": [],
     "ids": None, "piscar": {}, "glob": None, "pulso": 0}
_est = ler_estado()
E["ancora"] = tuple(_est.get("bola") or (SW - BOLA - 24, SH - BOLA - 90))   # canto da bolinha (x, y)


def ret_pontos(x1, y1, x2, y2, r):
    return [x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y2 - r, x2, y2, x2 - r, y2, x1 + r, y2, x1, y2, x1, y2 - r, x1, y1 + r, x1, y1]


def girar(pts, cx, cy, ang):
    c, s = math.cos(ang), math.sin(ang)
    out = []
    for i in range(0, len(pts), 2):
        dx, dy = pts[i] - cx, pts[i + 1] - cy
        out += [cx + dx * c - dy * s, cy + dx * s + dy * c]
    return out


def posicionar(w, h):
    """Abre a janela com o canto inferior direito colado à bolinha (sem sair da tela)."""
    ax, ay = E["ancora"]
    x = min(max(0, ax + BOLA - w), SW - w)
    y = min(max(0, ay + BOLA - h), SH - h)
    raiz.geometry("%dx%d+%d+%d" % (w, h, x, y))
    cv.config(width=w, height=h)
    raiz.update_idletasks()   # a posição nova vale já (o tremor do "chamar atenção" parte dela)


def botao(x, y, rotulo, cor, fn, anchor="e", tam=10):
    t = cv.create_text(x, y, text=rotulo, anchor=anchor, fill=cor, font=(FORTE, tam))
    E["botoes"].append((cv.bbox(t), fn))
    return t


# ------------------------------------------------------------------ desenho
def desenhar():
    cv.delete("all")
    E["botoes"], E["cartas"] = [], []
    if not E["notas"]:
        raiz.withdraw()
        return
    raiz.deiconify()
    {"bolinha": desenhar_bolinha, "leque": desenhar_leque, "aberto": desenhar_aberto}[E["modo"]]()


def desenhar_bolinha():
    posicionar(BOLA + 10, BOLA + 10)
    n = len(E["notas"])
    alarme = any(x.get("disparado") for x in E["notas"])
    p = E["pulso"]
    cor = "#ffb8b2" if alarme else "#ffe58f"
    cv.create_oval(5, 6, BOLA + 6, BOLA + 7, fill="#9a9a9a", outline="")              # sombra
    cv.create_oval(2 - p, 2 - p, BOLA + 2 + p, BOLA + 2 + p, fill=cor, outline="#ffffff", width=2)
    cv.create_text(BOLA // 2 + 2, BOLA // 2 + 3, text="📝", font=(FONTE, 22))
    cv.create_oval(BOLA - 20, 0, BOLA + 6, 26, fill="#d1453b" if alarme else "#1f6fb5", outline="#ffffff", width=2)
    cv.create_text(BOLA - 7, 13, text=str(n) if n < 100 else "99+", fill="#ffffff", font=(FORTE, 10))


def angulos(n):
    if n == 1:
        return [0.0]
    span = min(26.0, 7.0 * (n - 1))
    return [math.radians(-span + 2 * span * i / (n - 1)) for i in range(n)]


def desenhar_leque():
    posicionar(LW, LH)
    mostrar = E["notas"][:MAX_LEQUE]
    px, py, R = LW / 2, LH + 250, 470          # centro do leque (abaixo da janela) e raio
    # barra de cima: contador + minimizar
    cv.create_rectangle(LW - 262, 8, LW - 8, 40, fill="#1e2433", outline="")
    cv.create_text(LW - 248, 24, text="POST-ITS · %d" % len(E["notas"]), anchor="w", fill="#e8eefc", font=(FORTE, 11))
    botao(LW - 20, 23, "—  minimizar", "#ffd166", minimizar, tam=10)
    # a carta sob o mouse é desenhada por último (fica por cima) e sobe um pouco
    ordem = list(range(len(mostrar)))
    if E["sobre"] is not None and E["sobre"] < len(mostrar):
        ordem.remove(E["sobre"])
        ordem.append(E["sobre"])
    angs = angulos(len(mostrar))
    for i in ordem:
        n, a = mostrar[i], angs[i]
        sobe = 34 if i == E["sobre"] else 0
        cx, cy = px + (R + sobe) * math.sin(a), py - (R + sobe) * math.cos(a)
        fundo, faixa, texto, detalhe = tema(n)
        x1, y1, x2, y2 = cx - CW / 2, cy - CH / 2, cx + CW / 2, cy + CH / 2
        sombra = girar(ret_pontos(x1 + 5, y1 + 6, x2 + 5, y2 + 6, 14), cx + 5, cy + 6, a)
        cv.create_polygon(sombra, smooth=True, fill="#8c8c8c", outline="")
        cv.create_polygon(girar(ret_pontos(x1, y1, x2, y2, 14), cx, cy, a), smooth=True, fill=fundo, outline="#ffffff", width=1)
        cv.create_polygon(girar([x1 + 8, y1 + 2, x2 - 8, y1 + 2, x2, y1 + 34, x1, y1 + 34], cx, cy, a), fill=faixa, outline="")
        graus = -math.degrees(a)

        def ponto(dx, dy):
            return girar([cx + dx, cy + dy], cx, cy, a)
        hx, hy = ponto(-CW / 2 + 12, -CH / 2 + 18)
        cv.create_text(hx, hy, text=icone(n) + " " + quando_txt(n), angle=graus, anchor="w", fill=texto, font=(FORTE, 9))
        t = n.get("texto", "")
        t = t if len(t) <= 90 else t[:88] + "…"
        tx, ty = ponto(-CW / 2 + 12, -CH / 2 + 46)
        cv.create_text(tx, ty, text=t, angle=graus, anchor="nw", width=CW - 24, justify="left", fill=texto,
                       font=(FONTE, 12 if len(t) < 40 else 10))
        rx, ry = ponto(-CW / 2 + 12, CH / 2 - 16)
        cv.create_text(rx, ry, text="toque para abrir", angle=graus, anchor="w", fill=detalhe, font=(FONTE, 8))
        E["cartas"].append((i, cx, cy, a))
    if len(E["notas"]) > MAX_LEQUE:
        cv.create_text(LW / 2, LH - 12, text="+%d no celular (aba Post-its)" % (len(E["notas"]) - MAX_LEQUE),
                       fill="#e8eefc", font=(FONTE, 9))


def desenhar_aberto():
    n = E["aberta"]
    posicionar(AW + 8, AH + 8)
    fundo, faixa, texto, detalhe = tema(n)
    for i, c in ((6, "#d6d6d6"), (4, "#c4c4c4"), (2, "#b0b0b0")):
        cv.create_polygon(ret_pontos(i, i, AW + i - 2, AH + i - 2, 16), smooth=True, fill=c, outline="")
    cv.create_polygon(ret_pontos(0, 0, AW, AH, 16), smooth=True, fill=fundo, outline="")
    cv.create_polygon(ret_pontos(0, 0, AW, 40, 16), smooth=True, fill=faixa, outline="")
    cv.create_rectangle(0, 26, AW, 40, fill=faixa, outline="")
    cv.create_text(16, 20, text=icone(n) + "  " + quando_txt(n), anchor="w", fill=texto, font=(FORTE, 10))
    botao(AW - 14, 19, "✕", texto, concluir, tam=11)            # fechar = concluir (sai do celular também)
    botao(AW - 40, 18, "—", texto, minimizar, tam=11)
    botao(AW - 66, 19, "‹ leque", texto, ver_leque, tam=9)
    t = n.get("texto", "")
    cv.create_text(18, 56, text=t, anchor="nw", width=AW - 36, fill=texto,
                   font=(FONTE, 15 if len(t) < 50 else (12 if len(t) < 120 else 10)))
    cv.create_line(16, AH - 42, AW - 16, AH - 42, fill=faixa)
    criado = datetime.fromtimestamp(n.get("criado") or time.time()).strftime("%d/%m %H:%M")
    cv.create_text(18, AH - 21, text=criado + " · Cadu", anchor="w", fill=detalhe, font=(FONTE, 8))
    b = botao(AW - 16, AH - 21, "✓ Concluir", detalhe, concluir)
    if n.get("quando"):
        botao(cv.bbox(b)[0] - 12, AH - 21, "+10 min", detalhe, adiar)
    cv.create_polygon(AW - 22, AH, AW, AH - 22, AW, AH - 16, AW - 16, AH, fill=faixa, outline="")


# ------------------------------------------------------------------ ações
def minimizar():
    E["modo"] = "bolinha"
    api("/api/notas/minimizar", {"min": True}) or gravar_estado(min=True)
    E["glob"] = True
    desenhar()


def ver_leque():
    E["modo"], E["sobre"] = "leque", None
    if E["glob"]:
        api("/api/notas/minimizar", {"min": False}) or gravar_estado(min=False)
        E["glob"] = False
    desenhar()


def abrir(n):
    E["aberta"], E["modo"] = n, "aberto"
    desenhar()


def concluir():
    n = E["aberta"]
    if n:
        api("/api/notas/feito", {"id": n["id"]})
        E["notas"] = [x for x in E["notas"] if x["id"] != n["id"]]
    E["aberta"] = None
    E["modo"] = "leque" if E["notas"] else "bolinha"
    desenhar()


def adiar():
    n = E["aberta"]
    if n:
        api("/api/notas/adiar", {"id": n["id"], "min": 10})
    E["modo"] = "leque"
    desenhar()


def chamar_atencao(i=0):
    """Pisca, sacode e apita (lembrete tocando ou toque no celular)."""
    raiz.deiconify()
    raiz.lift()
    raiz.attributes("-topmost", True)
    if i == 0:
        try:
            import winsound
            winsound.MessageBeep(winsound.MB_ICONASTERISK)
        except Exception:
            pass
    if i < 12:
        try:
            raiz.attributes("-alpha", 0.4 if i % 2 else 1.0)
        except tk.TclError:
            pass
        dx = 5 if i % 4 == 1 else (-5 if i % 4 == 3 else 0)
        raiz.geometry("+%d+%d" % (raiz.winfo_x() + dx, raiz.winfo_y()))
        raiz.after(130, chamar_atencao, i + 1)
    else:
        try:
            raiz.attributes("-alpha", 1.0)
        except tk.TclError:
            pass


def pulsar(i=0):
    """Bolinha "respira" quando chega post-it novo."""
    if E["modo"] != "bolinha":
        E["pulso"] = 0
        return
    E["pulso"] = [0, 3, 5, 3, 0, 3, 5, 3, 0][i] if i < 9 else 0
    desenhar()
    if i < 9:
        raiz.after(90, pulsar, i + 1)


# ------------------------------------------------------------------ mouse
arr = {}


def carta_em(x, y):
    for i, cx, cy, a in reversed(E["cartas"]):          # de cima para baixo
        dx, dy = x - cx, y - cy
        c, s = math.cos(-a), math.sin(-a)
        lx, ly = dx * c - dy * s, dx * s + dy * c
        if abs(lx) <= CW / 2 and abs(ly) <= CH / 2:
            return i
    return None


def apertou(e):
    arr.update(x=e.x, y=e.y, rx=e.x_root, ry=e.y_root, wx=raiz.winfo_x(), wy=raiz.winfo_y(), moveu=False)


def moveu(e):
    if abs(e.x_root - arr.get("rx", 0)) + abs(e.y_root - arr.get("ry", 0)) > 4:
        arr["moveu"] = True
    if arr["moveu"] and E["modo"] in ("bolinha", "aberto"):
        raiz.geometry("+%d+%d" % (arr["wx"] + e.x_root - arr["rx"], arr["wy"] + e.y_root - arr["ry"]))


def soltou(e):
    if arr.get("moveu"):
        if E["modo"] == "bolinha":
            E["ancora"] = (raiz.winfo_x(), raiz.winfo_y())
            gravar_estado(bola=list(E["ancora"]))
        return
    for (x1, y1, x2, y2), fn in E["botoes"]:
        if x1 - 4 <= e.x <= x2 + 4 and y1 - 4 <= e.y <= y2 + 4:
            return fn()
    if E["modo"] == "bolinha":
        return ver_leque()
    if E["modo"] == "leque":
        i = carta_em(e.x, e.y)
        if i is not None:
            return abrir(E["notas"][i])


def passou(e):
    if E["modo"] != "leque":
        return
    i = carta_em(e.x, e.y)
    if i != E["sobre"]:
        E["sobre"] = i
        desenhar()


cv.bind("<Button-1>", apertou)
cv.bind("<B1-Motion>", moveu)
cv.bind("<ButtonRelease-1>", soltou)
cv.bind("<Motion>", passou)
cv.bind("<Leave>", lambda e: passou(type("E", (), {"x": -999, "y": -999})()))


# ------------------------------------------------------------------ vigia do notas.json
def vigiar():
    notas = ler_notas()
    if notas is not None:
        ids = [(n["id"], n.get("texto"), n.get("quando"), n.get("disparado")) for n in notas]
        antes = E["ids"]
        mudou = ids != antes
        E["notas"], E["ids"] = notas, ids
        novos = set(x[0] for x in ids) - set(x[0] for x in (antes or []))
        # quem pede atenção: lembrete que acabou de tocar ou post-it tocado no celular
        chamar = None
        for n in notas:
            pisc = n.get("piscar") or 0
            if pisc > E["piscar"].get(n["id"], 0):
                if antes is not None:
                    chamar = n
                E["piscar"][n["id"]] = pisc
        if E["aberta"]:
            E["aberta"] = next((n for n in notas if n["id"] == E["aberta"]["id"]), None)
            if not E["aberta"] and E["modo"] == "aberto":
                E["modo"] = "leque"
        # minimizar/mostrar pedido pelo celular
        g = bool(ler_estado().get("min"))
        if g != E["glob"]:
            if E["glob"] is not None or g:
                E["modo"] = "bolinha" if g else ("leque" if E["modo"] == "bolinha" else E["modo"])
            E["glob"] = g
            mudou = True
        if chamar:
            abrir(chamar)
            chamar_atencao()
        elif mudou:
            desenhar()
            if novos and antes is not None and E["modo"] == "bolinha":
                pulsar()
    raiz.after(800, vigiar)


E["glob"] = bool(_est.get("min"))
E["modo"] = "bolinha" if E["glob"] else "leque"
vigiar()
raiz.mainloop()
