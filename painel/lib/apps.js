'use strict';
// Catálogo de apps: descobre a última versão na FONTE OFICIAL, escolhe o APK certo para a
// arquitetura do aparelho (arm64-v8a / armeabi-v7a / x86) e baixa para uma pasta temporária.
// A instalação em si é feita por ops.instalarArquivo (adb install).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const RAIZ = path.resolve(__dirname, '..', '..');
const UA = 'Tvbuild-painel (+https://github.com/Nikolas10k/Tvbuild)';
const LIMITE_BYTES = 600 * 1024 * 1024;

class ErroApp extends Error {}

function catalogo() {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'catalogo_apps.json'), 'utf8')).apps;
}

// ----------------------------------------------------------------------------- arquitetura
function abiDoNome(nome) {
  const n = nome.toLowerCase();
  if (/arm64|aarch64/.test(n)) return 'arm64-v8a';
  if (/armeabi-v7a|armv7|arm32|armeabi/.test(n)) return 'armeabi-v7a';
  if (/x86_64|x86-64/.test(n)) return 'x86_64';
  if (/x86/.test(n)) return 'x86';
  if (/universal/.test(n)) return 'universal';
  return 'neutro';
}

function abisDoAparelho(abilist) {
  const l = String(abilist || '').split(',').map((s) => s.trim()).filter(Boolean);
  return l.length ? l : ['armeabi-v7a'];
}

// Escolhe o melhor APK de uma lista de arquivos de release
function escolherApk(arquivos, abis, { preferir = [], evitar = [] } = {}) {
  let melhor = null;
  for (const a of arquivos) {
    const nome = a.nome.toLowerCase();
    if (!nome.endsWith('.apk')) continue;
    if (evitar.some((p) => nome.includes(p.toLowerCase()))) continue;
    const abi = abiDoNome(a.nome);
    let nota;
    const i = abis.indexOf(abi);
    if (i >= 0) nota = 100 - i * 10;
    else if (abi === 'universal') nota = 50;
    else if (abi === 'neutro') nota = 40;
    else continue; // arquitetura incompatível
    nota += preferir.filter((p) => nome.includes(p.toLowerCase())).length * 5;
    if (!melhor || nota > melhor.nota) melhor = { ...a, abi, nota };
  }
  return melhor;
}

// ----------------------------------------------------------------------------- rede
async function pegar(url, aceitar = '*/*') {
  let r;
  try {
    r = await fetch(url, { headers: { 'User-Agent': UA, Accept: aceitar }, redirect: 'follow' });
  } catch (e) {
    throw new ErroApp(`Sem acesso a ${new URL(url).host}. Confira a internet do PC. (${e.cause ? e.cause.code || e.cause.message : e.message})`);
  }
  if (r.status === 403 && /api\.github\.com/.test(url)) throw new ErroApp('O GitHub limitou as consultas deste PC (60 por hora). Tente de novo mais tarde.');
  if (!r.ok) throw new ErroApp(`${new URL(url).host} respondeu ${r.status}.`);
  return r;
}

const cache = new Map();
async function comCache(chave, fn) {
  const c = cache.get(chave);
  if (c && Date.now() - c.t < 10 * 60 * 1000) return c.v;
  const v = await fn();
  cache.set(chave, { t: Date.now(), v });
  return v;
}

