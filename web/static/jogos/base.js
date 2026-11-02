/* Arcabouço comum dos jogos do Cadu: moldura, placar, recorde, piloto automático e conversa com a tela principal. ES5. */
var Jogo = (function () {
  "use strict";
  var opc, ultimoToque = Date.now(), AUTO_APOS = 8000, auto = false, pts = 0, recorde = 0, timerBot = null, falaT = null;
  var q = {}; location.search.replace(/[?&]([^=&]+)=([^&]*)/g, function (m, k, v) { q[k] = decodeURIComponent(v); });
  var CORES = { bolinha: ["#ffc857", "#fff1cf", "#6abf69"], ursinho: ["#c98f5e", "#f6e1c6", "#8a5a3b"], mochi: ["#fff4ea", "#ffffff", "#ffb3c1"] };
  function $(id) { return document.getElementById(id); }
  function avisarPai(m) { try { if (window.parent !== window) window.parent.postMessage(m, "*"); } catch (e) {} }
  function guardar(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function avatarSVG(estilo) {
    var c = CORES[estilo] || CORES.bolinha, extra = "";
    if (estilo === "ursinho") extra = '<circle cx="14" cy="14" r="7" fill="' + c[0] + '"/><circle cx="50" cy="14" r="7" fill="' + c[0] + '"/><circle cx="14" cy="14" r="4" fill="#f2a7a0"/><circle cx="50" cy="14" r="4" fill="#f2a7a0"/>';
    else if (estilo === "mochi") extra = '<path d="M10 22 L14 4 L26 14Z" fill="' + c[0] + '"/><path d="M54 22 L50 4 L38 14Z" fill="' + c[0] + '"/><path d="M13 17 L15 9 L21 14Z" fill="#ffb3c1"/><path d="M51 17 L49 9 L43 14Z" fill="#ffb3c1"/>';
    else extra = '<path d="M32 10 L32 3" stroke="#3a7d44" stroke-width="2"/><ellipse cx="26" cy="4" rx="6" ry="2.6" fill="#6abf69"/><ellipse cx="38" cy="4" rx="6" ry="2.6" fill="#81c784"/>';
    var focinho = estilo === "ursinho" ? '<ellipse cx="32" cy="40" rx="8" ry="6" fill="' + c[1] + '"/><ellipse cx="32" cy="37.5" rx="3" ry="2.2" fill="#3b2418"/>' : "";
    return '<svg viewBox="0 0 64 64" width="100%" height="100%">' + extra +
      '<ellipse cx="32" cy="58" rx="16" ry="3" fill="rgba(0,0,0,.35)"/>' +
      '<ellipse cx="32" cy="36" rx="24" ry="22" fill="' + c[0] + '"/>' +
      '<ellipse cx="32" cy="46" rx="14" ry="9" fill="' + c[1] + '"/>' + focinho +
      '<ellipse cx="23" cy="32" rx="3.4" ry="4.4" fill="#2b1d14"/><ellipse cx="41" cy="32" rx="3.4" ry="4.4" fill="#2b1d14"/>' +
      '<circle cx="24.2" cy="30.4" r="1.3" fill="#fff"/><circle cx="42.2" cy="30.4" r="1.3" fill="#fff"/>' +
      '<ellipse cx="15" cy="39" rx="4" ry="2.2" fill="#ff8fa3" opacity=".7"/><ellipse cx="49" cy="39" rx="4" ry="2.2" fill="#ff8fa3" opacity=".7"/>' +
      '<path d="M28.5 42 Q30 44 32 42 Q34 44 35.5 42" stroke="#2b1d14" stroke-width="1.4" fill="none"/>' +
      '<ellipse cx="20" cy="56" rx="6" ry="3" fill="' + (CORES[estilo] || CORES.bolinha)[2] + '"/><ellipse cx="44" cy="56" rx="6" ry="3" fill="' + (CORES[estilo] || CORES.bolinha)[2] + '"/></svg>';
  }
  function montar() {
    var lado = document.createElement("div"); lado.id = "lado";
    lado.innerHTML = '<div id="lTopo"><div id="casa" class="caixa"><svg viewBox="0 0 24 24" fill="#06d6a0"><path d="M4 20h16v2H4zm16-10h2v10h-2zM2 10h2v10H2zm2-2h2v2H4zm2-2h2v2H6zm2-2h2v2H8zm2-2h4v2h-4zm4 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zM8 14h2v6H8zm2-2h4v2h-4zm4 2h2v6h-2z"/></svg></div><div id="jTitulo"></div></div>' +
      '<div id="lMeio"><div id="avatar"></div><div id="placar"><div id="pts">0</div><div id="rec"></div></div></div><div id="fala"></div><div id="controles"></div>';
    document.body.appendChild(lado);
    var a = document.createElement("div"); a.id = "auto"; a.className = "caixa"; a.textContent = "AUTO"; document.body.appendChild(a);
    var v = document.createElement("div"); v.id = "aviso"; document.body.appendChild(v);
    $("jTitulo").textContent = opc.nome; $("avatar").innerHTML = avatarSVG(q.estilo);
    $("casa").addEventListener("click", function (e) { e.stopPropagation(); avisarPai({ cadu: "sair" }); });
    var ctl = $("controles");
    (opc.controles || []).forEach(function (c) {
      var b = document.createElement("div"); b.className = "ctl caixa" + (c.larga ? " larga" : ""); b.textContent = c.rotulo;
      function ap(e) { e.preventDefault(); toque(); b.className += " ap"; c.fn(); if (c.repetir) { b._r = setInterval(c.fn, c.repetir); } }
      function solta() { b.className = b.className.replace(/ ap/g, ""); clearInterval(b._r); }
      b.addEventListener("touchstart", ap, false); b.addEventListener("touchend", solta, false); b.addEventListener("touchcancel", solta, false);
      b.addEventListener("mousedown", ap, false); b.addEventListener("mouseup", solta, false); b.addEventListener("mouseleave", solta, false);
      ctl.appendChild(b);
    });
    recorde = parseInt(ler("rec_" + opc.id) || "0", 10) || 0; mostrar();
  }
  function mostrar() { $("pts").textContent = pts; $("rec").textContent = "recorde " + recorde; }
  function toque() {
    ultimoToque = Date.now();
    if (auto) { auto = false; document.body.className = document.body.className.replace(/ ?auto/g, ""); if (opc.aoManual) opc.aoManual(); }
    avisarPai({ cadu: "toque" });
  }
  function laco() {
    var deveria = Date.now() - ultimoToque > AUTO_APOS;
    if (deveria && !auto) { auto = true; document.body.className += " auto"; if (opc.aoAuto) opc.aoAuto(); }
    if (auto && opc.bot) { try { opc.bot(); } catch (e) {} }
  }
  return {
    iniciar: function (o) {
      opc = o; montar();
      ["touchstart", "mousedown", "keydown"].forEach(function (ev) { document.addEventListener(ev, function (e) { if (!e.isTrusted && e.isTrusted !== undefined) return; toque(); }, true); });
      timerBot = setInterval(laco, o.botMs || 120);
      window.addEventListener("message", function (e) { if (e.data && e.data.cadu === "auto") { ultimoToque = 0; } });
    },
    auto: function () { return auto; },
    pontos: function (n) { pts = n; if (pts > recorde) { recorde = pts; guardar("rec_" + opc.id, recorde); } mostrar(); avisarPai({ cadu: "pontos", jogo: opc.id, pontos: n }); },
    recompensa: function (moedas, texto) {
      var av = $("avatar"); av.className = ""; void av.offsetWidth; av.className = "pula";
      avisarPai({ cadu: "recompensa", jogo: opc.id, moedas: moedas || 1 });
      if (texto) this.falar(texto);
    },
    fim: function (texto) { var v = $("aviso"); v.textContent = texto || "FIM DE JOGO"; v.className = "ver"; setTimeout(function () { v.className = ""; }, 2500); avisarPai({ cadu: "fim", jogo: opc.id, pontos: pts, recorde: recorde }); },
    falar: function (t) { var f = $("fala"); f.textContent = t; clearTimeout(falaT); falaT = setTimeout(function () { f.textContent = ""; }, 3500); },
    sortear: function (l) { return l[Math.floor(Math.random() * l.length)]; }
  };
})();
