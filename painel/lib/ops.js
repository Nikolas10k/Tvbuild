'use strict';
// Operações do painel. Mesmas regras do tvopt.sh:
//  - nada de root/flash; só pm disable-user / pm uninstall -k --user 0 / settings / appops
//  - backup obrigatório antes de alterar
//  - pacotes protegidos (config/protegidos.txt + launcher e teclado em uso) são recusados
//  - toda alteração é registrada em saida/<ip>/estado/alteracoes.log (mesmo formato do tvopt.sh)
//  - toda operação que altera aceita "simular": devolve o plano (comandos + explicação) sem executar
const fs = require('fs');
const path = require('path');
const adb = require('./adb');

const RAIZ = path.resolve(__dirname, '..', '..');
const CONFIG = path.join(RAIZ, 'config');
const SAIDA = process.env.TVBUILD_SAIDA || path.join(RAIZ, 'saida');

const RE_PKG = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
const RE_COMP = /^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+$/;
const RE_ERRO = /exception|error|failure|unknown|not found|denied|usage:/i;
const PROJECTIVY = 'com.spocky.projengmenu';

class ErroUsuario extends Error {}

// ----------------------------------------------------------------------------- utilitários
function dataStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function normalizarAlvo(a) {
  a = String(a || '').trim();
  if (!/^[A-Za-z0-9.\-]+(:\d{1,5})?$/.test(a)) throw new ErroUsuario('Endereço inválido. Use algo como 192.168.0.50 ou 192.168.0.50:5555');
  return a.includes(':') ? a : `${a}:5555`;
}

function pastas(alvo) {
  const saida = path.join(SAIDA, alvo.replace(/[:.]/g, '_'));
  const estado = path.join(saida, 'estado');
  fs.mkdirSync(estado, { recursive: true });
  return { saida, estado, log: path.join(estado, 'alteracoes.log') };
}

function validarPacote(p) {
  if (!RE_PKG.test(String(p || ''))) throw new ErroUsuario(`Nome de pacote inválido: ${p}`);
  return p;
}

// Uma fila por aparelho: evita duas operações ao mesmo tempo no mesmo aparelho
const filas = new Map();
function naFila(alvo, fn) {
  const anterior = filas.get(alvo) || Promise.resolve();
  const atual = anterior.catch(() => {}).then(fn);
  filas.set(alvo, atual.catch(() => {}));
  return atual;
}

