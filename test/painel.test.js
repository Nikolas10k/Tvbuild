'use strict';
// Teste de ponta a ponta: sobe o servidor do painel com um adb simulado e exercita a API.
// (Roda em Linux/macOS; no Windows o adb simulado não pode ser executado diretamente.)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PULAR = process.platform === 'win32' ? 'adb simulado não roda no Windows' : false;
const RAIZ = path.resolve(__dirname, '..');
const ALVO = '192.168.0.50';
let dir; let srv; let base; let token;

function iniciar(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(RAIZ, 'painel', 'server.js'), '--porta', '0', ...args], {
      env: { ...process.env, ADB: path.join(__dirname, 'adb-simulado.js'), TVBUILD_SIM: dir, TVBUILD_SAIDA: path.join(dir, 'saida') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let txt = '';
    p.stdout.on('data', (c) => {
      txt += c;
      const m = txt.match(/localhost:(\d+)/);
      if (m) resolve({ p, base: `http://127.0.0.1:${m[1]}`, txt });
    });
    p.on('exit', (c) => reject(new Error('servidor saiu: ' + c + txt)));
    setTimeout(() => reject(new Error('servidor não iniciou: ' + txt)), 8000);
  });
}

async function api(caminho, corpo, extra = {}) {
  const headers = { 'X-Tvbuild': '1', ...(token ? { 'X-Token': token } : {}), ...extra };
  if (corpo) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + caminho, { method: corpo ? 'POST' : 'GET', headers, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const estado = () => JSON.parse(fs.readFileSync(path.join(dir, 'estado.json'), 'utf8'));

before(async () => {
  if (PULAR) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvbuild-teste-'));
  ({ p: srv, base } = await iniciar(['--rede']));
  token = fs.readFileSync(path.join(dir, 'saida', '.codigo_acesso'), 'utf8').trim();
});
after(() => { if (srv) srv.kill(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test('modo rede exige o código de acesso', { skip: PULAR }, async () => {
  const sem = await fetch(base + '/api/estado', { headers: { 'X-Tvbuild': '1' } });
  assert.equal(sem.status, 401);
  const semCabecalho = await fetch(base + '/api/estado', { headers: { 'X-Token': token } });
  assert.equal(semCabecalho.status, 401, 'sem X-Tvbuild (proteção contra outros sites)');
  assert.equal((await api('/api/estado')).status, 200);
});

test('info e classificação', { skip: PULAR }, async () => {
  const info = await api('/api/op/info', { alvo: ALVO });
  assert.equal(info.status, 200);
  assert.equal(info.json.dados.modelo, 'Box Teste');
  assert.equal(info.json.dados.ramDisponivelMB, 781);
  const c = await api('/api/op/classificar', { alvo: ALVO });
  const cat = Object.fromEntries(c.json.apps.map((a) => [a.pkg, a.categoria]));
  assert.equal(cat['com.android.calendar'], 'bloat');
  assert.equal(cat['com.google.android.tvlauncher'], 'essencial', 'launcher em uso');
  assert.equal(cat['com.softwinner.keystone'], 'essencial');
  assert.equal(cat['com.exemplo.misterio'], 'duvida');
  assert.equal(cat['org.xbmc.kodi'], 'usuario');
});

test('simular não altera nada; protegidos são recusados', { skip: PULAR }, async () => {
  const r = await api('/api/op/desativar', { alvo: ALVO, pacotes: ['com.android.calendar', 'com.android.settings'], simular: true });
  assert.equal(r.json.simulado, true);
  assert.ok(r.json.passos.some((p) => p.tipo === 'recusado' && /com\.android\.settings/.test(p.explicacao)));
  assert.deepEqual(estado().desativados, []);
  const inj = await api('/api/op/desativar', { alvo: ALVO, pacotes: ['a;reboot'] });
  assert.equal(inj.status, 400);
});

test('desativar, trocar launcher, desfazer tudo', { skip: PULAR }, async () => {
  await api('/api/op/desativar', { alvo: ALVO, pacotes: ['com.android.calendar'] });
  assert.deepEqual(estado().desativados, ['com.android.calendar']);
  assert.ok(fs.readdirSync(path.join(dir, 'saida', '192_168_0_50_5555')).some((f) => f.startsWith('backup_')), 'backup automático');

  // o launcher antigo só pode ser desativado depois que outro estiver em uso
  const antes = await api('/api/op/desativar', { alvo: ALVO, pacotes: ['com.google.android.tvlauncher'], permitirLaunchers: true });
  assert.ok(antes.json.passos.some((p) => p.tipo === 'recusado'));
  await api('/api/op/definirLauncher', { alvo: ALVO, comp: 'com.spocky.projengmenu/.ui.home.MainActivity' });
  const depois = await api('/api/op/desativar', { alvo: ALVO, pacotes: ['com.google.android.tvlauncher'], permitirLaunchers: true });
  assert.ok(depois.json.passos.some((p) => p.tipo === 'alteracao' && p.ok));

  await api('/api/op/animacoes', { alvo: ALVO, valor: '0.5' });
  assert.equal(estado().settings.window_animation_scale, '0.5');

  const scripts = await api('/api/op/gerarScripts', { alvo: ALVO });
  assert.equal(scripts.json.arquivos.length, 4);

  await api('/api/op/desfazer', { alvo: ALVO });
  const e = estado();
  assert.deepEqual(e.desativados, []);
  assert.equal(e.home, 'com.google.android.tvlauncher/.MainActivity');
  const h = await api('/api/op/historico', { alvo: ALVO });
  assert.equal(h.json.entradas.length, 0);
});

test('sem tela inicial padrão, todos os launchers ficam protegidos', { skip: PULAR }, async () => {
  const e = estado(); e.home = 'android/com.android.internal.app.ResolverActivity';
  fs.writeFileSync(path.join(dir, 'estado.json'), JSON.stringify(e));
  const r = await api('/api/op/desativar', { alvo: ALVO, pacotes: ['com.google.android.tvlauncher'], permitirLaunchers: true });
  assert.ok(r.json.passos.some((p) => p.tipo === 'recusado' && /pode ser o launcher/.test(p.explicacao)));
  e.home = 'com.google.android.tvlauncher/.MainActivity';
  fs.writeFileSync(path.join(dir, 'estado.json'), JSON.stringify(e));
});

test('controle remoto: só teclas permitidas chegam à TV', { skip: PULAR }, async () => {
  for (const tecla of ['CIMA', 'OK', 'VOLTAR']) assert.equal((await api('/api/controle/tecla', { alvo: ALVO, tecla })).status, 200);
  assert.equal((await api('/api/controle/tecla', { alvo: ALVO, tecla: 'reboot' })).status, 400);
  assert.equal((await api('/api/controle/abrir', { alvo: ALVO, pkg: 'x;reboot' })).status, 400);
  await api('/api/controle/texto', { alvo: ALVO, texto: 'Ação 1' });
  await api('/api/controle/toque', { alvo: ALVO, x: 0.5, y: 0.5 });
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(estado().stdin, ['input keyevent 19', 'input keyevent 23', 'input keyevent 4', "input text 'Acao%s1'", 'input tap 960 540']);
});

test('pareamento do Android 11+', { skip: PULAR }, async () => {
  assert.equal((await api('/api/parear', { endereco: '192.168.0.51:37123', codigo: '123456' })).status, 200);
  assert.equal((await api('/api/parear', { endereco: '192.168.0.51:37123', codigo: '000000' })).status, 400);
  assert.equal((await api('/api/parear', { endereco: '192.168.0.51', codigo: '123456' })).status, 400);
});

test('telas iniciais só saem pela aba Launcher (botão Início pode depender delas)', { skip: PULAR }, async () => {
  const r = await api('/api/op/desativar', { alvo: ALVO, pacotes: ['com.spocky.projengmenu'] });
  assert.ok(r.json.passos.some((p) => p.tipo === 'recusado' && /tela inicial/.test(p.explicacao)));
  assert.ok(!estado().desativados.includes('com.spocky.projengmenu'));
  const ops = require('../painel/lib/ops');
  const prot = { launchers: [], padroes: ops._interno.padroesProtegidos() };
  assert.ok(ops._interno.motivoProtecao('com.jm.jmlauncher', prot));
  assert.ok(ops._interno.motivoProtecao('com.htc.htclauncherhighenglishd08', prot));
});
