'use strict';
// Controle remoto pela rede: manda teclas, texto, toques e atalhos de apps para a TV via ADB.
// Para responder rápido, mantém um "adb shell" aberto por aparelho e escreve os comandos nele,
// em vez de abrir um processo novo a cada botão.
const { spawn, execFile } = require('child_process');
const adb = require('./adb');

class ErroControle extends Error {}

// Só estas teclas podem ser enviadas (nomes -> KEYCODE do Android)
const TECLAS = {
  CIMA: 19, BAIXO: 20, ESQUERDA: 21, DIREITA: 22, OK: 23,
  VOLTAR: 4, INICIO: 3, MENU: 82, CONFIG: 176, BUSCA: 84,
  VOL_MAIS: 24, VOL_MENOS: 25, MUDO: 164,
  PLAY_PAUSE: 85, PROXIMO: 87, ANTERIOR: 88, AVANCAR: 90, RETROCEDER: 89,
  APAGAR: 67, ENTER: 66, ENERGIA: 26, APPS_RECENTES: 187,
};

const RE_PKG = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

// Nomes amigáveis para os atalhos (a lista final depende do que está instalado)
const NOMES = {
  'com.spocky.projengmenu': 'Projectivy',
  'com.teamsmart.videomanager.tv': 'SmartTube',
  'com.liskovsoft.smarttubetv.beta': 'SmartTube beta',
  'com.google.android.youtube.tv': 'YouTube',
  'com.google.android.youtube.tvkids': 'YouTube Kids',
  'com.netflix.ninja': 'Netflix',
  'com.netflix.mediaclient': 'Netflix',
  'com.amazon.amazonvideo.livingroom': 'Prime Video',
  'com.disney.disneyplus': 'Disney+',
  'com.wbd.stream': 'Max',
  'com.hbo.hbonow': 'Max',
  'com.globo.globotv': 'Globoplay',
  'com.spotify.tv.android': 'Spotify',
  'org.xbmc.kodi': 'Kodi',
  'org.videolan.vlc': 'VLC',
  'com.phlox.tvwebbrowser': 'TV Bro',
  'com.lonelycatgames.Xplore': 'X-plore',
  'com.retroarch': 'RetroArch',
  'com.retroarch.aarch64': 'RetroArch',
  'com.stremio.one': 'Stremio',
  'com.android.vending': 'Play Store',
};

// ----------------------------------------------------------------------------- shell persistente
const shells = new Map();
const ultimaConexao = new Map();

async function garantirConexao(alvo) {
  const t = ultimaConexao.get(alvo) || 0;
  if (Date.now() - t < 15000) return;
  const c = await adb.conectar(alvo);
  if (!c.ok) {
    shells.delete(alvo);
    throw new ErroControle(c.estado === 'unauthorized' ? 'Aceite “Permitir depuração?” na tela da TV.' : `TV desconectada (${alvo}). Confira se ela está ligada e na mesma rede.`);
  }
  ultimaConexao.set(alvo, Date.now());
}

function shellAberto(alvo) {
  let s = shells.get(alvo);
  if (s && s.exitCode === null && !s.killed && s.stdin.writable) return s;
  s = spawn(adb.ADB, ['-s', alvo, 'shell'], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  s.on('exit', () => { if (shells.get(alvo) === s) shells.delete(alvo); });
  s.on('error', () => { if (shells.get(alvo) === s) shells.delete(alvo); });
  s.stdin.on('error', () => {});
  shells.set(alvo, s);
  return s;
}

async function enviar(alvo, linha) {
  await garantirConexao(alvo);
  shellAberto(alvo).stdin.write(linha + '\n');
}

function fecharTodos() {
  for (const s of shells.values()) { try { s.stdin.end('exit\n'); s.kill(); } catch (_) { /* ok */ } }
  shells.clear();
}

// ----------------------------------------------------------------------------- comandos
async function tecla(alvo, nome, { longo = false } = {}) {
  const code = TECLAS[nome];
  if (!code) throw new ErroControle('Tecla desconhecida.');
  await enviar(alvo, `input keyevent ${longo ? '--longpress ' : ''}${code}`);
}

// "input text" só aceita ASCII: remove acentos (ã -> a, ç -> c) e troca espaço por %s
function prepararTexto(texto) {
  const limpo = String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, 500);
  if (!limpo) return '';
  return limpo.replace(/ /g, '%s');
}

