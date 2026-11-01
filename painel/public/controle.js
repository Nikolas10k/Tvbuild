'use strict';
/* Tvbuild — controle remoto (celular ou PC). Sem bibliotecas. */

const $ = (s) => document.querySelector(s);
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* ok */ } };
const lerGuardado = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };

// Código de acesso e aparelho podem vir no link: /controle#t=código&alvo=192.168.0.50:5555
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('t')) guardar('tvbuild_token', hash.get('t'));
if (hash.get('alvo')) guardar('tvbuild_alvo', hash.get('alvo'));
if (location.hash) history.replaceState(null, '', location.pathname);
const TOKEN = lerGuardado('tvbuild_token') || (() => { try { return sessionStorage.getItem('tvbuild_token'); } catch (_) { return null; } })();
let ALVO = lerGuardado('tvbuild_alvo');

async function api(caminho, corpo, bruto = false) {
  const headers = { 'X-Tvbuild': '1' };
  if (TOKEN) headers['X-Token'] = TOKEN;
  if (corpo) headers['Content-Type'] = 'application/json';
  const r = await fetch(caminho, { method: corpo ? 'POST' : 'GET', headers, body: corpo ? JSON.stringify(corpo) : undefined });
  if (bruto && r.ok) return r;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
  return j;
}

// ----------------------------------------------------------------------------- estado da conexão
let avisoTimer;
function aviso(msg) {
  const a = $('#aviso');
  if (!msg) { a.hidden = true; return; }
  a.textContent = msg; a.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { a.hidden = true; }, 6000);
}
function status(ok) { $('#ponto').className = 'ponto ' + (ok === true ? 'on' : ok === false ? 'erro' : ''); }
const vibrar = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (_) { /* ok */ } };

let fila = Promise.resolve();
function enviar(acao, dados) {
  if (!ALVO) { aviso('Escolha um aparelho no topo.'); return Promise.resolve(); }
  // em fila: mantém a ordem dos botões apertados em sequência
  fila = fila.then(() => api(`/api/controle/${acao}`, { alvo: ALVO, ...dados })
    .then((r) => { status(true); return r; })
    .catch((e) => { status(false); aviso(e.message); }));
  return fila;
}

// ----------------------------------------------------------------------------- aparelhos
async function carregarAparelhos() {
  const sel = $('#aparelho');
  try {
    const e = await api('/api/estado');
    const lista = e.aparelhos || [];
    if (!lista.length) {
      sel.innerHTML = '<option>Nenhum aparelho: adicione no painel</option>';
      aviso('Adicione a TV no painel completo primeiro (link no fim da página).');
      return;
    }
    if (!lista.some((a) => a.alvo === ALVO)) ALVO = lista[0].alvo;
    sel.innerHTML = lista.map((a) => `<option value="${a.alvo}">${a.nome.replace(/</g, '&lt;')}</option>`).join('');
    sel.value = ALVO;
    guardar('tvbuild_alvo', ALVO);
    status(e.dispositivos && e.dispositivos[ALVO] === 'device' ? true : null);
    carregarAtalhos();
  } catch (err) {
    status(false);
    sel.innerHTML = '<option>Sem acesso ao painel</option>';
    aviso(/Código|autoriz/i.test(err.message) ? 'Abra este controle pelo link com código mostrado na janela do painel (iniciado com --rede).' : err.message);
  }
}
$('#aparelho').addEventListener('change', (e) => { ALVO = e.target.value; guardar('tvbuild_alvo', ALVO); status(null); carregarAtalhos(); });

async function carregarAtalhos() {
  const nav = $('#atalhos');
  nav.innerHTML = '<span class="vazio">Carregando apps…</span>';
  try {
    const r = await api('/api/controle/atalhos', { alvo: ALVO });
    status(true);
    nav.innerHTML = '';
    r.atalhos.forEach((a) => {
      const b = document.createElement('button');
      b.className = 'atalho'; b.textContent = a.nome; b.title = a.pkg;
      b.addEventListener('click', () => { vibrar(); enviar('abrir', { pkg: a.pkg }); });
      nav.appendChild(b);
    });
  } catch (e) {
    status(false);
    nav.innerHTML = `<span class="vazio">${e.message.replace(/</g, '&lt;')}</span>`;
  }
}

// ----------------------------------------------------------------------------- teclas (com repetição ao segurar)
document.querySelectorAll('[data-tecla]').forEach((b) => {
  const tecla = b.dataset.tecla;
  const repetir = b.hasAttribute('data-repetir');
  let espera, intervalo;
  const parar = () => { clearTimeout(espera); clearInterval(intervalo); b.classList.remove('ativo'); };
  b.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    b.classList.add('ativo');
    vibrar();
    enviar('tecla', { tecla });
    if (repetir) espera = setTimeout(() => { intervalo = setInterval(() => enviar('tecla', { tecla }), 220); }, 450);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => b.addEventListener(t, parar));
  b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); enviar('tecla', { tecla }); } });
  b.addEventListener('contextmenu', (ev) => ev.preventDefault());
});

// Energia: precisa de dois toques para evitar desligar sem querer
const btnEnergia = $('#energia');
let energiaArmada = null;
btnEnergia.addEventListener('click', () => {
  if (energiaArmada) { clearTimeout(energiaArmada); energiaArmada = null; btnEnergia.classList.remove('armado'); vibrar(); enviar('tecla', { tecla: 'ENERGIA' }); return; }
  btnEnergia.classList.add('armado');
  aviso('Toque de novo para ligar/desligar a tela.');
  energiaArmada = setTimeout(() => { energiaArmada = null; btnEnergia.classList.remove('armado'); }, 2500);
});

