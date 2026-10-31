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
const apps = require('./lib/apps');
const controle = require('./lib/controle');
const rede = require('./lib/rede');

const args = process.argv.slice(2);
const REDE = args.includes('--rede');
const ABRIR = args.includes('--abrir');
const iPorta = args.indexOf('--porta');
const PORTA = Number(iPorta >= 0 ? args[iPorta + 1] : process.env.PORTA || 7311);
const HOST = REDE ? '0.0.0.0' : '127.0.0.1';
// Código de acesso do modo rede: fica salvo para o atalho do celular continuar funcionando.
// Use --novo-codigo para gerar outro (quem tinha o link antigo perde o acesso).
function codigoDeAcesso() {
  const arq = path.join(ops.SAIDA, '.codigo_acesso');
  try {
    if (!args.includes('--novo-codigo')) {
      const c = fs.readFileSync(arq, 'utf8').trim();
      if (/^[0-9a-f]{12}$/.test(c)) return c;
    }
  } catch (_) { /* gera um novo */ }
  const novo = crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(ops.SAIDA, { recursive: true });
  fs.writeFileSync(arq, novo + '\n', { mode: 0o600 });
  return novo;
}
const TOKEN = REDE ? codigoDeAcesso() : null;
const PUBLICO = path.join(__dirname, 'public');
const APARELHOS = path.join(ops.SAIDA, 'aparelhos.json');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

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
  if (rel === '/controle') rel = '/controle.html';
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

    if (url.pathname === '/api/procurar' && req.method === 'POST') {
      const r = await rede.procurar();
      const salvos = new Set(lerAparelhos().map((a) => a.alvo));
      const achados = await Promise.all(r.achados.map(async (alvo) => {
        const c = await adb.conectar(alvo);
        let modelo = '';
        if (c.ok) modelo = (await adb.shell(alvo, ['getprop', 'ro.product.model'], { timeout: 8000 })).out.trim();
        return { alvo, estado: c.estado, modelo, jaAdicionado: salvos.has(alvo) };
      }));
      json(res, 200, { redes: r.redes, achados });
      return;
    }

    if (url.pathname === '/api/parear' && req.method === 'POST') {
      const b = await lerCorpo(req);
      const end = String(b.endereco || '').trim();
      const codigo = String(b.codigo || '').trim();
      if (!/^[A-Za-z0-9.\-]+:\d{2,5}$/.test(end)) throw new ops.ErroUsuario('Informe o IP e a porta de pareamento, como 192.168.0.51:37123.');
      if (!/^\d{6}$/.test(codigo)) throw new ops.ErroUsuario('O código de pareamento tem 6 números.');
      const r = await adb.parear(end, codigo);
      if (!r.ok) throw new ops.ErroUsuario(`O pareamento falhou. Confira o IP, a porta e o código (eles mudam a cada vez que a tela de pareamento é aberta). ${r.mensagem}`.trim());
      json(res, 200, { ok: true });
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
      try { json(res, 200, await ops.instalarArquivo(alvo, tmp, nome)); } finally { fs.rm(tmp, { force: true }, () => {}); }
      return;
    }

    // ---- controle remoto
    const mCtl = url.pathname.match(/^\/api\/controle\/(\w+)$/);
    if (mCtl) {
      const acao = mCtl[1];
      if (acao === 'tela' && req.method === 'GET') {
        const alvo = ops.normalizarAlvo(url.searchParams.get('alvo'));
        await controle.garantirConexao(alvo);
        const png = await controle.capturarTela(alvo);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(png);
        return;
      }
      if (req.method !== 'POST') { json(res, 405, { erro: 'Método não permitido.' }); return; }
      const b = await lerCorpo(req, 16 * 1024);
      const alvo = ops.normalizarAlvo(b.alvo);
      if (acao === 'tecla') { await controle.tecla(alvo, String(b.tecla), { longo: !!b.longo }); json(res, 200, { ok: true }); return; }
      if (acao === 'texto') { json(res, 200, { ok: true, ...(await controle.texto(alvo, b.texto)) }); return; }
      if (acao === 'toque') { await controle.toque(alvo, b.x, b.y); json(res, 200, { ok: true }); return; }
      if (acao === 'rolar') { await controle.rolar(alvo, String(b.direcao)); json(res, 200, { ok: true }); return; }
      if (acao === 'abrir') { await controle.abrirApp(alvo, String(b.pkg)); json(res, 200, { ok: true }); return; }
      if (acao === 'atalhos') { json(res, 200, { atalhos: await controle.atalhos(alvo) }); return; }
      json(res, 404, { erro: 'Ação desconhecida.' });
      return;
    }

    // ---- catálogo de apps (baixa da fonte oficial e instala pelo adb)
    if (url.pathname === '/api/apps/catalogo' && req.method === 'POST') {
      const b = await lerCorpo(req);
      const lista = apps.catalogo();
      const st = await ops.catalogoStatus(b.alvo, { catalogo: lista });
      json(res, 200, { apps: lista, ...st });
      return;
    }

    if (url.pathname === '/api/apps/resolver' && req.method === 'POST') {
      const b = await lerCorpo(req);
      const alvo = ops.normalizarAlvo(b.alvo);
      const abilist = (await adb.shell(alvo, ['getprop', 'ro.product.cpu.abilist'])).out.trim();
      const r = await apps.resolver(String(b.id || ''), abilist);
      json(res, 200, { id: r.app.id, nome: r.app.nome, pacote: r.app.pacote, versao: r.versao, arquivo: r.nome, url: r.url, tamanho: r.tamanho, abi: r.abi, origem: r.origem, abilist });
      return;
    }

    if (url.pathname === '/api/apps/instalar' && req.method === 'POST') {
      const b = await lerCorpo(req);
      const alvo = ops.normalizarAlvo(b.alvo);
      let app = null;
      if (b.id) {
        app = apps.catalogo().find((a) => a.id === b.id);
        if (!app) throw new ops.ErroUsuario('App fora do catálogo.');
      } else if (!/^https:\/\//i.test(String(b.url || ''))) {
        throw new ops.ErroUsuario('Informe um link https:// para o arquivo .apk.');
      }
      const t = apps.novaTarefa(app ? app.nome : String(b.url));
      json(res, 200, { tarefa: t.id });
      (async () => {
        let tmp = null;
        try {
          let link = b.url;
          if (app) {
            t.fase = 'Procurando a versão mais nova na fonte oficial…';
            const abilist = (await adb.shell(alvo, ['getprop', 'ro.product.cpu.abilist'])).out.trim();
            const r = await apps.resolver(app.id, abilist);
            link = r.url; t.versao = r.versao; t.arquivo = r.nome; t.total = r.tamanho;
          }
          t.estado = 'baixando'; t.fase = 'Baixando para o PC…';
          const d = await apps.baixar(link, (feito, total) => { t.baixado = feito; if (total) t.total = total; });
          tmp = d.arquivo;
          t.estado = 'instalando'; t.fase = 'Instalando na TV (pode levar 1–2 minutos)…';
          const r = await ops.instalarArquivo(alvo, d.arquivo, app ? (t.arquivo || d.nome) : d.nome, { esperado: app ? app.pacote : undefined });
          t.resultado = r;
          t.estado = r.ok ? 'concluido' : 'erro';
          t.fase = r.ok ? 'Instalado.' : r.erro;
          if (!r.ok) t.erro = r.erro;
        } catch (e) {
          t.estado = 'erro'; t.erro = e.message; t.fase = e.message;
          if (!(e instanceof apps.ErroApp) && !(e instanceof ops.ErroUsuario)) console.error(e);
        } finally {
          if (tmp) fs.rm(tmp, { force: true }, () => {});
        }
      })();
      return;
    }

    if (url.pathname === '/api/tarefa' && req.method === 'GET') {
      const t = apps.tarefa(url.searchParams.get('id'));
      if (!t) { json(res, 404, { erro: 'Tarefa não encontrada.' }); return; }
      json(res, 200, t);
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
    if (e instanceof ops.ErroUsuario || e instanceof apps.ErroApp || e instanceof controle.ErroControle) json(res, 400, { erro: e.message });
    else { console.error(e); json(res, 500, { erro: 'Erro interno: ' + e.message }); }
  }
}

