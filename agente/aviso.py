"""Aviso rápido do Cadu no canto inferior direito da tela (some sozinho).  Uso: pythonw aviso.py "título" "texto" [segundos]"""
import sys
import tkinter as tk

titulo = sys.argv[1] if len(sys.argv) > 1 else "Cadu"
texto = sys.argv[2] if len(sys.argv) > 2 else ""
segundos = int(sys.argv[3]) if len(sys.argv) > 3 else 15
try:
    import winsound
    winsound.MessageBeep(winsound.MB_ICONASTERISK)
except Exception:
    pass
r = tk.Tk()
r.overrideredirect(True)
r.attributes("-topmost", True)
W, H = 340, 110
r.geometry("%dx%d+%d+%d" % (W, H, r.winfo_screenwidth() - W - 20, r.winfo_screenheight() - H - 70))
r.configure(bg="#1d2540")
tk.Label(r, text="● " + titulo, bg="#1d2540", fg="#ffd166", font=("Bahnschrift SemiBold", 11), anchor="w").pack(fill="x", padx=12, pady=(10, 2))
tk.Label(r, text=texto, bg="#1d2540", fg="#f1f2f6", font=("Bahnschrift", 10), wraplength=W - 24, justify="left", anchor="w").pack(fill="both", expand=True, padx=12)
r.bind("<Button-1>", lambda e: r.destroy())
r.after(segundos * 1000, r.destroy)
r.mainloop()
