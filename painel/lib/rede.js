'use strict';
// Procura TVs na rede local: testa a porta do ADB (5555) em todos os endereços da(s) rede(s)
// do PC. Muitas TV boxes genéricas já vêm com o ADB ligado nessa porta, e assim dá para
// achar o IP sem precisar do controle.
const net = require('net');
const os = require('os');

const PORTA_ADB = 5555;

function privado(ip) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

// Redes /24 do PC (ex.: 192.168.0.x). Redes maiores são limitadas ao /24 do próprio PC.
function redesLocais() {
  const redes = new Map();
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family !== 'IPv4' && i.family !== 4) continue;
      if (i.internal || !privado(i.address)) continue;
      const base = i.address.split('.').slice(0, 3).join('.');
      if (!redes.has(base)) redes.set(base, i.address);
    }
  }
  return [...redes].map(([base, ip]) => ({ base, ip }));
}

function portaAberta(host, porta, tempo) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let feito = false;
    const fim = (ok) => { if (feito) return; feito = true; s.destroy(); resolve(ok); };
    s.setTimeout(tempo);
    s.once('connect', () => fim(true));
    s.once('timeout', () => fim(false));
    s.once('error', () => fim(false));
    s.connect(porta, host);
  });
}

async function procurar({ tempo = 600, paralelo = 64, redes = redesLocais() } = {}) {
  const alvos = [];
  for (const r of redes) {
    for (let n = 1; n <= 254; n++) {
      const ip = `${r.base}.${n}`;
      if (ip !== r.ip) alvos.push(ip);
    }
  }
  const achados = [];
  let i = 0;
  async function trabalhador() {
    while (i < alvos.length) {
      const ip = alvos[i++];
      if (await portaAberta(ip, PORTA_ADB, tempo)) achados.push(`${ip}:${PORTA_ADB}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(paralelo, alvos.length) }, trabalhador));
  achados.sort((a, b) => Number(a.split('.')[3].split(':')[0]) - Number(b.split('.')[3].split(':')[0]));
  return { redes: redes.map((r) => `${r.base}.0/24`), achados };
}

module.exports = { procurar, redesLocais, portaAberta };
