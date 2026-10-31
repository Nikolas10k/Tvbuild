#!/usr/bin/env node
'use strict';
// Tvbuild — Painel local
// Uso:  node painel/server.js            -> só neste PC: http://localhost:7311
//       node painel/server.js --rede     -> também pelo celular na mesma rede (exige código de acesso)
//       node painel/server.js --porta 8080
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const adb = require('./lib/adb');
const ops = require('./lib/ops');

const args = process.argv.slice(2);
const REDE = args.includes('--rede');
const iPorta = args.indexOf('--porta');
const PORTA = Number(iPorta >= 0 ? args[iPorta + 1] : process.env.PORTA || 7311);
const HOST = REDE ? '0.0.0.0' : '127.0.0.1';
const TOKEN = REDE ? crypto.randomBytes(6).toString('hex') : null;
const PUBLICO = path.join(__dirname, 'public');
const APARELHOS = path.join(ops.SAIDA, 'aparelhos.json');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// ----------------------------------------------------------------------------- aparelhos salvos
function lerAparelhos() {
  try { return JSON.parse(fs.readFileSync(APARELHOS, 'utf8')); } catch (_) { return []; }
}
function salvarAparelhos(lista) {
  fs.mkdirSync(ops.SAIDA, { recursive: true });
  fs.writeFileSync(APARELHOS, JSON.stringify(lista, null, 2));
}

// ----------------------------------------------------------------------------- operações expostas
// leitura = não altera o aparelho; as demais aceitam { simular: true } para mostrar o plano antes
const OPERACOES = {
  info: ops.info,
  backup: ops.backup,
  classificar: ops.classificar,
  desativar: ops.desativar,
  launcherStatus: ops.launcherStatus,
  definirLauncher: ops.definirLauncher,
  abrirPlayStore: ops.abrirPlayStore,
  desempenhoStatus: ops.desempenhoStatus,
  animacoes: ops.animacoes,
  restringirSegundoPlano: ops.restringirSegundoPlano,
  limparCache: ops.limparCache,
  encerrarSegundoPlano: ops.encerrarSegundoPlano,
  hy300: ops.hy300,
  abrirApp: ops.abrirApp,
  historico: ops.historico,
  desfazer: ops.desfazer,
  gerarScripts: ops.gerarScripts,
  resumo: ops.resumo,
};

// ----------------------------------------------------------------------------- http helpers
function json(res, status, obj) {
  const corpo = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(corpo);
}