async function texto(alvo, txt) {
  const t = prepararTexto(txt);
  if (!t) throw new ErroControle('Nada para digitar (acentos e emojis não passam pelo ADB).');
  await enviar(alvo, `input text ${adb.q(t)}`);
  const original = String(txt).slice(0, 500);
  return { removidos: original.replace(/[^\x20-\x7e]/g, '') !== original };
}

const tamanhos = new Map();
async function tamanhoTela(alvo) {
  if (tamanhos.has(alvo)) return tamanhos.get(alvo);
  const r = await adb.shell(alvo, ['wm', 'size']);
  const m = r.out.match(/Override size:\s*(\d+)x(\d+)/) || r.out.match(/Physical size:\s*(\d+)x(\d+)/);
  const t = m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1920, h: 1080 };
  tamanhos.set(alvo, t);
  return t;
}

const fracao = (v) => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1) throw new ErroControle('Posição inválida.'); return n; };

async function toque(alvo, x, y) {
  const t = await tamanhoTela(alvo);
  await enviar(alvo, `input tap ${Math.round(fracao(x) * t.w)} ${Math.round(fracao(y) * t.h)}`);
}

async function rolar(alvo, direcao) {
  const t = await tamanhoTela(alvo);
  const cx = Math.round(t.w / 2); const cy = Math.round(t.h / 2); const d = Math.round(t.h / 3);
  const mov = { CIMA: [cx, cy + d / 2, cx, cy - d / 2], BAIXO: [cx, cy - d / 2, cx, cy + d / 2], ESQUERDA: [cx + d / 2, cy, cx - d / 2, cy], DIREITA: [cx - d / 2, cy, cx + d / 2, cy] }[direcao];
  if (!mov) throw new ErroControle('Direção inválida.');
  await enviar(alvo, `input swipe ${mov.map(Math.round).join(' ')} 200`);
}

async function abrirApp(alvo, pkg) {
  if (pkg === 'CONFIGURACOES') { await enviar(alvo, 'am start -a android.settings.SETTINGS'); return; }
  if (!RE_PKG.test(String(pkg || ''))) throw new ErroControle('App inválido.');
  // Apps de TV usam a categoria LEANBACK_LAUNCHER; se não existir, tenta a de celular
  await enviar(alvo, `monkey -p ${pkg} -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null 2>&1 || monkey -p ${pkg} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`);
}

function nomeBonito(pkg) {
  if (NOMES[pkg]) return NOMES[pkg];
  const partes = pkg.split('.').filter((p) => !/^(com|org|net|br|tv|android|app|apps|br|io)$/i.test(p));
  const n = partes.pop() || pkg;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

// Atalhos: apps conhecidos + apps instalados pelo usuário
async function atalhos(alvo) {
  await garantirConexao(alvo);
  const [todos, terceiros] = await Promise.all([adb.shell(alvo, ['pm', 'list', 'packages', '-e']), adb.shell(alvo, ['pm', 'list', 'packages', '-3', '-e'])]);
  const lista = (r) => r.out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('package:')).map((l) => l.slice(8));
  const inst = new Set(lista(todos));
  const usuario = lista(terceiros);
  const escolhidos = [...new Set([...Object.keys(NOMES).filter((p) => inst.has(p)), ...usuario])]
    .filter((p) => p !== 'com.spocky.projengmenu' && !/^android$|systemui|settings|\.gms|inputmethod|\.ime|launcher|providers|softwinner|droidlogic|amlogic|allwinner/i.test(p));
  const vistos = new Set();
  const itens = [];
  for (const pkg of escolhidos) {
    const nome = nomeBonito(pkg);
    if (vistos.has(nome)) continue;
    vistos.add(nome);
    itens.push({ pkg, nome });
  }
  itens.push({ pkg: 'CONFIGURACOES', nome: 'Configurações' });
  return itens;
}

// Print da tela (PNG). Usado pela prévia "Ver a tela".
function capturarTela(alvo) {
  return new Promise((resolve, reject) => {
    execFile(adb.ADB, ['-s', alvo, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 15000, windowsHide: true }, (err, out) => {
      if (err || !out || out.length < 8 || out[0] !== 0x89) { reject(new ErroControle('Não consegui capturar a tela (alguns apps com DRM, como Netflix, mostram preto).')); return; }
      resolve(out);
    });
  });
}

module.exports = { ErroControle, TECLAS, tecla, texto, toque, rolar, abrirApp, atalhos, capturarTela, fecharTodos, prepararTexto, garantirConexao };
