#!/usr/bin/env node
'use strict';
// Roda antes do painel (iniciar-painel.bat / .sh): confere se o adb existe e, se não existir,
// oferece baixar o Android Platform Tools OFICIAL do Google para a pasta do projeto.
// Nunca impede o painel de abrir: em caso de erro, só avisa.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFile } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const EXE = process.platform === 'win32' ? 'adb.exe' : 'adb';
const LOCAL = path.join(RAIZ, 'platform-tools', EXE);
const SO = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
const URL_PT = `https://dl.google.com/android/repository/platform-tools-latest-${SO}.zip`;

function rodar(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 120000, ...opts }, (err, out, errOut) => resolve({ ok: !err, out: String(out || '') + String(errOut || '') }));
  });
}

function perguntar(texto) {
  if (!process.stdin.isTTY) return Promise.resolve('');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(texto, (r) => { rl.close(); resolve(r.trim()); }));
}

async function temAdb() {
  const adb = require('./lib/adb');
  return (await adb.versao()) !== null;
}

async function extrair(zip) {
  if (process.platform === 'win32') {
    // tar.exe vem no Windows 10/11 e abre .zip; se falhar, usa o PowerShell
    if ((await rodar('tar', ['-xf', zip, '-C', RAIZ])).ok && fs.existsSync(LOCAL)) return true;
    const ps = `Expand-Archive -Force -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${RAIZ.replace(/'/g, "''")}'`;
    return (await rodar('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps])).ok && fs.existsSync(LOCAL);
  }
  const r = await rodar('unzip', ['-qo', zip, '-d', RAIZ]);
  if (!r.ok) console.log('    É preciso o "unzip" (sudo apt install unzip).');
  return r.ok && fs.existsSync(LOCAL);
}

async function baixarPlatformTools() {
  console.log(`    Baixando de ${new URL(URL_PT).host} …`);
  const zip = path.join(os.tmpdir(), `platform-tools-${Date.now()}.zip`);
  try {
    const r = await fetch(URL_PT);
    if (!r.ok) throw new Error(`o servidor respondeu ${r.status}`);
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    if (!(await extrair(zip))) throw new Error('não consegui extrair o arquivo');
    if (process.platform !== 'win32') fs.chmodSync(LOCAL, 0o755);
    console.log(`[ok] adb instalado em ${path.dirname(LOCAL)}\n`);
  } catch (e) {
    console.log(`[ERRO] Não deu para baixar o adb (${e.message}).`);
    console.log('       Baixe manualmente: https://developer.android.com/tools/releases/platform-tools');
    console.log(`       e extraia a pasta "platform-tools" dentro de ${RAIZ}\n`);
  } finally {
    fs.rm(zip, { force: true }, () => {});
  }
}

(async () => {
  const [maior] = process.versions.node.split('.').map(Number);
  if (maior < 18) {
    console.log(`[ERRO] O Node.js instalado é a versão ${process.versions.node}. O painel precisa da 18 ou mais nova: https://nodejs.org`);
    process.exit(1);
  }
  if (await temAdb()) return;
  console.log('[!] O adb (Android Platform Tools) não foi encontrado. Sem ele o painel abre, mas não conecta na TV.');
  const r = await perguntar('    Baixar o Platform Tools oficial do Google para a pasta do projeto? [S/N] ');
  if (/^(s|sim|y|yes)$/i.test(r)) await baixarPlatformTools();
  else console.log('    Ok. Você pode instalar depois; veja o README.\n');
})().catch((e) => { console.log('[aviso] ' + e.message); });