// Abre o navegador só depois que o servidor está pronto (evita "página não encontrada")
function abrirNavegador(link) {
  const { spawn } = require('child_process');
  const [cmd, argv] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', link]]
    : process.platform === 'darwin' ? ['open', [link]] : ['xdg-open', [link]];
  try { spawn(cmd, argv, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref(); } catch (_) { /* abra manualmente */ }
}

// ----------------------------------------------------------------------------- início
const servidor = http.createServer((req, res) => { rotear(req, res); });
servidor.requestTimeout = 15 * 60 * 1000;
servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n[ERRO] A porta ${PORTA} já está em uso. O painel já está aberto? Ou use: --porta 8080\n`);
  else console.error(e);
  process.exit(1);
});
process.on('SIGINT', () => { controle.fecharTodos(); process.exit(0); });
process.on('SIGTERM', () => { controle.fecharTodos(); process.exit(0); });
servidor.listen(PORTA, HOST, async () => {
  const PORTA_REAL = servidor.address().port;
  const v = await adb.versao();
  console.log('\n  Tvbuild — Painel local');
  console.log('  ----------------------');
  console.log(`  adb: ${v ? v + (adb.ADB !== 'adb' ? ' (' + adb.ADB + ')' : '') : 'NÃO ENCONTRADO — instale o Platform Tools (veja o README)'}`);
  console.log(`  Abra no navegador:  http://localhost:${PORTA_REAL}${TOKEN ? '/#t=' + TOKEN : ''}`);
  if (REDE) {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    ips.forEach((ip) => {
      console.log(`  Painel no celular:   http://${ip}:${PORTA_REAL}/#t=${TOKEN}`);
      console.log(`  Controle remoto:     http://${ip}:${PORTA_REAL}/controle#t=${TOKEN}`);
    });
    console.log('  Abra o link no celular (mesma rede Wi-Fi). Para trocar o código: --novo-codigo');
  }
  if (!REDE) console.log(`  Controle remoto:     http://localhost:${PORTA_REAL}/controle   (no celular: inicie com --rede)`);
  console.log('\n  Para fechar o painel, feche esta janela (ou Ctrl+C).\n');
  if (ABRIR) abrirNavegador(`http://localhost:${PORTA_REAL}/${TOKEN ? '#t=' + TOKEN : ''}`);
});
