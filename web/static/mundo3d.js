/*
 * Mundos 3D do Cadu (Three.js r149, MIT). Cenários e personagem originais, low-poly.
 *
 *            ↑ Céu das Estrelas
 *   ← Horta     VILA (centro)     Estrada Elétrica →
 *            ↓ Fundo do Mar
 *
 * Arrastar o dedo para uma direção leva ao mundo daquele lado; o gesto contrário volta para a Vila.
 * Toque = interagir (raycast). Render em resolução reduzida e ampliado sem suavizar = 3D com cara de pixel
 * e leve para o J3. ES5 no nosso código (WebView do Android 5.1).
 */
var Mundo3D = (function () {
  var R, cam, cena, cont, opc = {}, ligado = true, ultimo = 0, acum = 0, ESC = 0.55;
  var atual = null, idAtual = "vila", trocando = false;
  var jogo = { moedas: 0, estrelas: 0, recorde: 0, colheita: 0, bau: 0, horta: [] };
  var pet = { fase: "bebe", humor: "feliz", dormindo: false, carinhos: 0 }, doenteFlag = false;
  var raio, ponteiro, tempo = 0, salvarT = null;

  var VIZINHOS = {
    vila: { cima: "ceu", baixo: "mar", esquerda: "horta", direita: "estrada" },
    ceu: { baixo: "vila" }, mar: { cima: "vila" }, horta: { direita: "vila" }, estrada: { esquerda: "vila" }
  };
  var NOMES = { vila: "Vila do Cadu", ceu: "Céu das Estrelas", mar: "Fundo do Mar", horta: "Horta", estrada: "Estrada Elétrica" };

  // ------------------------------------------------------------------ utilidades
  var matCache = {};
  function mat(cor, extra) {
    var k = cor + (extra ? JSON.stringify(extra) : "");
    if (!matCache[k]) {
      var p = { color: cor, flatShading: true };
      if (extra) for (var e in extra) p[e] = extra[e];
      matCache[k] = new THREE.MeshLambertMaterial(p);
    }
    return matCache[k];
  }
  function malha(geo, cor, x, y, z, extra) { var m = new THREE.Mesh(geo, mat(cor, extra)); m.position.set(x || 0, y || 0, z || 0); return m; }
  function aleat(a, b) { return a + Math.random() * (b - a); }
  function cenaBase(ceu, nevoa, perto, longe) {
    var c = new THREE.Scene();
    c.background = new THREE.Color(ceu);
    if (nevoa) c.fog = new THREE.Fog(nevoa, perto, longe);
    c.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.85));
    var sol = new THREE.DirectionalLight(0xffffff, 0.75); sol.position.set(5, 10, 6); c.add(sol);
    return c;
  }
  function corDoCeu() {
    var h = new Date().getHours();
    if (h >= 6 && h < 17) return 0x8ecae6;
    if (h >= 17 && h < 19) return 0xf4a261;
    return 0x1d2951;
  }
  function noite() { var h = new Date().getHours(); return h < 6 || h >= 19; }
  function salvarJogo() {
    clearTimeout(salvarT);
    salvarT = setTimeout(function () { if (opc.salvar) opc.salvar(jogo); }, 1500);
  }
  function moeda(n) { jogo.moedas += n || 1; salvarJogo(); contador(); }
  function contador() { if (atual && atual.contador && opc.aoContador) opc.aoContador(atual.contador()); }
  function falar(t) { if (opc.falar) opc.falar(t); }
  function agir(a) { if (opc.aoAgir) opc.aoAgir(a); }

  // ------------------------------------------------------------------ partículas
  var parts = [];
  var geoPart = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  function particula(cor, x, y, z, vx, vy, vz, vida) {
    var m = malha(geoPart, cor, x, y, z); cena.add(m);
    parts.push({ m: m, v: new THREE.Vector3(vx, vy, vz), vida: vida || 1.2, g: -4 });
  }
  function explosao(cor, pos, n, forca) {
    for (var i = 0; i < (n || 10); i++) particula(cor, pos.x, pos.y, pos.z, aleat(-1, 1) * (forca || 2), aleat(1, 3), aleat(-1, 1) * (forca || 2), aleat(0.6, 1.2));
  }
  function coracoes(pos) {
    for (var i = 0; i < 4; i++) { particula(0xff5d8f, pos.x + aleat(-.3, .3), pos.y + 1, pos.z + aleat(-.3, .3), aleat(-.3, .3), aleat(1.2, 2), 0, 1.3); parts[parts.length - 1].g = 0; }
  }
  function atualizarParticulas(dt) {
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i]; p.vida -= dt;
      if (p.vida <= 0) { cena.remove(p.m); parts.splice(i, 1); continue; }
      p.v.y += p.g * dt; p.m.position.addScaledVector(p.v, dt); p.m.rotation.x += dt * 4;
    }
  }

  // ------------------------------------------------------------------ o Cadu em 3D
  function criarCadu() {
    var g = new THREE.Group();
    var corpo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshLambertMaterial({ color: 0x7fd4c1, flatShading: true }));
    corpo.position.y = 0.62; g.add(corpo);
    var olhoM = new THREE.MeshBasicMaterial({ color: 0x13222a });
    var oe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.22, 0.06), olhoM), od = oe.clone();
    oe.position.set(-0.18, 0.7, 0.52); od.position.set(0.18, 0.7, 0.52); g.add(oe); g.add(od);
    var boca = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.05), olhoM); boca.position.set(0, 0.5, 0.54); g.add(boca);
    var bochM = mat(0xf28b9a);
    var be = malha(new THREE.BoxGeometry(0.1, 0.05, 0.04), 0xf28b9a, -0.3, 0.56, 0.47), bd = be.clone(); bd.position.x = 0.3; g.add(be); g.add(bd);
    var haste = malha(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 4), 0x1c3a38, 0.05, 1.3, 0); g.add(haste);
    var bolinha = malha(new THREE.SphereGeometry(0.09, 6, 4), 0xffd166, 0.05, 1.5, 0, { emissive: 0x664400 }); g.add(bolinha);
    var pe = new THREE.SphereGeometry(0.13, 6, 4);
    var pe1 = malha(pe, 0x1c3a38, -0.22, 0.1, 0.05), pe2 = malha(pe, 0x1c3a38, 0.22, 0.1, 0.05); pe1.scale.y = pe2.scale.y = 0.6; g.add(pe1); g.add(pe2);
    var exc = new THREE.Group(); exc.add(malha(new THREE.BoxGeometry(0.12, 0.35, 0.12), 0xffd166, 0, 2.05, 0)); exc.add(malha(new THREE.BoxGeometry(0.12, 0.12, 0.12), 0xffd166, 0, 1.75, 0)); exc.visible = false; g.add(exc);
    g.userData = { corpo: corpo, olhos: [oe, od], boca: boca, pes: [pe1, pe2], exc: exc, bochechas: [be, bd], pulo: 0, surpresa: 0, andando: false };
    return g;
  }
  function animarCadu(c, dt, dormindo) {
    var u = c.userData;
    u.pulo = Math.max(0, u.pulo - dt * 3);
    var salto = Math.sin(u.pulo * Math.PI) * 0.6;
    var bob = dormindo ? Math.sin(tempo * 1.5) * 0.02 : Math.sin(tempo * (u.andando ? 14 : 3)) * (u.andando ? 0.06 : 0.03);
    u.corpo.position.y = 0.62 + bob + salto;
    for (var i = 0; i < 2; i++) {
      u.olhos[i].position.y = 0.7 + bob + salto;
      u.olhos[i].scale.y = dormindo ? 0.15 : (u.surpresa > 0 ? 1.4 : (Math.sin(tempo * 0.9 + i * 0.01) > 0.985 ? 0.15 : 1));
      u.bochechas[i].position.y = 0.56 + bob + salto;
      u.bochechas[i].visible = pet.humor === "feliz" && !doenteFlag;
      u.pes[i].position.y = 0.08 + (u.andando ? Math.max(0, Math.sin(tempo * 14 + i * Math.PI)) * 0.12 : 0) + salto;
    }
    u.boca.position.y = 0.5 + bob + salto;
    u.boca.scale.set(u.surpresa > 0 ? 0.6 : 1, u.surpresa > 0 ? 3 : (pet.humor === "triste" || doenteFlag ? 0.6 : 1), 1);
    u.surpresa = Math.max(0, u.surpresa - dt); u.exc.visible = u.surpresa > 0; u.exc.position.y = salto;
    u.corpo.material.color.setHex(doenteFlag ? 0xa8c96b : (pet.humor === "triste" ? 0x6fb8a8 : 0x7fd4c1));
  }
  // anda até um ponto; aoChegar é chamado ao chegar
  function mover(c, dt, vel) {
    var u = c.userData;
    if (!u.alvo) { u.andando = false; return; }
    var dx = u.alvo.x - c.position.x, dz = u.alvo.z - c.position.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.1) { u.alvo = null; u.andando = false; var cb = u.aoChegar; u.aoChegar = null; if (cb) cb(); return; }
    u.andando = true;
    var passo = Math.min(d, vel * dt);
    c.position.x += dx / d * passo; c.position.z += dz / d * passo;
    var ang = Math.atan2(dx, dz), dif = ang - c.rotation.y;
    while (dif > Math.PI) dif -= Math.PI * 2; while (dif < -Math.PI) dif += Math.PI * 2;
    c.rotation.y += dif * Math.min(1, dt * 10);
  }
  function irPara(c, x, z, cb) { c.userData.alvo = { x: x, z: z }; c.userData.aoChegar = cb || null; }
  function tocouNoCadu(c) { return c && raio.intersectObject(c, true).length > 0; }
  function arvore(x, z, s) {
    var g = new THREE.Group();
    g.add(malha(new THREE.CylinderGeometry(0.15, 0.22, 1, 5), 0x7a4f32, 0, 0.5, 0));
    g.add(malha(new THREE.IcosahedronGeometry(0.9, 0), 0x2c7d4c, 0, 1.5, 0));
    g.add(malha(new THREE.IcosahedronGeometry(0.6, 0), 0x3fae6a, 0.3, 2.1, 0.1));
    g.position.set(x, 0, z); g.scale.setScalar(s || 1); return g;
  }
  function chao(raioChao, cor) {
    var m = new THREE.Mesh(new THREE.CircleGeometry(raioChao, 12), mat(cor));
    m.rotation.x = -Math.PI / 2; m.userData.chao = true; return m;
  }
  function pontoNoChao(chaoMesh) {
    var hit = raio.intersectObject(chaoMesh);
    return hit.length ? hit[0].point : null;
  }

  // ================================================================== MUNDO 1 — VILA (o Tamagotchi)
  function mundoVila() {
    var c = cenaBase(corDoCeu(), corDoCeu(), 18, 40);
    var piso = chao(14, 0x6ab04c); c.add(piso);
    for (var i = 0; i < 7; i++) { var a = i / 7 * 6.28; var mo = malha(new THREE.ConeGeometry(aleat(2, 3.5), aleat(1, 2.2), 6), 0x4f9a3d, Math.cos(a) * 13, 0.5, Math.sin(a) * 13); c.add(mo); }
    // casa
    var casa = new THREE.Group(); casa.position.set(-4, 0, -4);
    casa.add(malha(new THREE.BoxGeometry(3, 2, 3), 0xf4e1c1, 0, 1, 0));
    var teto = malha(new THREE.ConeGeometry(2.6, 1.6, 4), 0xd1495b, 0, 2.8, 0); teto.rotation.y = Math.PI / 4; casa.add(teto);
    casa.add(malha(new THREE.BoxGeometry(0.8, 1.3, 0.1), 0x7a4f32, 0.6, 0.65, 1.52));
    var janela = malha(new THREE.BoxGeometry(0.7, 0.6, 0.1), 0x8ecae6, -0.7, 1.2, 1.52, { emissive: 0x000000 }); casa.add(janela);
    c.add(casa);
    // poste com luz (acende à noite)
    var poste = malha(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 4), 0x2b2d42, -1.6, 1.2, -2.2); c.add(poste);
    var lampada = malha(new THREE.BoxGeometry(0.3, 0.3, 0.3), noite() ? 0xffe08a : 0x999999, -1.6, 2.5, -2.2, noite() ? { emissive: 0xffc94d } : null); c.add(lampada);
    // árvores, lago, pedras, flores
    c.add(arvore(4.5, -3.5, 1.1)); c.add(arvore(-7, 2, 0.9)); c.add(arvore(6.5, 3, 1)); c.add(arvore(1, -7, 1.2));
    var lago = new THREE.Mesh(new THREE.CircleGeometry(1.9, 8), mat(0x4cc9f0)); lago.rotation.x = -Math.PI / 2; lago.position.set(3.5, 0.02, 3); c.add(lago);
    for (i = 0; i < 6; i++) { var aa = i / 6 * 6.28; c.add(malha(new THREE.DodecahedronGeometry(0.25, 0), 0x9aa6cc, 3.5 + Math.cos(aa) * 2.1, 0.1, 3 + Math.sin(aa) * 2.1)); }
    var corFlor = [0xffd166, 0xef476f, 0xb388ff, 0xffffff];
    for (i = 0; i < 14; i++) c.add(malha(new THREE.BoxGeometry(0.15, 0.15, 0.15), corFlor[i % 4], aleat(-9, 9), 0.08, aleat(-9, 9)));
    // pote e bola
    var pote = malha(new THREE.CylinderGeometry(0.35, 0.25, 0.25, 8), 0xe07a5f, -1.2, 0.12, -0.6); c.add(pote);
    var racao = malha(new THREE.SphereGeometry(0.28, 6, 4), 0xf2cc8f, -1.2, 0.25, -0.6); racao.scale.y = 0.4; racao.visible = false; c.add(racao);
    var bola = malha(new THREE.SphereGeometry(0.25, 8, 6), 0xef476f, 0, -5, 0); c.add(bola);
    // chuva (VPS fora)
    var nuvem = new THREE.Group(); nuvem.add(malha(new THREE.IcosahedronGeometry(0.7, 0), 0x6c757d)); nuvem.add(malha(new THREE.IcosahedronGeometry(0.5, 0), 0x6c757d, 0.6, -0.1, 0)); nuvem.add(malha(new THREE.IcosahedronGeometry(0.5, 0), 0x6c757d, -0.6, -0.1, 0)); nuvem.visible = false; c.add(nuvem);
    // ovo e Cadu
    var ovo = new THREE.Group();
    var casca = malha(new THREE.SphereGeometry(0.55, 8, 6), 0xf4ecd8, 0, 0.7, 0); casca.scale.y = 1.3; ovo.add(casca);
    for (i = 0; i < 5; i++) ovo.add(malha(new THREE.SphereGeometry(0.09, 4, 3), 0x7fd4c1, Math.cos(i * 1.3) * 0.5, 0.5 + i * 0.14, Math.sin(i * 1.3) * 0.5));
    c.add(ovo);
    var cadu = criarCadu(); c.add(cadu);
    var modo = "livre", tModo = 0, ocioso = 2, bolaV = null, chutes = 0, entrando = false;

    function chutar() {
      chutes++;
      explosao(0xffd166, cadu.position.clone().setY(0.6), 5, 1);
      if (chutes >= 4) { bolaV = null; bola.position.y = -5; modo = "livre"; cadu.userData.pulo = 1; return; }
      var a = Math.random() * 6.28; bolaV = new THREE.Vector3(Math.cos(a) * 5, 4, Math.sin(a) * 5);
      setTimeout(function () { if (bolaV) irPara(cadu, bola.position.x, bola.position.z, chutar); }, 700);
    }
    return {
      cena: c,
      camera: function (dt) {
        var alvo = new THREE.Vector3(cadu.position.x * 0.5, 0, cadu.position.z * 0.5);
        cam.position.lerp(new THREE.Vector3(alvo.x, 6.2, alvo.z + 7.8), Math.min(1, dt * 2));
        cam.lookAt(alvo.x, 0.6, alvo.z);
      },
      ferramentas: [{ id: "comer", icone: "apple", cor: "#ff8a65" }, { id: "brincar", icone: "gamepad", cor: "#5ce1e6" }],
      contador: function () { return "moedas " + jogo.moedas; },
      atualizar: function (dt) {
        var ehOvo = pet.fase === "ovo";
        ovo.visible = ehOvo; cadu.visible = !ehOvo && !entrando;
        if (ehOvo) { ovo.rotation.z = Math.sin(tempo * (pet.carinhos > 2 ? 18 : 5)) * (pet.carinhos > 2 ? 0.15 : 0.06); return; }
        var dorme = pet.dormindo;
        janela.material = mat(dorme || noite() ? 0xffe08a : 0x8ecae6, dorme || noite() ? { emissive: 0xffb703 } : null);
        if (dorme && modo !== "dormindo") { modo = "dormindo"; irPara(cadu, -3.4, -2.3, function () { entrando = true; }); }
        if (!dorme && modo === "dormindo") { modo = "livre"; entrando = false; cadu.position.set(-3.4, 0, -2.2); cadu.userData.pulo = 1; }
        if (dorme && entrando && Math.random() < dt * 0.8) particula(0xcfe3ff, -3.6, 3.4, -4, 0.2, 0.6, 0, 2), parts[parts.length - 1].g = 0;
        mover(cadu, dt, pet.humor === "triste" ? 1.2 : (bolaV ? 3.2 : 2));
        animarCadu(cadu, dt, dorme);
        if (modo === "livre" && !cadu.userData.alvo && !dorme) {
          ocioso -= dt;
          if (ocioso <= 0) { ocioso = aleat(2, pet.humor === "triste" ? 9 : 5); if (Math.random() < 0.7) irPara(cadu, aleat(-6, 6), aleat(-4, 7)); else cadu.userData.pulo = 1; }
        }
        if (modo === "comendo") {
          tModo -= dt; racao.scale.setScalar(Math.max(0.1, tModo / 2.5)); racao.scale.y *= 0.4;
          if (Math.random() < dt * 5) particula(0xf2cc8f, cadu.position.x, 0.6, cadu.position.z, aleat(-.5, .5), 1, aleat(-.5, .5), 0.5);
          if (tModo <= 0) { modo = "livre"; racao.visible = false; cadu.userData.pulo = 1; }
        }
        if (bolaV) {
          bolaV.y -= 12 * dt; bola.position.addScaledVector(bolaV, dt);
          if (bola.position.y < 0.25) { bola.position.y = 0.25; bolaV.y = -bolaV.y * 0.45; bolaV.x *= 0.8; bolaV.z *= 0.8; }
          var r = Math.sqrt(bola.position.x * bola.position.x + bola.position.z * bola.position.z);
          if (r > 9) { bolaV.x = -bolaV.x; bolaV.z = -bolaV.z; }
          bolaV.x *= Math.pow(0.5, dt); bolaV.z *= Math.pow(0.5, dt);
        }
        nuvem.visible = doenteFlag;
        if (doenteFlag) {
          nuvem.position.set(cadu.position.x, 3, cadu.position.z);
          if (Math.random() < dt * 12) particula(0x4cc9f0, cadu.position.x + aleat(-.6, .6), 2.6, cadu.position.z + aleat(-.6, .6), 0, -3, 0, 0.7);
        }
      },
      toque: function () {
        if (pet.fase === "ovo") { if (raio.intersectObject(ovo, true).length) { explosao(0xffffff, new THREE.Vector3(0, 1.2, 0), 6, 1); agir("carinho"); } return; }
        if (tocouNoCadu(cadu)) { cadu.userData.pulo = 1; coracoes(cadu.position); agir("carinho"); return; }
        var p = pontoNoChao(piso);
        if (p && !pet.dormindo) irPara(cadu, Math.max(-9, Math.min(9, p.x)), Math.max(-9, Math.min(9, p.z)));
      },
      ferramenta: function (id) {
        if (pet.fase === "ovo") return falar("Ainda sou um ovo! Faz carinho."), false;
        if (id === "luz") return true;
        if (pet.dormindo) return falar("Zzz…"), false;
        if (id === "comer") {
          racao.visible = true; racao.scale.set(1, 0.4, 1); modo = "indo-comer";
          irPara(cadu, -1.2, 0.2, function () { modo = "comendo"; tModo = 2.5; cadu.rotation.y = Math.PI; });
        }
        if (id === "brincar") {
          bola.position.set(aleat(-3, 3), 3, aleat(-2, 4)); bolaV = new THREE.Vector3(0, 0, 0); chutes = 0; modo = "brincando";
          setTimeout(function () { irPara(cadu, bola.position.x, bola.position.z, chutar); }, 400);
        }
        return true;
      },
      cadu: cadu
    };
  }

  // ================================================================== MUNDO 2 — CÉU DAS ESTRELAS (↑)
  function mundoCeu() {
    var c = cenaBase(0x0b1330, null);
    var pos = [];
    for (var i = 0; i < 260; i++) { var v = new THREE.Vector3(aleat(-1, 1), aleat(-0.2, 1), aleat(-1, 0.3)).normalize().multiplyScalar(aleat(35, 55)); pos.push(v.x, v.y, v.z); }
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    c.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff6cc, size: 0.35, sizeAttenuation: true })));
    c.add(malha(new THREE.SphereGeometry(3, 10, 8), 0xfff6cc, -14, 16, -30, { emissive: 0xbbb08a }));
    // ilha flutuante
    var ilha = new THREE.Group();
    var base = malha(new THREE.ConeGeometry(3.2, 3.2, 7), 0x7a4f32, 0, -1.6, 0); base.rotation.x = Math.PI; ilha.add(base);
    ilha.add(malha(new THREE.CylinderGeometry(3.2, 3.2, 0.4, 7), 0x3fae6a, 0, 0, 0));
    ilha.add(arvore(-1.8, -1, 0.7)); c.add(ilha);
    var cadu = criarCadu(); cadu.position.set(0.6, 0.2, 0.8); c.add(cadu);
    // estrelas já coletadas viram cristais em volta da ilha
    var cristais = new THREE.Group(); c.add(cristais);
    function montarCristais() {
      while (cristais.children.length) cristais.remove(cristais.children[0]);
      var n = Math.min(24, jogo.estrelas);
      for (var k = 0; k < n; k++) { var a = k / 24 * 6.28; cristais.add(malha(new THREE.OctahedronGeometry(0.18, 0), 0xffd166, Math.cos(a) * 3.8, 0.4 + Math.sin(k) * 0.3, Math.sin(a) * 3.8, { emissive: 0x8a6d00 })); }
    }
    montarCristais();
    var cadentes = [], prox = 1;
    var geoEst = new THREE.OctahedronGeometry(0.35, 0), geoHit = new THREE.SphereGeometry(1.4, 6, 4), matHit = new THREE.MeshBasicMaterial({ visible: false });
    function nova() {
      var g2 = new THREE.Group(); var esq = Math.random() < 0.5;
      g2.add(malha(geoEst, 0xfff3b0, 0, 0, 0, { emissive: 0xffd166 }));
      var rastro = malha(new THREE.BoxGeometry(2.2, 0.08, 0.08), 0xffd166, esq ? -1.2 : 1.2, 0.35, 0, { emissive: 0x8a6d00, transparent: true, opacity: 0.6 }); rastro.rotation.z = esq ? -0.3 : 0.3; g2.add(rastro);
      var hit = new THREE.Mesh(geoHit, matHit); g2.add(hit);
      g2.position.set(esq ? -12 : 12, aleat(5, 10), aleat(-6, 0));
      g2.userData = { v: new THREE.Vector3(esq ? aleat(3, 5) : -aleat(3, 5), -aleat(1, 2), 0), hit: hit };
      c.add(g2); cadentes.push(g2);
    }
    return {
      cena: c,
      camera: function () { cam.position.set(0, 3, 9.5); cam.lookAt(0, 2.2, 0); },
      ferramentas: [],
      contador: function () { return "estrelas " + jogo.estrelas + " · moedas " + jogo.moedas; },
      atualizar: function (dt) {
        ilha.position.y = Math.sin(tempo * 0.8) * 0.15; cadu.position.y = 0.2 + ilha.position.y;
        cristais.rotation.y += dt * 0.2; cristais.position.y = ilha.position.y;
        animarCadu(cadu, dt, false);
        prox -= dt; if (prox <= 0) { prox = aleat(1.2, 3); nova(); }
        for (var i = cadentes.length - 1; i >= 0; i--) {
          var e = cadentes[i]; e.position.addScaledVector(e.userData.v, dt); e.children[0].rotation.y += dt * 4;
          if (Math.abs(e.position.x) > 14 || e.position.y < -3) { c.remove(e); cadentes.splice(i, 1); }
        }
        cadu.rotation.y = Math.sin(tempo * 0.5) * 0.5;
      },
      toque: function () {
        for (var i = 0; i < cadentes.length; i++) {
          if (raio.intersectObject(cadentes[i].userData.hit).length) {
            explosao(0xffd166, cadentes[i].position, 14, 3);
            c.remove(cadentes[i]); cadentes.splice(i, 1);
            jogo.estrelas++; moeda(1); montarCristais(); cadu.userData.pulo = 1;
            if (jogo.estrelas % 5 === 0) { agir("recompensa"); falar(jogo.estrelas + " estrelas!"); }
            return;
          }
        }
        if (tocouNoCadu(cadu)) { cadu.userData.pulo = 1; coracoes(cadu.position); agir("carinho"); }
      },
      ferramenta: function () { return true; },
      cadu: cadu
    };
  }

  // ================================================================== MUNDO 3 — FUNDO DO MAR (↓)
  function mundoMar() {
    var c = cenaBase(0x0a4a7a, 0x0a4a7a, 6, 24);
    var gAreia = new THREE.PlaneGeometry(40, 40, 14, 14), p = gAreia.attributes.position;
    for (var i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 0.6) * 0.25 + aleat(0, 0.15));
    gAreia.computeVertexNormals();
    var areia = new THREE.Mesh(gAreia, mat(0xe9d8a6)); areia.rotation.x = -Math.PI / 2; c.add(areia);
    // corais e algas
    var coresCoral = [0xff8fab, 0xff9f1c, 0xb388ff, 0xef476f];
    for (i = 0; i < 12; i++) { var a = aleat(0, 6.28), d = aleat(4, 9); c.add(malha(i % 2 ? new THREE.ConeGeometry(aleat(.3, .6), aleat(1, 2.2), 5) : new THREE.IcosahedronGeometry(aleat(.4, .8), 0), coresCoral[i % 4], Math.cos(a) * d, 0.5, Math.sin(a) * d - 2)); }
    var algas = [];
    for (i = 0; i < 16; i++) { var al = malha(new THREE.BoxGeometry(0.12, aleat(1.5, 3), 0.12), 0x2a9d8f, aleat(-9, 9), 1, aleat(-9, 2)); al.userData.f = aleat(0, 6); c.add(al); algas.push(al); }
    // baú do tesouro
    var bau = new THREE.Group(); bau.position.set(3, 0.3, -2);
    bau.add(malha(new THREE.BoxGeometry(1.2, 0.6, 0.8), 0x7a4f32));
    var tampa = new THREE.Group(); tampa.position.set(0, 0.3, -0.4); var tp = malha(new THREE.BoxGeometry(1.2, 0.2, 0.8), 0x5e3b25, 0, 0.1, 0.4); tampa.add(tp); bau.add(tampa);
    bau.add(malha(new THREE.BoxGeometry(0.2, 0.25, 0.05), 0xffd166, 0, 0.15, 0.42)); c.add(bau);
    // peixes
    var peixes = [], coresP = [0xffd166, 0xff8a65, 0x5ce1e6, 0xef476f, 0xb388ff, 0x06d6a0];
    for (i = 0; i < 9; i++) {
      var f = new THREE.Group(); var corpo = malha(new THREE.ConeGeometry(0.25, 0.8, 5), coresP[i % 6]); corpo.rotation.z = -Math.PI / 2; f.add(corpo);
      var cauda = malha(new THREE.ConeGeometry(0.2, 0.35, 3), coresP[(i + 2) % 6], -0.5, 0, 0); cauda.rotation.z = Math.PI / 2; f.add(cauda);
      f.add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 5, 4), new THREE.MeshBasicMaterial({ visible: false })));
      f.userData = { r: aleat(2.5, 7), h: aleat(1, 4), vel: aleat(0.3, 0.7) * (i % 2 ? 1 : -1), fase: aleat(0, 6.28), giro: 0, alvo: null };
      c.add(f); peixes.push(f);
    }
    var bolhas = [];
    for (i = 0; i < 18; i++) { var b = malha(new THREE.SphereGeometry(0.08, 5, 4), 0xcaf0f8, aleat(-8, 8), aleat(0, 8), aleat(-8, 2), { transparent: true, opacity: 0.7 }); c.add(b); bolhas.push(b); }
    var flocos = [];
    var cadu = criarCadu(); cadu.position.set(-1, 0, 1); c.add(cadu);
    var capacete = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), new THREE.MeshLambertMaterial({ color: 0xcaf0f8, transparent: true, opacity: 0.25 }));
    capacete.position.y = 0.7; cadu.add(capacete);
    var abrindo = 0, ocioso = 3;
    return {
      cena: c,
      camera: function (dt) { cam.position.lerp(new THREE.Vector3(cadu.position.x * 0.4, 4, 9), Math.min(1, dt * 2)); cam.lookAt(cadu.position.x * 0.4, 1.2, 0); },
      ferramentas: [{ id: "peixes", icone: "fish", cor: "#5ce1e6" }],
      contador: function () { return "moedas " + jogo.moedas; },
      atualizar: function (dt) {
        mover(cadu, dt, 1.4); animarCadu(cadu, dt, false);
        if (!cadu.userData.alvo) { ocioso -= dt; if (ocioso <= 0) { ocioso = aleat(3, 6); irPara(cadu, aleat(-5, 5), aleat(-3, 4)); } }
        for (var i = 0; i < algas.length; i++) algas[i].rotation.z = Math.sin(tempo * 1.2 + algas[i].userData.f) * 0.18;
        for (i = 0; i < bolhas.length; i++) { bolhas[i].position.y += dt * 0.9; bolhas[i].position.x += Math.sin(tempo * 2 + i) * dt * 0.2; if (bolhas[i].position.y > 9) bolhas[i].position.y = 0; }
        for (i = 0; i < peixes.length; i++) {
          var f = peixes[i], u = f.userData;
          if (u.giro > 0) { u.giro -= dt; f.rotation.z += dt * 12; continue; } else f.rotation.z = 0;
          if (flocos.length) {   // nada até o floco mais próximo
            var alvo = flocos[i % flocos.length], dv = alvo.position.clone().sub(f.position);
            if (dv.length() < 0.4) { c.remove(alvo); flocos.splice(flocos.indexOf(alvo), 1); u.giro = 0.3; continue; }
            dv.normalize(); f.position.addScaledVector(dv, dt * 2.5); f.rotation.y = Math.atan2(-dv.z, dv.x);
          } else {
            u.fase += u.vel * dt;
            var nx = Math.cos(u.fase) * u.r, nz = Math.sin(u.fase) * u.r - 2;
            f.rotation.y = Math.atan2(-(nz - f.position.z), nx - f.position.x);
            f.position.set(nx, u.h + Math.sin(tempo + i) * 0.3, nz);
          }
        }
        for (i = flocos.length - 1; i >= 0; i--) { flocos[i].position.y -= dt * 0.4; if (flocos[i].position.y < 0.1) { c.remove(flocos[i]); flocos.splice(i, 1); } }
        if (abrindo > 0) { abrindo -= dt; tampa.rotation.x = -Math.min(1.2, (3 - abrindo) * 2); if (abrindo <= 0) tampa.rotation.x = 0; }
      },
      toque: function () {
        if (raio.intersectObject(bau, true).length) {
          var agora = Date.now();
          if (agora - (jogo.bau || 0) < 10 * 60 * 1000) { falar("O baú está vazio. Volte daqui a pouco!"); return; }
          jogo.bau = agora; abrindo = 3; moeda(5); agir("recompensa");
          for (var k = 0; k < 12; k++) particula(0xffd166, 3, 0.8, -2, aleat(-1.5, 1.5), aleat(2, 4), aleat(-1, 1.5), 1.5);
          falar("Tesouro! +5 moedas"); return;
        }
        for (var i = 0; i < peixes.length; i++) if (raio.intersectObject(peixes[i], true).length) { peixes[i].userData.giro = 0.6; coracoes(peixes[i].position.clone().setY(peixes[i].position.y - 1)); if (Math.random() < 0.3) agir("recompensa"); return; }
        if (tocouNoCadu(cadu)) { cadu.userData.pulo = 1; coracoes(cadu.position); agir("carinho"); return; }
        var pt = pontoNoChao(areia); if (pt) irPara(cadu, Math.max(-7, Math.min(7, pt.x)), Math.max(-6, Math.min(5, pt.z)));
      },
      ferramenta: function (id) {
        if (id === "peixes") for (var k = 0; k < 6; k++) { var fl = malha(geoPart, 0xffd166, cadu.position.x + aleat(-1, 1), aleat(3, 4.5), cadu.position.z + aleat(-1, 1)); c.add(fl); flocos.push(fl); }
        return true;
      },
      cadu: cadu
    };
  }

  // ================================================================== MUNDO 4 — HORTA (←)
  var ESTAGIO_MS = 8 * 60 * 1000, TIPOS = ["cenoura", "tomate", "abobora"];
  function mundoHorta() {
    var c = cenaBase(0xa8dadc, 0xa8dadc, 18, 40);
    var piso = chao(14, 0x7cb342); c.add(piso);
    c.add(malha(new THREE.SphereGeometry(1.6, 8, 6), 0xffd166, 9, 11, -18, { emissive: 0xc79100 }));
    // celeiro e moinho
    var cel = new THREE.Group(); cel.position.set(-5.5, 0, -4.5);
    cel.add(malha(new THREE.BoxGeometry(3, 2.4, 2.6), 0xb23a48, 0, 1.2, 0));
    var tc = malha(new THREE.ConeGeometry(2.4, 1.4, 4), 0x5e3b25, 0, 3.1, 0); tc.rotation.y = Math.PI / 4; cel.add(tc);
    cel.add(malha(new THREE.BoxGeometry(1.2, 1.6, 0.1), 0xf4e1c1, 0, 0.8, 1.32)); c.add(cel);
    var moinho = new THREE.Group(); moinho.position.set(5.5, 0, -5);
    moinho.add(malha(new THREE.CylinderGeometry(0.4, 0.7, 4, 6), 0xf4e1c1, 0, 2, 0));
    var pas = new THREE.Group(); pas.position.set(0, 3.8, 0.7);
    for (var i = 0; i < 4; i++) { var pa = malha(new THREE.BoxGeometry(0.25, 2, 0.05), 0xffffff, 0, 1, 0); var hold = new THREE.Group(); hold.rotation.z = i * Math.PI / 2; hold.add(pa); pas.add(hold); }
    moinho.add(pas); c.add(moinho);
    for (i = -6; i <= 6; i += 1.2) { c.add(malha(new THREE.BoxGeometry(0.12, 0.7, 0.12), 0xd4a373, i, 0.35, 5.5)); }
    c.add(malha(new THREE.BoxGeometry(13, 0.08, 0.08), 0xd4a373, 0, 0.55, 5.5));
    // canteiros 3x3
    while (jogo.horta.length < 9) jogo.horta.push(null);
    var canteiros = [], plantas = [];
    for (i = 0; i < 9; i++) {
      var x = (i % 3 - 1) * 1.7, z = (Math.floor(i / 3) - 1) * 1.7 + 0.5;
      var cant = malha(new THREE.BoxGeometry(1.4, 0.25, 1.4), 0x6d4c41, x, 0.12, z); cant.userData.i = i; c.add(cant); canteiros.push(cant);
      var pl = new THREE.Group(); pl.position.set(x, 0.25, z); c.add(pl); plantas.push(pl);
    }
    function estagio(s) { if (!s) return -1; return Math.min(4, Math.floor((Date.now() - s.p + (s.ag || 0)) / ESTAGIO_MS)); }
    function desenharPlanta(i) {
      var pl = plantas[i], s = jogo.horta[i], e = estagio(s);
      while (pl.children.length) pl.remove(pl.children[0]);
      pl.userData.e = e;
      if (e < 0) return;
      if (e === 0) { pl.add(malha(new THREE.SphereGeometry(0.1, 4, 3), 0x3e2723, 0, 0.05, 0)); return; }
      var alt = 0.2 + e * 0.18;
      pl.add(malha(new THREE.CylinderGeometry(0.04, 0.05, alt, 4), 0x2e7d32, 0, alt / 2, 0));
      var f1 = malha(new THREE.BoxGeometry(0.35 * e / 2, 0.05, 0.15), 0x43a047, 0.12, alt * 0.8, 0); f1.rotation.z = 0.4; pl.add(f1);
      var f2 = malha(new THREE.BoxGeometry(0.35 * e / 2, 0.05, 0.15), 0x43a047, -0.12, alt * 0.7, 0); f2.rotation.z = -0.4; pl.add(f2);
      if (e === 4) {
        var t = TIPOS[s.t % 3];
        if (t === "cenoura") { var cn = malha(new THREE.ConeGeometry(0.15, 0.5, 5), 0xff8c00, 0, 0.2, 0); cn.rotation.x = Math.PI; pl.add(cn); }
        else if (t === "tomate") { pl.add(malha(new THREE.SphereGeometry(0.2, 6, 5), 0xe63946, 0.15, alt * 0.6, 0)); pl.add(malha(new THREE.SphereGeometry(0.17, 6, 5), 0xe63946, -0.15, alt * 0.5, 0.05)); }
        else { var ab = malha(new THREE.SphereGeometry(0.35, 8, 6), 0xf77f00, 0, 0.25, 0.25); ab.scale.y = 0.7; pl.add(ab); }
        pl.add(malha(new THREE.OctahedronGeometry(0.12, 0), 0xffd166, 0, alt + 0.5, 0, { emissive: 0x8a6d00 }));
      }
    }
    for (i = 0; i < 9; i++) desenharPlanta(i);
    var cesta = malha(new THREE.CylinderGeometry(0.45, 0.35, 0.45, 8), 0xd4a373, 3.5, 0.22, 2.5); c.add(cesta);
    var cadu = criarCadu(); cadu.position.set(2.8, 0, 3); c.add(cadu);
    var chapeu = new THREE.Group(); chapeu.add(malha(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 8), 0xe9c46a, 0, 1.15, 0)); chapeu.add(malha(new THREE.CylinderGeometry(0.28, 0.32, 0.25, 8), 0xe9c46a, 0, 1.3, 0)); cadu.add(chapeu);
    var revisao = 0;
    return {
      cena: c,
      camera: function () { cam.position.set(0, 9.5, 10.5); cam.lookAt(0, 0, 0.2); },
      ferramentas: [{ id: "comerColheita", icone: "apple", cor: "#ff8a65" }],
      contador: function () { return "colheita " + jogo.colheita + " · moedas " + jogo.moedas; },
      atualizar: function (dt) {
        pas.rotation.z += dt * 1.2;
        mover(cadu, dt, 2); animarCadu(cadu, dt, false);
        revisao -= dt;
        if (revisao <= 0) { revisao = 5; for (var k = 0; k < 9; k++) if (plantas[k].userData.e !== estagio(jogo.horta[k])) desenharPlanta(k); }
        for (k = 0; k < 9; k++) if (plantas[k].userData.e === 4) plantas[k].children[plantas[k].children.length - 1].rotation.y += dt * 3;
      },
      toque: function () {
        if (tocouNoCadu(cadu)) { cadu.userData.pulo = 1; coracoes(cadu.position); agir("carinho"); return; }
        var hit = raio.intersectObjects(canteiros.concat(plantas), true);
        if (!hit.length) { var pt = pontoNoChao(piso); if (pt) irPara(cadu, Math.max(-8, Math.min(8, pt.x)), Math.max(-6, Math.min(5, pt.z))); return; }
        var o = hit[0].object, i = -1;
        while (o && i < 0) { if (o.userData.i !== undefined) i = o.userData.i; else { var idx = plantas.indexOf(o); if (idx >= 0) i = idx; } o = o.parent; }
        if (i < 0) return;
        var alvo = canteiros[i].position;
        irPara(cadu, alvo.x, alvo.z + 0.95, function () {
          cadu.rotation.y = Math.PI;
          var s = jogo.horta[i], e = estagio(s);
          if (e < 0) { jogo.horta[i] = { t: Math.floor(Math.random() * 3), p: Date.now(), ag: 0, ar: 0 }; falar("Plantei uma semente de " + TIPOS[jogo.horta[i].t].replace("abobora", "abóbora") + "!"); }
          else if (e < 4) {
            if (Date.now() - (s.ar || 0) < 60000) { falar("Já reguei, espera um pouco."); return; }
            s.ag = (s.ag || 0) + ESTAGIO_MS / 2; s.ar = Date.now();
            for (var k = 0; k < 10; k++) particula(0x4cc9f0, alvo.x + aleat(-.4, .4), 1.8, alvo.z + aleat(-.4, .4), 0, -2, 0, 0.6);
            falar("Reguei! Cresce mais rápido.");
          } else {
            jogo.horta[i] = null; jogo.colheita++; moeda(2); agir("recompensa");
            explosao(0xff8c00, alvo.clone().setY(0.6), 10, 1.5); falar("Colhi! Tenho " + jogo.colheita + " na cesta.");
          }
          desenharPlanta(i); salvarJogo(); contador();
        });
      },
      ferramenta: function (id) {
        if (id !== "comerColheita") return true;
        if (pet.dormindo) return falar("Zzz…"), false;
        if (jogo.colheita <= 0) return falar("A cesta está vazia. Colha algo!"), false;
        irPara(cadu, 3.5, 3.3, function () { jogo.colheita--; cadu.userData.pulo = 1; explosao(0xff8c00, cadu.position.clone().setY(0.8), 6, 1); agir("alimentar"); salvarJogo(); contador(); });
        return true;
      },
      cadu: cadu
    };
  }

  // ================================================================== MUNDO 5 — ESTRADA ELÉTRICA (→)
  function mundoEstrada() {
    var c = cenaBase(0xffcdb2, 0xffcdb2, 14, 48);
    var estrada = malha(new THREE.BoxGeometry(7, 0.1, 120), 0x3d405b, 0, 0, -40); c.add(estrada);
    c.add(malha(new THREE.BoxGeometry(60, 0.05, 120), 0x81b29a, 0, -0.05, -40));
    var faixas = [];
    for (var i = 0; i < 24; i++) for (var l = -1; l <= 1; l += 2) { var fx = malha(new THREE.BoxGeometry(0.12, 0.02, 1.4), 0xffffff, l * 1.15, 0.06, -i * 4); c.add(fx); faixas.push(fx); }
    for (i = 0; i < 9; i++) c.add(malha(new THREE.BoxGeometry(aleat(2, 4), aleat(4, 12), 2), [0x6d6875, 0xb5838d, 0xe5989b][i % 3], -24 + i * 6, 3, -70));
    var lateral = [];
    for (i = 0; i < 14; i++) { var lado = i % 2 ? 1 : -1; var obj = i % 3 === 0 ? malha(new THREE.CylinderGeometry(0.08, 0.08, 3, 4), 0x2b2d42, lado * 5, 1.5, -i * 6) : arvore(lado * aleat(5.5, 8), -i * 6, aleat(0.7, 1.1)); c.add(obj); lateral.push(obj); }
    // carrinho elétrico com o Cadu
    var carro = new THREE.Group();
    carro.add(malha(new THREE.BoxGeometry(1.3, 0.45, 2.1), 0x5ce1e6, 0, 0.4, 0));
    carro.add(malha(new THREE.BoxGeometry(1.1, 0.4, 1), 0xcaf0f8, 0, 0.8, 0.2, { transparent: true, opacity: 0.6 }));
    carro.add(malha(new THREE.BoxGeometry(0.2, 0.1, 0.05), 0xffd166, -0.4, 0.45, -1.06, { emissive: 0xc79100 })); carro.add(malha(new THREE.BoxGeometry(0.2, 0.1, 0.05), 0xffd166, 0.4, 0.45, -1.06, { emissive: 0xc79100 }));
    var rodaG = new THREE.CylinderGeometry(0.25, 0.25, 0.2, 8);
    var rodas = [];
    for (i = 0; i < 4; i++) { var r = malha(rodaG, 0x1b1b1b, i % 2 ? 0.7 : -0.7, 0.25, i < 2 ? 0.7 : -0.7); r.rotation.z = Math.PI / 2; carro.add(r); rodas.push(r); }
    c.add(carro);
    var cadu = criarCadu(); cadu.scale.setScalar(0.6); cadu.position.set(0, 0.55, 0.25); cadu.rotation.y = Math.PI; carro.add(cadu);
    var raioLaranja = 0;
    var obst = [], moedas = [], faixa = 0, xAlvo = 0, vel = 0, dist = 0, estado = "parado", spawn = 0;
    var geoCone = new THREE.ConeGeometry(0.4, 0.9, 6), geoCarro = new THREE.BoxGeometry(1.3, 0.8, 2), geoMoeda = new THREE.TorusGeometry(0.3, 0.08, 4, 10);
    function limpar() { for (var k = 0; k < obst.length; k++) c.remove(obst[k]); for (k = 0; k < moedas.length; k++) c.remove(moedas[k]); obst = []; moedas = []; }
    function iniciar() { limpar(); faixa = 0; xAlvo = 0; carro.position.x = 0; carro.rotation.set(0, 0, 0); vel = 9; dist = 0; estado = "correndo"; spawn = 1; falar("Valendo!"); }
    function criarObst() {
      var f = Math.floor(Math.random() * 3) - 1, o;
      if (Math.random() < 0.6) o = malha(geoCone, 0xf77f00, f * 2.3, 0.45, -48);
      else { o = new THREE.Group(); o.add(malha(geoCarro, [0xef476f, 0x8338ec, 0x06d6a0][Math.floor(Math.random() * 3)], 0, 0.5, 0)); o.position.set(f * 2.3, 0, -48); }
      o.userData.f = f; c.add(o); obst.push(o);
      if (Math.random() < 0.7) { var lf = f; while (lf === f) lf = Math.floor(Math.random() * 3) - 1; for (var k = 0; k < 3; k++) { var m = malha(geoMoeda, 0xffd166, lf * 2.3, 0.7, -48 - k * 2, { emissive: 0x8a6d00 }); m.userData.f = lf; c.add(m); moedas.push(m); } }
    }
    return {
      cena: c,
      camera: function (dt) { cam.position.lerp(new THREE.Vector3(carro.position.x * 0.6, 3.2, 6.5), Math.min(1, dt * 4)); cam.lookAt(carro.position.x * 0.6, 0.6, -5); },
      ferramentas: [],
      contador: function () { return estado === "correndo" ? "distância " + Math.floor(dist) + " m · recorde " + jogo.recorde : "recorde " + jogo.recorde + " m · moedas " + jogo.moedas; },
      atualizar: function (dt) {
        animarCadu(cadu, dt, false);
        carro.position.x += (xAlvo - carro.position.x) * Math.min(1, dt * 10);
        carro.rotation.z = (carro.position.x - xAlvo) * 0.15;
        if (estado !== "correndo") { if (estado === "batido") carro.rotation.y += dt * 6 * Math.max(0, raioLaranja -= dt); return; }
        vel = Math.min(26, vel + dt * 0.35); dist += vel * dt;
        for (var i = 0; i < rodas.length; i++) rodas[i].rotation.x -= vel * dt * 4;
        for (i = 0; i < faixas.length; i++) { faixas[i].position.z += vel * dt; if (faixas[i].position.z > 6) faixas[i].position.z -= 96; }
        for (i = 0; i < lateral.length; i++) { lateral[i].position.z += vel * dt; if (lateral[i].position.z > 8) lateral[i].position.z -= 84; }
        spawn -= dt; if (spawn <= 0) { spawn = Math.max(0.55, 1.6 - vel / 30); criarObst(); }
        for (i = obst.length - 1; i >= 0; i--) {
          var o = obst[i]; o.position.z += vel * dt;
          if (o.position.z > -1 && o.position.z < 1.2 && o.userData.f === faixa) {   // bateu!
            estado = "batido"; raioLaranja = 1.2; explosao(0xf77f00, carro.position.clone().setY(0.8), 16, 3);
            var d = Math.floor(dist);
            if (d > jogo.recorde) { jogo.recorde = d; falar("Novo recorde: " + d + " m!"); agir("recompensa"); } else falar("Bati! " + d + " m. Toque para correr de novo.");
            salvarJogo(); contador(); return;
          }
          if (o.position.z > 10) { c.remove(o); obst.splice(i, 1); }
        }
        for (i = moedas.length - 1; i >= 0; i--) {
          var m = moedas[i]; m.position.z += vel * dt; m.rotation.y += dt * 5;
          if (m.position.z > -0.8 && m.position.z < 0.8 && m.userData.f === faixa) { c.remove(m); moedas.splice(i, 1); moeda(1); continue; }
          if (m.position.z > 10) { c.remove(m); moedas.splice(i, 1); }
        }
        if (Math.floor(dist) % 50 === 0) contador();
      },
      toque: function (ndc) {
        if (estado !== "correndo") { iniciar(); contador(); return; }
        faixa = Math.max(-1, Math.min(1, faixa + (ndc.x < 0 ? -1 : 1))); xAlvo = faixa * 2.3;
      },
      ferramenta: function () { return true; },
      aoEntrar: function () { falar("Toque para correr! Esquerda/direita troca de faixa."); },
      cadu: cadu
    };
  }

  var FABRICAS = { vila: mundoVila, ceu: mundoCeu, mar: mundoMar, horta: mundoHorta, estrada: mundoEstrada };

  // ------------------------------------------------------------------ troca de mundo
  function liberar(obj) {
    obj.traverse(function (o) { if (o.geometry && o.geometry !== geoPart) o.geometry.dispose(); });
  }
  function carregar(id) {
    if (cena) { liberar(cena); parts = []; }
    idAtual = id;
    atual = FABRICAS[id]();
    cena = atual.cena;
    if (atual.camera) atual.camera(1);
    if (opc.aoMundo) opc.aoMundo(id, NOMES[id], VIZINHOS[id], atual.ferramentas || []);
    contador();
    if (atual.aoEntrar) atual.aoEntrar();
  }
  function trocar(direcao) {
    var dest = VIZINHOS[idAtual][direcao];
    if (!dest || trocando) return false;
    trocando = true;
    var veu = document.getElementById("veu3d");
    if (veu) veu.className = "ver";
    setTimeout(function () { carregar(dest); setTimeout(function () { if (veu) veu.className = ""; trocando = false; }, 80); }, 260);
    return true;
  }

  // ------------------------------------------------------------------ toque e gestos
  var ini = null;
  function inicioToque(x, y) { ini = { x: x, y: y, t: Date.now() }; }
  function fimToque(x, y) {
    if (!ini) return;
    var dx = x - ini.x, dy = y - ini.y, adx = Math.abs(dx), ady = Math.abs(dy);
    ini = null;
    if (Math.max(adx, ady) > 60) {             // gesto = trocar de mundo
      var dir = adx > ady ? (dx > 0 ? "direita" : "esquerda") : (dy < 0 ? "cima" : "baixo");
      if (!trocar(dir) && opc.semSaida) opc.semSaida(dir);
      return;
    }
    var r = cont.getBoundingClientRect();
    ponteiro.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raio.setFromCamera(ponteiro, cam);
    if (atual && atual.toque) atual.toque(ponteiro);
  }

  // ------------------------------------------------------------------ laço
  function quadro(t) {
    if (!ligado) { ultimo = 0; return; }
    requestAnimationFrame(quadro);
    if (!ultimo) ultimo = t;
    var dt = Math.min(0.1, (t - ultimo) / 1000); ultimo = t; acum += dt;
    if (acum < 1 / 32) return;            // ~30 fps
    dt = acum; acum = 0; tempo += dt;
    if (atual) { atual.atualizar(dt); if (atual.camera) atual.camera(dt); }
    atualizarParticulas(dt);
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
      R.domElement.style.width = "100%"; R.domElement.style.height = "100%";
      R.domElement.style.imageRendering = "pixelated";
      cont.appendChild(R.domElement);
      cam = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
      raio = new THREE.Raycaster(); ponteiro = new THREE.Vector2();
      medir(); window.addEventListener("resize", medir);
      cont.addEventListener("touchstart", function (e) { var t = e.touches[0]; inicioToque(t.clientX, t.clientY); }, false);
      cont.addEventListener("touchend", function (e) { var t = e.changedTouches[0]; fimToque(t.clientX, t.clientY); e.preventDefault(); }, false);
      cont.addEventListener("mousedown", function (e) { inicioToque(e.clientX, e.clientY); });
      cont.addEventListener("mouseup", function (e) { fimToque(e.clientX, e.clientY); });
      carregar("vila");
      requestAnimationFrame(quadro);
    },
    ativo: function (sim) { if (sim && !ligado) { ligado = true; requestAnimationFrame(quadro); } ligado = !!sim; },
    estado: function (e) { if (e) pet = e; },
    jogo: function (j) { if (j) { for (var k in j) jogo[k] = j[k]; if (idAtual === "horta" || idAtual === "ceu") carregar(idAtual); else contador(); } return jogo; },
    ferramenta: function (id) { if (id === "casa") { carregar("vila"); return "ok"; } return atual && atual.ferramenta ? atual.ferramenta(id) : true; },
    irPara: function (dir) { return trocar(dir); },
    mundo: function () { return idAtual; },
    doente: function (s) { doenteFlag = !!s; },
    surpreso: function () { if (atual && atual.cadu) { atual.cadu.userData.surpresa = 3; atual.cadu.userData.pulo = 1; } },
    suportado: function () { try { var c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl"))); } catch (e) { return false; } }
  };
})();