// ----------------------------------------------------------------------------- config
function lerLista(arquivo) {
  const txt = fs.readFileSync(path.join(CONFIG, arquivo), 'utf8');
  const itens = [];
  for (const linha of txt.split(/\r?\n/)) {
    const semComentario = linha.replace(/#.*/, '').trim();
    if (!semComentario) continue;
    const pkg = semComentario.split(/\s+/)[0];
    const desc = (linha.match(/#\s*(.*)$/) || [, ''])[1].trim();
    itens.push({ pkg, desc });
  }
  return itens;
}

function padroesProtegidos() {
  const txt = fs.readFileSync(path.join(CONFIG, 'protegidos.txt'), 'utf8');
  const lista = [];
  for (const l of txt.split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    try { lista.push({ fonte: t, re: new RegExp(t, 'i') }); } catch (_) { /* padrão inválido: ignora */ }
  }
  return lista;
}

// ----------------------------------------------------------------------------- contexto
class Ctx {
  constructor(alvo, simular) {
    this.alvo = alvo;
    this.simular = !!simular;
    this.passos = [];
    this.p = pastas(alvo);
    this.data = dataStr();
  }

  async ler(args, opts) {
    const r = await adb.shell(this.alvo, args, opts);
    return r.out;
  }

  leitura(explicacao, comando) {
    this.passos.push({ tipo: 'leitura', explicacao, comando });
  }

  aviso(texto) {
    this.passos.push({ tipo: 'aviso', explicacao: texto });
  }

  recusado(explicacao) {
    this.passos.push({ tipo: 'recusado', explicacao });
  }

  async alterar(explicacao, args, opts) {
    const comando = 'adb shell ' + args.join(' ');
    if (this.simular) {
      this.passos.push({ tipo: 'alteracao', explicacao, comando, simulado: true, ok: true });
      return true;
    }
    const r = await adb.shell(this.alvo, args, opts);
    const saida = (r.out + r.err).trim();
    const ok = r.code === 0 && !RE_ERRO.test(saida);
    this.passos.push({ tipo: 'alteracao', explicacao, comando, saida, ok });
    return ok;
  }

  registrar(linha) {
    if (!this.simular) fs.appendFileSync(this.p.log, linha + '\n');
  }

  resultado(extra = {}) {
    return { simulado: this.simular, passos: this.passos, ...extra };
  }
}

async function ctxConectado(alvo, simular) {
  alvo = normalizarAlvo(alvo);
  const c = await adb.conectar(alvo);
  if (!c.ok) {
    if (c.estado === 'unauthorized') throw new ErroUsuario('O aparelho ainda não autorizou este PC. Aceite o aviso "Permitir depuração?" na tela e tente de novo.');
    throw new ErroUsuario(await adb.explicarFalha(alvo, c.estado));
  }
  return new Ctx(alvo, simular);
}

// ----------------------------------------------------------------------------- leituras do aparelho
function linhas(txt) { return txt.split('\n').map((l) => l.trim()).filter(Boolean); }
function pacotesDe(txt) { return linhas(txt).filter((l) => l.startsWith('package:')).map((l) => l.slice(8)).sort(); }

async function pacotes(ctx, flag) {
  return pacotesDe(await ctx.ler(flag ? ['pm', 'list', 'packages', flag] : ['pm', 'list', 'packages']));
}

async function getprops(ctx) {
  const out = await ctx.ler(['getprop']);
  const props = {};
  for (const l of out.split('\n')) {
    const m = l.match(/^\[([^\]]+)\]: \[(.*)\]$/);
    if (m) props[m[1]] = m[2];
  }
  return props;
}

async function launcherAtual(ctx) {
  const out = await ctx.ler(['cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME']);
  const comp = linhas(out).filter((l) => RE_COMP.test(l)).pop();
  if (comp) return comp;
  const pref = await ctx.ler(['dumpsys', 'package', 'preferred-activities']);
  const m = pref.match(/[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+/);
  return m ? m[0] : '';
}

async function launchersDisponiveis(ctx) {
  const out = await ctx.ler(['cmd', 'package', 'query-activities', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME']);
  return [...new Set(linhas(out).filter((l) => RE_COMP.test(l)))];
}

async function tecladoAtual(ctx) {
  return (await ctx.ler(['settings', 'get', 'secure', 'default_input_method'])).trim();
}

async function memoria(ctx) {
  const out = await ctx.ler(['cat', '/proc/meminfo']);
  const m = {};
  for (const l of out.split('\n')) {
    const x = l.match(/^(\w+):\s+(\d+)/);
    if (x) m[x[1]] = Number(x[2]);
  }
  return m;
}

// Quando a TV tem várias telas iniciais e nenhuma é a padrão, o Android responde com o
// seletor do sistema ("android/...ResolverActivity"). Aí não dá para saber qual está em uso,
// então TODAS as telas iniciais ficam protegidas.
function launcherIndefinido(comp) {
  return !comp || comp.split('/')[0] === 'android';
}

async function launchersProtegidos(ctx, atual) {
  if (!launcherIndefinido(atual)) return [atual.split('/')[0]];
  return [...new Set((await launchersDisponiveis(ctx)).map((c) => c.split('/')[0]).filter((p) => p !== 'android'))];
}

async function protecaoDinamica(ctx) {
  const [launcher, teclado] = await Promise.all([launcherAtual(ctx), tecladoAtual(ctx)]);
  return {
    launcher: launcher.split('/')[0],
    launchers: await launchersProtegidos(ctx, launcher),
    indefinido: launcherIndefinido(launcher),
    teclado: teclado.split('/')[0],
    padroes: padroesProtegidos(),
  };
}

// devolve o motivo (string) se o pacote é protegido, ou null
function motivoProtecao(pkg, prot, ignorarPadroes = false) {
  if (prot.launchers && prot.launchers.includes(pkg)) return prot.indefinido ? 'pode ser o launcher em uso (nenhuma tela inicial padrão definida)' : 'launcher em uso';
  if (prot.launcher && pkg === prot.launcher) return 'launcher em uso';
  if (prot.teclado && pkg === prot.teclado) return 'teclado em uso';
  if (ignorarPadroes) return null;
  const hit = prot.padroes.find((p) => p.re.test(pkg));
  return hit ? `protegido (${hit.fonte})` : null;
}

// ----------------------------------------------------------------------------- 2. info
async function info(alvo) {
  const ctx = await ctxConectado(alvo);
  return naFila(ctx.alvo, async () => {
    ctx.leitura('Propriedades do sistema (modelo, Android, chip)', 'getprop');
    ctx.leitura('Memória RAM', 'cat /proc/meminfo');
    ctx.leitura('Armazenamento livre', 'df -h /data');
    const [props, mem, df, wmSize, wmDens, todos, usuario, off, cpu, launcher, teclado] = await Promise.all([
      getprops(ctx), memoria(ctx), ctx.ler(['df', '-h', '/data']), ctx.ler(['wm', 'size']), ctx.ler(['wm', 'density']),
      pacotes(ctx), pacotes(ctx, '-3'), pacotes(ctx, '-d'), ctx.ler(['cat', '/proc/cpuinfo']), launcherAtual(ctx), tecladoAtual(ctx),
    ]);
    const dfLinha = linhas(df)[1] ? linhas(df)[1].split(/\s+/) : [];
    const hw = (cpu.match(/^Hardware\s*:\s*(.+)$/m) || [, ''])[1];
    const dados = {
      fabricante: props['ro.product.manufacturer'] || '',
      marca: props['ro.product.brand'] || '',
      modelo: props['ro.product.model'] || '',
      dispositivo: props['ro.product.device'] || '',
      android: props['ro.build.version.release'] || '',
      sdk: Number(props['ro.build.version.sdk'] || 0),
      build: props['ro.build.display.id'] || '',
      patch: props['ro.build.version.security_patch'] || '',
      plataforma: [...new Set([props['ro.board.platform'], props['ro.soc.model'], hw].filter(Boolean))].join(' · '),
      nucleos: (cpu.match(/^processor\s*:/gm) || []).length,
      resolucao: linhas(wmSize).join(' / '),
      densidade: linhas(wmDens).join(' / '),
      launcher, teclado,
      ramTotalMB: Math.round((mem.MemTotal || 0) / 1024),
      ramDisponivelMB: Math.round((mem.MemAvailable || mem.MemFree || 0) / 1024),
      armazenamento: dfLinha.length >= 4 ? { total: dfLinha[1], usado: dfLinha[2], livre: dfLinha[3], uso: dfLinha[4] } : null,
      pacotes: { total: todos.length, usuario: usuario.length, desativados: off.length },
    };
    const ramAntesArq = path.join(ctx.p.estado, 'ram_antes.txt');
    if (!fs.existsSync(ramAntesArq) && mem.MemAvailable) fs.writeFileSync(ramAntesArq, String(mem.MemAvailable) + '\n');
    dados.ramAntesMB = fs.existsSync(ramAntesArq) ? Math.round(Number(fs.readFileSync(ramAntesArq, 'utf8')) / 1024) : null;
    dados.temBackup = temBackup(ctx);
    fs.writeFileSync(path.join(ctx.p.saida, `info_${ctx.data}.txt`), JSON.stringify(dados, null, 2));
    return ctx.resultado({ dados });
  });
}

// ----------------------------------------------------------------------------- backup
function temBackup(ctx) {
  return fs.readdirSync(ctx.p.saida).some((f) => /^backup_.*\.txt$/.test(f));
}

async function fazerBackup(ctx) {
  ctx.leitura('Lista todos os pacotes com o caminho do APK', 'pm list packages -f');
  ctx.leitura('Lista desativados e instalados por você', 'pm list packages -d / -3');
  ctx.leitura('Copia todas as configurações', 'settings list global | secure | system');
  const [f, d, u, g, s, y, props, launcher, teclado] = await Promise.all([
    ctx.ler(['pm', 'list', 'packages', '-f']), ctx.ler(['pm', 'list', 'packages', '-d']), ctx.ler(['pm', 'list', 'packages', '-3']),
    ctx.ler(['settings', 'list', 'global']), ctx.ler(['settings', 'list', 'secure']), ctx.ler(['settings', 'list', 'system']),
    ctx.ler(['getprop']), launcherAtual(ctx), tecladoAtual(ctx),
  ]);
  const ordenar = (t) => linhas(t).sort().join('\n');
  const conteudo = [
    `### BACKUP tvopt (painel) — ${ctx.data} — ${ctx.alvo}`,
    `### Launcher atual: ${launcher}`, `### Teclado atual : ${teclado}`,
    '', '### pm list packages -f', ordenar(f),
    '', '### pm list packages -d (desativados)', ordenar(d),
    '', '### pm list packages -3 (instalados pelo usuário)', ordenar(u),
    '', '### settings list global', g.trim(), '', '### settings list secure', s.trim(), '', '### settings list system', y.trim(),
    '', '### getprop', props.trim(), '',
  ].join('\n');
  const arq = path.join(ctx.p.saida, `backup_${ctx.data}.txt`);
  fs.writeFileSync(arq, conteudo);
  const anim = path.join(ctx.p.estado, 'animacoes_originais.txt');
  if (!fs.existsSync(anim)) {
    const vals = [];
    for (const k of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) {
      vals.push(`${k}=${(await ctx.ler(['settings', 'get', 'global', k])).trim()}`);
    }
    fs.writeFileSync(anim, vals.join('\n') + '\n');
  }
  const lo = path.join(ctx.p.estado, 'launcher_original.txt');
  if (!fs.existsSync(lo)) fs.writeFileSync(lo, launcher + '\n');
  return path.basename(arq);
}

async function backup(alvo) {
  const ctx = await ctxConectado(alvo);
  return naFila(ctx.alvo, async () => {
    const arquivo = await fazerBackup(ctx);
    return ctx.resultado({ arquivo });
  });
}

async function exigirBackup(ctx) {
  if (temBackup(ctx)) return;
  if (ctx.simular) { ctx.aviso('Nenhum backup ainda: ele será feito automaticamente antes de executar.'); return; }
  ctx.aviso('Nenhum backup encontrado: fazendo o backup agora (obrigatório antes de alterar).');
  await fazerBackup(ctx);
}

// ----------------------------------------------------------------------------- 3. classificar
async function classificar(alvo) {
  const ctx = await ctxConectado(alvo);
  return naFila(ctx.alvo, async () => {
    ctx.leitura('Lista os pacotes e compara com config/*.txt', 'pm list packages / -3 / -d');
    const [todos, usuario, off, prot] = await Promise.all([pacotes(ctx), pacotes(ctx, '-3'), pacotes(ctx, '-d'), protecaoDinamica(ctx)]);
    const bloat = new Map(lerLista('bloat_seguro.txt').map((x) => [x.pkg, x.desc]));
    const lanc = new Map(lerLista('launchers_anuncio.txt').map((x) => [x.pkg, x.desc]));
    const setUsuario = new Set(usuario);
    const setOff = new Set(off);
    const apps = todos.map((pkg) => {
      const base = { pkg, desativado: setOff.has(pkg) };
      const motivo = motivoProtecao(pkg, prot);
      if (motivo) return { ...base, categoria: 'essencial', motivo };
      if (lanc.has(pkg)) return { ...base, categoria: 'launcher', desc: lanc.get(pkg) };
      if (bloat.has(pkg)) return { ...base, categoria: 'bloat', desc: bloat.get(pkg) };
      if (setUsuario.has(pkg)) return { ...base, categoria: 'usuario' };
      return { ...base, categoria: 'duvida' };
    });
    const txt = ['essencial', 'bloat', 'launcher', 'usuario', 'duvida'].map((c) =>
      `=== ${c.toUpperCase()} ===\n` + apps.filter((a) => a.categoria === c).map((a) => `  ${a.pkg}${a.desativado ? ' [desativado]' : ''}${a.desc ? '  (' + a.desc + ')' : ''}${a.motivo ? '  (' + a.motivo + ')' : ''}`).join('\n')).join('\n\n');
    fs.writeFileSync(path.join(ctx.p.saida, `classificacao_${ctx.data}.txt`), `Classificação — ${ctx.data} — ${ctx.alvo}\nLauncher: ${prot.launcher}  Teclado: ${prot.teclado}\n\n${txt}\n`);
    return ctx.resultado({ apps, launcher: prot.indefinido ? '' : prot.launcher, teclado: prot.teclado });
  });
}

// ----------------------------------------------------------------------------- 4. desativar / reativar
async function desativar(alvo, { pacotes: lista, modo = 'disable', simular, permitirLaunchers = false } = {}) {
  if (!Array.isArray(lista) || !lista.length) throw new ErroUsuario('Nenhum pacote selecionado.');
  lista.forEach(validarPacote);
  const ctx = await ctxConectado(alvo, simular);
  return naFila(ctx.alvo, async () => {
    await exigirBackup(ctx);
    const prot = await protecaoDinamica(ctx);
    const ativos = new Set(await pacotes(ctx, '-e'));
    const launchersConhecidos = new Set(lerLista('launchers_anuncio.txt').map((x) => x.pkg));
    for (const pkg of lista) {
      const ignorar = permitirLaunchers && launchersConhecidos.has(pkg);
      const motivo = motivoProtecao(pkg, prot, ignorar);
      if (motivo) { ctx.recusado(`RECUSADO: ${pkg} (${motivo})`); continue; }
      if (!ativos.has(pkg)) { ctx.aviso(`Ignorado: ${pkg} não está instalado ou já está desativado`); continue; }
      if (modo === 'uninstall') {
        if (await ctx.alterar(`Remove ${pkg} só para o usuário 0, mantendo o APK no sistema (volta com install-existing)`, ['pm', 'uninstall', '-k', '--user', '0', pkg])) ctx.registrar(`UNINSTALL|${pkg}`);
      } else if (await ctx.alterar(`Desativa ${pkg} (volta com pm enable)`, ['pm', 'disable-user', '--user', '0', pkg])) {
        ctx.registrar(`DISABLE|${pkg}`);
      }
    }
    return ctx.resultado();
  });
}

// ----------------------------------------------------------------------------- 5. launcher
async function launcherStatus(alvo) {
  const ctx = await ctxConectado(alvo);
  return naFila(ctx.alvo, async () => {
    const [atual, disponiveis, ativos, todos] = await Promise.all([launcherAtual(ctx), launchersDisponiveis(ctx), pacotes(ctx, '-e'), pacotes(ctx)]);
    const indefinido = launcherIndefinido(atual);
    const prot = { launcher: atual.split('/')[0], launchers: indefinido ? [...new Set(disponiveis.map((c) => c.split('/')[0]))] : [atual.split('/')[0]], indefinido, teclado: '', padroes: padroesProtegidos() };
    const conhecidos = new Map(lerLista('launchers_anuncio.txt').map((x) => [x.pkg, x.desc]));
    const setAtivos = new Set(ativos);
    const lista = disponiveis.map((comp) => {
      const pkg = comp.split('/')[0];
      return {
        comp, pkg,
        emUso: !indefinido && pkg === prot.launcher,
        ativo: setAtivos.has(pkg),
        conhecidoComAnuncio: conhecidos.has(pkg),
        desc: conhecidos.get(pkg) || '',
        protegido: conhecidos.has(pkg) ? motivoProtecao(pkg, prot, true) : motivoProtecao(pkg, prot),
      };
    });
    // launchers conhecidos que estão desativados não aparecem no query-activities
    for (const [pkg, desc] of conhecidos) {
      if (todos.includes(pkg) && !lista.some((l) => l.pkg === pkg)) lista.push({ comp: '', pkg, emUso: false, ativo: false, conhecidoComAnuncio: true, desc, protegido: null });
    }
    return ctx.resultado({ atual: indefinido ? '' : atual, indefinido, lista, projectivyInstalado: todos.includes(PROJECTIVY), projectivy: PROJECTIVY });
  });
}

async function definirLauncher(alvo, { comp, simular } = {}) {
  if (!RE_COMP.test(String(comp || ''))) throw new ErroUsuario('Componente de launcher inválido.');
  const ctx = await ctxConectado(alvo, simular);
  return naFila(ctx.alvo, async () => {
    await exigirBackup(ctx);
    const atual = await launcherAtual(ctx);
    if (atual === comp) { ctx.aviso(`${comp} já é o launcher padrão.`); return ctx.resultado(); }
    if (await ctx.alterar(`Define ${comp.split('/')[0]} como tela inicial padrão (reversível)`, ['cmd', 'package', 'set-home-activity', comp])) {
      ctx.registrar(`HOME|${comp}|${atual}`);
      await ctx.alterar('Aperta HOME para testar o novo launcher', ['input', 'keyevent', 'KEYCODE_HOME']);
    } else if (!ctx.simular) {
      ctx.aviso('Este Android não aceitou set-home-activity. Aperte HOME no controle, escolha o launcher e depois "Sempre".');
    }
    return ctx.resultado();
  });
}

async function abrirPlayStore(alvo, { pkg = PROJECTIVY, simular } = {}) {
  validarPacote(pkg);
  const ctx = await ctxConectado(alvo, simular);
  return naFila(ctx.alvo, async () => {
    await ctx.alterar(`Abre a página de ${pkg} na Play Store da TV`, ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', `market://details?id=${pkg}`]);
    return ctx.resultado();
  });
}

const ERROS_INSTALACAO = [
  [/INSTALL_FAILED_OLDER_SDK|requires newer sdk/i, 'Este app precisa de um Android mais novo que o do aparelho. Procure uma versão mais antiga do app.'],
  [/NO_MATCHING_ABIS|CPU_ABI_INCOMPATIBLE/i, 'Este APK foi feito para outro tipo de processador.'],
  [/INSUFFICIENT_STORAGE/i, 'Falta espaço no aparelho. Limpe o cache (aba Desempenho) ou desinstale algo.'],
  [/UPDATE_INCOMPATIBLE|signatures do not match/i, 'Já existe uma versão deste app com outra assinatura (por exemplo, instalada pela Play Store). Desinstale a atual e tente de novo.'],
  [/VERSION_DOWNGRADE/i, 'O aparelho já tem uma versão mais nova deste app.'],
  [/PARSE_FAILED|INVALID_APK/i, 'O arquivo não é um APK válido ou está corrompido.'],
  [/USER_RESTRICTED|verification|Rejected/i, 'O aparelho bloqueou a instalação. Na TV, permita instalar apps de fontes desconhecidas ou desative "Verificar apps via USB" nas Opções do desenvolvedor.'],
];

async function versaoInstalada(ctx, pkg) {
  const out = await ctx.ler(['dumpsys', 'package', pkg]);
  const m = out.match(/versionName=(\S+)/);
  return m ? m[1] : '';
}

// Instala um APK que já está no PC. Detecta qual pacote entrou e registra no histórico (para desfazer).
async function instalarArquivo(alvo, arquivo, nome, { esperado } = {}) {
  const ctx = await ctxConectado(alvo);
  return naFila(ctx.alvo, async () => {
    await exigirBackup(ctx);
    const antes = new Set(await pacotes(ctx));
    const r = await adb.run(['-s', ctx.alvo, 'install', '-r', arquivo], { timeout: 15 * 60 * 1000 });
    const saida = (r.out + r.err).trim();
    const ok = r.code === 0 && /Success/i.test(saida);
    ctx.passos.push({ tipo: 'alteracao', explicacao: `Instala ${nome} no aparelho`, comando: `adb install -r "${nome}"`, saida, ok });
    if (!ok) {
      const dica = ERROS_INSTALACAO.find(([re]) => re.test(saida));
      if (dica) ctx.aviso(dica[1]);
      return ctx.resultado({ ok: false, erro: dica ? dica[1] : 'A instalação falhou. Veja os detalhes na Atividade.' });
    }
    const novos = (await pacotes(ctx)).filter((p) => !antes.has(p));
    for (const p of novos) ctx.registrar(`INSTALL|${p}`);
    const pkg = esperado || novos[0] || '';
    const versao = pkg ? await versaoInstalada(ctx, pkg) : '';
    if (esperado && !novos.includes(esperado) && !antes.has(esperado)) ctx.aviso(`Instalado, mas o pacote ${esperado} não apareceu. Confira na TV.`);
    return ctx.resultado({ ok: true, pacote: pkg, versao, novo: novos.length > 0 });
  });
}

// Estado do catálogo no aparelho: o que já está instalado, versão e arquitetura
async function catalogoStatus(alvo, { catalogo } = {}) {
  const ctx = await ctxConectado(alvo);
  return naFila(ctx.alvo, async () => {
    const [todos, props] = await Promise.all([pacotes(ctx), getprops(ctx)]);
    const abilist = props['ro.product.cpu.abilist'] || props['ro.product.cpu.abi'] || (await ctx.ler(['getprop', 'ro.product.cpu.abilist'])).trim();
    const instalados = {};
    await Promise.all(catalogo.filter((a) => todos.includes(a.pacote)).map(async (a) => { instalados[a.pacote] = await versaoInstalada(ctx, a.pacote) || 'instalado'; }));
    return ctx.resultado({ abilist, sdk: Number(props['ro.build.version.sdk'] || 0), android: props['ro.build.version.release'] || '', instalados });
  });
}

// ----------------------------------------------------------------------------- 6. desempenho
const ANIM = ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'];

async function desempenhoStatus(alvo) {
  const ctx = await ctxConectado(alvo);
  return naFila(ctx.alvo, async () => {
    const props = await getprops(ctx);
    const sdk = Number(props['ro.build.version.sdk'] || 0);
    const anim = {};
    for (const k of ANIM) anim[k] = (await ctx.ler(['settings', 'get', 'global', k])).trim();
    const prot = await protecaoDinamica(ctx);
    const apps = [];
    if (sdk >= 26) {
      const candidatos = (await pacotes(ctx, '-3')).filter((pkg) => !motivoProtecao(pkg, prot));
      const estados = await Promise.all(candidatos.map((pkg) => ctx.ler(['cmd', 'appops', 'get', pkg, 'RUN_IN_BACKGROUND'])));
      candidatos.forEach((pkg, i) => {
        const m = estados[i].match(/RUN_IN_BACKGROUND: (\w+)/);
        apps.push({ pkg, estado: m ? m[1] : 'default' });
      });
    }
    const df = linhas(await ctx.ler(['df', '-h', '/data']))[1];
    return ctx.resultado({ sdk, anim, apps, appopsSuportado: sdk >= 26, armazenamentoLivre: df ? df.split(/\s+/)[3] : '' });
  });
}

async function animacoes(alvo, { valor = '0.5', simular } = {}) {
  if (!['0.5', '1.0', '0'].includes(String(valor))) throw new ErroUsuario('Valor de animação inválido.');
  const ctx = await ctxConectado(alvo, simular);
  return naFila(ctx.alvo, async () => {
    await exigirBackup(ctx);
    for (const k of ANIM) {
      const antigo = (await ctx.ler(['settings', 'get', 'global', k])).trim();
      if (antigo === String(valor)) { ctx.aviso(`${k} já é ${valor}`); continue; }
      if (await ctx.alterar(`Muda ${k} de "${antigo}" para ${valor}`, ['settings', 'put', 'global', k, String(valor)])) ctx.registrar(`SETTING|global|${k}|${antigo}|${valor}`);
    }
    return ctx.resultado();
  });
}

async function restringirSegundoPlano(alvo, { pacotes: lista, simular } = {}) {
  if (!Array.isArray(lista) || !lista.length) throw new ErroUsuario('Nenhum app selecionado.');
  lista.forEach(validarPacote);
  const ctx = await ctxConectado(alvo, simular);
  return naFila(ctx.alvo, async () => {
    await exigirBackup(ctx);
    const sdk = Number((await ctx.ler(['getprop', 'ro.build.version.sdk'])).trim() || 0);
    if (sdk < 26) throw new ErroUsuario(`Android antigo (SDK ${sdk}): restrição de segundo plano não é suportada.`);
    const prot = await protecaoDinamica(ctx);
    for (const pkg of lista) {
      const motivo = motivoProtecao(pkg, prot);
      if (motivo) { ctx.recusado(`RECUSADO: ${pkg} (${motivo})`); continue; }
      for (const op of ['RUN_IN_BACKGROUND', 'RUN_ANY_IN_BACKGROUND']) {
        if (op === 'RUN_ANY_IN_BACKGROUND' && sdk < 28) continue;
        const m = (await ctx.ler(['cmd', 'appops', 'get', pkg, op])).match(new RegExp(`${op}: (\\w+)`));
        const antigo = m ? m[1] : 'default';
        if (antigo === 'ignore') continue;
        if (await ctx.alterar(`Impede ${pkg} de rodar escondido (${op})`, ['cmd', 'appops', 'set', pkg, op, 'ignore'])) ctx.registrar(`APPOPS|${pkg}|${op}|${antigo}|ignore`);
      }
    }
    return ctx.resultado();
  });
}

async function limparCache(alvo, { simular } = {}) {
  const ctx = await ctxConectado(alvo, simular);
  return naFila(ctx.alvo, async () => {
    const livre = async () => { const l = linhas(await ctx.ler(['df', '-h', '/data']))[1]; return l ? l.split(/\s+/)[3] : '?'; };
    const antes = await livre();
    await ctx.alterar('Pede ao sistema para liberar todo o cache possível (não apaga logins nem dados)', ['pm', 'trim-caches', '999G'], { timeout: 120000 });
    const depois = ctx.simular ? antes : await livre();
    if (!ctx.simular) ctx.aviso(`Espaço livre em /data: antes ${antes} → depois ${depois}`);
    return ctx.resultado({ antes, depois });
  });
}

async function encerrarSegundoPlano(alvo, { simular } = {}) {
  const ctx = await ctxConectado(alvo, simular);
  return naFila(ctx.alvo, async () => {
    const m0 = await memoria(ctx);
    await ctx.alterar('Encerra apps em cache que não estão em uso (temporário)', ['am', 'kill-all']);
    if (!ctx.simular) {
      const m1 = await memoria(ctx);
      ctx.aviso(`RAM disponível: ${Math.round((m0.MemAvailable || 0) / 1024)} MB → ${Math.round((m1.MemAvailable || 0) / 1024)} MB`);
    }
    return ctx.resultado();
  });
}

// ----------------------------------------------------------------------------- 7. HY300
async function hy300(alvo) {
  const ctx = await ctxConectado(alvo);
  return naFila(ctx.alvo, async () => {
    ctx.leitura('Resolução lógica', 'wm size; wm density');
    ctx.leitura('Modos de exibição', 'dumpsys display');
    ctx.leitura('Apps de keystone/foco e de atualização', 'pm list packages');
    const [props, wmSize, wmDens, disp, todos, sys, glob, sysset] = await Promise.all([
      getprops(ctx), ctx.ler(['wm', 'size']), ctx.ler(['wm', 'density']), ctx.ler(['dumpsys', 'display']), pacotes(ctx),
      ctx.ler(['cat', '/sys/class/disp/disp/attr/sys']), ctx.ler(['settings', 'list', 'global']), ctx.ler(['settings', 'list', 'system']),
    ]);
    const modos = linhas(disp).filter((l) => /DisplayModeRecord|mActiveModeId|real \d+ x \d+/i.test(l)).slice(0, 12);
    const fisica = (wmSize.match(/Physical size:\s*(\d+)x(\d+)/) || []).slice(1).map(Number);
    const keystone = todos.filter((p) => /keystone|trapez|focus|correct|projector|projection/i.test(p));
    const ajustes = [...linhas(glob), ...linhas(sysset)].filter((l) => /keystone|focus|trapez|project/i.test(l));
    const atualizacao = todos.filter((p) => /update|ota|fota|upgrade/i.test(p));
    const oficial = atualizacao.filter((p) => !/adups|webview|gms|vending/i.test(p));
    const dados = {
      modelo: props['ro.product.model'] || '', plataforma: props['ro.board.platform'] || '', android: props['ro.build.version.release'] || '',
      resolucao: linhas(wmSize).join(' / '), densidade: linhas(wmDens).join(' / '),
      resolucaoFisica: fisica.length ? `${fisica[0]}x${fisica[1]}` : '',
      acimaDoPainel: fisica.length ? Math.max(...fisica) > 1280 : null,
      modos, driver: linhas(sys).slice(0, 12),
      keystone, ajustes,
      firmware: { fingerprint: props['ro.build.fingerprint'] || '', build: props['ro.build.display.id'] || '', data: props['ro.build.date'] || '', patch: props['ro.build.version.security_patch'] || '' },
      atualizacao, atualizacaoOficial: oficial[0] || '',
    };
    fs.writeFileSync(path.join(ctx.p.saida, `hy300_${ctx.data}.txt`), JSON.stringify(dados, null, 2));
    return ctx.resultado({ dados });
  });
}

async function abrirApp(alvo, { pkg, simular } = {}) {
  validarPacote(pkg);
  const ctx = await ctxConectado(alvo, simular);
  return naFila(ctx.alvo, async () => {
    await ctx.alterar(`Abre ${pkg} na tela do aparelho`, ['monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
    return ctx.resultado();
  });
}

// ----------------------------------------------------------------------------- histórico / desfazer
function lerLog(alvo) {
  const p = pastas(normalizarAlvo(alvo));
  if (!fs.existsSync(p.log)) return [];
  return fs.readFileSync(p.log, 'utf8').split('\n').filter(Boolean).map((linha, i) => {
    const [tipo, a, b, c, d] = linha.split('|');
    return { i, linha, tipo, a, b, c, d };
  });
}

function comandoDesfazer(e) {
  switch (e.tipo) {
    case 'DISABLE': return { explicacao: `Reativa ${e.a}`, args: ['pm', 'enable', '--user', '0', e.a] };
    case 'UNINSTALL': return { explicacao: `Reinstala ${e.a} a partir do sistema`, args: ['cmd', 'package', 'install-existing', e.a] };
    case 'SETTING': return (!e.c || e.c === 'null')
      ? { explicacao: `Volta ${e.a}/${e.b} ao padrão`, args: ['settings', 'delete', e.a, e.b] }
      : { explicacao: `Restaura ${e.a}/${e.b} = ${e.c}`, args: ['settings', 'put', e.a, e.b, e.c] };
    case 'APPOPS': return { explicacao: `Restaura ${e.b} de ${e.a} para ${e.c}`, args: ['cmd', 'appops', 'set', e.a, e.b, e.c] };
    case 'HOME': return e.b ? { explicacao: `Volta o launcher para ${e.b.split('/')[0]}`, args: ['cmd', 'package', 'set-home-activity', e.b] } : null;
    case 'INSTALL': return { explicacao: `Desinstala ${e.a} (instalado pelo painel)`, args: ['pm', 'uninstall', e.a] };
    default: return null;
  }
}

function comandoReaplicar(e) {
  switch (e.tipo) {
    case 'DISABLE': return ['pm', 'disable-user', '--user', '0', e.a];
    case 'UNINSTALL': return ['pm', 'uninstall', '-k', '--user', '0', e.a];
    case 'SETTING': return ['settings', 'put', e.a, e.b, e.d];
    case 'APPOPS': return ['cmd', 'appops', 'set', e.a, e.b, e.d];
    case 'HOME': return ['cmd', 'package', 'set-home-activity', e.a];
    default: return null;
  }
}

async function historico(alvo) {
  alvo = normalizarAlvo(alvo);
  const p = pastas(alvo);
  const arquivos = fs.readdirSync(p.saida).filter((f) => /\.(txt|sh|bat)$/.test(f)).sort().reverse();
  return { entradas: lerLog(alvo), arquivos };
}

// desfaz todas (indices = undefined) ou só as entradas indicadas
async function desfazer(alvo, { indices, simular } = {}) {
  const ctx = await ctxConectado(alvo, simular);
  return naFila(ctx.alvo, async () => {
    const todas = lerLog(ctx.alvo);
    const alvoSet = Array.isArray(indices) ? new Set(indices.map(Number)) : null;
    const escolhidas = todas.filter((e) => !alvoSet || alvoSet.has(e.i)).reverse();
    if (!escolhidas.length) { ctx.aviso('Nada para desfazer.'); return ctx.resultado(); }
    const desfeitas = new Set();
    for (const e of escolhidas) {
      const c = comandoDesfazer(e);
      if (!c) { desfeitas.add(e.i); continue; }
      if (await ctx.alterar(c.explicacao, c.args)) desfeitas.add(e.i);
    }
    if (!ctx.simular) {
      const restantes = todas.filter((e) => !desfeitas.has(e.i)).map((e) => e.linha);
      const feitas = todas.filter((e) => desfeitas.has(e.i)).map((e) => e.linha);
      if (feitas.length) fs.appendFileSync(path.join(ctx.p.estado, `alteracoes_desfeitas_${ctx.data}.log`), feitas.join('\n') + '\n');
      fs.writeFileSync(ctx.p.log, restantes.length ? restantes.join('\n') + '\n' : '');
    }
    return ctx.resultado();
  });
}

// ----------------------------------------------------------------------------- 8. gerar scripts
function gerarScripts(alvo) {
  alvo = normalizarAlvo(alvo);
  const p = pastas(alvo);
  const entradas = lerLog(alvo);
  if (!entradas.length) throw new ErroUsuario('Nenhuma alteração registrada ainda.');
  const base = alvo.replace(/[:.]/g, '_');
  const data = dataStr();
  const shq = (args) => args.map(adb.q).join(' ');
  const batq = (args) => args.map((a) => (/[\s$&|<>^]/.test(a) ? `"${a}"` : a)).join(' ');
  const cab = (tit) => ['#!/usr/bin/env bash', `# ${tit} em ${alvo} (gerado pelo painel em ${data})`, `T="\${1:-${alvo}}"; adb connect "$T"`, 'A() { adb -s "$T" shell "$@"; }'];
  const cabBat = (tit) => ['@echo off', `REM ${tit} em ${alvo} (gerado pelo painel em ${data})`, 'set T=%1', `if "%T%"=="" set T=${alvo}`, 'adb connect %T%'];
  const rs = cab('Reaplica as otimizações'); const ds = cab('DESFAZ as otimizações');
  const rb = cabBat('Reaplica as otimizacoes'); const db = cabBat('DESFAZ as otimizacoes');
  for (const e of entradas) {
    const c = comandoReaplicar(e);
    if (c) { rs.push(`A ${shq(c)}`); rb.push(`adb -s %T% shell ${batq(c)}`); }
  }
  for (const e of [...entradas].reverse()) {
    const c = comandoDesfazer(e);
    if (c) { ds.push(`A ${shq(c.args)}`); db.push(`adb -s %T% shell ${batq(c.args)}`); }
  }
  rs.push('echo "Concluído."'); ds.push('echo "Concluído. Reinicie o aparelho se algo não voltar de imediato."');
  rb.push('echo Concluido.', 'pause'); db.push('echo Concluido. Reinicie o aparelho se algo nao voltar de imediato.', 'pause');
  const arquivos = {
    [`reaplicar_${base}.sh`]: rs.join('\n') + '\n',
    [`desfazer_${base}.sh`]: ds.join('\n') + '\n',
    [`reaplicar_${base}.bat`]: rb.join('\r\n') + '\r\n',
    [`desfazer_${base}.bat`]: db.join('\r\n') + '\r\n',
  };
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    fs.writeFileSync(path.join(p.saida, nome), conteudo, { mode: nome.endsWith('.sh') ? 0o755 : 0o644 });
  }
  return { arquivos: Object.keys(arquivos) };
}

function caminhoArquivo(alvo, nome) {
  alvo = normalizarAlvo(alvo);
  if (!/^[A-Za-z0-9_.\-]+\.(txt|sh|bat)$/.test(String(nome || ''))) throw new ErroUsuario('Arquivo inválido.');
  const arq = path.join(pastas(alvo).saida, nome);
  if (!fs.existsSync(arq)) throw new ErroUsuario('Arquivo não encontrado.');
  return arq;
}

// ----------------------------------------------------------------------------- 9. resumo
async function resumo(alvo) {
  const ctx = await ctxConectado(alvo);
  return naFila(ctx.alvo, async () => {
    const mem = await memoria(ctx);
    const antesArq = path.join(ctx.p.estado, 'ram_antes.txt');
    const antes = fs.existsSync(antesArq) ? Number(fs.readFileSync(antesArq, 'utf8')) : null;
    const entradas = lerLog(ctx.alvo);
    const dados = {
      ramAntesMB: antes ? Math.round(antes / 1024) : null,
      ramAgoraMB: Math.round((mem.MemAvailable || 0) / 1024),
      ramTotalMB: Math.round((mem.MemTotal || 0) / 1024),
      desativados: entradas.filter((e) => e.tipo === 'DISABLE').map((e) => e.a),
      removidos: entradas.filter((e) => e.tipo === 'UNINSTALL').map((e) => e.a),
      configuracoes: entradas.filter((e) => e.tipo === 'SETTING').map((e) => `${e.b}: ${e.c} → ${e.d}`),
      segundoPlano: [...new Set(entradas.filter((e) => e.tipo === 'APPOPS').map((e) => e.a))],
      launcher: entradas.filter((e) => e.tipo === 'HOME').map((e) => e.a.split('/')[0]).pop() || null,
      instalados: entradas.filter((e) => e.tipo === 'INSTALL').map((e) => e.a),
    };
    const txt = [
      `Resumo — ${ctx.data} — ${ctx.alvo}`,
      `RAM disponível: antes ${dados.ramAntesMB ?? '?'} MB, agora ${dados.ramAgoraMB} MB (total ${dados.ramTotalMB} MB)`,
      `Desativados (${dados.desativados.length}): ${dados.desativados.join(', ')}`,
      `Removidos (${dados.removidos.length}): ${dados.removidos.join(', ')}`,
      `Configurações: ${dados.configuracoes.join('; ')}`,
      `Segundo plano restrito: ${dados.segundoPlano.join(', ')}`,
      `Launcher: ${dados.launcher || 'sem mudança'}`,
      `Apps instalados pelo painel: ${dados.instalados.join(', ') || 'nenhum'}`,
    ].join('\n');
    fs.writeFileSync(path.join(ctx.p.saida, `resumo_${ctx.data}.txt`), txt + '\n');
    return ctx.resultado({ dados });
  });
}

// funções internas expostas só para os testes
const _interno = { motivoProtecao, padroesProtegidos, comandoDesfazer, comandoReaplicar, launcherIndefinido };

module.exports = {
  _interno,
  ErroUsuario, normalizarAlvo, SAIDA,
  info, backup, classificar, desativar,
  launcherStatus, definirLauncher, abrirPlayStore, instalarArquivo, catalogoStatus,
  desempenhoStatus, animacoes, restringirSegundoPlano, limparCache, encerrarSegundoPlano,
  hy300, abrirApp, historico, desfazer, gerarScripts, caminhoArquivo, resumo,
};