function versaoNumerica(v) {
  return String(v).split(/[^\d]+/).filter(Boolean).map(Number);
}
function compararVersao(a, b) {
  const x = versaoNumerica(a); const y = versaoNumerica(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ----------------------------------------------------------------------------- fontes
async function resolverGithub(fonte, abis) {
  const rel = await comCache(`gh:${fonte.repo}`, async () => (await pegar(`https://api.github.com/repos/${fonte.repo}/releases/latest`, 'application/vnd.github+json')).json());
  const arquivos = (rel.assets || []).map((a) => ({ nome: a.name, url: a.browser_download_url, tamanho: a.size }));
  const apk = escolherApk(arquivos, abis, fonte);
  if (!apk) throw new ErroApp(`A última versão de ${fonte.repo} não tem APK compatível com ${abis.join(', ')}.`);
  return { versao: rel.tag_name || rel.name || '', ...apk, origem: `github.com/${fonte.repo}` };
}

async function listarLinks(url) {
  const html = await comCache(`dir:${url}`, async () => (await pegar(url, 'text/html')).text());
  return [...html.matchAll(/href="([^"?#]+)"/g)].map((m) => decodeURIComponent(m[1]));
}

async function resolverKodi(fonte, abis) {
  const pasta = { 'arm64-v8a': 'arm64-v8a', 'armeabi-v7a': 'arm', x86_64: 'x86_64', x86: 'x86' };
  for (const abi of abis) {
    if (!pasta[abi]) continue;
    const base = `https://mirrors.kodi.tv/releases/android/${pasta[abi]}/`;
    const nomes = (await listarLinks(base)).map((h) => h.split('/').pop())
      .filter((n) => /^kodi-[\d.]+-[A-Za-z]+-[\w-]+\.apk$/.test(n) && !/beta|rc\d|alpha|nightly/i.test(n));
    if (!nomes.length) continue;
    nomes.sort((a, b) => compararVersao(b.split('-')[1], a.split('-')[1]));
    const nome = nomes[0];
    return { versao: nome.split('-')[1], nome, url: base + nome, tamanho: null, abi, origem: 'mirrors.kodi.tv' };
  }
  throw new ErroApp(`Não encontrei Kodi para ${abis.join(', ')} em mirrors.kodi.tv.`);
}

async function resolverVideolan(fonte, abis) {
  const base = 'https://get.videolan.org/vlc-android/';
  const versoes = [...new Set((await listarLinks(base)).map((h) => h.replace(/\/$/, '').split('/').pop()).filter((v) => /^\d+(\.\d+)+$/.test(v)))]
    .sort((a, b) => compararVersao(b, a));
  for (const v of versoes.slice(0, 3)) {
    const nomes = (await listarLinks(`${base}${v}/`)).map((h) => h.split('/').pop()).filter((n) => /^VLC-Android-.+\.apk$/i.test(n));
    const apk = escolherApk(nomes.map((n) => ({ nome: n, url: `${base}${v}/${n}`, tamanho: null })), abis);
    if (apk) return { versao: v, ...apk, origem: 'get.videolan.org' };
  }
  throw new ErroApp(`Não encontrei VLC para ${abis.join(', ')} em get.videolan.org.`);
}

async function resolver(id, abilist) {
  const app = catalogo().find((a) => a.id === id);
  if (!app) throw new ErroApp('App fora do catálogo.');
  const abis = abisDoAparelho(abilist);
  const f = app.fonte || {};
  let r;
  if (f.tipo === 'github') r = await resolverGithub(f, abis);
  else if (f.tipo === 'kodi') r = await resolverKodi(f, abis);
  else if (f.tipo === 'videolan') r = await resolverVideolan(f, abis);
  else throw new ErroApp(`${app.nome} só está disponível pela Play Store.`);
  if (!r.tamanho) {
    try {
      const h = await fetch(r.url, { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow' });
      r.tamanho = Number(h.headers.get('content-length')) || null;
    } catch (_) { /* tamanho fica desconhecido */ }
  }
  return { app, ...r };
}

// ----------------------------------------------------------------------------- download
async function baixar(url, aoProgredir) {
  let u;
  try { u = new URL(url); } catch (_) { throw new ErroApp('Link inválido.'); }
  if (u.protocol !== 'https:') throw new ErroApp('Use um link https://.');
  const r = await pegar(url);
  const total = Number(r.headers.get('content-length')) || null;
  if (total && total > LIMITE_BYTES) throw new ErroApp('Arquivo grande demais (mais de 600 MB).');
  const nome = (path.basename(new URL(r.url || url).pathname) || 'app.apk').replace(/[^\w.\-]/g, '_');
  const tmp = path.join(os.tmpdir(), `tvbuild_${crypto.randomBytes(4).toString('hex')}_${nome.endsWith('.apk') ? nome : nome + '.apk'}`);
  let baixado = 0;
  const corpo = Readable.fromWeb(r.body);
  corpo.on('data', (c) => {
    baixado += c.length;
    if (baixado > LIMITE_BYTES) corpo.destroy(new ErroApp('Arquivo grande demais (mais de 600 MB).'));
    aoProgredir && aoProgredir(baixado, total);
  });
  try {
    await pipeline(corpo, fs.createWriteStream(tmp));
  } catch (e) {
    fs.rm(tmp, { force: true }, () => {});
    throw e instanceof ErroApp ? e : new ErroApp('O download foi interrompido: ' + e.message);
  }
  // Todo APK é um arquivo ZIP: confere a assinatura "PK" antes de mandar para a TV
  const fd = fs.openSync(tmp, 'r'); const b = Buffer.alloc(2); fs.readSync(fd, b, 0, 2, 0); fs.closeSync(fd);
  if (b.toString('latin1') !== 'PK') {
    fs.rm(tmp, { force: true }, () => {});
    throw new ErroApp('O arquivo baixado não é um APK válido (o link aponta para uma página, não para o arquivo?).');
  }
  return { arquivo: tmp, nome, bytes: baixado };
}

// ----------------------------------------------------------------------------- tarefas em segundo plano
const tarefas = new Map();
function novaTarefa(descricao) {
  const id = crypto.randomBytes(6).toString('hex');
  const t = { id, descricao, estado: 'preparando', fase: 'Preparando…', baixado: 0, total: null, criado: Date.now() };
  tarefas.set(id, t);
  for (const [k, v] of tarefas) if (Date.now() - v.criado > 60 * 60 * 1000) tarefas.delete(k);
  return t;
}
function tarefa(id) { return tarefas.get(id) || null; }

module.exports = { ErroApp, catalogo, resolver, baixar, novaTarefa, tarefa, abisDoAparelho, escolherApk, abiDoNome };
