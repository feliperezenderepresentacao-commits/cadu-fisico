"""
Post-it do Cadu na área de trabalho do PC (uma janelinha por anotação).
Uso: pythonw postit.py <id> <posição>

- Cartão com cantos arredondados, sombra e dobrinha, sempre por cima das janelas.
- Arraste por qualquer parte. Botões: Concluir · Adiar 10 min (lembretes) · ×.
- Fica olhando o notas.json: se você tocar no post-it pelo celular ele pisca e vem para a frente;
  se concluir pelo celular, ele some sozinho.
"""
import json
import sys
import time
import tkinter as tk
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

PASTA = Path(__file__).resolve().parent
NID = int(sys.argv[1])
POS = int(sys.argv[2]) if len(sys.argv) > 2 else 0
try:
    PORTA = json.loads((PASTA / "config.json").read_text(encoding="utf-8")).get("porta", 8765)
except Exception:
    PORTA = 8765

W, H, R, SOMBRA = 300, 196, 16, 6
TRANSP = "#ff00fe"
TEMAS = {  # fundo, faixa do topo, texto, detalhe
    "nota": ("#fff4c2", "#ffe58f", "#3d3a2f", "#b58b00"),
    "lembrete": ("#e3f2ff", "#bfe0ff", "#20344a", "#1f6fb5"),
    "alarme": ("#ffe1df", "#ffb8b2", "#4a2020", "#d1453b"),
}
DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]


def ler_nota():
    try:
        for n in json.loads((PASTA / "notas.json").read_text(encoding="utf-8")):
            if n["id"] == NID:
                return n
    except Exception:
        return None
    return None


def api(caminho, dados):
    try:
        req = urllib.request.Request("http://127.0.0.1:%d%s" % (PORTA, caminho), data=json.dumps(dados).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=3).read()
        return True
    except Exception:
        return False


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


nota = ler_nota()
if not nota or nota.get("feito"):
    sys.exit(0)

raiz = tk.Tk()
raiz.overrideredirect(True)
raiz.attributes("-topmost", True)
try:
    raiz.attributes("-transparentcolor", TRANSP)
    raiz.attributes("-alpha", 0.0)
except tk.TclError:
    pass
