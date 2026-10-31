#!/usr/bin/env node
'use strict';
// adb simulado para os testes: imita uma TV box com estado salvo em $TVBUILD_SIM/estado.json.
// Não é usado pelo painel de verdade.
const fs = require('fs');
const path = require('path');

const DIR = process.env.TVBUILD_SIM;
const ARQ = path.join(DIR, 'estado.json');
const ALVO = '192.168.0.50:5555';

const inicial = {
  pacotes: ['android', 'com.android.systemui', 'com.android.settings', 'com.google.android.gms', 'com.google.android.tvlauncher',
    'com.android.calendar', 'com.android.printspooler', 'com.google.android.tvrecommendations', 'com.softwinner.keystone',
    'com.google.android.leanback.ime', 'com.exemplo.misterio', 'org.xbmc.kodi', 'com.spocky.projengmenu'],
  usuario: ['org.xbmc.kodi', 'com.spocky.projengmenu'],
  desativados: [],
  home: 'com.google.android.tvlauncher/.MainActivity',
  homes: ['com.google.android.tvlauncher/.MainActivity', 'com.spocky.projengmenu/.ui.home.MainActivity'],
  settings: {},
  appops: {},
  stdin: [],
};
const est = fs.existsSync(ARQ) ? JSON.parse(fs.readFileSync(ARQ, 'utf8')) : inicial;
const salvar = () => fs.writeFileSync(ARQ, JSON.stringify(est));
if (!fs.existsSync(ARQ)) salvar();
const out = (t) => process.stdout.write(t + (t.endsWith('\n') ? '' : '\n'));

// desfaz as aspas simples que o painel coloca em cada argumento
const tirarAspas = (a) => (/^'.*'$/s.test(a) ? a.slice(1, -1).replace(/'\\''/g, "'") : a);

let argv = process.argv.slice(2);
if (argv[0] === 'version') { out('Android Debug Bridge version 1.0.41 (simulado)'); process.exit(0); }
if (argv[0] === 'devices') { out(`List of devices attached\n${ALVO}\tdevice`); process.exit(0); }
if (argv[0] === 'connect') { out(argv[1] === ALVO ? `already connected to ${ALVO}` : `failed to connect to ${argv[1]}`); process.exit(0); }
if (argv[0] === 'pair') { out(argv[2] === '123456' ? `Successfully paired to ${argv[1]}` : 'Failed: Wrong password'); process.exit(argv[2] === '123456' ? 0 : 1); }
if (argv[0] === '-s') argv = argv.slice(2);
if (argv[0] === 'exec-out') { process.stdout.write(Buffer.from('89504e470d0a1a0a0000', 'hex')); process.exit(0); }
if (argv[0] === 'install') { if (process.env.TVBUILD_SIM_PKG) { est.pacotes.push(process.env.TVBUILD_SIM_PKG); est.usuario.push(process.env.TVBUILD_SIM_PKG); salvar(); } out('Performing Streamed Install\nSuccess'); process.exit(0); }

if (argv[0] === 'shell' && argv.length === 1) {
  // shell persistente do controle remoto: registra cada linha recebida
  let buf = '';
  process.stdin.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const linha = buf.slice(0, i); buf = buf.slice(i + 1);
      const atual = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
      atual.stdin.push(linha);
      fs.writeFileSync(ARQ, JSON.stringify(atual));
    }
  });
  process.stdin.on('end', () => process.exit(0));
  return;
}

const a = argv.slice(1).map(tirarAspas);
const cmd = a.join(' ');
const ativos = () => est.pacotes.filter((p) => !est.desativados.includes(p));
const lista = (l) => l.map((p) => 'package:' + p).join('\n');

if (cmd === 'getprop') out('[ro.product.model]: [Box Teste]\n[ro.build.version.release]: [11]\n[ro.build.version.sdk]: [30]\n[ro.board.platform]: [teste]\n[ro.product.cpu.abilist]: [arm64-v8a,armeabi-v7a]');
else if (cmd === 'getprop ro.build.version.sdk') out('30');
else if (cmd === 'getprop ro.product.cpu.abilist') out('arm64-v8a,armeabi-v7a');
else if (cmd === 'pm list packages -e') out(lista(ativos()));
else if (cmd === 'pm list packages -d') out(lista(est.desativados));
else if (cmd === 'pm list packages -3' || cmd === 'pm list packages -3 -e') out(lista(est.usuario.filter((p) => est.pacotes.includes(p))));
else if (cmd === 'pm list packages -f') out(est.pacotes.map((p) => `package:/system/app/${p}.apk=${p}`).join('\n'));
else if (cmd === 'pm list packages') out(lista(est.pacotes));
else if (a[0] === 'pm' && a[1] === 'disable-user') { est.desativados.push(a[4]); salvar(); out(`Package ${a[4]} new state: disabled-user`); }
else if (a[0] === 'pm' && a[1] === 'enable') { est.desativados = est.desativados.filter((p) => p !== a[4]); salvar(); out(`Package ${a[4]} new state: enabled`); }
else if (a[0] === 'pm' && a[1] === 'uninstall') { const p = a[a.length - 1]; est.pacotes = est.pacotes.filter((x) => x !== p); salvar(); out('Success'); }
else if (cmd.startsWith('cmd package resolve-activity')) out(`priority=0 preferredOrder=0\n${est.home}`);
else if (cmd.startsWith('cmd package query-activities')) out(`${est.homes.length} activities found:\n${est.homes.join('\n')}`);
else if (a[0] === 'cmd' && a[2] === 'set-home-activity') { est.home = a[3]; salvar(); out('Success'); }
else if (cmd === 'settings get secure default_input_method') out('com.google.android.leanback.ime/.LeanbackImeService');
else if (a[0] === 'settings' && a[1] === 'get') out(est.settings[a[3]] ?? 'null');
else if (a[0] === 'settings' && a[1] === 'put') { est.settings[a[3]] = a[4]; salvar(); }
else if (a[0] === 'settings' && a[1] === 'list') out('x=1');
else if (cmd === 'cat /proc/meminfo') out('MemTotal: 2000000 kB\nMemAvailable: 800000 kB');
else if (cmd === 'df -h /data') out('Filesystem Size Used Avail Use% Mounted\n/dev/data 8G 3G 5G 38% /data');
else if (cmd === 'wm size') out('Physical size: 1920x1080');
// demais comandos (dumpsys, wm density, input...) não precisam de resposta
process.exit(0);