// Teclado do PC vira controle (quando não estiver digitando)
const MAPA = { ArrowUp: 'CIMA', ArrowDown: 'BAIXO', ArrowLeft: 'ESQUERDA', ArrowRight: 'DIREITA', Enter: 'OK', Backspace: 'VOLTAR', Escape: 'VOLTAR', Home: 'INICIO', h: 'INICIO', m: 'MENU', '+': 'VOL_MAIS', '=': 'VOL_MAIS', '-': 'VOL_MENOS', ' ': 'PLAY_PAUSE' };
document.addEventListener('keydown', (ev) => {
  if (ev.target.matches('input, select, textarea') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const t = MAPA[ev.key];
  if (!t) return;
  ev.preventDefault();
  enviar('tecla', { tecla: t });
});

// ----------------------------------------------------------------------------- abas
document.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-aba]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  ['touchpad', 'teclado', 'tela'].forEach((id) => { $('#aba-' + id).hidden = id !== b.dataset.aba; });
  if (b.dataset.aba !== 'tela') pararTela();
  if (b.dataset.aba === 'teclado') $('#texto').focus();
}));

// ----------------------------------------------------------------------------- touchpad: deslizar = setas, tocar = OK
(function () {
  const pad = $('#touchpad');
  const PASSO = 45; // px de arrasto por "clique" de seta
  let ini = null; let acum = { x: 0, y: 0 }; let moveu = false;
  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId);
    ini = { x: e.clientX, y: e.clientY, t: Date.now() }; acum = { x: e.clientX, y: e.clientY }; moveu = false;
  });
  pad.addEventListener('pointermove', (e) => {
    if (!ini) return;
    const dx = e.clientX - acum.x; const dy = e.clientY - acum.y;
    if (Math.abs(dx) < PASSO && Math.abs(dy) < PASSO) return;
    moveu = true;
    const tecla = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'DIREITA' : 'ESQUERDA') : (dy > 0 ? 'BAIXO' : 'CIMA');
    acum = { x: e.clientX, y: e.clientY };
    vibrar();
    enviar('tecla', { tecla });
    const r = pad.getBoundingClientRect(); const p = document.createElement('span');
    p.className = 'rastro'; p.style.left = (e.clientX - r.left) + 'px'; p.style.top = (e.clientY - r.top) + 'px';
    pad.appendChild(p); setTimeout(() => p.remove(), 250);
  });
  const fim = () => {
    if (ini && !moveu && Date.now() - ini.t < 400) { vibrar(); enviar('tecla', { tecla: 'OK' }); }
    ini = null;
  };
  pad.addEventListener('pointerup', fim);
  pad.addEventListener('pointercancel', () => { ini = null; });
})();

// ----------------------------------------------------------------------------- digitar
async function enviarTexto() {
  const inp = $('#texto');
  const t = inp.value;
  if (!t) return;
  const r = await enviar('texto', { texto: t });
  if (r) { inp.value = ''; if (r.removidos) aviso('Enviado sem os acentos.'); }
}
$('#formTexto').addEventListener('submit', (e) => { e.preventDefault(); enviarTexto(); });
$('#btnEnviar').addEventListener('click', (e) => { e.preventDefault(); enviarTexto(); });

// ----------------------------------------------------------------------------- ver a tela
let telaLigada = false; let telaTimer = null; let urlAnterior = null;
async function atualizarTela() {
  if (!telaLigada || document.hidden) return;
  const t0 = Date.now();
  try {
    const r = await api(`/api/controle/tela?alvo=${encodeURIComponent(ALVO)}`, null, true);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    let img = $('#quadro img');
    if (!img) { $('#quadro').innerHTML = ''; img = document.createElement('img'); img.alt = 'Tela da TV'; $('#quadro').appendChild(img); }
    img.src = url;
    if (urlAnterior) URL.revokeObjectURL(urlAnterior);
    urlAnterior = url;
    $('#telaInfo').textContent = `Atualizada há pouco · ${((Date.now() - t0) / 1000).toFixed(1)} s para capturar`;
    status(true);
  } catch (e) {
    $('#telaInfo').textContent = e.message;
  }
  if (telaLigada) telaTimer = setTimeout(atualizarTela, 2000);
}
function pararTela() {
  telaLigada = false; clearTimeout(telaTimer);
  $('#btnTela').textContent = 'Ligar prévia'; $('#btnTela').classList.add('principal');
  $('#telaInfo').textContent = 'Desligada';
}
$('#btnTela').addEventListener('click', () => {
  if (telaLigada) { pararTela(); return; }
  telaLigada = true;
  $('#btnTela').textContent = 'Desligar prévia'; $('#btnTela').classList.remove('principal');
  $('#telaInfo').textContent = 'Capturando…';
  atualizarTela();
});
$('#quadro').addEventListener('click', (e) => {
  const img = $('#quadro img');
  if (!img || !img.naturalWidth) return;
  // converte o toque para a posição na imagem (que usa object-fit: contain)
  const r = img.getBoundingClientRect();
  const escala = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
  const w = img.naturalWidth * escala; const h = img.naturalHeight * escala;
  const x = (e.clientX - r.left - (r.width - w) / 2) / w;
  const y = (e.clientY - r.top - (r.height - h) / 2) / h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  vibrar();
  enviar('toque', { x, y }).then(() => { clearTimeout(telaTimer); setTimeout(atualizarTela, 600); });
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && telaLigada) { clearTimeout(telaTimer); atualizarTela(); } });

carregarAparelhos();