x0 = raiz.winfo_screenwidth() - W - 28 - (POS // 4) * (W + 10)
y0 = 30 + (POS % 4) * (H + 8)
raiz.geometry("%dx%d+%d+%d" % (W + SOMBRA, H + SOMBRA, x0, y0))
cv = tk.Canvas(raiz, width=W + SOMBRA, height=H + SOMBRA, bg=TRANSP, highlightthickness=0, bd=0)
cv.pack()


def ret_arredondado(x1, y1, x2, y2, r, **kw):
    p = [x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y2 - r, x2, y2, x2 - r, y2, x1 + r, y2, x1, y2, x1, y2 - r, x1, y1 + r, x1, y1]
    return cv.create_polygon(p, smooth=True, **kw)


estado = {"piscar": nota.get("piscar") or 0, "assinatura": None, "botoes": {}}


def desenhar():
    n = estado["nota"]
    tema = TEMAS["alarme" if n.get("disparado") else ("lembrete" if n.get("quando") else "nota")]
    fundo, faixa, texto, detalhe = tema
    cv.delete("all")
    estado["botoes"] = {}
    # sombra em camadas (suave)
    for i, a in ((6, "#d6d6d6"), (4, "#c4c4c4"), (2, "#b0b0b0")):
        ret_arredondado(i, i, W + i - 2, H + i - 2, R, fill=a, outline="")
    ret_arredondado(0, 0, W, H, R, fill=fundo, outline="")
    # faixa do topo
    ret_arredondado(0, 0, W, 38, R, fill=faixa, outline="")
    cv.create_rectangle(0, 24, W, 38, fill=faixa, outline="")
    icone = "⏰" if n.get("disparado") else ("🔔" if n.get("quando") else "📝")
    cv.create_text(16, 19, text=icone + "  " + quando_txt(n), anchor="w", fill=texto, font=("Segoe UI Semibold", 10))
    xb = cv.create_text(W - 16, 18, text="✕", anchor="e", fill=texto, font=("Segoe UI", 11))
    estado["botoes"][xb] = fechar
    # texto da anotação
    t = n.get("texto", "")
    tam = 14 if len(t) < 50 else (12 if len(t) < 110 else 10)
    cv.create_text(18, 52, text=t, anchor="nw", width=W - 36, fill=texto, font=("Segoe UI", tam))
    # rodapé
    cv.create_line(16, H - 40, W - 16, H - 40, fill=faixa, width=1)
    criado = datetime.fromtimestamp(n.get("criado", time.time())).strftime("%d/%m %H:%M")
    cv.create_text(18, H - 20, text=criado + " · Cadu", anchor="w", fill=detalhe, font=("Segoe UI", 8))
    bx = W - 16
    b = botao(bx, H - 20, "✓ Concluir", detalhe, concluir)
    bx = cv.bbox(b)[0] - 10
    if n.get("quando"):
        botao(bx, H - 20, "+10 min", detalhe, adiar)
    # dobrinha no canto
    cv.create_polygon(W - 22, H, W, H - 22, W, H - R, W - R, H, fill=faixa, outline="")


def botao(x, y, rotulo, cor, fn):
    t = cv.create_text(x, y, text=rotulo, anchor="e", fill=cor, font=("Segoe UI Semibold", 9))
    estado["botoes"][t] = fn
    cv.tag_bind(t, "<Enter>", lambda e: (cv.itemconfigure(t, font=("Segoe UI Semibold", 9, "underline")), raiz.config(cursor="hand2")))
    cv.tag_bind(t, "<Leave>", lambda e: (cv.itemconfigure(t, font=("Segoe UI Semibold", 9)), raiz.config(cursor="")))
    return t


def fechar():
    sumir()


def concluir():
    api("/api/notas/feito", {"id": NID})
    sumir()


def adiar():
    api("/api/notas/adiar", {"id": NID, "min": 10})


def sumir(passo=10):
    try:
        a = float(raiz.attributes("-alpha"))
    except Exception:
        a = 0
    if a > 0.05 and passo > 0:
        raiz.attributes("-alpha", max(0, a - 0.12))
        raiz.after(25, sumir, passo - 1)
    else:
        raiz.destroy()


def aparecer(a=0.0):
    try:
        raiz.attributes("-alpha", min(0.97, a))
    except Exception:
        return
    if a < 0.97:
        raiz.after(20, aparecer, a + 0.1)


def piscar(i=0):
    """Chama atenção: pisca, sacode de leve e vem para a frente."""
    raiz.lift()
    raiz.attributes("-topmost", True)
    if i == 0:
        try:
            import winsound
            winsound.MessageBeep(winsound.MB_ICONASTERISK)
        except Exception:
            pass
    if i < 12:
        raiz.attributes("-alpha", 0.35 if i % 2 else 0.97)
        dx = (4 if i % 4 == 1 else (-4 if i % 4 == 3 else 0))
        raiz.geometry("+%d+%d" % (raiz.winfo_x() + dx, raiz.winfo_y()))
        raiz.after(140, piscar, i + 1)
    else:
        raiz.attributes("-alpha", 0.97)


# arrastar por qualquer lugar (clique simples nos "botões" executa a ação)
arr = {}


def apertou(e):
    arr.update(x=e.x, y=e.y, moveu=False)


def moveu(e):
    arr["moveu"] = True
    raiz.geometry("+%d+%d" % (raiz.winfo_x() + e.x - arr["x"], raiz.winfo_y() + e.y - arr["y"]))


def soltou(e):
    if arr.get("moveu"):
        return
    for item in cv.find_overlapping(e.x - 2, e.y - 2, e.x + 2, e.y + 2):
        if item in estado["botoes"]:
            estado["botoes"][item]()
            return


cv.bind("<Button-1>", apertou)
cv.bind("<B1-Motion>", moveu)
cv.bind("<ButtonRelease-1>", soltou)


def vigiar():
    """Acompanha o notas.json (celular pode concluir, adiar ou pedir para piscar)."""
    n = ler_nota()
    if not n or n.get("feito"):
        return sumir()
    ass = (n.get("texto"), n.get("quando"), n.get("disparado"))
    if ass != estado["assinatura"]:
        estado["nota"], estado["assinatura"] = n, ass
        desenhar()
    if (n.get("piscar") or 0) > estado["piscar"]:
        estado["piscar"] = n["piscar"]
        piscar()
    raiz.after(800, vigiar)


estado["nota"] = nota
estado["assinatura"] = (nota.get("texto"), nota.get("quando"), nota.get("disparado"))
desenhar()
aparecer()
if nota.get("disparado"):
    raiz.after(400, piscar)
raiz.after(800, vigiar)
raiz.mainloop()
