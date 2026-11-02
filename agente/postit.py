"""Post-it do Cadu na área de trabalho (uma janelinha por anotação).  Uso: pythonw postit.py <id> <posição>"""
import json
import sys
import tkinter as tk
import urllib.request
from datetime import datetime
from pathlib import Path

PASTA = Path(__file__).resolve().parent
nid, pos = int(sys.argv[1]), int(sys.argv[2]) if len(sys.argv) > 2 else 0
try:
    nota = next(n for n in json.loads((PASTA / "notas.json").read_text(encoding="utf-8")) if n["id"] == nid)
except Exception:
    sys.exit(0)
try:
    porta = json.loads((PASTA / "config.json").read_text(encoding="utf-8")).get("porta", 8765)
except Exception:
    porta = 8765

alarme = bool(nota.get("disparado"))
COR = "#ffd166" if not alarme else "#ff8fa3"
raiz = tk.Tk()
raiz.overrideredirect(True)
raiz.attributes("-topmost", True)
W, H = 270, 160
x = raiz.winfo_screenwidth() - W - 24 - (pos // 4) * (W + 14)
y = 40 + (pos % 4) * (H + 14)
raiz.geometry("%dx%d+%d+%d" % (W, H, x, y))
raiz.configure(bg=COR)

topo = tk.Frame(raiz, bg="#e9b949" if not alarme else "#ef476f", height=26)
topo.pack(fill="x")
quando = ""
if nota.get("quando"):
    q = datetime.fromtimestamp(nota["quando"])
    quando = q.strftime("⏰ %d/%m %H:%M")
tk.Label(topo, text=(quando or "📝 nota") + "  · Cadu", bg=topo["bg"], fg="#2b2142", font=("Segoe UI", 9, "bold")).pack(side="left", padx=8)


def feito():
    try:
        req = urllib.request.Request("http://127.0.0.1:%d/api/notas/feito" % porta, data=json.dumps({"id": nid}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=3).read()
    except Exception:
        pass
    raiz.destroy()


tk.Button(topo, text="✕", command=raiz.destroy, bg=topo["bg"], fg="#2b2142", bd=0, font=("Segoe UI", 9, "bold"), cursor="hand2").pack(side="right", padx=4)
tk.Button(topo, text="✔ feito", command=feito, bg=topo["bg"], fg="#2b2142", bd=0, font=("Segoe UI", 9, "bold"), cursor="hand2").pack(side="right")
tk.Label(raiz, text=nota["texto"], bg=COR, fg="#2b2142", font=("Segoe UI", 12), wraplength=W - 24, justify="left").pack(fill="both", expand=True, padx=12, pady=8)

# arrastar pela barra de cima
arr = {}
topo.bind("<Button-1>", lambda e: arr.update(x=e.x, y=e.y))
topo.bind("<B1-Motion>", lambda e: raiz.geometry("+%d+%d" % (raiz.winfo_x() + e.x - arr["x"], raiz.winfo_y() + e.y - arr["y"])))

if alarme:  # pisca para chamar atenção
    def piscar(i=0):
        raiz.configure(bg=COR if i % 2 else "#ffffff")
        if i < 20:
            raiz.after(400, piscar, i + 1)
    piscar()
raiz.mainloop()
