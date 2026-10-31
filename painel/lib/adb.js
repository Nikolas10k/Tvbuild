'use strict';
// Camada fina sobre o executável "adb".
// - Usa execFile (sem shell local) => nada do que vem da página é interpretado pelo shell do PC.
// - No aparelho, "adb shell" junta os argumentos numa linha de comando; por isso todo argumento
//   é colocado entre aspas simples (q()) antes de ir para o shell remoto.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Procura o adb: variável ADB, pasta platform-tools do projeto, SDK do Android Studio, e por fim o PATH.
function acharAdb() {
  if (process.env.ADB) return process.env.ADB;
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const raiz = path.resolve(__dirname, '..', '..');
  const casa = os.homedir();
  const locais = [
    path.join(raiz, 'platform-tools', exe),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', exe),
    process.platform === 'win32' && 'C:\\platform-tools\\adb.exe',
    path.join(casa, 'Library', 'Android', 'sdk', 'platform-tools', exe),
    path.join(casa, 'Android', 'Sdk', 'platform-tools', exe),
  ].filter(Boolean);
  return locais.find((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }) || 'adb';
}

const ADB = acharAdb();

function q(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function run(args, { timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    execFile(ADB, args, { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const out = String(stdout || '').replace(/\r/g, '');
      const errTxt = String(stderr || '').replace(/\r/g, '');
      if (err && err.code === 'ENOENT') {
        resolve({ code: 127, out: '', err: 'adb não encontrado. Instale o Android Platform Tools e coloque-o no PATH.' });
        return;
      }
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out, err: errTxt });
    });
  });
}

function shell(alvo, args, opts) {
  return run(['-s', alvo, 'shell', ...args.map(q)], opts);
}

async function versao() {
  const r = await run(['version'], { timeout: 5000 });
  return r.code === 0 ? r.out.split('\n')[0] : null;
}

async function dispositivos() {
  const r = await run(['devices']);
  const lista = {};
  r.out.split('\n').slice(1).forEach((l) => {
    const m = l.trim().match(/^(\S+)\s+(\S+)/);
    if (m) lista[m[1]] = m[2];
  });
  return lista;
}

async function conectar(alvo) {
  let estado = (await dispositivos())[alvo];
  if (estado === 'device') return { ok: true, estado };
  const r = await run(['connect', alvo], { timeout: 15000 });
  await new Promise((res) => setTimeout(res, 800));
  estado = (await dispositivos())[alvo];
  return { ok: estado === 'device', estado: estado || 'offline', mensagem: (r.out + r.err).trim() };
}

// Pareamento da "Depuração sem fio" (Android 11+): adb pair IP:PORTA CÓDIGO
async function parear(enderecoPareamento, codigo) {
  const r = await run(['pair', enderecoPareamento, codigo], { timeout: 30000 });
  const msg = (r.out + r.err).trim();
  return { ok: r.code === 0 && /Successfully paired/i.test(msg), mensagem: msg };
}

function desconectar(alvo) {
  return run(['disconnect', alvo], { timeout: 10000 });
}

module.exports = { ADB, run, shell, versao, dispositivos, conectar, parear, desconectar, q };