function lerCorpo(req, limite = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    req.on('data', (c) => { tam += c.length; if (tam > limite) { reject(new ops.ErroUsuario('Requisição grande demais.')); req.destroy(); } else partes.push(c); });
    req.on('end', () => {
      const txt = Buffer.concat(partes).toString('utf8');
      try { resolve(txt ? JSON.parse(txt) : {}); } catch (_) { reject(new ops.ErroUsuario('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

function hostPermitido(req) {
  if (REDE) return true;
  const h = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

function autorizado(req) {
  // cabeçalho customizado: navegadores não deixam outros sites enviá-lo sem permissão (proteção CSRF)
  if (req.headers['x-tvbuild'] !== '1') return false;
  if (TOKEN && req.headers['x-token'] !== TOKEN) return false;
  return true;
}

function servirEstatico(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const arq = path.normalize(path.join(PUBLICO, rel));
  if (!arq.startsWith(PUBLICO + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(arq, (err, dados) => {
    if (err) { res.writeHead(404); res.end('Não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(dados);
  });
}

// ----------------------------------------------------------------------------- rotas
async function rotear(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (!hostPermitido(req)) { res.writeHead(403); res.end('Host não permitido'); return; }

  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    servirEstatico(req, res, url);
    return;
  }

  if (!autorizado(req)) { json(res, 401, { erro: TOKEN ? 'Código de acesso inválido. Use o link mostrado na janela do painel.' : 'Não autorizado.' }); return; }

  try {
    if (url.pathname === '/api/estado' && req.method === 'GET') {
      const [versao, dispositivos] = await Promise.all([adb.versao(), adb.dispositivos()]);
      json(res, 200, { adb: versao, dispositivos, aparelhos: lerAparelhos() });
      return;
    }

    if (url.pathname === '/api/aparelhos' && req.method === 'POST') {
      const b = await lerCorpo(req);
      const alvo = ops.normalizarAlvo(b.alvo);
      const nome = String(b.nome || alvo).slice(0, 40);
      const tipo = b.tipo === 'hy300' ? 'hy300' : 'box';
      const lista = lerAparelhos().filter((a) => a.alvo !== alvo);
      lista.push({ nome, alvo, tipo });
      salvarAparelhos(lista);
      json(res, 200, { aparelhos: lista });
      return;
    }

    if (url.pathname === '/api/aparelhos/remover' && req.method === 'POST') {
      const b = await lerCorpo(req);
      const lista = lerAparelhos().filter((a) => a.alvo !== b.alvo);
      salvarAparelhos(lista);
      json(res, 200, { aparelhos: lista });
      return;
    }

    if (url.pathname === '/api/conectar' && req.method === 'POST') {
      const b = await lerCorpo(req);
      const alvo = ops.normalizarAlvo(b.alvo);
      json(res, 200, await adb.conectar(alvo));
      return;
    }

    const mOp = url.pathname.match(/^\/api\/op\/(\w+)$/);
    if (mOp && req.method === 'POST') {
      const fn = OPERACOES[mOp[1]];
      if (!fn) { json(res, 404, { erro: 'Operação desconhecida.' }); return; }
      const b = await lerCorpo(req);
      const { alvo, ...params } = b;
      json(res, 200, await fn(alvo, params));
      return;
    }

    if (url.pathname === '/api/instalar' && req.method === 'POST') {
      const alvo = url.searchParams.get('alvo');
      const nome = path.basename(String(url.searchParams.get('nome') || 'app.apk')).replace(/[^\w.\-]/g, '_');
      if (!/\.apk$/i.test(nome)) throw new ops.ErroUsuario('Envie um arquivo .apk');
      const tmp = path.join(os.tmpdir(), `tvbuild_${Date.now()}_${nome}`);
      await new Promise((resolve, reject) => {
        const w = fs.createWriteStream(tmp);
        let tam = 0;
        req.on('data', (c) => { tam += c.length; if (tam > 1024 * 1024 * 1024) { req.destroy(); reject(new ops.ErroUsuario('APK maior que 1 GB.')); } });
        req.pipe(w); w.on('finish', resolve); w.on('error', reject); req.on('error', reject);
      });
      try { json(res, 200, await ops.instalarApk(alvo, tmp, nome)); } finally { fs.rm(tmp, { force: true }, () => {}); }
      return;
    }

    if (url.pathname === '/api/arquivo' && req.method === 'GET') {
      const arq = ops.caminhoArquivo(url.searchParams.get('alvo'), url.searchParams.get('nome'));
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${path.basename(arq)}"` });
      fs.createReadStream(arq).pipe(res);
      return;
    }

    json(res, 404, { erro: 'Rota não encontrada.' });
  } catch (e) {
    if (e instanceof ops.ErroUsuario) json(res, 400, { erro: e.message });
    else { console.error(e); json(res, 500, { erro: 'Erro interno: ' + e.message }); }
  }
}

// ----------------------------------------------------------------------------- início
const servidor = http.createServer((req, res) => { rotear(req, res); });
servidor.requestTimeout = 15 * 60 * 1000;
servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n[ERRO] A porta ${PORTA} já está em uso. O painel já está aberto? Ou use: --porta 8080\n`);
  else console.error(e);
  process.exit(1);
});
servidor.listen(PORTA, HOST, async () => {
  const v = await adb.versao();
  console.log('\n  Tvbuild — Painel local');
  console.log('  ----------------------');
  console.log(`  adb: ${v || 'NÃO ENCONTRADO — instale o Platform Tools (veja o README)'}`);
  console.log(`  Abra no navegador:  http://localhost:${PORTA}${TOKEN ? '/#t=' + TOKEN : ''}`);
  if (REDE) {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    ips.forEach((ip) => console.log(`  No celular (mesma rede): http://${ip}:${PORTA}/#t=${TOKEN}`));
    console.log('  O código de acesso muda a cada vez que o painel é iniciado.');
  }
  console.log('\n  Para fechar o painel, feche esta janela (ou Ctrl+C).\n');
});
