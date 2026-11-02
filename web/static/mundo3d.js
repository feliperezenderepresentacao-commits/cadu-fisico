/*
 * Mundos 3D do Cadu — v2 (Three.js r149, MIT). Cenários, personagem e sons originais.
 *
 *            ↑ Céu das Estrelas
 *   ← Horta     VILA (centro)     Estrada Elétrica →
 *            ↓ Fundo do Mar
 *
 * - Arrastar o dedo troca de mundo; o gesto contrário (ou a casinha) volta para a Vila.
 * - Toque interage. Sem toque por alguns segundos, o PILOTO AUTOMÁTICO assume: o Cadu vive e joga sozinho.
 * - Opcional: TOUR — passeia sozinho pelos mundos de tempos em tempos.
 * - Render em resolução reduzida e ampliado sem suavizar (visual pixel) para caber na GPU do J3.
 * ES5 no nosso código (WebView do Android 5.1).
 */
var Mundo3D = (function () {
  "use strict";
  var R, cam, cena, cont, opc = {}, ligado = true, ultimo = 0, acum = 0, ESC = 0.6;
  var atual = null, idAtual = "vila", trocando = false, tempo = 0;
  var jogo = { moedas: 0, estrelas: 0, recorde: 0, colheita: 0, bau: 0, horta: [], peixes: 0 };
  var pet = { fase: "bebe", humor: "feliz", dormindo: false, carinhos: 0, barriga: 80, alegria: 80, energia: 80 };
  var doenteFlag = false, raio, ponteiro, salvarT = null;
  var ultimoToque = 0, AUTO_APOS = 8000, autoEstava = null, tour = false, tTour = 0, TOUR_S = 75, somLigado = true;

  // os 4 lados da Vila agora são jogos do GitHub (abertos pela tela principal, em /static/jogos/)
  var JOGOS = { torre: "Torre", pacman: "Come-come", tetris: "Tetris", "2048": "2048" };
  var VIZINHOS = {
    vila: { cima: "torre", baixo: "pacman", esquerda: "tetris", direita: "2048" },
    ceu: { baixo: "vila" }, mar: { cima: "vila" }, horta: { direita: "vila" }, estrada: { esquerda: "vila" }
  };
  var NOMES = { vila: "Vila do Cadu", ceu: "Céu das Estrelas", mar: "Fundo do Mar", horta: "Horta", estrada: "Estrada Elétrica" };
  var ROTA_TOUR = ["torre", "tetris", "2048", "pacman"], iTour = 0;

  // ================================================================== utilidades
  function aleat(a, b) { return a + Math.random() * (b - a); }
  function escolha(l) { return l[Math.floor(Math.random() * l.length)]; }
  function suave(a, b, t) { return a + (b - a) * Math.min(1, t); }
  var matCache = {};
  function mat(cor, extra, tipo) {
    var k = (tipo || "L") + cor + (extra ? JSON.stringify(extra) : "");
    if (!matCache[k]) {
      var p = { color: cor };
      if (tipo !== "B") p.flatShading = !(extra && extra.liso);
      if (extra) for (var e in extra) if (e !== "liso") p[e] = extra[e];
      matCache[k] = tipo === "B" ? new THREE.MeshBasicMaterial(p) : new THREE.MeshLambertMaterial(p);
    }
    return matCache[k];
  }
  function girada(m, x, y, z) { m.rotation.set(x || 0, y || 0, z || 0); return m; }
  function malha(geo, cor, x, y, z, extra, tipo) { var m = new THREE.Mesh(geo, mat(cor, extra, tipo)); m.position.set(x || 0, y || 0, z || 0); return m; }
  function agora() { return Date.now(); }
  function autoAtivo() { return agora() - ultimoToque > AUTO_APOS; }
  function salvarJogo() { clearTimeout(salvarT); salvarT = setTimeout(function () { if (opc.salvar) opc.salvar(jogo); }, 1500); }
  function contador() { if (atual && atual.contador && opc.aoContador) opc.aoContador(atual.contador()); }
  function moeda(n) { jogo.moedas += n || 1; salvarJogo(); contador(); som("moeda"); }
  function falar(t) { if (opc.falar) opc.falar(t); }
  function agir(a) { if (opc.aoAgir) opc.aoAgir(a); }
  function hora() { if (window.horaPC) { var t = window.horaPC(); return t.h + t.m / 60; } return new Date().getHours() + new Date().getMinutes() / 60; }
  function periodo() { var h = hora(); return h >= 6 && h < 17 ? "dia" : (h >= 17 && h < 19 ? "tarde" : "noite"); }

  // ================================================================== sons retrô (gerados, sem arquivos)
  var audio = null;
  function som(tipo) {
    if (!somLigado) return;
    try {
      if (!audio) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; audio = new AC(); }
      if (audio.state === "suspended") audio.resume();
      var t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
      o.connect(g); g.connect(audio.destination);
      var S = {
        moeda: ["square", [988, 1319], [0, 0.07], 0.05, 0.18],
        pulo: ["square", [330, 660], [0, 0.12], 0.04, 0.15],
        plop: ["sine", [520, 220], [0, 0.12], 0.08, 0.14],
        bolha: ["sine", [400, 900], [0, 0.1], 0.05, 0.12],
        bate: ["sawtooth", [160, 50], [0, 0.35], 0.07, 0.4],
        estrela: ["triangle", [880, 1760], [0, 0.18], 0.06, 0.25],
        trocar: ["triangle", [440, 880], [0, 0.15], 0.04, 0.2],
        carinho: ["sine", [660, 990], [0, 0.1], 0.05, 0.16]
      }[tipo];
      if (!S) return;
      o.type = S[0]; o.frequency.setValueAtTime(S[1][0], t); o.frequency.exponentialRampToValueAtTime(S[1][1], t + S[2][1] + 0.01);
      g.gain.setValueAtTime(S[3], t); g.gain.exponentialRampToValueAtTime(0.0001, t + S[4]);
      o.start(t); o.stop(t + S[4] + 0.02);
    } catch (e) { }
  }

  // ================================================================== peças de cenário
  function ruido(x, z) { return Math.sin(x * 0.31) * Math.cos(z * 0.27) * 0.7 + Math.sin(x * 0.83 + z * 0.61) * 0.18 + Math.cos(z * 0.9 - x * 0.4) * 0.12; }
  function cor3(c) { var k = new THREE.Color(c); return [k.r, k.g, k.b]; }
  // céu em degradê (cúpula com cores por vértice)
  function ceuDegrade(topo, horiz, baixo) {
    var g = new THREE.SphereGeometry(95, 18, 12), p = g.attributes.position, cores = [];
    var ct = new THREE.Color(topo), ch = new THREE.Color(horiz), cb = new THREE.Color(baixo || horiz), c = new THREE.Color();
    for (var i = 0; i < p.count; i++) {
      var y = p.getY(i) / 95;
      if (y > 0) c.copy(ch).lerp(ct, Math.pow(y, 0.7)); else c.copy(ch).lerp(cb, Math.min(1, -y * 3));
      cores.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(cores, 3));
    var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -1; return m;
  }
  // terreno low-poly com relevo e cores por altura
  function terreno(tam, seg, altura, corDe) {
    var g = new THREE.PlaneGeometry(tam, tam, seg, seg); g.rotateX(-Math.PI / 2);
    var p = g.attributes.position, cores = [];
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), z = p.getZ(i), y = altura(x, z); p.setY(i, y);
      var c = new THREE.Color(corDe(y, x, z)); c.offsetHSL(0, 0, aleat(-0.03, 0.03)); cores.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(cores, 3));
    g = g.toNonIndexed(); g.computeVertexNormals();
    var m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    m.userData.chao = true; return m;
  }
  // capim: muitas folhinhas numa malha só (1 chamada de desenho)
  function capim(n, raioMax, altura, coresBase, evitar) {
    var pos = [], cores = [], c1 = new THREE.Color(coresBase[0]), c2 = new THREE.Color(coresBase[1]);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * raioMax, x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (evitar && evitar(x, z)) continue;
      var y = altura(x, z), h = aleat(0.18, 0.38), lx = aleat(-0.08, 0.08), lz = aleat(-0.08, 0.08), w = 0.05;
      pos.push(x - w, y, z, x + w, y, z, x + lx, y + h, z + lz);
      cores.push(c1.r, c1.g, c1.b, c1.r, c1.g, c1.b, c2.r, c2.g, c2.b);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(cores, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  }
  function nuvem(x, y, z, s) {
    var g = new THREE.Group(), m = mat(0xffffff, { liso: false });
    var partes = [[0, 0, 0, 1.2], [1.1, -0.2, 0.1, 0.85], [-1.1, -0.25, 0, 0.8], [0.4, 0.5, 0, 0.8], [-0.5, 0.35, 0.2, 0.7]];
    for (var i = 0; i < partes.length; i++) { var b = new THREE.Mesh(new THREE.IcosahedronGeometry(partes[i][3], 1), m); b.position.set(partes[i][0], partes[i][1], partes[i][2]); b.scale.y = 0.7; g.add(b); }
    g.position.set(x, y, z); g.scale.setScalar(s || 1); return g;
  }
  function sombra(r) {
    var m = new THREE.Mesh(new THREE.CircleGeometry(r, 14), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.userData.sombra = true; return m;
  }
  function arvore(x, z, s, tipo, alturaFn) {
    var g = new THREE.Group(), y = alturaFn ? alturaFn(x, z) : 0;
    g.add(malha(new THREE.CylinderGeometry(0.14, 0.24, 1.2, 6), 0x7a4f32, 0, 0.6, 0));
    if (tipo === "pinheiro") {
      g.add(malha(new THREE.ConeGeometry(1.1, 1.6, 7), 0x2d6a4f, 0, 1.6, 0));
      g.add(malha(new THREE.ConeGeometry(0.85, 1.3, 7), 0x40916c, 0, 2.3, 0));
      g.add(malha(new THREE.ConeGeometry(0.55, 1, 7), 0x52b788, 0, 2.9, 0));
    } else {
      g.add(malha(new THREE.IcosahedronGeometry(1, 1), 0x2d6a4f, 0, 1.7, 0));
      g.add(malha(new THREE.IcosahedronGeometry(0.75, 1), 0x40916c, 0.45, 2.2, 0.15));
      g.add(malha(new THREE.IcosahedronGeometry(0.6, 1), 0x52b788, -0.35, 2.4, -0.1));
    }
    var sb = sombra(1.1); g.add(sb);
    g.position.set(x, y, z); g.scale.setScalar(s || 1); g.rotation.y = aleat(0, 6.28); return g;
  }
  function estrelasPontos(n, raio, tamanho) {
    var pos = [];
    for (var i = 0; i < n; i++) { var v = new THREE.Vector3(aleat(-1, 1), aleat(0.05, 1), aleat(-1, 1)).normalize().multiplyScalar(raio); pos.push(v.x, v.y, v.z); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff6dd, size: tamanho || 0.5, sizeAttenuation: true, fog: false, transparent: true }));
  }
  function base(fundo) {
    var c = new THREE.Scene();
    if (fundo) c.background = new THREE.Color(fundo);
    return c;
  }
  function luzes(c, ceuCor, chaoCor, intens, solPos, solCor) {
    var h = new THREE.HemisphereLight(ceuCor || 0xddeeff, chaoCor || 0x556644, intens || 0.75); c.add(h);
    var s = new THREE.DirectionalLight(solCor || 0xfff1d6, 0.85); s.position.copy(solPos || new THREE.Vector3(6, 12, 8)); c.add(s);
    return { hemi: h, sol: s };
  }

  // ================================================================== partículas (pool)
  var parts = [], geoPart;
  function particula(cor, x, y, z, vx, vy, vz, vida, grav, tam) {
    var m = new THREE.Mesh(geoPart, mat(cor, null, "B"));
    m.position.set(x, y, z); m.scale.setScalar(tam || 1); cena.add(m);
    parts.push({ m: m, v: new THREE.Vector3(vx, vy, vz), vida: vida || 1.2, g: grav === undefined ? -5 : grav, ini: vida || 1.2, tam: tam || 1 });
  }
  function explosao(cor, pos, n, forca) { for (var i = 0; i < (n || 10); i++) particula(cor, pos.x, pos.y, pos.z, aleat(-1, 1) * (forca || 2), aleat(1.5, 3.5), aleat(-1, 1) * (forca || 2), aleat(0.5, 1.1)); }
  function coracoes(pos) { for (var i = 0; i < 4; i++) particula(0xff5d8f, pos.x + aleat(-.3, .3), pos.y + 1.2, pos.z + aleat(-.3, .3), aleat(-.3, .3), aleat(1, 1.8), 0, 1.4, 0, 1.6); som("carinho"); }
  function atualizarParticulas(dt) {
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i]; p.vida -= dt;
      if (p.vida <= 0) { cena.remove(p.m); parts.splice(i, 1); continue; }
      p.v.y += p.g * dt; p.m.position.addScaledVector(p.v, dt); p.m.rotation.x += dt * 5; p.m.rotation.y += dt * 3;
      p.m.scale.setScalar(p.tam * Math.min(1, p.vida / p.ini * 1.5));
    }
  }

  // ================================================================== o CADU v3 — bichinho fofo (3 visuais originais)
  var ESTILOS = {
    bolinha: { pele: 0xffc857, barriga: 0xfff1cf, pe: 0xf08a24, orelha: "broto" },
    ursinho: { pele: 0xc98f5e, barriga: 0xf6e1c6, pe: 0x8a5a3b, orelha: "redonda" },
    mochi:   { pele: 0xfff4ea, barriga: 0xffffff, pe: 0xf2b5a7, orelha: "gato" }
  };
  var estiloCadu = "bolinha";
  var TAM_FASE = { ovo: 0.8, bebe: 0.82, crianca: 0.93, adulto: 1.04 };
  function criarCadu() {
    var E = ESTILOS[estiloCadu] || ESTILOS.bolinha;
    var g = new THREE.Group(), corpoG = new THREE.Group(); g.add(corpoG);
    var pele = new THREE.MeshLambertMaterial({ color: E.pele });
    function liso(geo, cor) { return new THREE.Mesh(geo, cor === undefined ? pele : new THREE.MeshLambertMaterial({ color: cor })); }
    var corpo = liso(new THREE.SphereGeometry(0.55, 22, 16)); corpo.position.y = 0.6; corpo.scale.set(1.04, 0.9, 0.96); corpoG.add(corpo);
    var barriga = liso(new THREE.SphereGeometry(0.34, 18, 12), E.barriga); barriga.position.set(0, 0.45, 0.33); barriga.scale.set(1.05, 0.88, 0.5); corpoG.add(barriga);
    // olhos de pontinho (sem branco) com dois brilhos — estilo bichinho virtual
    var olhos = [], preto = new THREE.MeshBasicMaterial({ color: 0x2b1d14 }), branco = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (var s = -1; s <= 1; s += 2) {
      var o = new THREE.Group(); o.position.set(s * 0.2, 0.68, 0.5); o.rotation.y = s * 0.28;
      var olho = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), preto); olho.scale.set(0.85, 1.12, 0.45); o.add(olho);
      var b1 = new THREE.Mesh(new THREE.SphereGeometry(0.027, 6, 5), branco); b1.position.set(0.022, 0.03, 0.03); olho.add(b1);
      var b2 = new THREE.Mesh(new THREE.SphereGeometry(0.013, 5, 4), branco); b2.position.set(-0.02, -0.03, 0.03); olho.add(b2);
      o.userData = { pupila: olho, brilho: b1 }; corpoG.add(o); olhos.push(o);
    }
    var bocaG = new THREE.Group(); bocaG.position.set(0, 0.55, 0.535); corpoG.add(bocaG);
    var sorriso = new THREE.Group();
    for (s = -1; s <= 1; s += 2) { var arco = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.011, 5, 10, Math.PI), preto); arco.rotation.z = Math.PI; arco.position.x = s * 0.032; sorriso.add(arco); } // boquinha "w"
    bocaG.add(sorriso);
    var bocaA = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0x8c2f39 })); bocaA.scale.set(1, 1.15, 0.4); bocaA.visible = false; bocaG.add(bocaA);
    var boch = [];
    for (s = -1; s <= 1; s += 2) { var b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6), new THREE.MeshBasicMaterial({ color: 0xff8fa3, transparent: true, opacity: 0.6 })); b.scale.set(1.3, 0.7, 0.25); b.position.set(s * 0.34, 0.58, 0.44); b.rotation.y = s * 0.6; corpoG.add(b); boch.push(b); }
    // topo da cabeça conforme o visual
    var topo = new THREE.Group(); topo.position.y = 1.08; corpoG.add(topo);
    var halo = new THREE.Mesh(new THREE.SphereGeometry(0.01, 3, 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })); topo.add(halo);
    if (E.orelha === "broto") {
      var haste = liso(new THREE.CylinderGeometry(0.018, 0.024, 0.16, 6), 0x3a7d44); haste.position.y = 0.06; topo.add(haste);
      for (s = -1; s <= 1; s += 2) { var fol = liso(new THREE.SphereGeometry(0.1, 10, 6), s < 0 ? 0x6abf69 : 0x81c784); fol.scale.set(1, 0.32, 0.55); fol.position.set(s * 0.09, 0.15, 0); fol.rotation.z = s * 0.45; topo.add(fol); }
    } else if (E.orelha === "redonda") {
      for (s = -1; s <= 1; s += 2) {
        var ore = liso(new THREE.SphereGeometry(0.15, 12, 10)); ore.scale.set(1, 1, 0.6); ore.position.set(s * 0.33, -0.12, 0); topo.add(ore);
        var dentro = liso(new THREE.SphereGeometry(0.09, 10, 8), 0xf2a7a0); dentro.scale.set(1, 1, 0.4); dentro.position.set(s * 0.33, -0.12, 0.07); topo.add(dentro);
      }
      var focinho = liso(new THREE.SphereGeometry(0.15, 14, 10), E.barriga); focinho.scale.set(1.15, 0.8, 0.55); focinho.position.set(0, 0.56, 0.47); corpoG.add(focinho);
      var nariz = liso(new THREE.SphereGeometry(0.045, 10, 8), 0x3b2418); nariz.scale.set(1.3, 0.9, 0.7); nariz.position.set(0, 0.6, 0.555); corpoG.add(nariz);
      bocaG.position.set(0, 0.515, 0.555);
    } else {
      for (s = -1; s <= 1; s += 2) {
        var cone = liso(new THREE.ConeGeometry(0.19, 0.36, 4)); cone.position.set(s * 0.28, 0.0, 0); cone.rotation.set(0, Math.PI / 4, s * -0.35); topo.add(cone);
        var cin = liso(new THREE.ConeGeometry(0.1, 0.2, 4), 0xffb3c1); cin.position.set(s * 0.275, -0.02, 0.08); cin.rotation.set(0, Math.PI / 4, s * -0.35); topo.add(cin);
      }
      var rabo = liso(new THREE.TorusGeometry(0.16, 0.05, 6, 12, Math.PI * 1.2)); rabo.position.set(0.15, 0.35, -0.55); rabo.rotation.set(0, Math.PI / 2, 0.4); corpoG.add(rabo);
    }
    var bracos = [];
    for (s = -1; s <= 1; s += 2) { var br = new THREE.Group(); br.position.set(s * 0.5, 0.5, 0.12); var mb = liso(new THREE.SphereGeometry(0.1, 10, 8)); mb.scale.set(0.8, 1.1, 0.8); mb.position.y = -0.05; br.add(mb); corpoG.add(br); bracos.push(br); }
    var pes = [];
    for (s = -1; s <= 1; s += 2) { var pe = liso(new THREE.SphereGeometry(0.13, 12, 8), E.pe); pe.scale.set(1, 0.55, 1.25); pe.position.set(s * 0.22, 0.07, 0.12); g.add(pe); pes.push(pe); }
    var exc = new THREE.Group();
    exc.add(malha(new THREE.BoxGeometry(0.11, 0.32, 0.11), 0xffd166, 0, 2.05, 0, null, "B")); exc.add(malha(new THREE.BoxGeometry(0.11, 0.11, 0.11), 0xffd166, 0, 1.78, 0, null, "B"));
    exc.visible = false; g.add(exc);
    g.add(sombra(0.5));
    g.userData = { corpoG: corpoG, corpo: corpo, pele: pele, corBase: new THREE.Color(E.pele), olhos: olhos, sorriso: sorriso, bocaA: bocaA, boch: boch, bracos: bracos, pes: pes, exc: exc,
      halo: halo, topo: topo, pulo: 0, vy: 0, alt: 0, squash: 0, surpresa: 0, andando: false, vel: 0, piscar: 2, olhando: null,
      acenar: 0, comendo: 0, sentado: false, dormindo: false, alvo: null, aoChegar: null, chao: null };
    return g;
  }
  var COR_DOENTE = new THREE.Color(0xb5c96b);
  function g0(c, tf) { var k = c.userData.escBase || (c.userData.escBase = c.scale.x); c.scale.setScalar(k * tf); }
  function pular(c, forca) { var u = c.userData; if (u.alt <= 0.01) { u.vy = forca || 4.2; u.squash = -0.25; som("pulo"); } }
  function animarCadu(c, dt) {
    var u = c.userData, dorme = u.dormindo, cg = u.corpoG;
    // física do pulo + squash & stretch
    if (u.alt > 0 || u.vy > 0) { u.vy -= 14 * dt; u.alt += u.vy * dt; if (u.alt <= 0) { u.alt = 0; u.vy = 0; u.squash = 0.3; } }
    u.squash = suave(u.squash, 0, dt * 8);
    var resp = dorme ? Math.sin(tempo * 1.6) * 0.04 : Math.sin(tempo * 2.4) * 0.02;
    var passo = u.andando ? Math.abs(Math.sin(tempo * 13)) * 0.12 : 0;
    var sy = 1 - u.squash + resp + (u.vy > 0 ? 0.12 : 0), sxz = 1 + u.squash * 0.6 - resp * 0.5;
    if (u.sentado) { sy *= 0.85; sxz *= 1.08; }
    var tf = TAM_FASE[pet.fase] || 1; g0(c, tf);
    cg.scale.set(sxz, sy, sxz); cg.position.y = u.alt + passo;
    for (var i = 0; i < 2; i++) {
      u.pes[i].position.y = 0.07 + u.alt + (u.andando ? Math.max(0, Math.sin(tempo * 13 + i * Math.PI)) * 0.14 : 0);
      u.pes[i].position.z = 0.08 + (u.andando ? Math.sin(tempo * 13 + i * Math.PI) * 0.12 : 0);
      var br = u.bracos[i], s = i ? 1 : -1;
      if (u.acenar > 0 && i === 1) br.rotation.z = 2.4 + Math.sin(tempo * 14) * 0.4;
      else if (u.andando) br.rotation.z = s * 0.2 + Math.sin(tempo * 13 + i * Math.PI) * 0.35;
      else br.rotation.z = s * (0.15 + Math.sin(tempo * 2) * 0.05) + (u.vy > 0 ? -s * 0.9 : 0);
    }
    u.acenar = Math.max(0, u.acenar - dt);
    // piscar e olhar
    u.piscar -= dt; var fech = 1;
    if (u.piscar < 0) { fech = 0.1; if (u.piscar < -0.12) u.piscar = aleat(1.8, 4.5); }
    if (dorme) fech = 0.08;
    var surpreso = u.surpresa > 0; u.surpresa = Math.max(0, u.surpresa - dt);
    var px = 0, py = -0.01;
    if (u.olhando) {
      var local = c.worldToLocal(u.olhando.clone()); px = Math.max(-0.05, Math.min(0.05, local.x * 0.03)); py = Math.max(-0.04, Math.min(0.04, (local.y - 0.7) * 0.03));
    }
    for (i = 0; i < 2; i++) {
      var o = u.olhos[i]; o.scale.set(surpreso ? 1.25 : 1, fech * (surpreso ? 1.25 : 1), 1);
      o.userData.pupila.position.x = suave(o.userData.pupila.position.x, px * 0.4, dt * 8);
      o.userData.pupila.position.y = suave(o.userData.pupila.position.y, py * 0.4, dt * 8);
      u.boch[i].visible = (pet.humor === "feliz" || u.acenar > 0) && !doenteFlag;
    }
    // boca
    var abre = surpreso || (u.comendo > 0 && Math.sin(tempo * 18) > 0);
    u.comendo = Math.max(0, u.comendo - dt);
    u.bocaA.visible = abre; u.sorriso.visible = !abre;
    u.sorriso.rotation.z = (pet.humor === "triste" || doenteFlag) ? Math.PI : 0;
    u.exc.visible = surpreso; u.exc.position.y = u.alt;
    // broto/orelhas balançam; cor muda com o humor
    u.topo.rotation.z = Math.sin(tempo * 3) * 0.06 + (u.andando ? Math.sin(tempo * 13) * 0.08 : 0);
    u.pele.color.copy(u.corBase);
    if (doenteFlag) u.pele.color.lerp(COR_DOENTE, 0.45); else if (pet.humor === "triste") u.pele.color.multiplyScalar(0.82);
  }
  function mover(c, dt, velMax, alturaFn) {
    var u = c.userData;
    if (u.alvo) {
      var dx = u.alvo.x - c.position.x, dz = u.alvo.z - c.position.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.12) { u.alvo = null; u.vel = 0; var cb = u.aoChegar; u.aoChegar = null; if (cb) cb(); }
      else {
        u.vel = suave(u.vel, Math.min(velMax, d * 2.5), dt * 4);
        c.position.x += dx / d * u.vel * dt; c.position.z += dz / d * u.vel * dt;
        var ang = Math.atan2(dx, dz), dif = ang - c.rotation.y;
        while (dif > Math.PI) dif -= Math.PI * 2; while (dif < -Math.PI) dif += Math.PI * 2;
        c.rotation.y += dif * Math.min(1, dt * 9);
      }
    }
    u.andando = !!u.alvo && u.vel > 0.2;
    if (alturaFn) c.position.y = suave(c.position.y, alturaFn(c.position.x, c.position.z), dt * 10);
  }
  function irPara(c, x, z, cb) { c.userData.alvo = { x: x, z: z }; c.userData.aoChegar = cb || null; c.userData.sentado = false; }
  function virarPara(c, x, z, dt) { var a = Math.atan2(x - c.position.x, z - c.position.z), dif = a - c.rotation.y; while (dif > Math.PI) dif -= 6.283; while (dif < -Math.PI) dif += 6.283; c.rotation.y += dif * Math.min(1, (dt || 1) * 6); }
  function tocouEm(obj) { return obj && raio.intersectObject(obj, true).length > 0; }
  function pontoEm(m) { var h = raio.intersectObject(m, false); return h.length ? h[0].point : null; }

  // ================================================================== agenda do piloto automático
  // cada mundo tem um "cérebro": lista de atividades com peso; escolhe uma quando a anterior termina
  function cerebro(atividades) {
    var atual2 = null, resta = 0;
    return {
      passo: function (dt) {
        resta -= dt;
        if (atual2 && atual2.passo && resta > 0) { if (atual2.passo(dt) === false) resta = 0; }
        if (resta <= 0) {
          if (atual2 && atual2.fim) atual2.fim();
          var total = 0, l = [], i;
          for (i = 0; i < atividades.length; i++) { var p = atividades[i].peso(); if (p > 0) { l.push([atividades[i], p]); total += p; } }
          var r = Math.random() * total; atual2 = null;
          for (i = 0; i < l.length; i++) { r -= l[i][1]; if (r <= 0) { atual2 = l[i][0]; break; } }
          if (!atual2 && l.length) atual2 = l[0][0];
          resta = atual2 ? atual2.dura() : 2;
          if (atual2 && atual2.ini) atual2.ini();
        }
      },
      parar: function () { if (atual2 && atual2.fim) atual2.fim(); atual2 = null; resta = 0; }
    };
  }

  // ================================================================== MUNDO 1 — VILA
  function mundoVila() {
    var c = base(), per = periodo();
    var CORES = { dia: [0x4ea8de, 0xbde0fe, 0xfff3c4], tarde: [0x3d348b, 0xf7b267, 0xf79d65], noite: [0x0b132b, 0x1c2541, 0x3a506b] }[per];
    c.add(ceuDegrade(CORES[0], CORES[1], CORES[2]));
    c.fog = new THREE.Fog(CORES[1], 22, 60);
    var L = luzes(c, per === "noite" ? 0x8899cc : 0xddeeff, 0x5a6b3a, per === "noite" ? 0.45 : 0.8, per === "tarde" ? new THREE.Vector3(-10, 5, 4) : new THREE.Vector3(6, 12, 8), per === "tarde" ? 0xffb37a : 0xfff1d6);
    if (per === "noite") L.sol.intensity = 0.25;
    var LAGO = { x: 4.2, z: 3.5, r: 2.4 };
    function altura(x, z) {
      var d = Math.sqrt(x * x + z * z), y = ruido(x, z) * 0.35 + Math.max(0, d - 10) * 0.35;
      var dl = Math.sqrt((x - LAGO.x) * (x - LAGO.x) + (z - LAGO.z) * (z - LAGO.z));
      if (dl < LAGO.r + 0.8) y -= (1 - dl / (LAGO.r + 0.8)) * 0.9;
      return y;
    }
    var chao = terreno(44, 44, altura, function (y, x, z) {
      var dl = Math.sqrt((x - LAGO.x) * (x - LAGO.x) + (z - LAGO.z) * (z - LAGO.z));
      if (dl < LAGO.r + 0.5) return 0xe9d8a6;
      return y > 1.2 ? 0x6a994e : (y > 0.2 ? 0x7cb342 : 0x8bc34a);
    });
    c.add(chao);
    c.add(capim(900, 14, altura, [0x5a8f3e, 0xa7d36a], function (x, z) { var dl = Math.hypot ? Math.hypot(x - LAGO.x, z - LAGO.z) : Math.sqrt((x - LAGO.x) * (x - LAGO.x) + (z - LAGO.z) * (z - LAGO.z)); return dl < LAGO.r + 0.6 || (x < -1.5 && x > -6.5 && z < -1.5 && z > -6.5); }));
    // lago com ondinhas
    var gAgua = new THREE.CircleGeometry(LAGO.r + 0.3, 20); gAgua.rotateX(-Math.PI / 2);
    var agua = new THREE.Mesh(gAgua, new THREE.MeshLambertMaterial({ color: 0x3b9fc4, transparent: true, opacity: 0.85, flatShading: true }));
    agua.position.set(LAGO.x, -0.12, LAGO.z); c.add(agua);
    for (var i = 0; i < 9; i++) { var a = i / 9 * 6.283; c.add(malha(new THREE.DodecahedronGeometry(aleat(0.18, 0.32), 0), 0xa3a3b5, LAGO.x + Math.cos(a) * (LAGO.r + 0.35), 0.0, LAGO.z + Math.sin(a) * (LAGO.r + 0.35))); }
    var vitoria = malha(new THREE.CylinderGeometry(0.45, 0.45, 0.03, 10), 0x52b788, LAGO.x - 0.8, -0.08, LAGO.z + 0.6); c.add(vitoria);
    // casa
    var casa = new THREE.Group(); casa.position.set(-4, altura(-4, -4), -4);
    casa.add(malha(new THREE.BoxGeometry(3.2, 2.1, 3), 0xfaedcd, 0, 1.05, 0));
    casa.add(malha(new THREE.BoxGeometry(3.3, 0.25, 3.1), 0xd4a373, 0, 0.12, 0));
    var teto = malha(new THREE.ConeGeometry(2.75, 1.7, 4), 0xc1121f, 0, 2.95, 0); teto.rotation.y = Math.PI / 4; casa.add(teto);
    var chamine = malha(new THREE.BoxGeometry(0.4, 1, 0.4), 0x9c6644, 0.9, 3.3, -0.5); casa.add(chamine);
    casa.add(malha(new THREE.BoxGeometry(0.85, 1.35, 0.1), 0x7f5539, 0.7, 0.7, 1.52));
    casa.add(malha(new THREE.SphereGeometry(0.05, 6, 4), 0xffd166, 0.95, 0.7, 1.58));
    var janelaMat = new THREE.MeshLambertMaterial({ color: 0x9bd1f0, emissive: 0x000000 });
    var jan = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.1), janelaMat); jan.position.set(-0.75, 1.25, 1.52); casa.add(jan);
    casa.add(malha(new THREE.BoxGeometry(0.85, 0.08, 0.15), 0xffffff, -0.75, 0.9, 1.56));
    casa.add(malha(new THREE.BoxGeometry(0.75, 0.2, 0.25), 0xe63946, -0.75, 0.8, 1.66));
    c.add(casa);
    // caminho de pedras até a porta
    for (i = 0; i < 6; i++) { var pe = malha(new THREE.CylinderGeometry(0.28, 0.3, 0.06, 7), 0xcbc0ad, -3.3 + i * 0.55, altura(-3.3 + i * 0.55, -2.2 + i * 0.5) + 0.03, -2.2 + i * 0.5); c.add(pe); }
    // poste
    var postX = -1.4, postZ = -1.6, postY = altura(postX, postZ);
    c.add(malha(new THREE.CylinderGeometry(0.05, 0.08, 2.6, 6), 0x2b2d42, postX, postY + 1.3, postZ));
    var luzPoste = malha(new THREE.SphereGeometry(0.17, 10, 8), per === "noite" ? 0xffe8a3 : 0xdddddd, postX, postY + 2.7, postZ, null, "B"); c.add(luzPoste);
    if (per === "noite") c.add(malha(new THREE.SphereGeometry(0.5, 10, 8), 0xffd166, postX, postY + 2.7, postZ, { transparent: true, opacity: 0.18, depthWrite: false }, "B"));
    // cerca
    for (i = -6; i <= 6; i++) { var fx = i * 0.9, fz = 8.2; c.add(malha(new THREE.BoxGeometry(0.12, 0.7, 0.12), 0xe9c46a, fx, altura(fx, fz) + 0.35, fz)); }
    var trilho = malha(new THREE.BoxGeometry(11, 0.08, 0.06), 0xe9c46a, 0, altura(0, 8.2) + 0.5, 8.2); c.add(trilho);
    // árvores e flores
    var arvs = [[5.8, -3.8, 1.1, "copa"], [-7.5, 2.2, 1, "pinheiro"], [7.5, 3, 0.9, "pinheiro"], [1.2, -7.2, 1.25, "copa"], [-2, 6.5, 0.8, "copa"], [-9, -4, 1.2, "pinheiro"], [9, -6, 1.3, "copa"]];
    for (i = 0; i < arvs.length; i++) c.add(arvore(arvs[i][0], arvs[i][1], arvs[i][2], arvs[i][3], altura));
    var coresFlor = [0xffd166, 0xef476f, 0xc77dff, 0xffffff, 0xff9f1c];
    for (i = 0; i < 36; i++) {
      var fx2 = aleat(-9, 9), fz2 = aleat(-6, 8);
      if (Math.sqrt((fx2 - LAGO.x) * (fx2 - LAGO.x) + (fz2 - LAGO.z) * (fz2 - LAGO.z)) < LAGO.r + 0.8) continue;
      var fl = new THREE.Group(); fl.position.set(fx2, altura(fx2, fz2), fz2);
      fl.add(malha(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 3), 0x2d6a4f, 0, 0.12, 0));
      fl.add(malha(new THREE.IcosahedronGeometry(0.08, 0), coresFlor[i % 5], 0, 0.27, 0)); c.add(fl);
    }
    // céu: nuvens / astros
    var nuvens = [];
    for (i = 0; i < 5; i++) { var n = nuvem(aleat(-25, 25), aleat(10, 15), aleat(-30, -10), aleat(0.9, 1.6)); c.add(n); nuvens.push(n); }
    if (per === "noite") {
      c.add(estrelasPontos(350, 80, 0.6));
      c.add(malha(new THREE.SphereGeometry(2.4, 14, 10), 0xfff6d5, -18, 22, -45, { fog: false }, "B"));
    } else c.add(malha(new THREE.SphereGeometry(3, 14, 10), per === "tarde" ? 0xff9e5e : 0xfff3b0, per === "tarde" ? -30 : 20, per === "tarde" ? 8 : 26, -50, { fog: false }, "B"));
    var vagalumes = [];
    if (per === "noite") for (i = 0; i < 14; i++) { var v = malha(new THREE.SphereGeometry(0.05, 4, 3), 0xd9ed92, aleat(-8, 8), aleat(0.5, 2.5), aleat(-6, 7), null, "B"); v.userData.f = aleat(0, 6); c.add(v); vagalumes.push(v); }
    // borboletas
    var borboletas = [];
    for (i = 0; i < 3; i++) {
      var bb = new THREE.Group(), cb2 = [0xffbe0b, 0xff006e, 0x8338ec][i];
      var a1 = malha(new THREE.PlaneGeometry(0.22, 0.16), cb2, 0, 0, 0, { side: THREE.DoubleSide }, "B"), a2 = a1.clone();
      a1.position.x = -0.11; a2.position.x = 0.11; bb.add(a1); bb.add(a2);
      bb.userData = { a1: a1, a2: a2, t: aleat(0, 10), cx: aleat(-6, 6), cz: aleat(-4, 6) };
      c.add(bb); borboletas.push(bb);
    }
    // pote, bola, vara de pesca, peixe que pula, fumaça
    var poteX = -1.6, poteZ = 0.2;
    var pote = malha(new THREE.CylinderGeometry(0.36, 0.26, 0.26, 12), 0xe07a5f, poteX, altura(poteX, poteZ) + 0.13, poteZ); c.add(pote);
    var racao = malha(new THREE.SphereGeometry(0.29, 8, 6), 0xf2cc8f, poteX, altura(poteX, poteZ) + 0.26, poteZ); racao.scale.y = 0.4; racao.visible = false; c.add(racao);
    var bola = new THREE.Group(); var bm = malha(new THREE.SphereGeometry(0.26, 12, 10), 0xef476f, 0, 0, 0, { liso: true }); bola.add(bm);
    bola.add(malha(new THREE.TorusGeometry(0.262, 0.03, 4, 16), 0xffffff, 0, 0, 0, { liso: true })); bola.position.set(2, -9, 1); c.add(bola);
    var bolaV = new THREE.Vector3();
    var vara = new THREE.Group(); vara.add(malha(new THREE.CylinderGeometry(0.02, 0.03, 1.6, 4), 0x7f5539, 0, 0.8, 0)); vara.children[0].rotation.x = -0.9;
    var linha = malha(new THREE.CylinderGeometry(0.006, 0.006, 1.2, 3), 0xffffff, 0, 0.75, 1.15, null, "B"); vara.add(linha);
    vara.visible = false;
    var peixe = new THREE.Group(); var pc = malha(new THREE.ConeGeometry(0.15, 0.45, 6), 0xffa62b, 0, 0, 0); pc.rotation.z = -Math.PI / 2; peixe.add(pc); peixe.add(malha(new THREE.ConeGeometry(0.12, 0.2, 3), 0xff7b00, -0.3, 0, 0)); peixe.visible = false; c.add(peixe);
    var peixeT = 0;
    var nuvemChuva = nuvem(0, 3.2, 0, 0.55); nuvemChuva.traverse(function (o) { if (o.material) o.material = mat(0x6c757d); }); nuvemChuva.visible = false; c.add(nuvemChuva);
    // ovo e Cadu
    var ovo = new THREE.Group();
    var casca = malha(new THREE.SphereGeometry(0.55, 14, 12), 0xfaf3e0, 0, 0.72, 0, { liso: true }); casca.scale.y = 1.3; ovo.add(casca);
    for (i = 0; i < 6; i++) ovo.add(malha(new THREE.SphereGeometry(0.1, 6, 4), i % 2 ? 0x7fd4c1 : 0xffd166, Math.cos(i * 1.2) * 0.5, 0.45 + i * 0.12, Math.sin(i * 1.2) * 0.5));
    ovo.add(sombra(0.5)); ovo.position.y = altura(0, 0); c.add(ovo);
    var cadu = criarCadu(); cadu.position.set(0, altura(0, 0), 1); cadu.add(vara); c.add(cadu);
    var modo = "livre", dentroDeCasa = false, chutes = 0, quer = null;

    function chutar() {
      chutes++; pular(cadu, 3); bolaV.set(aleat(-1, 1), 0, aleat(-1, 1)).normalize().multiplyScalar(aleat(4, 6)); bolaV.y = aleat(3, 5);
      explosao(0xffffff, bola.position, 5, 1); som("plop");
      if (chutes >= 4) { modo = "livre"; setTimeout(function () { if (modo === "livre") bola.position.y = -9; }, 2500); return; }
      setTimeout(function () { if (modo === "bola") irPara(cadu, bola.position.x, bola.position.z, chutar); }, 900);
    }
    function comecarBola() { if (modo === "dormir") return; modo = "bola"; chutes = 0; bola.position.set(cadu.position.x + aleat(-3, 3), 3, cadu.position.z + aleat(-2, 2)); bolaV.set(0, 0, 0); setTimeout(function () { if (modo === "bola") irPara(cadu, bola.position.x, bola.position.z, chutar); }, 500); }
    function comecarComer(cb) { modo = "comer"; racao.visible = true; racao.scale.set(1, 0.4, 1); irPara(cadu, poteX, poteZ + 0.75, function () { virarPara(cadu, poteX, poteZ); cadu.userData.comendo = 2.4; setTimeout(function () { racao.visible = false; modo = "livre"; pular(cadu, 3); if (cb) cb(); }, 2400); }); }

    var IA = cerebro([
      { peso: function () { return 3; }, dura: function () { return aleat(3, 6); }, ini: function () { irPara(cadu, aleat(-7, 7), aleat(-3, 7)); } },
      { peso: function () { return 2; }, dura: function () { return 7; }, ini: function () { quer = escolha(borboletas); modo = "borboleta"; }, passo: function () { if (quer) irPara(cadu, quer.position.x, quer.position.z); if (Math.random() < 0.01) pular(cadu); }, fim: function () { modo = "livre"; quer = null; cadu.userData.alvo = null; } },
      { peso: function () { return pet.energia > 25 ? 2 : 0; }, dura: function () { return 12; }, ini: comecarBola, fim: function () { if (modo === "bola") modo = "livre"; } },
      { peso: function () { return 1.5; }, dura: function () { return 11; }, ini: function () {
          modo = "pesca"; irPara(cadu, LAGO.x - LAGO.r - 0.5, LAGO.z, function () { virarPara(cadu, LAGO.x, LAGO.z); cadu.userData.sentado = true; vara.visible = true; peixeT = aleat(4, 7); });
        }, fim: function () { vara.visible = false; cadu.userData.sentado = false; modo = "livre"; } },
      { peso: function () { return 1; }, dura: function () { return 6; }, ini: function () { var t = escolha(arvs); irPara(cadu, t[0] + 1.3, t[1] + 1.3, function () { cadu.userData.sentado = true; }); }, fim: function () { cadu.userData.sentado = false; } },
      { peso: function () { return 1; }, dura: function () { return 3; }, ini: function () { cadu.userData.alvo = null; cadu.userData.acenar = 2.5; falar(escolha(["Oi, Felipe!", "Olha eu aqui!", "Bora!", "Tudo certo?"])); } },
      { peso: function () { return pet.barriga < 45 && jogo.colheita > 0 ? 6 : 0; }, dura: function () { return 6; }, ini: function () { comecarComer(function () { jogo.colheita--; salvarJogo(); agir("alimentar"); falar("Comi da horta!"); }); } }
    ]);

    return {
      cena: c, cadu: cadu,
      ferramentas: [{ id: "comer", icone: "apple", cor: "#ff8a65" }, { id: "brincar", icone: "gamepad", cor: "#5ce1e6" }],
      contador: function () { return "moedas " + jogo.moedas + " · colheita " + jogo.colheita; },
      camera: function (dt, auto) {
        var alvo = new THREE.Vector3(cadu.position.x * 0.55, 0, cadu.position.z * 0.45);
        var orb = auto ? Math.sin(tempo * 0.06) * 3 : 0;
        cam.position.lerp(new THREE.Vector3(alvo.x + orb, 6 + (auto ? Math.sin(tempo * 0.1) * 0.5 : 0), alvo.z + 8.2), Math.min(1, dt * 1.6));
        cam.lookAt(alvo.x, 0.9, alvo.z);
      },
      atualizar: function (dt, auto) {
        var ehOvo = pet.fase === "ovo", u = cadu.userData;
        ovo.visible = ehOvo; cadu.visible = !ehOvo && !dentroDeCasa;
        if (ehOvo) { ovo.rotation.z = Math.sin(tempo * (pet.carinhos > 2 ? 16 : 4)) * (pet.carinhos > 2 ? 0.14 : 0.05); return; }
        // água, nuvens, vaga-lumes, borboletas, fumaça
        agua.position.y = -0.12 + Math.sin(tempo * 1.2) * 0.02;
        for (var i = 0; i < nuvens.length; i++) { nuvens[i].position.x += dt * 0.4; if (nuvens[i].position.x > 30) nuvens[i].position.x = -30; }
        for (i = 0; i < vagalumes.length; i++) { var v = vagalumes[i]; v.userData.f += dt; v.position.x += Math.sin(v.userData.f * 0.7) * dt * 0.3; v.position.y += Math.cos(v.userData.f) * dt * 0.2; v.visible = Math.sin(v.userData.f * 3) > -0.3; }
        for (i = 0; i < borboletas.length; i++) {
          var b = borboletas[i], d = b.userData; d.t += dt;
          b.position.set(d.cx + Math.sin(d.t * 0.4) * 3, altura(b.position.x, b.position.z) + 0.8 + Math.sin(d.t * 2) * 0.3, d.cz + Math.cos(d.t * 0.33) * 3);
          var bat = Math.sin(d.t * 18) * 0.9; d.a1.rotation.y = bat; d.a2.rotation.y = -bat; b.rotation.y = d.t * 0.4;
        }
        if (Math.random() < dt * 2) particula(0xd9d9d9, -3.1, casa.position.y + 3.9, -4.5, aleat(-.1, .1), 0.6, 0, 2.5, 0.1, 2.2);
        // dormir / acordar
        var dorme = pet.dormindo;
        janelaMat.emissive.setHex(dorme || per === "noite" ? 0xffb703 : 0x000000);
        if (dorme && modo !== "dormir") { modo = "dormir"; IA.parar(); irPara(cadu, -3.3, -2.3, function () { dentroDeCasa = true; }); }
        if (!dorme && modo === "dormir") { modo = "livre"; dentroDeCasa = false; cadu.position.set(-3.3, altura(-3.3, -2.3), -2.3); pular(cadu); falar("Bom dia!"); }
        if (dorme && dentroDeCasa && Math.random() < dt * 0.7) particula(0xcfe3ff, -4.6, casa.position.y + 2.2, -2.4, 0.15, 0.5, 0, 2.2, 0, 1.8);
        // bola com física
        if (bola.position.y > -5) {
          bolaV.y -= 13 * dt; bola.position.addScaledVector(bolaV, dt);
          var ch = altura(bola.position.x, bola.position.z) + 0.26;
          if (bola.position.y < ch) { bola.position.y = ch; bolaV.y = Math.abs(bolaV.y) * 0.45; bolaV.x *= 0.82; bolaV.z *= 0.82; }
          if (Math.abs(bola.position.x) > 9) bolaV.x = -bolaV.x; if (bola.position.z > 7.5 || bola.position.z < -6) bolaV.z = -bolaV.z;
          bola.rotation.x += bolaV.z * dt * 3; bola.rotation.z -= bolaV.x * dt * 3;
        }
        // pesca
        if (modo === "pesca" && vara.visible) {
          linha.position.y = 0.75 + Math.sin(tempo * 2) * 0.03;
          peixeT -= dt;
          if (peixeT <= 0 && peixeT > -10) {
            peixeT = -20; peixe.visible = true; peixe.position.set(LAGO.x - 0.8, 0, LAGO.z); peixe.userData.v = new THREE.Vector3(-1.2, 4, 0);
            pular(cadu, 3); u.surpresa = 1;
            if (Math.random() < 0.6) { moeda(1); jogo.peixes = (jogo.peixes || 0) + 1; falar("Peguei um peixe! (" + jogo.peixes + ")"); agir("recompensa"); } else falar("Ih, escapou!");
          }
        }
        if (peixe.visible) { peixe.userData.v.y -= 10 * dt; peixe.position.addScaledVector(peixe.userData.v, dt); peixe.rotation.z += dt * 8; if (peixe.position.y < -0.5) { peixe.visible = false; explosao(0x90e0ef, peixe.position.clone().setY(0), 6, 1); som("plop"); } }
        // doente: nuvem de chuva
        nuvemChuva.visible = doenteFlag;
        if (doenteFlag) { nuvemChuva.position.set(cadu.position.x, cadu.position.y + 3, cadu.position.z); if (Math.random() < dt * 14) particula(0x90e0ef, cadu.position.x + aleat(-.5, .5), cadu.position.y + 2.7, cadu.position.z + aleat(-.4, .4), 0, -4, 0, 0.6, 0); }
        // piloto automático
        if (auto && !dorme && modo !== "comer") IA.passo(dt);
        if (modo === "borboleta" && quer) u.olhando = quer.position; else if (bola.position.y > -5 && modo === "bola") u.olhando = bola.position; else u.olhando = cam.position;
        u.dormindo = dorme;
        mover(cadu, dt, modo === "bola" || modo === "borboleta" ? 3.2 : (pet.humor === "triste" ? 1.3 : 2.1), altura);
        animarCadu(cadu, dt);
      },
      toque: function () {
        if (pet.fase === "ovo") { if (tocouEm(ovo)) { explosao(0xffffff, new THREE.Vector3(0, 1.4, 0), 6, 1); som("carinho"); agir("carinho"); } return; }
        if (tocouEm(cadu)) { pular(cadu); coracoes(cadu.position); agir("carinho"); return; }
        if (tocouEm(bola) && bola.position.y > -5) { comecarBola(); return; }
        var p = pontoEm(chao);
        if (p && !pet.dormindo) { IA.parar(); if (modo !== "comer") modo = "livre"; vara.visible = false; irPara(cadu, Math.max(-9, Math.min(9, p.x)), Math.max(-6, Math.min(7.5, p.z))); }
      },
      ferramenta: function (id) {
        if (pet.fase === "ovo") return falar("Ainda sou um ovo! Faz carinho."), false;
        if (id === "luz") return true;
        if (pet.dormindo) return falar("Zzz…"), false;
        IA.parar(); vara.visible = false;
        if (id === "comer") comecarComer();
        if (id === "brincar") comecarBola();
        return true;
      }
    };
  }

  // ================================================================== MUNDO 2 — CÉU DAS ESTRELAS (↑)
  function mundoCeu() {
    var c = base();
    c.add(ceuDegrade(0x03045e, 0x3a0ca3, 0x7209b7));
    luzes(c, 0x9d8df1, 0x3a0ca3, 0.7, new THREE.Vector3(-6, 10, 6), 0xd0c3ff);
    var estrelas = estrelasPontos(500, 85, 0.7); c.add(estrelas);
    var estrelas2 = estrelasPontos(120, 70, 1.3); c.add(estrelas2);
    // aurora: faixas onduladas
    var auroras = [];
    for (var k = 0; k < 2; k++) {
      var gA = new THREE.PlaneGeometry(70, 8, 30, 1), corA = [];
      for (var v = 0; v < gA.attributes.position.count; v++) { var yy = gA.attributes.position.getY(v); var cc = new THREE.Color(k ? 0x80ffdb : 0x72efdd); if (yy > 0) cc.lerp(new THREE.Color(0x7400b8), 0.8); corA.push(cc.r, cc.g, cc.b); }
      gA.setAttribute("color", new THREE.Float32BufferAttribute(corA, 3));
      var au = new THREE.Mesh(gA, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, fog: false }));
      au.position.set(0, 18 + k * 4, -40 - k * 6); au.userData.base = gA.attributes.position.array.slice(0); au.userData.k = k; c.add(au); auroras.push(au);
    }
    // lua com crateras
    var lua = new THREE.Group(); lua.add(malha(new THREE.SphereGeometry(3.5, 18, 14), 0xfdf0d5, 0, 0, 0, { liso: true, emissive: 0x5c5040 }));
    for (k = 0; k < 6; k++) lua.add(malha(new THREE.SphereGeometry(aleat(0.3, 0.7), 8, 6), 0xe2d6b8, Math.cos(k * 1.7) * 2.6, Math.sin(k * 2.3) * 2.2, 2.4, { liso: true, emissive: 0x3c3428 }));
    lua.position.set(-16, 17, -32); c.add(lua);
    // ilha flutuante principal
    var ilha = new THREE.Group();
    var rocha = malha(new THREE.ConeGeometry(3.4, 3.8, 9), 0x6d4c41, 0, -2, 0); rocha.rotation.x = Math.PI; ilha.add(rocha);
    ilha.add(girada(malha(new THREE.ConeGeometry(2, 2, 7), 0x5d4037, 1.2, -3.1, 0.6), Math.PI, 0, 0));
    ilha.add(malha(new THREE.CylinderGeometry(3.45, 3.3, 0.5, 9), 0x52b788, 0, 0, 0));
    ilha.add(capim(160, 3.1, function () { return 0.25; }, [0x40916c, 0x95d5b2]));
    ilha.add(arvore(-1.9, -1, 0.75, "pinheiro"));
    var tel = new THREE.Group(); tel.add(malha(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4), 0x2b2d42, 0, 0.45, 0)); var tubo = malha(new THREE.CylinderGeometry(0.1, 0.14, 0.8, 8), 0xdee2e6, 0, 1, 0.2); tubo.rotation.x = -0.8; tel.add(tubo); tel.position.set(1.8, 0.25, -1); ilha.add(tel);
    c.add(ilha);
    var ilhotas = [];
    for (k = 0; k < 4; k++) { var il = new THREE.Group(); var r2 = malha(new THREE.ConeGeometry(0.9, 1.3, 7), 0x6d4c41, 0, -0.65, 0); r2.rotation.x = Math.PI; il.add(r2); il.add(malha(new THREE.CylinderGeometry(0.92, 0.9, 0.2, 7), 0x52b788)); il.position.set(escolha([-1, 1]) * aleat(6, 11), aleat(-1, 4), aleat(-10, -3)); il.userData.f = aleat(0, 6); c.add(il); ilhotas.push(il); }
    var cadu = criarCadu(); cadu.position.set(0.5, 0.25, 0.9); ilha.add(cadu);
    // cristais (estrelas guardadas) orbitando a ilha
    var cristais = new THREE.Group(); c.add(cristais);
    var geoCr = new THREE.OctahedronGeometry(0.2, 0);
    function montarCristais() {
      while (cristais.children.length) cristais.remove(cristais.children[0]);
      var n = Math.min(30, jogo.estrelas), cores = [0xffd166, 0x80ffdb, 0xf72585, 0x4cc9f0];
      for (var q = 0; q < n; q++) { var a = q / 30 * 6.283; var m = malha(geoCr, cores[q % 4], Math.cos(a) * 4.3, 0.6 + Math.sin(q * 1.3) * 0.5, Math.sin(a) * 4.3, null, "B"); cristais.add(m); }
    }
    montarCristais();
    // estrelas cadentes
    var cadentes = [], prox = 0.8, geoE = new THREE.OctahedronGeometry(0.32, 0), geoHit = new THREE.SphereGeometry(1.6, 6, 4), matHit = new THREE.MeshBasicMaterial({ visible: false });
    function nova() {
      var g = new THREE.Group(), esq = Math.random() < 0.5, cor = escolha([0xfff3b0, 0x80ffdb, 0xffafcc]);
      g.add(malha(geoE, cor, 0, 0, 0, null, "B"));
      for (var t = 1; t <= 5; t++) { var tr = malha(geoE, cor, (esq ? -1 : 1) * t * 0.35, t * 0.12, 0, { transparent: true, opacity: 0.6 - t * 0.1 }, "B"); tr.scale.setScalar(1 - t * 0.15); g.add(tr); }
      var hit = new THREE.Mesh(geoHit, matHit); g.add(hit);
      g.position.set(esq ? -13 : 13, aleat(4.5, 9), aleat(-5, 1));
      g.userData = { v: new THREE.Vector3(esq ? aleat(2.5, 4.5) : -aleat(2.5, 4.5), -aleat(0.6, 1.4), 0), hit: hit, cor: cor };
      c.add(g); cadentes.push(g);
    }
    function pegar(i, auto) {
      var e = cadentes[i]; explosao(e.userData.cor, e.position, 16, 3); som("estrela");
      c.remove(e); cadentes.splice(i, 1);
      jogo.estrelas++; moeda(1); montarCristais(); pular(cadu, 4.5); cadu.userData.surpresa = 0.6;
      if (jogo.estrelas % 5 === 0) { agir("recompensa"); falar(jogo.estrelas + " estrelas!"); }
      else if (auto && Math.random() < 0.3) falar(escolha(["Peguei!", "Mais uma!", "Que linda!"]));
    }
    var tPulo = 0;
    return {
      cena: c, cadu: cadu, ferramentas: [],
      contador: function () { return "estrelas " + jogo.estrelas + " · moedas " + jogo.moedas; },
      camera: function (dt, auto) { var o = auto ? Math.sin(tempo * 0.08) * 2 : 0; cam.position.lerp(new THREE.Vector3(o, 3.2, 10), Math.min(1, dt * 2)); cam.lookAt(0, 2.6, 0); },
      atualizar: function (dt, auto) {
        ilha.position.y = Math.sin(tempo * 0.7) * 0.2; ilha.rotation.y = Math.sin(tempo * 0.15) * 0.08;
        cristais.position.y = ilha.position.y; cristais.rotation.y += dt * 0.25;
        for (var i = 0; i < ilhotas.length; i++) { ilhotas[i].userData.f += dt; ilhotas[i].position.y += Math.sin(ilhotas[i].userData.f) * dt * 0.2; }
        estrelas2.material.opacity = 0.6 + Math.sin(tempo * 3) * 0.4;
        lua.rotation.y += dt * 0.05;
        for (i = 0; i < auroras.length; i++) {
          var au = auroras[i], p = au.geometry.attributes.position, b = au.userData.base;
          for (var v2 = 0; v2 < p.count; v2++) p.setZ(v2, b[v2 * 3 + 2] + Math.sin(b[v2 * 3] * 0.15 + tempo * 0.8 + au.userData.k * 2) * 2.2);
          p.needsUpdate = true;
        }
        prox -= dt; if (prox <= 0) { prox = aleat(1, 2.6); nova(); }
        var maisPerto = null, dist = 99;
        for (i = cadentes.length - 1; i >= 0; i--) {
          var e = cadentes[i]; e.position.addScaledVector(e.userData.v, dt); e.children[0].rotation.y += dt * 5;
          var d = Math.abs(e.position.x); if (d < dist) { dist = d; maisPerto = e; }
          if (Math.abs(e.position.x) > 15 || e.position.y < -4) { c.remove(e); cadentes.splice(i, 1); }
        }
        var u = cadu.userData;
        u.olhando = maisPerto ? maisPerto.position : cam.position;
        if (maisPerto) virarPara(cadu, maisPerto.position.x - ilha.position.x, maisPerto.position.z + 3, dt * 0.6);
        // piloto automático: pula para pegar as que passam por cima da ilha
        tPulo -= dt;
        if (auto && maisPerto && dist < 2.2 && tPulo <= 0) { tPulo = 1.2; if (Math.random() < 0.55) pegar(cadentes.indexOf(maisPerto), true); else { pular(cadu, 4); } }
        if (auto && Math.random() < dt * 0.05) u.acenar = 2;
        animarCadu(cadu, dt);
      },
      toque: function () {
        for (var i = 0; i < cadentes.length; i++) if (raio.intersectObject(cadentes[i].userData.hit).length) return pegar(i, false);
        if (tocouEm(cadu)) { pular(cadu); coracoes(cadu.getWorldPosition(new THREE.Vector3())); agir("carinho"); }
      },
      ferramenta: function () { return true; },
      aoEntrar: function () { falar("Toque nas estrelas cadentes!"); }
    };
  }

  // ================================================================== MUNDO 3 — FUNDO DO MAR (↓)
  function mundoMar() {
    var c = base();
    c.add(ceuDegrade(0x48cae4, 0x0077b6, 0x03045e));
    c.fog = new THREE.Fog(0x0a5e8f, 7, 30);
    luzes(c, 0x90e0ef, 0x0a3d62, 0.85, new THREE.Vector3(2, 14, 4), 0xcaf0f8);
    function altura(x, z) { return Math.sin(x * 0.45) * 0.35 + Math.cos(z * 0.5 + x * 0.2) * 0.25 + Math.max(0, Math.sqrt(x * x + z * z) - 11) * 0.3; }
    var areia = terreno(46, 40, altura, function (y) { return y > 0.4 ? 0xf1dca7 : (y > 0 ? 0xe9d8a6 : 0xd4c08e); }); c.add(areia);
    // raios de luz do sol entrando na água
    var raios = [];
    for (var i = 0; i < 5; i++) { var rr = malha(new THREE.PlaneGeometry(1.6, 18), 0xcaf0f8, aleat(-8, 8), 7, aleat(-8, -1), { transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }, "B"); rr.rotation.z = aleat(-0.3, -0.15); rr.userData.f = aleat(0, 6); c.add(rr); raios.push(rr); }
    // corais, algas, rochas, barco afundado
    var coresCoral = [0xff8fab, 0xff9f1c, 0xb388ff, 0xef476f, 0xffd6a5];
    for (i = 0; i < 18; i++) {
      var a = aleat(0, 6.28), d = aleat(3.5, 10), x = Math.cos(a) * d, z = Math.sin(a) * d - 1.5, grupo = new THREE.Group();
      var t = i % 3;
      if (t === 0) for (var j = 0; j < 4; j++) grupo.add(malha(new THREE.CylinderGeometry(0.08, 0.12, aleat(0.6, 1.4), 5), coresCoral[i % 5], aleat(-.3, .3), 0.5, aleat(-.3, .3)));
      else if (t === 1) grupo.add(malha(new THREE.IcosahedronGeometry(aleat(0.45, 0.8), 1), coresCoral[i % 5], 0, 0.35, 0));
      else { var leque = malha(new THREE.CircleGeometry(0.7, 8, 0, Math.PI), coresCoral[i % 5], 0, 0.1, 0, { side: THREE.DoubleSide }); grupo.add(leque); }
      grupo.position.set(x, altura(x, z), z); grupo.rotation.y = aleat(0, 6); c.add(grupo);
    }
    var algas = [];
    for (i = 0; i < 18; i++) {
      var ax = aleat(-10, 10), az = aleat(-10, 3), alga = new THREE.Group(); alga.position.set(ax, altura(ax, az), az);
      var segs = Math.floor(aleat(4, 7));
      for (j = 0; j < segs; j++) { var sg = malha(new THREE.BoxGeometry(0.16, 0.42, 0.06), j % 2 ? 0x2a9d8f : 0x40916c, 0, 0.21 + j * 0.4, 0); alga.add(sg); }
      alga.userData.f = aleat(0, 6); c.add(alga); algas.push(alga);
    }
    var barco = new THREE.Group(); barco.add(malha(new THREE.BoxGeometry(3.5, 1, 1.4), 0x5e3b25, 0, 0.5, 0)); barco.add(malha(new THREE.BoxGeometry(0.15, 3, 0.15), 0x3e2723, 0.4, 2, 0)); barco.add(malha(new THREE.PlaneGeometry(1.2, 1.4), 0xe5e5e5, 0.95, 2.4, 0, { side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
    barco.position.set(-7, altura(-7, -6.5), -6.5); barco.rotation.set(0.15, 0.7, 0.35); c.add(barco);
    // baú
    var bau = new THREE.Group(), bx = 3.2, bz = -2.2; bau.position.set(bx, altura(bx, bz) + 0.3, bz); bau.rotation.y = -0.4;
    bau.add(malha(new THREE.BoxGeometry(1.2, 0.6, 0.8), 0x8d5524)); bau.add(malha(new THREE.BoxGeometry(1.24, 0.1, 0.84), 0xc9a227, 0, 0.1, 0));
    var tampa = new THREE.Group(); tampa.position.set(0, 0.3, -0.4); tampa.add(malha(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 8, 1, false, 0, Math.PI), 0x6f4518, 0, 0, 0.4)); tampa.children[0].rotation.z = Math.PI / 2; bau.add(tampa);
    var brilhoBau = malha(new THREE.SphereGeometry(0.5, 8, 6), 0xffd166, 0, 0.4, 0, { transparent: true, opacity: 0, depthWrite: false }, "B"); bau.add(brilhoBau);
    c.add(bau);
    // água-viva
    var aguasVivas = [];
    for (i = 0; i < 3; i++) {
      var av = new THREE.Group(), cor = [0xffafcc, 0xcdb4db, 0xa2d2ff][i];
      av.add(malha(new THREE.SphereGeometry(0.4, 10, 6, 0, 6.283, 0, Math.PI / 2), cor, 0, 0, 0, { transparent: true, opacity: 0.75, liso: true }));
      for (j = 0; j < 5; j++) av.add(malha(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 3), cor, Math.cos(j * 1.25) * 0.22, -0.4, Math.sin(j * 1.25) * 0.22, { transparent: true, opacity: 0.6 }, "B"));
      av.position.set(aleat(-7, 7), aleat(3, 6), aleat(-6, -1)); av.userData.f = aleat(0, 6); c.add(av); aguasVivas.push(av);
    }
    // cardumes (peixes que seguem um líder)
    var coresP = [0xffd166, 0xff8a65, 0x5ce1e6, 0xef476f, 0xb388ff, 0x06d6a0];
    function fazerPeixe(cor, s) {
      var f = new THREE.Group(), corpo = malha(new THREE.SphereGeometry(0.22, 8, 6), cor); corpo.scale.set(1.5, 0.9, 0.6); f.add(corpo);
      var cauda = malha(new THREE.ConeGeometry(0.16, 0.3, 4), cor, -0.38, 0, 0); cauda.rotation.z = Math.PI / 2; f.add(cauda);
      f.add(malha(new THREE.SphereGeometry(0.04, 4, 3), 0x13222a, 0.2, 0.05, 0.11, null, "B"));
      f.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 5, 4), new THREE.MeshBasicMaterial({ visible: false })));
      f.scale.setScalar(s || 1); f.userData = { cauda: cauda, giro: 0 }; return f;
    }
    var cardumes = [];
    for (var k = 0; k < 3; k++) {
      var lider = { ang: aleat(0, 6), r: aleat(3, 7), h: aleat(1.5, 4.5), vel: aleat(0.25, 0.45) * (k % 2 ? 1 : -1) }, membros = [];
      for (j = 0; j < 6; j++) { var pf = fazerPeixe(coresP[(k * 2 + j) % 6], aleat(0.7, 1)); pf.userData.off = new THREE.Vector3(aleat(-1, 1), aleat(-0.5, 0.5), aleat(-1, 1)); c.add(pf); membros.push(pf); }
      cardumes.push({ l: lider, m: membros, alvo: null });
    }
    var bolhas = [];
    for (i = 0; i < 26; i++) { var bo = malha(new THREE.SphereGeometry(aleat(0.04, 0.1), 6, 4), 0xcaf0f8, aleat(-9, 9), aleat(0, 9), aleat(-9, 2), { transparent: true, opacity: 0.6 }, "B"); c.add(bo); bolhas.push(bo); }
    var flocos = [];
    var cadu = criarCadu(); cadu.position.set(-1, altura(-1, 1), 1); c.add(cadu);
    var capacete = new THREE.Mesh(new THREE.SphereGeometry(0.88, 14, 12), new THREE.MeshLambertMaterial({ color: 0xcaf0f8, transparent: true, opacity: 0.22 })); capacete.position.y = 0.68; cadu.userData.corpoG.add(capacete);
    cadu.userData.corpoG.add(girada(malha(new THREE.TorusGeometry(0.62, 0.05, 6, 16), 0xadb5bd, 0, 0.18, 0, { liso: true }), Math.PI / 2, 0, 0));
    var abrindo = 0;
    function abrirBau() {
      if (agora() - (jogo.bau || 0) < 10 * 60 * 1000) { falar("O baú está vazio. Volte daqui a pouco!"); return false; }
      jogo.bau = agora(); abrindo = 3; moeda(5); agir("recompensa"); brilhoBau.material.opacity = 0.5;
      for (var q = 0; q < 14; q++) particula(0xffd166, bau.position.x, bau.position.y + 0.5, bau.position.z, aleat(-1.5, 1.5), aleat(2, 4), aleat(-1, 1.5), 1.6);
      falar("Tesouro! +5 moedas"); return true;
    }
    function soltarRacao() { for (var q = 0; q < 8; q++) { var fl = malha(geoPart, 0xffd166, cadu.position.x + aleat(-1.2, 1.2), aleat(3, 4.5), cadu.position.z + aleat(-1, 1), null, "B"); c.add(fl); flocos.push(fl); } som("plop"); }
    var IA = cerebro([
      { peso: function () { return 3; }, dura: function () { return aleat(4, 7); }, ini: function () { irPara(cadu, aleat(-6, 6), aleat(-4, 4)); } },
      { peso: function () { return 2; }, dura: function () { return 7; }, ini: function () { var cd = escolha(cardumes); cadu.userData.segue = cd; }, passo: function () { var cd = cadu.userData.segue; if (cd) irPara(cadu, Math.cos(cd.l.ang) * cd.l.r * 0.7, Math.sin(cd.l.ang) * cd.l.r * 0.7 - 1.5); }, fim: function () { cadu.userData.segue = null; } },
      { peso: function () { return agora() - (jogo.bau || 0) > 10 * 60 * 1000 ? 6 : 0; }, dura: function () { return 6; }, ini: function () { irPara(cadu, bx - 1.1, bz + 0.9, function () { virarPara(cadu, bx, bz); abrirBau(); }); } },
      { peso: function () { return 1.5; }, dura: function () { return 5; }, ini: function () { cadu.userData.alvo = null; soltarRacao(); falar("Hora do lanche, peixinhos!"); } },
      { peso: function () { return 1; }, dura: function () { return 3; }, ini: function () { cadu.userData.alvo = null; cadu.userData.acenar = 2.5; } }
    ]);
    return {
      cena: c, cadu: cadu,
      ferramentas: [{ id: "peixes", icone: "fish", cor: "#5ce1e6" }],
      contador: function () { return "moedas " + jogo.moedas; },
      camera: function (dt, auto) { var o = auto ? Math.sin(tempo * 0.07) * 2.5 : 0; cam.position.lerp(new THREE.Vector3(cadu.position.x * 0.45 + o, 4.2, cadu.position.z * 0.3 + 9), Math.min(1, dt * 1.6)); cam.lookAt(cadu.position.x * 0.45, 1.4, cadu.position.z * 0.3); },
      atualizar: function (dt, auto) {
        var i, j;
        for (i = 0; i < raios.length; i++) { raios[i].userData.f += dt; raios[i].material.opacity = 0.06 + Math.sin(raios[i].userData.f * 0.8) * 0.04; }
        for (i = 0; i < algas.length; i++) { var al = algas[i]; for (j = 0; j < al.children.length; j++) { al.children[j].rotation.z = Math.sin(tempo * 1.3 + al.userData.f + j * 0.5) * 0.12 * (j + 1) * 0.5; al.children[j].position.x = Math.sin(tempo * 1.3 + al.userData.f + j * 0.4) * 0.05 * j; } }
        for (i = 0; i < aguasVivas.length; i++) { var av = aguasVivas[i]; av.userData.f += dt; var pul = Math.sin(av.userData.f * 2.4); av.scale.set(1 + pul * 0.08, 1 - pul * 0.1, 1 + pul * 0.08); av.position.y += Math.max(0, pul) * dt * 0.5 - dt * 0.12; if (av.position.y < 1.5) av.position.y = 6.5; }
        for (i = 0; i < bolhas.length; i++) { var bo = bolhas[i]; bo.position.y += dt * 0.9; bo.position.x += Math.sin(tempo * 2 + i) * dt * 0.2; if (bo.position.y > 10) bo.position.y = 0; }
        if (Math.random() < dt * 1.5) particula(0xcaf0f8, cadu.position.x + 0.3, cadu.position.y + 1.4, cadu.position.z, 0, 1.2, 0, 2, 0.4, 0.8);
        for (var k = 0; k < cardumes.length; k++) {
          var cd = cardumes[k], L2 = cd.l;
          var alvoC = flocos.length ? flocos[k % flocos.length].position : null;
          if (!alvoC) L2.ang += L2.vel * dt;
          var lx = alvoC ? alvoC.x : Math.cos(L2.ang) * L2.r, lz = alvoC ? alvoC.z : Math.sin(L2.ang) * L2.r - 1.5, ly = alvoC ? alvoC.y : L2.h + Math.sin(tempo + k) * 0.4;
          for (j = 0; j < cd.m.length; j++) {
            var f = cd.m[j], u = f.userData;
            if (u.giro > 0) { u.giro -= dt; f.rotation.x += dt * 14; continue; } else f.rotation.x = 0;
            var alvo = new THREE.Vector3(lx + u.off.x, ly + u.off.y, lz + u.off.z), dv = alvo.sub(f.position), dist = dv.length();
            if (dist > 0.05) { dv.normalize(); f.position.addScaledVector(dv, Math.min(dist, dt * (alvoC ? 3.2 : 2.2))); f.rotation.y = Math.atan2(-dv.z, dv.x); }
            u.cauda.rotation.y = Math.sin(tempo * 12 + j) * 0.5;
          }
          if (alvoC) for (i = flocos.length - 1; i >= 0; i--) if (flocos[i].position.distanceTo(cd.m[0].position) < 0.5) { c.remove(flocos[i]); flocos.splice(i, 1); som("bolha"); }
        }
        for (i = flocos.length - 1; i >= 0; i--) { flocos[i].position.y -= dt * 0.35; if (flocos[i].position.y < 0.2) { c.remove(flocos[i]); flocos.splice(i, 1); } }
        if (abrindo > 0) { abrindo -= dt; tampa.rotation.x = -Math.min(1.3, (3 - abrindo) * 2.2); brilhoBau.material.opacity = Math.max(0, abrindo / 6); if (abrindo <= 0) tampa.rotation.x = 0; }
        if (auto) IA.passo(dt);
        cadu.userData.olhando = cadu.userData.segue ? cadu.userData.segue.m[0].position : cam.position;
        mover(cadu, dt, 1.5, altura); animarCadu(cadu, dt);
      },
      toque: function () {
        if (tocouEm(bau)) { IA.parar(); irPara(cadu, bx - 1.1, bz + 0.9, function () { virarPara(cadu, bx, bz); abrirBau(); }); return; }
        for (var k = 0; k < cardumes.length; k++) for (var j = 0; j < cardumes[k].m.length; j++) if (tocouEm(cardumes[k].m[j])) { cardumes[k].m[j].userData.giro = 0.5; coracoes(cardumes[k].m[j].position.clone().setY(cardumes[k].m[j].position.y - 1.2)); if (Math.random() < 0.3) agir("recompensa"); return; }
        if (tocouEm(cadu)) { pular(cadu); coracoes(cadu.position); agir("carinho"); return; }
        var pt = pontoEm(areia); if (pt) { IA.parar(); irPara(cadu, Math.max(-8, Math.min(8, pt.x)), Math.max(-7, Math.min(5, pt.z))); }
      },
      ferramenta: function (id) { if (id === "peixes") { IA.parar(); soltarRacao(); } return true; }
    };
  }

  // ================================================================== MUNDO 4 — HORTA (←)
  var ESTAGIO_MS = 8 * 60 * 1000, TIPOS = ["cenoura", "tomate", "abóbora", "milho"];
  function mundoHorta() {
    var c = base();
    c.add(ceuDegrade(0x48cae4, 0xcaf0f8, 0xf1faee));
    c.fog = new THREE.Fog(0xcaf0f8, 22, 60);
    luzes(c, 0xffffff, 0x6b8e23, 0.8, new THREE.Vector3(8, 14, 6), 0xfff1c1);
    function altura(x, z) { var d = Math.sqrt(x * x + z * z); return (d < 5.5 ? 0 : ruido(x, z) * 0.4 + (d - 5.5) * 0.18); }
    var chao = terreno(50, 46, altura, function (y, x, z) { if (Math.abs(x) < 3.1 && z > -2.4 && z < 3.6) return 0x8d6e63; return y > 1 ? 0x6a994e : 0x90be6d; });
    c.add(chao);
    c.add(capim(700, 15, altura, [0x588157, 0xa7c957], function (x, z) { return Math.abs(x) < 3.4 && z > -2.8 && z < 4; }));
    c.add(malha(new THREE.SphereGeometry(2.4, 14, 10), 0xfff3b0, 18, 20, -40, { fog: false }, "B"));
    var nuvens = []; for (var i = 0; i < 6; i++) { var n = nuvem(aleat(-28, 28), aleat(10, 15), aleat(-35, -15), aleat(1, 1.7)); c.add(n); nuvens.push(n); }
    // celeiro
    var cel = new THREE.Group(); cel.position.set(-7, altura(-7, -5), -5); cel.rotation.y = 0.5;
    cel.add(malha(new THREE.BoxGeometry(3.4, 2.6, 3), 0xae2012, 0, 1.3, 0));
    var tc = malha(new THREE.CylinderGeometry(1.75, 1.75, 3.1, 4, 1, false, 0, Math.PI), 0x5e3b25, 0, 2.6, 0); tc.rotation.z = Math.PI / 2; tc.rotation.y = Math.PI / 2; tc.scale.set(1, 1, 1.4); cel.add(tc);
    cel.add(malha(new THREE.BoxGeometry(1.4, 1.8, 0.1), 0xf4e1c1, 0, 0.9, 1.52)); cel.add(girada(malha(new THREE.BoxGeometry(1.4, 0.12, 0.12), 0xffffff, 0, 0.9, 1.6), 0, 0, 0.9));
    c.add(cel);
    // moinho
    var moinho = new THREE.Group(); moinho.position.set(7.5, altura(7.5, -6), -6);
    moinho.add(malha(new THREE.CylinderGeometry(0.5, 0.9, 5, 8), 0xf1faee, 0, 2.5, 0)); moinho.add(malha(new THREE.ConeGeometry(0.75, 1, 8), 0x9c6644, 0, 5.4, 0));
    var pas = new THREE.Group(); pas.position.set(0, 4.7, 0.85);
    for (i = 0; i < 4; i++) { var h2 = new THREE.Group(); h2.rotation.z = i * Math.PI / 2; h2.add(malha(new THREE.BoxGeometry(0.4, 2.3, 0.04), 0xffffff, 0, 1.2, 0)); h2.add(malha(new THREE.BoxGeometry(0.05, 2.4, 0.06), 0x7f5539, -0.2, 1.2, 0)); pas.add(h2); }
    moinho.add(pas); c.add(moinho);
    // espantalho
    var esp = new THREE.Group(); esp.position.set(4.6, altura(4.6, 1), 1);
    esp.add(malha(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 4), 0x7f5539, 0, 1.1, 0)); esp.add(girada(malha(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 4), 0x7f5539, 0, 1.5, 0), 0, 0, Math.PI / 2));
    esp.add(malha(new THREE.BoxGeometry(0.7, 0.8, 0.3), 0x3a86ff, 0, 1.4, 0)); esp.add(malha(new THREE.SphereGeometry(0.28, 8, 6), 0xf4e1c1, 0, 2.05, 0)); esp.add(malha(new THREE.ConeGeometry(0.4, 0.45, 8), 0xe9c46a, 0, 2.38, 0));
    c.add(esp);
    // cerca ao redor
    for (i = 0; i < 22; i++) { var a = i / 22 * 6.283, fx = Math.cos(a) * 9, fz = Math.sin(a) * 7.5 + 0.5; if (fz > 6) continue; c.add(malha(new THREE.BoxGeometry(0.12, 0.8, 0.12), 0xd4a373, fx, altura(fx, fz) + 0.4, fz)); }
    // canteiros 3x3
    while (jogo.horta.length < 9) jogo.horta.push(null);
    var canteiros = [], plantas = [];
    for (i = 0; i < 9; i++) {
      var x = (i % 3 - 1) * 1.9, z = (Math.floor(i / 3) - 1) * 1.9 + 0.6;
      var cant = new THREE.Group(); cant.position.set(x, 0, z);
      var terra = malha(new THREE.BoxGeometry(1.55, 0.22, 1.55), 0x6d4c41, 0, 0.11, 0); terra.userData.i = i; cant.add(terra);
      for (var r = -1; r <= 1; r++) { var sulco = malha(new THREE.BoxGeometry(1.45, 0.06, 0.2), 0x5d4037, 0, 0.24, r * 0.45); sulco.userData.i = i; cant.add(sulco); }
      cant.userData.i = i; c.add(cant); canteiros.push(cant);
      var pl = new THREE.Group(); pl.position.set(x, 0.24, z); c.add(pl); plantas.push(pl);
    }
    function estagio(s) { if (!s) return -1; return Math.min(4, Math.floor((agora() - s.p + (s.ag || 0)) / ESTAGIO_MS)); }
    function desenharPlanta(i) {
      var pl = plantas[i], s = jogo.horta[i], e = estagio(s);
      while (pl.children.length) pl.remove(pl.children[0]);
      pl.userData.e = e; if (e < 0) return;
      if (e === 0) { for (var q = 0; q < 3; q++) pl.add(malha(new THREE.SphereGeometry(0.07, 5, 4), 0x3e2723, (q - 1) * 0.35, 0.04, 0)); return; }
      var t = TIPOS[s.t % 4], esc = 0.35 + e * 0.17;
      for (q = -1; q <= 1; q += 2) {
        var p2 = new THREE.Group(); p2.position.x = q * 0.36;
        p2.add(malha(new THREE.CylinderGeometry(0.03, 0.04, 0.5 * esc, 4), 0x2d6a4f, 0, 0.25 * esc, 0));
        for (var f = 0; f < 3; f++) { var fol = malha(new THREE.SphereGeometry(0.15 * esc, 6, 4), f % 2 ? 0x52b788 : 0x40916c, Math.cos(f * 2.1) * 0.12 * esc, 0.45 * esc, Math.sin(f * 2.1) * 0.12 * esc); fol.scale.set(1.4, 0.5, 0.8); fol.rotation.y = f * 2.1; p2.add(fol); }
        if (e === 4) {
          if (t === "cenoura") { var cn = malha(new THREE.ConeGeometry(0.12, 0.42, 6), 0xff7b00, 0, 0.12, 0); cn.rotation.x = Math.PI; p2.add(cn); }
          else if (t === "tomate") { p2.add(malha(new THREE.SphereGeometry(0.15, 8, 6), 0xe63946, 0.12, 0.42, 0)); p2.add(malha(new THREE.SphereGeometry(0.12, 8, 6), 0xd62828, -0.1, 0.32, 0.06)); }
          else if (t === "abóbora") { var ab = malha(new THREE.SphereGeometry(0.28, 10, 8), 0xf77f00, 0, 0.2, 0.15, { liso: true }); ab.scale.y = 0.7; p2.add(ab); }
          else { var mi = malha(new THREE.CylinderGeometry(0.09, 0.07, 0.4, 6), 0xffd60a, 0.08, 0.6, 0); mi.rotation.z = -0.3; p2.add(mi); }
        }
        pl.add(p2);
      }
      if (e === 4) pl.add(malha(new THREE.OctahedronGeometry(0.11, 0), 0xffd166, 0, 1.15, 0, null, "B"));
    }
    for (i = 0; i < 9; i++) desenharPlanta(i);
    var cesta = new THREE.Group(); cesta.position.set(3.9, 0, 3.6); cesta.add(malha(new THREE.CylinderGeometry(0.5, 0.38, 0.5, 10), 0xd4a373, 0, 0.25, 0)); cesta.add(malha(new THREE.TorusGeometry(0.35, 0.04, 4, 10, Math.PI), 0xb08968, 0, 0.5, 0));
    var conteudo = malha(new THREE.SphereGeometry(0.4, 8, 6), 0xff7b00, 0, 0.45, 0); conteudo.scale.y = 0.35; cesta.add(conteudo); c.add(cesta);
    var regador = new THREE.Group(); regador.add(malha(new THREE.CylinderGeometry(0.16, 0.18, 0.3, 8), 0x8ecae6)); var bico = malha(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 4), 0x8ecae6, 0.22, 0.05, 0); bico.rotation.z = -1; regador.add(bico); regador.position.set(0.45, 0.7, 0.2); regador.visible = false;
    var cadu = criarCadu(); cadu.position.set(3, 0, 3.4); cadu.userData.corpoG.add(regador); c.add(cadu);
    var chapeu = new THREE.Group(); chapeu.add(malha(new THREE.CylinderGeometry(0.58, 0.6, 0.05, 12), 0xe9c46a, 0, 1.12, 0)); chapeu.add(malha(new THREE.CylinderGeometry(0.28, 0.33, 0.28, 10), 0xe9c46a, 0, 1.28, 0)); chapeu.add(malha(new THREE.CylinderGeometry(0.335, 0.335, 0.07, 10), 0xe63946, 0, 1.18, 0)); cadu.userData.corpoG.add(chapeu);
    var revisao = 0, ocupado = false;
    function cuidar(i, cb) {
      var alvo = canteiros[i].position; ocupado = true;
      irPara(cadu, alvo.x, alvo.z + 1.05, function () {
        cadu.rotation.y = Math.PI;
        var s = jogo.horta[i], e = estagio(s);
        if (e < 0) { jogo.horta[i] = { t: Math.floor(Math.random() * 4), p: agora(), ag: 0, ar: 0 }; falar("Plantei " + TIPOS[jogo.horta[i].t] + "!"); som("plop"); }
        else if (e < 4) {
          if (agora() - (s.ar || 0) < 60000) { falar("Já reguei esse."); ocupado = false; if (cb) cb(); return; }
          s.ag = (s.ag || 0) + ESTAGIO_MS / 2; s.ar = agora(); regador.visible = true;
          for (var k = 0; k < 14; k++) particula(0x48cae4, alvo.x + aleat(-.5, .5), 1.3, alvo.z + aleat(-.5, .5), 0, -1.5, 0, 0.7, -3);
          setTimeout(function () { regador.visible = false; }, 1200); falar("Reguei!"); som("bolha");
        } else {
          jogo.horta[i] = null; jogo.colheita++; moeda(2); agir("recompensa"); pular(cadu, 4);
          explosao(0xff7b00, alvo.clone().setY(0.8), 12, 1.6); falar("Colhi! Cesta: " + jogo.colheita);
        }
        desenharPlanta(i); salvarJogo(); contador(); ocupado = false; if (cb) cb();
      });
    }
    var IA = cerebro([
      { peso: function () { for (var q = 0; q < 9; q++) if (estagio(jogo.horta[q]) === 4) return 8; return 0; }, dura: function () { return 6; }, ini: function () { for (var q = 0; q < 9; q++) if (estagio(jogo.horta[q]) === 4) return cuidar(q); } },
      { peso: function () { for (var q = 0; q < 9; q++) if (estagio(jogo.horta[q]) < 0) return 5; return 0; }, dura: function () { return 6; }, ini: function () { for (var q = 0; q < 9; q++) if (estagio(jogo.horta[q]) < 0) return cuidar(q); } },
      { peso: function () { for (var q = 0; q < 9; q++) { var s = jogo.horta[q], e = estagio(s); if (e >= 0 && e < 4 && agora() - (s.ar || 0) > 60000) return 4; } return 0; }, dura: function () { return 6; }, ini: function () { for (var q = 0; q < 9; q++) { var s = jogo.horta[q], e = estagio(s); if (e >= 0 && e < 4 && agora() - (s.ar || 0) > 60000) return cuidar(q); } } },
      { peso: function () { return pet.barriga < 45 && jogo.colheita > 0 ? 6 : 0; }, dura: function () { return 5; }, ini: function () { irPara(cadu, 3.9, 4.4, function () { jogo.colheita--; cadu.userData.comendo = 2; agir("alimentar"); salvarJogo(); contador(); falar("Hmm, fresquinho!"); }); } },
      { peso: function () { return 2; }, dura: function () { return aleat(3, 5); }, ini: function () { irPara(cadu, aleat(-6, 6), aleat(-4, 5)); } },
      { peso: function () { return 1; }, dura: function () { return 3; }, ini: function () { cadu.userData.alvo = null; cadu.userData.acenar = 2.5; } }
    ]);
    return {
      cena: c, cadu: cadu,
      ferramentas: [{ id: "comerColheita", icone: "apple", cor: "#ff8a65" }],
      contador: function () { return "colheita " + jogo.colheita + " · moedas " + jogo.moedas; },
      camera: function (dt, auto) { var o = auto ? Math.sin(tempo * 0.07) * 2 : 0; cam.position.lerp(new THREE.Vector3(o, 8.5, 10.5), Math.min(1, dt * 2)); cam.lookAt(0, 0, 0.6); },
      atualizar: function (dt, auto) {
        pas.rotation.z += dt * 1.1;
        for (var i = 0; i < nuvens.length; i++) { nuvens[i].position.x += dt * 0.35; if (nuvens[i].position.x > 32) nuvens[i].position.x = -32; }
        conteudo.visible = jogo.colheita > 0; conteudo.scale.set(1, 0.2 + Math.min(1, jogo.colheita / 6) * 0.4, 1);
        revisao -= dt;
        if (revisao <= 0) { revisao = 5; for (var k = 0; k < 9; k++) if (plantas[k].userData.e !== estagio(jogo.horta[k])) desenharPlanta(k); }
        for (k = 0; k < 9; k++) if (plantas[k].userData.e === 4) { var sp = plantas[k].children[plantas[k].children.length - 1]; sp.rotation.y += dt * 3; sp.position.y = 1.15 + Math.sin(tempo * 3 + k) * 0.08; }
        if (auto && !ocupado) IA.passo(dt);
        cadu.userData.olhando = cam.position;
        mover(cadu, dt, 2.2, altura); animarCadu(cadu, dt);
      },
      toque: function () {
        if (tocouEm(cadu)) { pular(cadu); coracoes(cadu.position); agir("carinho"); return; }
        var hit = raio.intersectObjects(canteiros.concat(plantas), true);
        if (!hit.length) { var pt = pontoEm(chao); if (pt) { IA.parar(); irPara(cadu, Math.max(-8, Math.min(8, pt.x)), Math.max(-6, Math.min(5.5, pt.z))); } return; }
        var o = hit[0].object, i = -1;
        while (o && i < 0) { if (o.userData && o.userData.i !== undefined) i = o.userData.i; else { var idx = plantas.indexOf(o); if (idx >= 0) i = idx; } o = o.parent; }
        if (i >= 0) { IA.parar(); cuidar(i); }
      },
      ferramenta: function (id) {
        if (id !== "comerColheita") return true;
        if (pet.dormindo) return falar("Zzz…"), false;
        if (jogo.colheita <= 0) return falar("A cesta está vazia. Colha algo!"), false;
        IA.parar(); irPara(cadu, 3.9, 4.4, function () { jogo.colheita--; cadu.userData.comendo = 2; pular(cadu, 3); agir("alimentar"); salvarJogo(); contador(); });
        return true;
      }
    };
  }

  // ================================================================== MUNDO 5 — ESTRADA ELÉTRICA (→)
  function mundoEstrada() {
    var c = base();
    c.add(ceuDegrade(0x3d348b, 0xff9e7a, 0xffd6a5));
    c.fog = new THREE.Fog(0xffb8a0, 18, 70);
    luzes(c, 0xffd6c9, 0x5c4d7d, 0.8, new THREE.Vector3(-4, 6, -10), 0xffc09f);
    var sol = malha(new THREE.CircleGeometry(7, 24), 0xffd166, 0, 9, -85, { fog: false }, "B"); c.add(sol);
    for (var i = 0; i < 5; i++) c.add(malha(new THREE.PlaneGeometry(20, 0.5), 0xff9e7a, 0, 5 + i * 1.6, -84, { fog: false }, "B"));
    // horizonte com prédios em camadas
    for (var cam2 = 0; cam2 < 2; cam2++) for (i = 0; i < 18; i++) {
      var h = aleat(3, 13) * (cam2 ? 0.7 : 1), pr = malha(new THREE.BoxGeometry(aleat(2, 4), h, 2), cam2 ? 0x6d597a : 0x355070, -40 + i * 4.6 + cam2 * 2, h / 2, -62 - cam2 * 6, { fog: false });
      c.add(pr);
      if (!cam2) for (var j = 0; j < 4; j++) if (Math.random() < 0.5) c.add(malha(new THREE.BoxGeometry(0.4, 0.4, 0.05), 0xffd166, pr.position.x + aleat(-0.6, 0.6), aleat(1, h - 0.5), -60.9, { fog: false }, "B"));
    }
    // estrada, calçada, grama
    c.add(malha(new THREE.BoxGeometry(8, 0.1, 140), 0x2b2d42, 0, 0, -50));
    for (var l = -1; l <= 1; l += 2) { c.add(malha(new THREE.BoxGeometry(1.6, 0.25, 140), 0x9a8c98, l * 4.8, 0.08, -50)); c.add(malha(new THREE.BoxGeometry(40, 0.05, 140), 0x6a994e, l * 25.6, -0.02, -50)); }
    var faixas = [];
    for (i = 0; i < 26; i++) for (l = -1; l <= 1; l += 2) { var fx = malha(new THREE.BoxGeometry(0.14, 0.03, 1.6), 0xffffff, l * 1.33, 0.07, -i * 4.2); c.add(fx); faixas.push(fx); }
    var cenario = [];
    for (i = 0; i < 16; i++) {
      var lado = i % 2 ? 1 : -1, ob;
      if (i % 4 < 2) { ob = new THREE.Group(); ob.add(malha(new THREE.CylinderGeometry(0.07, 0.09, 3.6, 6), 0x2b2d42, 0, 1.8, 0)); var braco = malha(new THREE.BoxGeometry(0.9, 0.08, 0.08), 0x2b2d42, -lado * 0.4, 3.55, 0); ob.add(braco); ob.add(malha(new THREE.BoxGeometry(0.4, 0.12, 0.25), 0xfff3b0, -lado * 0.8, 3.48, 0, null, "B")); ob.position.set(lado * 4.8, 0, -i * 6); }
      else { ob = arvore(lado * aleat(6.5, 9), -i * 6, aleat(0.8, 1.2), escolha(["copa", "pinheiro"])); }
      c.add(ob); cenario.push(ob);
    }
    // carrinho elétrico
    var carro = new THREE.Group();
    var lat = malha(new THREE.BoxGeometry(1.5, 0.5, 2.4), 0x48cae4, 0, 0.45, 0, { liso: true }); carro.add(lat);
    var capo = malha(new THREE.BoxGeometry(1.46, 0.25, 0.8), 0x48cae4, 0, 0.75, -0.75); capo.rotation.x = 0.25; carro.add(capo);
    carro.add(malha(new THREE.BoxGeometry(1.3, 0.5, 1.1), 0xcaf0f8, 0, 0.95, 0.25, { transparent: true, opacity: 0.55 }));
    carro.add(malha(new THREE.BoxGeometry(1.52, 0.08, 2.42), 0x023e8a, 0, 0.25, 0));
    for (l = -1; l <= 1; l += 2) { carro.add(malha(new THREE.BoxGeometry(0.28, 0.12, 0.05), 0xfff3b0, l * 0.5, 0.55, -1.21, null, "B")); carro.add(malha(new THREE.BoxGeometry(0.3, 0.1, 0.05), 0xff4d6d, l * 0.5, 0.55, 1.21, null, "B")); }
    var raioLogo = malha(new THREE.BoxGeometry(0.1, 0.35, 0.04), 0xffd166, 0.76, 0.5, 0, null, "B"); raioLogo.rotation.z = 0.4; carro.add(raioLogo);
    var rodas = [], rodaG = new THREE.CylinderGeometry(0.3, 0.3, 0.22, 12);
    for (i = 0; i < 4; i++) { var rd = malha(rodaG, 0x1b1b1b, i % 2 ? 0.76 : -0.76, 0.3, i < 2 ? 0.8 : -0.8, { liso: true }); rd.rotation.z = Math.PI / 2; carro.add(rd); rodas.push(rd); rd.add(malha(new THREE.CylinderGeometry(0.14, 0.14, 0.24, 8), 0xced4da)); }
    carro.add(sombra(1.4));
    c.add(carro);
    var cadu = criarCadu(); cadu.scale.setScalar(0.62); cadu.position.set(0, 0.62, 0.3); cadu.rotation.y = Math.PI; carro.add(cadu);
    cadu.userData.corpoG.children[0].visible = true;
    var obst = [], moedasE = [], faixa = 0, xAlvo = 0, vel = 0, dist = 0, estado = "parado", spawn = 0, tBatida = 0, manualAte = 0;
    var geoCone = new THREE.ConeGeometry(0.38, 0.95, 8), geoCarro = new THREE.BoxGeometry(1.4, 0.9, 2.2), geoMoeda = new THREE.TorusGeometry(0.3, 0.09, 6, 14), geoBarreira = new THREE.BoxGeometry(1.8, 0.6, 0.3);
    var X = [-2.66, 0, 2.66];
    function limpar() { var k; for (k = 0; k < obst.length; k++) c.remove(obst[k]); for (k = 0; k < moedasE.length; k++) c.remove(moedasE[k]); obst = []; moedasE = []; }
    function iniciar() { limpar(); faixa = 0; xAlvo = 0; carro.position.x = 0; carro.rotation.set(0, 0, 0); vel = 10; dist = 0; estado = "correndo"; spawn = 1.2; som("trocar"); }
    function criarObst() {
      var f = Math.floor(Math.random() * 3) - 1, o, t = Math.random();
      if (t < 0.45) { o = new THREE.Group(); o.add(malha(geoCone, 0xff7b00, 0, 0.47, 0)); o.add(malha(new THREE.CylinderGeometry(0.27, 0.32, 0.12, 8), 0xffffff, 0, 0.5, 0)); }
      else if (t < 0.75) { o = new THREE.Group(); var cc = escolha([0xef476f, 0x8338ec, 0x06d6a0, 0xffd166]); o.add(malha(geoCarro, cc, 0, 0.55, 0)); o.add(malha(new THREE.BoxGeometry(1.2, 0.45, 1.1), 0x22223b, 0, 1.1, 0.1)); o.add(malha(new THREE.BoxGeometry(0.3, 0.1, 0.05), 0xff4d6d, 0.45, 0.6, 1.11, null, "B")); o.add(malha(new THREE.BoxGeometry(0.3, 0.1, 0.05), 0xff4d6d, -0.45, 0.6, 1.11, null, "B")); }
      else { o = new THREE.Group(); o.add(malha(geoBarreira, 0xffffff, 0, 0.6, 0)); for (var k = -1; k <= 1; k++) o.add(malha(new THREE.BoxGeometry(0.3, 0.62, 0.32), 0xe63946, k * 0.6, 0.6, 0)); o.add(malha(new THREE.BoxGeometry(0.1, 0.6, 0.1), 0x555555, -0.7, 0.3, 0)); o.add(malha(new THREE.BoxGeometry(0.1, 0.6, 0.1), 0x555555, 0.7, 0.3, 0)); }
      o.position.set(X[f + 1], 0, -60); o.userData.f = f; c.add(o); obst.push(o);
      if (Math.random() < 0.75) { var lf = f; while (lf === f) lf = Math.floor(Math.random() * 3) - 1; for (var q = 0; q < 4; q++) { var m = malha(geoMoeda, 0xffd166, X[lf + 1], 0.75, -60 - q * 2, { emissive: 0x9d7400 }); m.userData.f = lf; c.add(m); moedasE.push(m); } }
    }
    // piloto automático: escolhe a faixa mais segura olhando à frente, prefere moedas
    function decidir() {
      var risco = [0, 0, 0];
      for (var k = 0; k < obst.length; k++) { var z = obst[k].position.z; if (z < 1 && z > -22) risco[obst[k].userData.f + 1] += (22 + z) * 2; }
      for (k = 0; k < moedasE.length; k++) { var zm = moedasE[k].position.z; if (zm < 1 && zm > -18) risco[moedasE[k].userData.f + 1] -= 6; }
      var melhor = faixa, mv = 1e9;
      for (var f = -1; f <= 1; f++) { var custo = risco[f + 1] + Math.abs(f - faixa) * 4; if (custo < mv) { mv = custo; melhor = f; } }
      if (melhor !== faixa) faixa += melhor > faixa ? 1 : -1;
      xAlvo = X[faixa + 1];
    }
    var tDecide = 0;
    return {
      cena: c, cadu: cadu, ferramentas: [],
      contador: function () { return estado === "correndo" ? Math.floor(dist) + " m · recorde " + jogo.recorde + " m" : "recorde " + jogo.recorde + " m · moedas " + jogo.moedas; },
      camera: function (dt) { cam.position.lerp(new THREE.Vector3(carro.position.x * 0.6, 3.3 + (vel > 18 ? 0.2 : 0), 6.8 - Math.min(1, vel / 30)), Math.min(1, dt * 4)); cam.lookAt(carro.position.x * 0.6, 0.7, -6); },
      atualizar: function (dt, auto) {
        animarCadu(cadu, dt);
        carro.position.x += (xAlvo - carro.position.x) * Math.min(1, dt * 9);
        carro.rotation.z = (carro.position.x - xAlvo) * 0.12; carro.rotation.y = (carro.position.x - xAlvo) * 0.08;
        var piloto = auto && agora() > manualAte;
        if (estado === "parado") { if (piloto) iniciar(); return; }
        if (estado === "batido") { tBatida -= dt; carro.rotation.y += dt * 8 * Math.max(0, tBatida - 1.5); if (tBatida <= 0 && piloto) iniciar(); return; }
        vel = Math.min(30, vel + dt * 0.4); dist += vel * dt;
        for (var i = 0; i < rodas.length; i++) rodas[i].rotation.x -= vel * dt * 3.3;
        for (i = 0; i < faixas.length; i++) { faixas[i].position.z += vel * dt; if (faixas[i].position.z > 6) faixas[i].position.z -= 109.2; }
        for (i = 0; i < cenario.length; i++) { cenario[i].position.z += vel * dt; if (cenario[i].position.z > 8) cenario[i].position.z -= 96; }
        if (vel > 16 && Math.random() < dt * vel * 0.4) particula(0xffffff, aleat(-6, 6), aleat(0.5, 3), -10, 0, 0, vel * 1.5, 0.5, 0, 0.6);
        spawn -= dt; if (spawn <= 0) { spawn = Math.max(0.5, 1.7 - vel / 28); criarObst(); }
        if (piloto) { tDecide -= dt; if (tDecide <= 0) { tDecide = 0.25; decidir(); } }
        for (i = obst.length - 1; i >= 0; i--) {
          var o = obst[i]; o.position.z += vel * dt;
          if (o.position.z > -1.3 && o.position.z < 1.3 && Math.abs(o.position.x - carro.position.x) < 1.2) {
            estado = "batido"; tBatida = 3; explosao(0xff7b00, carro.position.clone().setY(0.9), 20, 3.5); som("bate"); cadu.userData.surpresa = 2;
            var d = Math.floor(dist);
            if (d > jogo.recorde) { jogo.recorde = d; falar("Novo recorde: " + d + " m!"); agir("recompensa"); } else falar("Bati! " + d + " m" + (piloto ? "" : ". Toque para correr de novo."));
            salvarJogo(); contador(); return;
          }
          if (o.position.z > 10) { c.remove(o); obst.splice(i, 1); }
        }
        for (i = moedasE.length - 1; i >= 0; i--) {
          var m = moedasE[i]; m.position.z += vel * dt; m.rotation.y += dt * 6;
          if (m.position.z > -1 && m.position.z < 1 && Math.abs(m.position.x - carro.position.x) < 1) { explosao(0xffd166, m.position, 5, 1); c.remove(m); moedasE.splice(i, 1); moeda(1); continue; }
          if (m.position.z > 10) { c.remove(m); moedasE.splice(i, 1); }
        }
        if (Math.floor(dist) % 25 === 0) contador();
      },
      toque: function (ndc) {
        manualAte = agora() + 15000;
        if (estado !== "correndo") { iniciar(); contador(); return; }
        faixa = Math.max(-1, Math.min(1, faixa + (ndc.x < 0 ? -1 : 1))); xAlvo = X[faixa + 1]; som("pulo");
      },
      ferramenta: function () { return true; },
      aoEntrar: function () { falar("Toque esquerda/direita para trocar de faixa!"); }
    };
  }

  var FABRICAS = { vila: mundoVila, ceu: mundoCeu, mar: mundoMar, horta: mundoHorta, estrada: mundoEstrada };

  // ================================================================== troca de mundo
  function liberar(obj) { obj.traverse(function (o) { if (o.geometry && o.geometry !== geoPart) o.geometry.dispose(); }); }
  function carregar(id) {
    if (cena) { liberar(cena); parts = []; }
    idAtual = id; atual = FABRICAS[id](); cena = atual.cena; tTour = 0;
    if (atual.camera) { atual.camera(1, false); }
    if (opc.aoMundo) opc.aoMundo(id, NOMES[id], VIZINHOS[id], atual.ferramentas || []);
    contador();
    if (atual.aoEntrar && !autoAtivo()) atual.aoEntrar();
  }
  function trocarPara(dest) {
    if (!dest || trocando || dest === idAtual) return false;
    if (JOGOS[dest]) { som("trocar"); if (opc.abrirJogo) opc.abrirJogo(dest, JOGOS[dest]); return true; }
    trocando = true; som("trocar");
    var veu = document.getElementById("veu3d"); if (veu) veu.className = "ver";
    setTimeout(function () { carregar(dest); setTimeout(function () { if (veu) veu.className = ""; trocando = false; }, 90); }, 280);
    return true;
  }
  function trocar(direcao) { return trocarPara(VIZINHOS[idAtual][direcao]); }

  // ================================================================== toque e gestos
  var ini = null;
  function inicioToque(x, y) { ini = { x: x, y: y }; ultimoToque = agora(); if (audio && audio.state === "suspended") audio.resume(); }
  function fimToque(x, y) {
    if (!ini) return;
    var dx = x - ini.x, dy = y - ini.y, adx = Math.abs(dx), ady = Math.abs(dy); ini = null; ultimoToque = agora();
    if (Math.max(adx, ady) > 60) {
      var dir = adx > ady ? (dx > 0 ? "direita" : "esquerda") : (dy < 0 ? "cima" : "baixo");
      if (!trocar(dir) && opc.semSaida) opc.semSaida(dir);
      return;
    }
    var r = cont.getBoundingClientRect();
    ponteiro.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raio.setFromCamera(ponteiro, cam);
    if (atual && atual.toque) atual.toque(ponteiro);
  }

  // ================================================================== laço principal (~30 fps)
  function quadro(t) {
    if (!ligado) { ultimo = 0; return; }
    requestAnimationFrame(quadro);
    if (!ultimo) ultimo = t;
    var dt = Math.min(0.1, (t - ultimo) / 1000); ultimo = t; acum += dt;
    if (acum < 1 / 31) return;
    dt = Math.min(0.1, acum); acum = 0; tempo += dt;
    var auto = autoAtivo();
    if (auto !== autoEstava) { autoEstava = auto; if (opc.aoAuto) opc.aoAuto(auto); }
    if (atual) { atual.atualizar(dt, auto); if (atual.camera) atual.camera(dt, auto); }
    atualizarParticulas(dt);
    if (auto && tour && !trocando) { tTour += dt; if (tTour > TOUR_S) { tTour = 0; iTour = (iTour + 1) % ROTA_TOUR.length; if (idAtual !== "vila") trocarPara("vila"); else trocarPara(ROTA_TOUR[iTour]); } }
    R.render(cena, cam);
    if (opc.aoQuadro && atual && atual.cadu) {
      var p = new THREE.Vector3(); atual.cadu.getWorldPosition(p); p.y += 1.9; p.project(cam);
      var r = cont.getBoundingClientRect();
      opc.aoQuadro({ x: (p.x + 1) / 2 * r.width, y: (1 - p.y) / 2 * r.height });
    }
  }
  function medir() {
    var w = cont.clientWidth || window.innerWidth, h = cont.clientHeight || window.innerHeight;
    R.setSize(Math.round(w * ESC), Math.round(h * ESC), false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
  }

  return {
    iniciar: function (container, opcoes) {
      cont = container; opc = opcoes || {};
      R = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
      R.setPixelRatio(1);
      R.domElement.style.width = "100%"; R.domElement.style.height = "100%"; R.domElement.style.imageRendering = "pixelated";
      cont.appendChild(R.domElement);
      cam = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
      raio = new THREE.Raycaster(); ponteiro = new THREE.Vector2();
      geoPart = new THREE.BoxGeometry(0.12, 0.12, 0.12);
      medir(); window.addEventListener("resize", medir);
      cont.addEventListener("touchstart", function (e) { var t = e.touches[0]; inicioToque(t.clientX, t.clientY); }, false);
      cont.addEventListener("touchend", function (e) { var t = e.changedTouches[0]; fimToque(t.clientX, t.clientY); e.preventDefault(); }, false);
      cont.addEventListener("mousedown", function (e) { inicioToque(e.clientX, e.clientY); });
      cont.addEventListener("mouseup", function (e) { fimToque(e.clientX, e.clientY); });
      ultimoToque = agora();
      carregar("vila");
      requestAnimationFrame(quadro);
    },
    ativo: function (sim) { if (sim && !ligado) { ligado = true; requestAnimationFrame(quadro); } ligado = !!sim; },
    estado: function (e) { if (e) { pet = e; } },
    jogo: function (j) { if (j) { for (var k in j) jogo[k] = j[k]; if (idAtual === "horta" || idAtual === "ceu") carregar(idAtual); else contador(); } return jogo; },
    ferramenta: function (id) { ultimoToque = agora(); if (id === "casa") { trocarPara("vila"); return "ok"; } return atual && atual.ferramenta ? atual.ferramenta(id) : true; },
    irPara: function (dir) { return trocar(dir); },
    mundo: function () { return idAtual; },
    doente: function (s) { doenteFlag = !!s; },
    surpreso: function () { if (atual && atual.cadu) { atual.cadu.userData.surpresa = 3; pular(atual.cadu, 4); } },
    debug: function () { return { cam: cam, atual: atual }; },
    config: function (c2) {
      if (c2.estilo && ESTILOS[c2.estilo] && c2.estilo !== estiloCadu) { estiloCadu = c2.estilo; if (atual) carregar(idAtual); } if (c2.tour !== undefined) tour = !!c2.tour; if (c2.som !== undefined) somLigado = !!c2.som; if (c2.autoApos) AUTO_APOS = c2.autoApos; },
    autoAgora: function () { ultimoToque = 0; },
    moedas: function (n) { jogo.moedas += n || 1; salvarJogo(); contador(); },
    voltouDoJogo: function (tocou) { tTour = 0; if (tocou) ultimoToque = agora(); },
    suportado: function () { try { var c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl"))); } catch (e) { return false; } }
  };
})();
