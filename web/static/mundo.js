/*
 * Mundo do Cadu — quarto isométrico em pixel art com o bichinho (estilo Tamagotchi).
 * Personagem e cenário originais, desenhados por código (sem imagens externas).
 * Canvas em baixa resolução ampliado sem suavizar = visual pixel nítido e leve para o J3.
 * ES5 de propósito (WebView do Android 5.1).
 *
 * API: Mundo.iniciar(canvas, opcoes) · Mundo.acao("comer"|"brincar"|"luz") · Mundo.estado(petJSON)
 *      Mundo.doente(bool) · Mundo.surpreso() · Mundo.fala(texto) · Mundo.ativo(bool)
 */
var Mundo = (function () {
  var cv, ctx, fundo, fctx, W, H, ESC, opc = {};
  var TW = 26, TH = 13, N = 7, OX, OY, PAREDE = 46;
  var ligado = true, ultimoT = 0, acumulado = 0;
  var pet = { x: 3.2, y: 3.2, alvo: null, aoChegar: null, dir: 1, modo: "livre", tModo: 0, pulo: 0, ocioso: 2 };
  var est = { fase: "bebe", humor: "feliz", dormindo: false, barriga: 80, alegria: 80, energia: 80, carinhos: 0 };
  var doenteFlag = false, surpresaT = 0, luzApagada = false, comidaNoPote = 0;
  var bola = null, particulas = [], tempo = 0, horaFundo = -1, fundoSujo = true;

  // ---------------------------------------------------------------- paleta
  var C = {
    vazio: "#0d1020", piso1: "#c9a27a", piso2: "#bb9268", pisoL: "#8f6b4b",
    parE: "#5b6c9a", parE2: "#52628d", parD: "#6c7fb0", parD2: "#62749f", rodape: "#3c4566",
    tapete: "#d1495b", tapete2: "#b83d4f", tapeteB: "#edae49",
    cama: "#3b4a7a", lencol: "#e8eef7", trav: "#f2c14e", madeira: "#7a4f32", madeira2: "#5e3b25",
    planta: "#3fae6a", planta2: "#2c7d4c", vaso: "#c0603c",
    corpo: "#7fd4c1", corpoS: "#55aa9a", corpoL: "#c4f2e7", contorno: "#1c3a38",
    olho: "#13222a", brilho: "#ffffff", bochecha: "#f28b9a", antena: "#ffd166",
    doente: "#a8c96b", doenteS: "#7d9a4a", sombra: "rgba(0,0,0,.28)",
    ovo: "#f4ecd8", ovoS: "#d8cdb2", ovoP: "#7fd4c1",
    pote: "#e07a5f", comida: "#f2cc8f", bola: "#ef476f", bolaL: "#ffb3c1",
    coracao: "#ff5d8f", z: "#cfe3ff", exc: "#ffd166"
  };

  // ---------------------------------------------------------------- utilidades de pixel
  function px(c, x, y, w, h, cor) { c.fillStyle = cor; c.fillRect(Math.round(x), Math.round(y), w || 1, h || 1); }
  function circulo(c, cx, cy, r, cor) {
    c.fillStyle = cor;
    for (var dy = -r; dy <= r; dy++) {
      var dx = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35);
      c.fillRect(Math.round(cx - dx), Math.round(cy + dy), dx * 2 + 1, 1);
    }
  }
  function elipse(c, cx, cy, rx, ry, cor) {
    c.fillStyle = cor;
    for (var dy = -ry; dy <= ry; dy++) {
      var dx = Math.floor(rx * Math.sqrt(1 - (dy * dy) / (ry * ry)) + 0.35);
      c.fillRect(Math.round(cx - dx), Math.round(cy + dy), dx * 2 + 1, 1);
    }
  }
  // losango isométrico preenchido linha a linha (bordas nítidas)
  function losango(c, cx, topo, w, h, cor) {
    c.fillStyle = cor;
    var meio = h / 2;
    for (var i = 0; i < h; i++) {
      var t = i < meio ? (i + 1) / meio : (h - i) / meio;
      var lw = Math.max(1, Math.round((w / 2) * t));
      c.fillRect(Math.round(cx - lw), Math.round(topo + i), lw * 2, 1);
    }
  }
  function iso(tx, ty) { return { x: OX + (tx - ty) * TW / 2, y: OY + (tx + ty) * TH / 2 }; }
  function deIso(sx, sy) {
    var a = (sx - OX) / (TW / 2), b = (sy - OY) / (TH / 2);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }
  function andavel(tx, ty) {
    if (tx < 0.6 || ty < 0.6 || tx > N - 0.4 || ty > N - 0.4) return false;
    if (tx < 2.1 && ty > 2.6 && ty < 5.2) return false;    // cama
    if (tx < 1.3 && ty < 1.3) return false;                 // planta
    return true;
  }

  // ---------------------------------------------------------------- cenário (desenhado 1x num canvas guardado)
  function horaDoDia() { return new Date().getHours(); }
  function corCeu(h) {
    if (h >= 6 && h < 17) return ["#8ecae6", "#bde0fe"];
    if (h >= 17 && h < 19) return ["#f4a261", "#e76f51"];
    return ["#1d2951", "#0b1330"];
  }
  function desenharFundo() {
    var c = fctx, i, j, p;
    c.fillStyle = C.vazio; c.fillRect(0, 0, W, H);
    var topo = iso(0, 0), esq = iso(0, N), dir = iso(N, 0);
    // parede esquerda (ao longo de x=0) — faixas verticais de papel de parede
    for (var sx = Math.round(esq.x); sx <= Math.round(topo.x); sx++) {
      var t = (topo.x - sx) / (topo.x - esq.x);
      var base = Math.round(topo.y + t * (esq.y - topo.y));
      c.fillStyle = ((sx >> 2) % 2) ? C.parE : C.parE2;
      c.fillRect(sx, base - PAREDE, 1, PAREDE);
      c.fillStyle = C.rodape; c.fillRect(sx, base - 3, 1, 3);
    }
    // parede direita (ao longo de y=0)
    for (sx = Math.round(topo.x); sx <= Math.round(dir.x); sx++) {
      var t2 = (sx - topo.x) / (dir.x - topo.x);
      var base2 = Math.round(topo.y + t2 * (dir.y - topo.y));
      c.fillStyle = ((sx >> 2) % 2) ? C.parD : C.parD2;
      c.fillRect(sx, base2 - PAREDE, 1, PAREDE);
      c.fillStyle = C.rodape; c.fillRect(sx, base2 - 3, 1, 3);
    }
    // janela na parede direita (céu muda com a hora)
    var ceu = corCeu(horaDoDia());
    for (sx = Math.round(iso(3, 0).x); sx <= Math.round(iso(5.2, 0).x); sx++) {
      var t3 = (sx - topo.x) / (dir.x - topo.x);
      var b3 = Math.round(topo.y + t3 * (dir.y - topo.y));
      c.fillStyle = "#2b2d42"; c.fillRect(sx, b3 - PAREDE + 8, 1, 22);
      c.fillStyle = ceu[(sx >> 3) % 2 ? 0 : 1]; c.fillRect(sx, b3 - PAREDE + 10, 1, 18);
      if (ceu[0] === "#1d2951" && (sx * 7) % 11 === 0) px(c, sx, b3 - PAREDE + 12 + (sx % 9), 1, 1, "#fff6cc");
    }
    // quadro na parede esquerda
    for (sx = Math.round(iso(0, 3.2).x); sx <= Math.round(iso(0, 1.8).x); sx++) {
      var t4 = (topo.x - sx) / (topo.x - esq.x);
      var b4 = Math.round(topo.y + t4 * (esq.y - topo.y));
      c.fillStyle = C.madeira; c.fillRect(sx, b4 - PAREDE + 10, 1, 14);
      c.fillStyle = (sx % 5 < 2) ? "#06d6a0" : "#118ab2"; c.fillRect(sx, b4 - PAREDE + 12, 1, 10);
    }
    // piso em losangos
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
      p = iso(i, j);
      losango(c, p.x, p.y, TW, TH, ((i + j) % 2) ? C.piso1 : C.piso2);
    }
    // tapete
    for (i = 2; i < 5; i++) for (j = 2; j < 5; j++) {
      p = iso(i, j);
      losango(c, p.x, p.y + 1, TW - 4, TH - 2, (i === 3 && j === 3) ? C.tapeteB : ((i + j) % 2 ? C.tapete : C.tapete2));
    }
    // cama (encostada na parede esquerda)
    var cb = iso(0.15, 3.0);
    for (i = 0; i < 2; i++) for (j = 0; j < 2; j++) {
      p = iso(0.1 + i * 0.95, 3.05 + j * 0.95);
      losango(c, p.x, p.y - 6, TW - 2, TH - 1, C.lencol);
      losango(c, p.x, p.y - 5, TW - 2, TH - 1, C.cama);
    }
    p = iso(0.5, 3.4); elipse(c, p.x, p.y - 4, 7, 3, C.lencol);                 // travesseiro
    px(c, cb.x - 2, cb.y - 20, 4, 16, C.madeira2);                               // cabeceira
    // planta no canto
    p = iso(0.6, 0.6);
    px(c, p.x - 4, p.y - 6, 9, 7, C.vaso); px(c, p.x - 5, p.y - 7, 11, 2, "#d9774e");
    circulo(c, p.x, p.y - 13, 6, C.planta); circulo(c, p.x - 4, p.y - 17, 4, C.planta2); circulo(c, p.x + 4, p.y - 18, 4, C.planta);
    // pote de comida
    p = iso(5.2, 0.9); elipse(c, p.x, p.y, 6, 3, C.pote); elipse(c, p.x, p.y - 1, 4, 2, "#6b2f22");
    horaFundo = horaDoDia(); fundoSujo = false;
  }

  // ---------------------------------------------------------------- o bichinho
  function desenharPet() {
    var p = iso(pet.x, pet.y), f = est.fase, x = p.x, y = p.y;
    var r = f === "bebe" ? 5 : f === "crianca" ? 7 : 8;
    var dorme = est.dormindo || luzApagada;
    var bob = dorme ? Math.round(Math.sin(tempo * 1.5)) : Math.round(Math.sin(tempo * (pet.alvo ? 12 : 3)) * (pet.alvo ? 1 : 0.7));
    var pul = Math.round(pet.pulo);
    elipse(ctx, x, y, r + 1, 2, C.sombra);
    if (f === "ovo") return desenharOvo(x, y);
    var cy = y - r - 2 - pul + bob, doe = doenteFlag;
    var corpo = doe ? C.doente : C.corpo, sombra = doe ? C.doenteS : C.corpoS;
    // antena
    if (!dorme) {
      px(ctx, x + pet.dir, cy - r - 4, 1, 4, C.contorno);
      circulo(ctx, x + pet.dir, cy - r - 5, 1, C.antena);
    }
    // pezinhos (alternam ao andar)
    var passo = pet.alvo ? (Math.floor(tempo * 10) % 2) : 0;
    elipse(ctx, x - r / 2, y - 1 - (passo ? 1 : 0) - pul, 2, 1, C.contorno);
    elipse(ctx, x + r / 2, y - 1 - (passo ? 0 : 1) - pul, 2, 1, C.contorno);
    // corpo com contorno, sombra e brilho
    circulo(ctx, x, cy, r + 1, C.contorno);
    circulo(ctx, x, cy, r, corpo);
    for (var dy = 1; dy <= r; dy++) {
      var dx = Math.floor(Math.sqrt(r * r - dy * dy));
      px(ctx, x + dx - 1, cy + dy, 2, 1, sombra);
    }
    px(ctx, x - r + 2, cy - r + 2, 2, 2, C.corpoL);
    // rosto
    var ol = Math.max(2, Math.round(r / 3)), ox = x + pet.dir;
    if (dorme) {
      px(ctx, ox - ol - 1, cy, ol, 1, C.olho); px(ctx, ox + 1, cy, ol, 1, C.olho);
    } else if (est.humor === "feliz" && !doe) {
      px(ctx, ox - ol - 1, cy - 1, 1, 1, C.olho); px(ctx, ox - ol, cy - 2, ol - 1, 1, C.olho); px(ctx, ox - 1, cy - 1, 1, 1, C.olho);
      px(ctx, ox + 1, cy - 1, 1, 1, C.olho); px(ctx, ox + 2, cy - 2, ol - 1, 1, C.olho); px(ctx, ox + ol + 1, cy - 1, 1, 1, C.olho);
      px(ctx, ox - ol - 2, cy + 1, 2, 1, C.bochecha); px(ctx, ox + ol + 1, cy + 1, 2, 1, C.bochecha);
    } else {
      var h = surpresaT > 0 ? ol + 1 : ol;
      px(ctx, ox - ol - 1, cy - 2, Math.max(1, ol - 1), h, C.olho); px(ctx, ox + 2, cy - 2, Math.max(1, ol - 1), h, C.olho);
      px(ctx, ox - ol - 1, cy - 2, 1, 1, C.brilho); px(ctx, ox + 2, cy - 2, 1, 1, C.brilho);
      if (est.humor === "triste" || doe) px(ctx, ox - ol - 1, cy - 3, ol, 1, C.contorno), px(ctx, ox + 2, cy - 3, ol, 1, C.contorno);
    }
    // boca
    if (pet.modo === "comendo" && Math.floor(tempo * 6) % 2) circulo(ctx, ox, cy + Math.round(r / 2), 1, C.olho);
    else if (surpresaT > 0) circulo(ctx, ox, cy + Math.round(r / 2), 1, C.olho);
    else if (est.humor === "triste" || doe) px(ctx, ox - 1, cy + Math.round(r / 2) + 1, 3, 1, C.olho), px(ctx, ox - 2, cy + Math.round(r / 2) + 2, 1, 1, C.olho), px(ctx, ox + 2, cy + Math.round(r / 2) + 2, 1, 1, C.olho);
    else if (!dorme) px(ctx, ox - 1, cy + Math.round(r / 2), 3, 1, C.olho), px(ctx, ox - 2, cy + Math.round(r / 2) - 1, 1, 1, C.olho), px(ctx, ox + 2, cy + Math.round(r / 2) - 1, 1, 1, C.olho);
    // termômetro se doente
    if (doe) { px(ctx, x + r + 2, cy - r - 4, 1, 7, "#ffffff"); px(ctx, x + r + 2, cy - r, 1, 3, "#ef476f"); }
    // "!" de surpresa
    if (surpresaT > 0) { px(ctx, x - 1, cy - r - 12, 2, 5, C.exc); px(ctx, x - 1, cy - r - 6, 2, 2, C.exc); }
    pet.tela = { x: x, y: cy, r: r };
  }
  function desenharOvo(x, y) {
    var tremor = Math.round(Math.sin(tempo * (est.carinhos > 2 ? 18 : 6)) * (est.carinhos > 2 ? 1.5 : 0.6));
    var cx = x + tremor, cy = y - 8;
    elipse(ctx, cx, cy, 7, 9, C.contorno);
    elipse(ctx, cx, cy, 6, 8, C.ovo);
    for (var i = 0; i < 4; i++) px(ctx, cx + 4 - i, cy + 2 + i, 2, 1, C.ovoS);
    circulo(ctx, cx - 2, cy - 3, 1, C.ovoP); circulo(ctx, cx + 3, cy + 1, 1, C.ovoP); circulo(ctx, cx - 1, cy + 4, 1, C.ovoP);
    if (est.carinhos > 1) { px(ctx, cx - 4, cy - 1, 2, 1, C.contorno); px(ctx, cx - 2, cy, 2, 1, C.contorno); px(ctx, cx, cy - 1, 2, 1, C.contorno); }
    pet.tela = { x: cx, y: cy, r: 8 };
  }

  // ---------------------------------------------------------------- partículas e objetos
  function particula(tipo, x, y) { particulas.push({ t: tipo, x: x, y: y, vy: -12 - Math.random() * 6, vx: (Math.random() - .5) * 8, vida: 1.6 }); }
  function desenharParticulas(dt) {
    for (var i = particulas.length - 1; i >= 0; i--) {
      var q = particulas[i];
      q.vida -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.vida <= 0) { particulas.splice(i, 1); continue; }
      if (q.t === "coracao") {
        px(ctx, q.x - 2, q.y, 2, 1, C.coracao); px(ctx, q.x + 1, q.y, 2, 1, C.coracao);
        px(ctx, q.x - 2, q.y + 1, 5, 1, C.coracao); px(ctx, q.x - 1, q.y + 2, 3, 1, C.coracao); px(ctx, q.x, q.y + 3, 1, 1, C.coracao);
      } else if (q.t === "z") {
        px(ctx, q.x, q.y, 4, 1, C.z); px(ctx, q.x + 2, q.y + 1, 1, 1, C.z); px(ctx, q.x + 1, q.y + 2, 1, 1, C.z); px(ctx, q.x, q.y + 3, 4, 1, C.z);
      } else if (q.t === "estrela") {
        px(ctx, q.x, q.y - 1, 1, 3, C.antena); px(ctx, q.x - 1, q.y, 3, 1, C.antena);
      } else if (q.t === "migalha") {
        px(ctx, q.x, q.y, 1, 1, C.comida);
      }
    }
  }
  function desenharObjetos() {
    if (comidaNoPote > 0) { var p = iso(5.2, 0.9); elipse(ctx, p.x, p.y - 2, 4, 2, C.comida); px(ctx, p.x - 2, p.y - 4, 1, 1, "#e09f3e"); px(ctx, p.x + 1, p.y - 4, 1, 1, "#e09f3e"); }
    if (bola) {
      var b = iso(bola.x, bola.y), alt = Math.round(bola.z);
      elipse(ctx, b.x, b.y, 3, 1, C.sombra);
      circulo(ctx, b.x, b.y - 3 - alt, 3, C.bola); px(ctx, b.x - 1, b.y - 5 - alt, 1, 1, C.bolaL);
    }
  }

  // ---------------------------------------------------------------- comportamento
  function irPara(tx, ty, aoChegar) {
    if (!andavel(tx, ty)) { tx = Math.max(0.8, Math.min(N - 0.6, tx)); ty = Math.max(0.8, Math.min(N - 0.6, ty)); }
    pet.alvo = { x: tx, y: ty }; pet.aoChegar = aoChegar || null;
  }
  function atualizar(dt) {
    tempo += dt;
    if (surpresaT > 0) surpresaT -= dt;
    if (pet.pulo > 0) { pet.pulo = Math.max(0, pet.pulo - dt * 30); }
    var dorme = est.dormindo || luzApagada;
    if (est.fase === "ovo") return;
    if (dorme) {
      if (pet.modo !== "dormindo") { irPara(1.0, 4.0, function () { pet.modo = "dormindo"; }); pet.modo = "indo-dormir"; }
      if (pet.modo === "dormindo" && Math.random() < dt * 0.8) { var q = pet.tela || { x: 0, y: 0 }; particula("z", q.x + 4, q.y - 8); }
    } else if (pet.modo === "dormindo" || pet.modo === "indo-dormir") { pet.modo = "livre"; pet.alvo = null; }
    if (pet.alvo) {
      var dx = pet.alvo.x - pet.x, dy = pet.alvo.y - pet.y, d = Math.sqrt(dx * dx + dy * dy);
      var vel = (est.humor === "triste" ? 1.0 : 1.8) * (bola ? 1.6 : 1);
      if (d < 0.08) { pet.alvo = null; var cb = pet.aoChegar; pet.aoChegar = null; if (cb) cb(); }
      else { pet.x += dx / d * Math.min(d, vel * dt); pet.y += dy / d * Math.min(d, vel * dt); pet.dir = (dx - dy) >= 0 ? 1 : -1; }
    } else if (pet.modo === "livre" && !dorme) {
      pet.ocioso -= dt;
      if (pet.ocioso <= 0) {
        pet.ocioso = 2 + Math.random() * (est.humor === "triste" ? 8 : 4);
        if (Math.random() < 0.65) irPara(1 + Math.random() * (N - 2), 1 + Math.random() * (N - 2));
        else if (est.humor === "feliz" && Math.random() < 0.5) pet.pulo = 6;
      }
    }
    if (pet.modo === "comendo") {
      pet.tModo -= dt;
      if (Math.random() < dt * 4) { var t = pet.tela || { x: 0, y: 0 }; particula("migalha", t.x, t.y + 3); }
      if (pet.tModo <= 0) { pet.modo = "livre"; comidaNoPote = 0; pet.pulo = 6; }
    }
    if (bola) {
      bola.x += bola.vx * dt; bola.y += bola.vy * dt; bola.vx *= Math.pow(0.4, dt); bola.vy *= Math.pow(0.4, dt);
      bola.vz -= 60 * dt; bola.z += bola.vz * dt; if (bola.z < 0) { bola.z = 0; bola.vz = -bola.vz * 0.45; }
      if (bola.x < 0.7 || bola.x > N - 0.5) bola.vx = -bola.vx;
      if (bola.y < 0.7 || bola.y > N - 0.5) bola.vy = -bola.vy;
      bola.x = Math.max(0.7, Math.min(N - 0.5, bola.x)); bola.y = Math.max(0.7, Math.min(N - 0.5, bola.y));
    }
  }

  function chutar() {
    if (!bola) return;
    bola.chutes = (bola.chutes || 0) + 1;
    particula("estrela", pet.tela.x, pet.tela.y - 6);
    if (bola.chutes >= 4) { bola = null; pet.modo = "livre"; pet.pulo = 8; return; }
    var ang = Math.random() * 6.28;
    bola.vx = Math.cos(ang) * 4; bola.vy = Math.sin(ang) * 4; bola.vz = 22;
    setTimeout(function () { if (bola) irPara(bola.x, bola.y, chutar); }, 600);
  }

  // ---------------------------------------------------------------- laço de desenho (~20 fps para poupar o J3)
  function quadro(t) {
    if (!ligado) { ultimoT = 0; return; }
    requestAnimationFrame(quadro);
    if (!ultimoT) ultimoT = t;
    var dt = Math.min(0.1, (t - ultimoT) / 1000); ultimoT = t; acumulado += dt;
    if (acumulado < 0.05) return;
    dt = acumulado; acumulado = 0;
    atualizar(dt);
    if (fundoSujo || horaDoDia() !== horaFundo) desenharFundo();
    ctx.drawImage(fundo, 0, 0);
    desenharObjetos();
    desenharPet();
    desenharParticulas(dt);
    if (est.dormindo || luzApagada) { ctx.fillStyle = "rgba(8,10,40,.55)"; ctx.fillRect(0, 0, W, H); }
    if (opc.aoQuadro) opc.aoQuadro(pet.tela ? { x: pet.tela.x * ESC, y: (pet.tela.y - pet.tela.r - 6) * ESC } : null);
  }

  // ---------------------------------------------------------------- tamanho e toque
  function medir() {
    var sw = cv.clientWidth || window.innerWidth, sh = cv.clientHeight || window.innerHeight;
    ESC = Math.max(2, Math.floor(Math.min(sw, sh) / 150));
    W = Math.ceil(sw / ESC); H = Math.ceil(sh / ESC);
    cv.width = W; cv.height = H;
    N = Math.max(5, Math.min(7, Math.floor((W - 20) / TW)));
    OX = Math.round(W / 2); OY = Math.round(H - N * TH - (opc.margemBaixo || 26));
    PAREDE = Math.min(46, OY - 4);
    fundo = document.createElement("canvas"); fundo.width = W; fundo.height = H; fctx = fundo.getContext("2d");
    ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled = false;
    fundoSujo = true;
  }
  function tocar(ev) {
    var r = cv.getBoundingClientRect(), t = ev.changedTouches ? ev.changedTouches[0] : ev;
    var sx = (t.clientX - r.left) / ESC, sy = (t.clientY - r.top) / ESC;
    if (pet.tela) {
      var dx = sx - pet.tela.x, dy = sy - pet.tela.y;
      if (dx * dx + dy * dy < (pet.tela.r + 6) * (pet.tela.r + 6)) {   // tocou no Cadu = carinho
        pet.pulo = 7; for (var i = 0; i < 3; i++) particula("coracao", pet.tela.x, pet.tela.y - pet.tela.r);
        if (opc.aoAgir) opc.aoAgir("carinho");
        return;
      }
    }
    var tile = deIso(sx, sy);
    if (!est.dormindo && !luzApagada && est.fase !== "ovo" && tile.x > 0 && tile.y > 0 && tile.x < N && tile.y < N) irPara(tile.x, tile.y);
  }

  return {
    iniciar: function (canvas, opcoes) {
      cv = canvas; opc = opcoes || {};
      medir();
      window.addEventListener("resize", medir);
      cv.addEventListener("click", tocar);
      requestAnimationFrame(quadro);
    },
    ativo: function (sim) {
      if (sim && !ligado) { ligado = true; requestAnimationFrame(quadro); }
      ligado = !!sim;
    },
    estado: function (e) {
      if (!e) return;
      var antes = est.fase; est = e;
      luzApagada = !!e.dormindo;
      if (antes === "ovo" && e.fase !== "ovo") { for (var i = 0; i < 8; i++) particula("estrela", pet.tela ? pet.tela.x : W / 2, pet.tela ? pet.tela.y : H / 2); pet.pulo = 10; }
    },
    acao: function (a) {
      if (est.fase === "ovo") return "ovo";
      if (a === "comer") {
        if (est.dormindo) return "dormindo";
        comidaNoPote = 1; pet.modo = "indo-comer";
        irPara(4.6, 1.3, function () { pet.modo = "comendo"; pet.tModo = 2.5; pet.dir = 1; });
      } else if (a === "brincar") {
        if (est.dormindo) return "dormindo";
        var p = { x: 2 + Math.random() * 3, y: 2 + Math.random() * 3 };
        bola = { x: p.x, y: p.y, z: 18, vx: 0, vy: 0, vz: 0, chutes: 0 }; pet.modo = "brincando";
        irPara(p.x, p.y, chutar);
      } else if (a === "luz") {
        luzApagada = !luzApagada;
      }
      return "ok";
    },
    luz: function () { return luzApagada; },
    doente: function (sim) { doenteFlag = !!sim; },
    surpreso: function () { surpresaT = 3; pet.pulo = 9; },
    festa: function () { pet.pulo = 8; for (var i = 0; i < 4; i++) particula("estrela", pet.tela ? pet.tela.x : W / 2, pet.tela ? pet.tela.y - 8 : H / 2); }
  };
})();
