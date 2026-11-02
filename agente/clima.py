"""Clima da cidade (Open-Meteo: gratuito, sem chave). Cache de 20 minutos."""
import json
import time
import urllib.request

CODIGOS = {0: ("céu limpo", "sol"), 1: ("poucas nuvens", "sol"), 2: ("parcialmente nublado", "nuvem"), 3: ("nublado", "nuvem"),
           45: ("neblina", "nuvem"), 48: ("neblina", "nuvem"), 51: ("garoa", "chuva"), 53: ("garoa", "chuva"), 55: ("garoa forte", "chuva"),
           61: ("chuva fraca", "chuva"), 63: ("chuva", "chuva"), 65: ("chuva forte", "chuva"), 80: ("pancadas de chuva", "chuva"),
           81: ("pancadas de chuva", "chuva"), 82: ("temporal", "chuva"), 95: ("trovoadas", "raio"), 96: ("trovoadas com granizo", "raio"),
           99: ("trovoadas com granizo", "raio")}
_cache = {"t": 0, "dados": None}


def obter(cfg):
    c = dict({"nome": "Goiânia", "lat": -16.68, "lon": -49.25}, **((cfg or {}).get("cidade") or {}))
    if time.time() - _cache["t"] < 1200 and _cache["dados"]:
        return _cache["dados"]
    url = ("https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s&current=temperature_2m,weather_code"
           "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=America%%2FSao_Paulo&forecast_days=1"
           % (c["lat"], c["lon"]))
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cadu-fisico"}), timeout=8) as r:
            d = json.loads(r.read().decode("utf-8"))
        cod = int(d["current"]["weather_code"])
        texto, icone = CODIGOS.get(cod, ("tempo variável", "nuvem"))
        dados = {"cidade": c["nome"], "temp": round(d["current"]["temperature_2m"]), "max": round(d["daily"]["temperature_2m_max"][0]),
                 "min": round(d["daily"]["temperature_2m_min"][0]), "chuva": int(d["daily"]["precipitation_probability_max"][0] or 0),
                 "texto": texto, "icone": icone}
        _cache.update(t=time.time(), dados=dados)
        return dados
    except Exception:
        return _cache["dados"]   # sem internet: usa o último que deu certo (ou None)


def frase(d):
    if not d:
        return "Não consegui ver o clima agora."
    f = "Em %s, %d graus, %s. Máxima de %d, mínima de %d." % (d["cidade"], d["temp"], d["texto"], d["max"], d["min"])
    if d["chuva"] >= 40:
        f += " Chance de chuva de %d por cento, leve o guarda-chuva." % d["chuva"]
    return f
