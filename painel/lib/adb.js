'use strict';
// Camada fina sobre o executável "adb".
// - Usa execFile (sem shell local) => nada do que vem da página é interpretado pelo shell do PC.
// - No aparelho, "adb shell" junta os argumentos numa linha de comando; por isso todo argumento
//   é colocado entre aspas simples (q()) antes de ir para o shell remoto.
const { execFile } = require('child_process');

const ADB = process.env.ADB || 'adb';

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

function desconectar(alvo) {
  return run(['disconnect', alvo], { timeout: 10000 });
}

module.exports = { run, shell, versao, dispositivos, conectar, desconectar, q };
