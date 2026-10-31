'use strict';
// Testes das funções puras: escolha de APK, texto do controle, endereços e regras de proteção.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const apps = require('../painel/lib/apps');
const controle = require('../painel/lib/controle');
const ops = require('../painel/lib/ops');

const smarttube = ['SmartTube_stable_32.68_arm64-v8a.apk', 'SmartTube_stable_32.68_armeabi-v7a.apk', 'SmartTube_stable_32.68_universal.apk',
  'SmartTube_stable_32.68_x86.apk', 'SmartTube_beta_32.70_universal.apk'].map((nome) => ({ nome, url: nome }));
const filtro = { preferir: ['stable'], evitar: ['beta', 'debug'] };
const escolher = (abilist) => (apps.escolherApk(smarttube, apps.abisDoAparelho(abilist), filtro) || {}).nome;

test('APK certo para cada processador', () => {
  assert.equal(escolher('arm64-v8a,armeabi-v7a,armeabi'), 'SmartTube_stable_32.68_arm64-v8a.apk');
  assert.equal(escolher('armeabi-v7a,armeabi'), 'SmartTube_stable_32.68_armeabi-v7a.apk');
  assert.equal(escolher('x86_64,x86'), 'SmartTube_stable_32.68_x86.apk');
  assert.equal(escolher('mips'), 'SmartTube_stable_32.68_universal.apk');
  assert.equal(escolher(''), 'SmartTube_stable_32.68_armeabi-v7a.apk', 'sem informação, assume ARM 32 bits');
});

test('APK de outra arquitetura nunca é escolhido', () => {
  const r = apps.escolherApk([{ nome: 'app-x86.apk', url: 'x' }], ['armeabi-v7a']);
  assert.equal(r, null);
});

test('catálogo só usa fontes conhecidas', () => {
  for (const a of apps.catalogo()) {
    assert.ok(['github', 'kodi', 'videolan', 'playstore'].includes(a.fonte.tipo), a.id);
    assert.match(a.pacote, /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/, a.id);
  }
});

test('texto do controle: sem acentos, espaços viram %s', () => {
  assert.equal(controle.prepararTexto('Ação é ótima'), 'Acao%se%sotima');
  assert.equal(controle.prepararTexto('wifi 100%'), 'wifi%s100%');
  assert.equal(controle.prepararTexto('olá 👋'), 'ola%s');
  assert.equal(controle.prepararTexto(''), '');
});

test('endereços aceitos e recusados', () => {
  assert.equal(ops.normalizarAlvo('192.168.0.50'), '192.168.0.50:5555');
  assert.equal(ops.normalizarAlvo(' 192.168.0.51:37000 '), '192.168.0.51:37000');
  assert.throws(() => ops.normalizarAlvo('192.168.0.50; reboot'));
  assert.throws(() => ops.normalizarAlvo('$(id)'));
});

test('proteção: launcher e teclado em uso, padrões e launcher indefinido', () => {
  const { motivoProtecao, padroesProtegidos } = ops._interno;
  const prot = { launcher: 'com.x.launcher', launchers: ['com.x.launcher'], teclado: 'com.x.teclado', padroes: padroesProtegidos() };
  assert.match(motivoProtecao('com.x.launcher', prot, true), /launcher em uso/);
  assert.match(motivoProtecao('com.x.teclado', prot), /teclado/);
  for (const p of ['com.android.settings', 'com.android.systemui', 'com.google.android.gms', 'com.softwinner.keystone', 'com.droidlogic.hdmicec', 'com.android.bluetooth']) {
    assert.ok(motivoProtecao(p, prot), p);
  }
  assert.equal(motivoProtecao('com.android.calendar', prot), null);
  const indef = { launcher: 'android', launchers: ['com.a', 'com.b'], indefinido: true, teclado: '', padroes: [] };
  assert.match(motivoProtecao('com.b', indef, true), /pode ser o launcher/);
});

test('cada tipo de alteração tem como ser desfeita', () => {
  const { comandoDesfazer } = ops._interno;
  const casos = {
    'DISABLE|com.a': 'pm enable --user 0 com.a',
    'UNINSTALL|com.a': 'cmd package install-existing com.a',
    'SETTING|global|window_animation_scale|1.0|0.5': 'settings put global window_animation_scale 1.0',
    'SETTING|global|window_animation_scale|null|0.5': 'settings delete global window_animation_scale',
    'APPOPS|com.a|RUN_IN_BACKGROUND|allow|ignore': 'cmd appops set com.a RUN_IN_BACKGROUND allow',
    'HOME|com.novo/.H|com.velho/.H': 'cmd package set-home-activity com.velho/.H',
    'INSTALL|com.a': 'pm uninstall com.a',
  };
  for (const [linha, esperado] of Object.entries(casos)) {
    const [tipo, a, b, c, d] = linha.split('|');
    assert.equal(comandoDesfazer({ tipo, a, b, c, d }).args.join(' '), esperado, linha);
  }
});

test('procurar TVs: acha quem responde na porta do ADB', async (t) => {
  const net = require('net');
  const rede = require('../painel/lib/rede');
  const srv = net.createServer((s) => s.end());
  try {
    await new Promise((ok, falha) => { srv.once('error', falha); srv.listen(5555, '127.0.0.23', ok); });
  } catch (_) { t.skip('não foi possível escutar em 127.0.0.23:5555 neste sistema'); return; }
  try {
    const r = await rede.procurar({ redes: [{ base: '127.0.0', ip: '127.0.0.1' }], tempo: 300 });
    assert.deepEqual(r.achados, ['127.0.0.23:5555']);
  } finally { srv.close(); }
});
