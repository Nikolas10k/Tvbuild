'use strict';
/* Tvbuild — Painel local (frontend). Sem bibliotecas: funciona offline. */

// ---------------------------------------------------------------------------- estado
const S = {
  token: null,
  aparelhos: [],
  dispositivos: {},
  alvo: null,
  aba: 'geral',
  dados: {}, // cache por alvo: { info, apps, launcher, desempenho, hy300, historico, resumo }
  filtro: 'bloat',
  busca: '',
  selApps: new Set(),
  selBg: new Set(),
  nAtividade: 0,
};

(function lerToken() {
  const m = location.hash.match(/t=([0-9a-f]+)/);
  try {
    if (m) { sessionStorage.setItem('tvbuild_token', m[1]); history.replaceState(null, '', location.pathname); }
    S.token = sessionStorage.getItem('tvbuild_token');
  } catch (_) { S.token = m ? m[1] : null; }
})();

// ---------------------------------------------------------------------------- utilitários
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const aparelhoAtual = () => S.aparelhos.find((a) => a.alvo === S.alvo);
const cache = () => (S.dados[S.alvo] ||= {});

async function api(caminho, { metodo = 'GET', corpo, bruto } = {}) {
  const headers = { 'X-Tvbuild': '1' };
  if (S.token) headers['X-Token'] = S.token;
  let body;
  if (bruto) { body = bruto; headers['Content-Type'] = 'application/octet-stream'; }
  else if (corpo !== undefined) { body = JSON.stringify(corpo); headers['Content-Type'] = 'application/json'; }
  const r = await fetch(caminho, { method: metodo, headers, body });
  const tipo = r.headers.get('content-type') || '';
  if (!tipo.includes('application/json')) {
    if (!r.ok) throw new Error(`Erro ${r.status}`);
    return r;
  }
  const j = await r.json();
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
  return j;
}
const op = (nome, params = {}) => api(`/api/op/${nome}`, { metodo: 'POST', corpo: { alvo: S.alvo, ...params } });

let toastTimer;
function toast(msg, erro = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast vis' + (erro ? ' erro' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, erro ? 6000 : 3000);
}

function atividade(texto, passos = []) {
  const li = document.createElement('li');
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.innerHTML = `<time>${hora}</time><div><div>${esc(texto)}</div>${passos.map(htmlPasso).join('')}</div>`;
  $('#logAtividade').prepend(li);
  $('#contAtividade').textContent = ++S.nAtividade;
}

function htmlPasso(p) {
  const cls = p.tipo === 'recusado' ? 'recusado' : p.tipo === 'aviso' ? 'aviso' : p.tipo === 'alteracao' && !p.simulado ? (p.ok ? 'ok' : 'falhou') : '';
  return `<div class="passo ${cls}">
    <div class="exp">${esc(p.explicacao)}</div>
    ${p.comando ? `<div class="cmd">$ ${esc(p.comando)}</div>` : ''}
    ${p.saida ? `<div class="out">${esc(p.saida)}</div>` : ''}
  </div>`;
}

async function comBotao(btn, fn) {
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); } catch (e) { toast(e.message, true); atividade('Erro: ' + e.message); } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
}

// ---------------------------------------------------------------------------- modal
function modal({ titulo, html, acoes }) {
  return new Promise((resolve) => {
    const d = $('#modal');
    $('#modalTitulo').textContent = titulo;
    $('#modalConteudo').innerHTML = html;
    const caixa = $('#modalAcoes');
    caixa.innerHTML = '';
    acoes.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.classe || '');
      b.textContent = a.texto;
      if (a.exigeCheck) {
        b.disabled = true;
        setTimeout(() => {
          const c = $('#modalConteudo input[data-confirma]');
          if (c) c.addEventListener('change', () => { b.disabled = !c.checked; });
        });
      }
      b.addEventListener('click', () => { d.close(); resolve(a.valor); });
      caixa.appendChild(b);
    });
    d.onclose = () => resolve(null);
    d.oncancel = () => resolve(null);
    d.showModal();
    const foco = caixa.querySelector('.btn.sec') || caixa.querySelector('.btn');
    if (foco) foco.focus();
  });
}

// Fluxo padrão para tudo que ALTERA o aparelho:
// 1) pede o plano ao servidor (simular) -> 2) mostra comandos + explicação -> 3) só executa após "Executar"
async function executarComConfirmacao({ titulo, operacao, params = {}, alertaHtml = '', exigeCheck = false, depois }) {
  const plano = await op(operacao, { ...params, simular: true });
  const alteracoes = plano.passos.filter((p) => p.tipo === 'alteracao');
  const html = `${alertaHtml}
    ${alteracoes.length ? `<p class="texto-2">Estes comandos serão executados no aparelho:</p>` : '<div class="nota info">Nada a alterar.</div>'}
    <div>${plano.passos.filter((p) => p.tipo !== 'leitura').map(htmlPasso).join('')}</div>
    ${exigeCheck ? `<label class="check-confirma"><input type="checkbox" data-confirma> <span>Pesquisei e tenho certeza do que esses pacotes fazem.</span></label>` : ''}`;
  if (!alteracoes.length) {
    await modal({ titulo, html, acoes: [{ texto: 'Fechar', valor: false, classe: 'sec' }] });
    return null;
  }
  const ok = await modal({
    titulo, html,
    acoes: [{ texto: 'Cancelar', valor: false, classe: 'sec' }, { texto: `Executar ${alteracoes.length} comando${alteracoes.length > 1 ? 's' : ''}`, valor: true, exigeCheck }],
  });
  if (!ok) return null;
  const r = await op(operacao, { ...params, simular: false });
  const falhas = r.passos.filter((p) => p.tipo === 'alteracao' && !p.ok).length;
  atividade(`${titulo}: ${falhas ? falhas + ' falha(s)' : 'concluído'}`, r.passos.filter((p) => p.tipo !== 'leitura'));
  toast(falhas ? `Concluído com ${falhas} falha(s). Veja a Atividade.` : 'Concluído.', !!falhas);
  delete cache().historico;
  delete cache().resumo;
  if (depois) await depois(r);
  return r;
}

// ---------------------------------------------------------------------------- aparelhos
async function atualizarEstado() {
  try {
    const e = await api('/api/estado');
    S.aparelhos = e.aparelhos;
    S.dispositivos = e.dispositivos;
    const st = $('#statusAdb');
    st.textContent = e.adb ? e.adb.replace('Android Debug Bridge version', 'adb') : 'adb não encontrado: instale o Platform Tools';
    st.classList.toggle('erro', !e.adb);
    renderAparelhos();
  } catch (e) {
    $('#statusAdb').textContent = e.message;
    $('#statusAdb').classList.add('erro');
  }
}

function renderAparelhos() {
  const ul = $('#listaAparelhos');
  if (!S.aparelhos.length) { ul.innerHTML = '<li class="texto-2" style="font-size:14px">Nenhum aparelho ainda.</li>'; return; }
  ul.innerHTML = S.aparelhos.map((a) => {
    const st = S.dispositivos[a.alvo];
    const cls = st === 'device' ? 'on' : st ? 'aviso' : '';
    const tit = st === 'device' ? 'conectado' : st === 'unauthorized' ? 'aguardando autorização na TV' : 'desconectado';
    return `<li>
      <button class="aparelho" data-alvo="${esc(a.alvo)}" aria-current="${a.alvo === S.alvo}">
        <span class="ponto ${cls}" title="${tit}"></span>
        <span style="min-width:0"><span class="nome">${esc(a.nome)}</span><span class="ip">${esc(a.alvo)} · ${a.tipo === 'hy300' ? 'HY300' : 'TV box'}</span></span>
      </button>
      <button class="remover" data-remover="${esc(a.alvo)}" title="Remover da lista" aria-label="Remover ${esc(a.nome)} da lista">✕</button>
    </li>`;
  }).join('');
}

$('#listaAparelhos').addEventListener('click', async (ev) => {
  const sel = ev.target.closest('[data-alvo]');
  const rem = ev.target.closest('[data-remover]');
  if (rem) {
    const ok = await modal({
      titulo: 'Remover da lista?',
      html: '<p>Só remove o aparelho deste painel. Nada é alterado no aparelho, e os backups continuam na pasta <code>saida/</code>.</p>',
      acoes: [{ texto: 'Cancelar', valor: false, classe: 'sec' }, { texto: 'Remover da lista', valor: true, classe: 'perigo' }],
    });
    if (!ok) return;
    const r = await api('/api/aparelhos/remover', { metodo: 'POST', corpo: { alvo: rem.dataset.remover } });
    S.aparelhos = r.aparelhos;
    if (S.alvo === rem.dataset.remover) { S.alvo = null; renderPrincipal(); }
    renderAparelhos();
    return;
  }
  if (sel) selecionar(sel.dataset.alvo);
});

$('#formAparelho').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = ev.submitter;
  await comBotao(btn, async () => {
    const r = await api('/api/aparelhos', { metodo: 'POST', corpo: { nome: $('#fNome').value.trim(), alvo: $('#fAlvo').value.trim(), tipo: $('#fTipo').value } });
    S.aparelhos = r.aparelhos;
    const novo = r.aparelhos[r.aparelhos.length - 1];
    $('#formAparelho').reset();
    renderAparelhos();
    selecionar(novo.alvo);
  });
});

async function selecionar(alvo) {
  S.alvo = alvo;
  S.selApps.clear(); S.selBg.clear();
  const ap = aparelhoAtual();
  S.aba = 'geral';
  cache().conectando = true;
  renderAparelhos();
  renderPrincipal();
  const c = await api('/api/conectar', { metodo: 'POST', corpo: { alvo } }).catch((e) => ({ ok: false, mensagem: e.message }));
  S.dispositivos[alvo] = c.estado;
  delete cache().conectando;
  if (S.alvo !== alvo) return;
  renderAparelhos();
  if (!c.ok) {
    cache().erroConexao = c.estado === 'unauthorized'
      ? 'O aparelho ainda não autorizou este PC. Aceite o aviso “Permitir depuração?” na tela da TV (marque “Sempre permitir”) e clique em Tentar de novo.'
      : `Não consegui conectar em ${alvo}. Confira se o IP está certo, se o PC e a TV estão na mesma rede e se a depuração ADB em rede está ativa. ${c.mensagem || ''}`;
  } else {
    delete cache().erroConexao;
    atividade(`Conectado em ${ap ? ap.nome : alvo}`);
  }
  renderPrincipal();
}

// ---------------------------------------------------------------------------- principal
const ABAS = [
  ['geral', 'Visão geral'],
  ['apps', 'Apps'],
  ['launcher', 'Launcher'],
  ['desempenho', 'Desempenho'],
  ['hy300', 'Projetor HY300'],
  ['historico', 'Histórico e desfazer'],
];

function renderPrincipal() {
  const m = $('#principal');
  const ap = aparelhoAtual();
  if (!ap) {
    m.innerHTML = `<section class="vazio"><h1>Nenhum aparelho selecionado</h1><p>Adicione a TV box ou o projetor pelo IP, à esquerda. Nada é alterado sem você confirmar, e tudo pode ser desfeito.</p></section>`;
    return;
  }
  const abas = ABAS.filter(([id]) => id !== 'hy300' || ap.tipo === 'hy300');
  m.innerHTML = `
    <div class="cab-aparelho">
      <div><h1>${esc(ap.nome)}</h1><div class="sub mono">${esc(ap.alvo)}</div></div>
    </div>
    <nav class="abas" role="tablist">${abas.map(([id, nome]) => `<button class="aba" role="tab" data-aba="${id}" aria-selected="${S.aba === id}">${nome}</button>`).join('')}</nav>
    <div id="conteudo"></div>`;
  m.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => { S.aba = b.dataset.aba; renderPrincipal(); }));
  const c = $('#conteudo');
  if (cache().conectando) { carregando(c, `Conectando em ${ap.alvo}…`); return; }
  if (cache().erroConexao) {
    c.innerHTML = `<div class="nota perigo"><p>${esc(cache().erroConexao)}</p></div><div class="acoes" style="margin-top:16px"><button class="btn" id="btnReconectar">Tentar de novo</button></div>`;
    $('#btnReconectar').addEventListener('click', () => selecionar(S.alvo));
    return;
  }
  ({ geral: abaGeral, apps: abaApps, launcher: abaLauncher, desempenho: abaDesempenho, hy300: abaHy300, historico: abaHistorico }[S.aba] || abaGeral)(c);
}

function carregando(c, texto) { c.innerHTML = `<div class="carregando"><span class="giro"></span>${esc(texto)}</div>`; }

async function carregar(chave, nomeOp, c, texto, forcar = false) {
  if (!forcar && cache()[chave]) return cache()[chave];
  carregando(c, texto);
  const alvo = S.alvo;
  try {
    const r = await op(nomeOp);
    S.dados[alvo] ||= {};
    S.dados[alvo][chave] = r;
    return alvo === S.alvo && c.isConnected ? r : null;
  } catch (e) {
    if (alvo === S.alvo) c.innerHTML = `<div class="nota perigo">${esc(e.message)}</div>`;
    return null;
  }
}

// ---------------------------------------------------------------------------- aba: visão geral
async function abaGeral(c, forcar = false) {
  const r = await carregar('info', 'info', c, 'Lendo informações do aparelho…', forcar);
  if (!r || S.aba !== 'geral') return;
  const d = r.dados;
  const usoRam = d.ramTotalMB ? Math.round(100 * (d.ramTotalMB - d.ramDisponivelMB) / d.ramTotalMB) : 0;
  const h = cache().historico;
  const temAlteracoes = h ? h.entradas.length > 0 : null;
  const passos = [
    ['Coletar informações', true],
    ['Backup de pacotes e configurações', d.temBackup],
    ['Classificar apps (aba Apps)', !!cache().apps],
    ['Desativar bloatware (aba Apps)', temAlteracoes],
    ['Launcher leve (aba Launcher)', d.launcher && d.launcher.startsWith('com.spocky.projengmenu')],
    ['Ajustes de desempenho (aba Desempenho)', null],
    ['Gerar scripts e ver resumo (aba Histórico)', null],
  ];
  c.innerHTML = `
    <div class="grade">
      <div class="cartao"><div class="rotulo">Modelo</div><div class="valor">${esc(d.modelo || '?')}</div><div class="det">${esc([d.fabricante, d.dispositivo].filter(Boolean).join(' · '))}</div></div>
      <div class="cartao"><div class="rotulo">Android</div><div class="valor">${esc(d.android)} <small class="texto-2" style="font-size:14px">SDK ${d.sdk}</small></div><div class="det">Patch ${esc(d.patch || '?')}</div></div>
      <div class="cartao"><div class="rotulo">Chip</div><div class="valor" style="font-size:16px">${esc(d.plataforma || '?')}</div><div class="det">${d.nucleos} núcleos</div></div>
      <div class="cartao"><div class="rotulo">RAM disponível</div><div class="valor">${d.ramDisponivelMB} MB <small class="texto-2" style="font-size:14px">de ${d.ramTotalMB} MB</small></div>
        <div class="barra" title="${usoRam}% em uso"><i style="width:${usoRam}%"></i></div>
        <div class="det">${d.ramAntesMB != null ? `Antes das mudanças: ${d.ramAntesMB} MB` : ''}</div></div>
      <div class="cartao"><div class="rotulo">Armazenamento livre</div><div class="valor">${esc(d.armazenamento ? d.armazenamento.livre : '?')}</div><div class="det">${d.armazenamento ? `de ${esc(d.armazenamento.total)} (${esc(d.armazenamento.uso)} usado)` : ''}</div></div>
      <div class="cartao"><div class="rotulo">Apps</div><div class="valor">${d.pacotes.total}</div><div class="det">${d.pacotes.usuario} instalados por você · ${d.pacotes.desativados} desativados</div></div>
    </div>
    <div class="cartao" style="margin-top:16px">
      <div class="cartao-cab"><h2>Tela e entrada</h2></div>
      <ul class="lista-simples">
        <li><span>Resolução</span><span class="mono">${esc(d.resolucao)}</span></li>
        <li><span>Launcher em uso</span><span class="mono">${esc(d.launcher || '?')}</span></li>
        <li><span>Teclado em uso</span><span class="mono">${esc(d.teclado || '?')}</span></li>
      </ul>
    </div>
    <div class="cartao">
      <div class="cartao-cab"><h2>Roteiro</h2>
        <div class="acoes">
          <button class="btn sec" id="btnAtualizarInfo">Atualizar</button>
          <button class="btn" id="btnBackup">${d.temBackup ? 'Fazer novo backup' : 'Fazer backup agora'}</button>
        </div>
      </div>
      ${d.temBackup ? '' : '<div class="nota alerta" style="margin-bottom:12px"><b>Sem backup ainda.</b> O painel faz o backup sozinho antes da primeira alteração, mas você pode fazer agora.</div>'}
      <ol class="passos">${passos.map(([t, f], i) => `<li class="${f ? 'feito' : ''}"><span class="n">${f ? '✓' : i + 1}</span><span class="t">${t}</span></li>`).join('')}</ol>
      <p class="texto-2" style="font-size:13px;margin-top:12px">Dica: para medir a RAM “antes” de forma justa, reinicie o aparelho e espere 2 minutos antes da primeira leitura.</p>
    </div>`;
  c.querySelector('#btnAtualizarInfo').addEventListener('click', () => abaGeral(c, true));
  c.querySelector('#btnBackup').addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
    const b = await op('backup');
    atividade(`Backup salvo: ${b.arquivo}`, b.passos);
    toast('Backup salvo em saida/ (' + b.arquivo + ')');
    await abaGeral(c, true);
  }));
}

// ---------------------------------------------------------------------------- aba: apps
const CATS = {
  bloat: ['Bloatware seguro', 'bloat'],
  duvida: ['Dúvida', 'duvida'],
  launcher: ['Launchers com anúncio', 'launcher'],
  usuario: ['Seus apps', 'usuario'],
  essencial: ['Essenciais (protegidos)', 'essencial'],
  todos: ['Todos', ''],
};

async function abaApps(c, forcar = false) {
  const r = await carregar('apps', 'classificar', c, 'Lendo e classificando os apps…', forcar);
  if (!r || S.aba !== 'apps') return;
  const apps = r.apps;
  const contagem = Object.fromEntries(Object.keys(CATS).map((k) => [k, k === 'todos' ? apps.length : apps.filter((a) => a.categoria === k).length]));
  const visiveis = apps.filter((a) => (S.filtro === 'todos' || a.categoria === S.filtro) && (!S.busca || a.pkg.toLowerCase().includes(S.busca.toLowerCase()) || (a.desc || '').toLowerCase().includes(S.busca.toLowerCase())));
  const selecionavel = (a) => (a.categoria === 'bloat' || a.categoria === 'duvida') && !a.desativado;
  const textoCat = {
    bloat: 'Apps conhecidos e seguros de desativar. Você pode reativar qualquer um depois.',
    duvida: 'Apps de sistema que o painel não conhece. Pesquise cada um (ou pergunte) antes de desativar.',
    launcher: 'Telas iniciais de fábrica com anúncios. Troque o launcher na aba Launcher antes de desativá-las.',
    usuario: 'Apps que você instalou. O painel não mexe neles.',
    essencial: 'Sistema, teclado, Wi-Fi, Bluetooth, HDMI, keystone/foco etc. Nunca são alterados.',
    todos: 'Todos os pacotes instalados.',
  }[S.filtro];

  c.innerHTML = `
    <div class="cartao-cab">
      <div class="filtros" role="group" aria-label="Filtrar por categoria">${Object.entries(CATS).map(([k, [nome]]) => `<button class="chip" data-filtro="${k}" aria-pressed="${S.filtro === k}">${nome} <span class="c">${contagem[k]}</span></button>`).join('')}</div>
      <div class="acoes"><input class="busca" id="busca" type="search" placeholder="Buscar pacote" aria-label="Buscar pacote" value="${esc(S.busca)}"><button class="btn sec" id="btnReclass">Reclassificar</button></div>
    </div>
    <p class="texto-2" style="margin-bottom:12px">${textoCat}</p>
    ${visiveis.length ? `<ul class="tabela-apps">${visiveis.map((a) => {
      const pode = selecionavel(a);
      return `<li class="${pode ? '' : 'travado'}">
        <input type="checkbox" data-pkg="${esc(a.pkg)}" ${pode ? '' : 'disabled'} ${S.selApps.has(a.pkg) ? 'checked' : ''} aria-label="Selecionar ${esc(a.pkg)}">
        <div><div class="pkg">${esc(a.pkg)}</div>${a.desc || a.motivo ? `<div class="desc">${esc(a.desc || a.motivo)}</div>` : ''}</div>
        <div class="selos">${a.desativado ? '<span class="selo off">desativado</span> ' : ''}<span class="selo ${CATS[a.categoria][1]}">${CATS[a.categoria][0].replace(' (protegidos)', '')}</span></div>
      </li>`;
    }).join('')}</ul>` : '<div class="nota info">Nenhum app nesta categoria.</div>'}
    <div class="barra-acao">
      <div class="acoes">
        <strong id="nSel">${S.selApps.size} selecionado(s)</strong>
        ${S.filtro === 'bloat' ? '<button class="btn sec peq" id="btnSelBloat">Selecionar todo o bloatware</button>' : ''}
        ${S.selApps.size ? '<button class="btn sec peq" id="btnLimparSel">Limpar seleção</button>' : ''}
      </div>
      <div class="acoes">
        <select id="modo" aria-label="Modo">
          <option value="disable">Desativar (pm disable-user)</option>
          <option value="uninstall">Remover para o usuário (pm uninstall -k --user 0)</option>
        </select>
        <button class="btn" id="btnDesativar" ${S.selApps.size ? '' : 'disabled'}>Revisar e desativar</button>
      </div>
    </div>`;

  c.querySelectorAll('[data-filtro]').forEach((b) => b.addEventListener('click', () => { S.filtro = b.dataset.filtro; abaApps(c); }));
  const busca = c.querySelector('#busca');
  busca.addEventListener('input', () => { S.busca = busca.value; abaApps(c).then(() => { const b = c.querySelector('#busca'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }); });
  c.querySelector('#btnReclass').addEventListener('click', () => abaApps(c, true));
  c.querySelectorAll('input[data-pkg]').forEach((cb) => cb.addEventListener('change', () => {
    cb.checked ? S.selApps.add(cb.dataset.pkg) : S.selApps.delete(cb.dataset.pkg);
    c.querySelector('#nSel').textContent = `${S.selApps.size} selecionado(s)`;
    c.querySelector('#btnDesativar').disabled = !S.selApps.size;
  }));
  const sb = c.querySelector('#btnSelBloat');
  if (sb) sb.addEventListener('click', () => { apps.filter((a) => a.categoria === 'bloat' && !a.desativado).forEach((a) => S.selApps.add(a.pkg)); abaApps(c); });
  const ls = c.querySelector('#btnLimparSel');
  if (ls) ls.addEventListener('click', () => { S.selApps.clear(); abaApps(c); });
  c.querySelector('#btnDesativar').addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
    const lista = [...S.selApps];
    const duvidas = lista.filter((p) => (apps.find((a) => a.pkg === p) || {}).categoria === 'duvida');
    const modo = c.querySelector('#modo').value;
    const alerta = (duvidas.length ? `<div class="nota alerta"><b>Atenção:</b> ${duvidas.length} app(s) da lista <b>Dúvida</b>: ${duvidas.map((d) => `<code>${esc(d)}</code>`).join(', ')}. Se algo parar de funcionar, reative pela aba Histórico.</div>` : '')
      + (modo === 'uninstall' ? '<div class="nota info">“Remover para o usuário” tira o app da lista, mas o APK continua no sistema e pode voltar com <code>install-existing</code>.</div>' : '');
    const r = await executarComConfirmacao({
      titulo: modo === 'uninstall' ? 'Remover apps (usuário 0)' : 'Desativar apps',
      operacao: 'desativar', params: { pacotes: lista, modo }, alertaHtml: alerta, exigeCheck: duvidas.length > 0,
    });
    if (r) { S.selApps.clear(); delete cache().info; await abaApps(c, true); }
  }));
}

// ---------------------------------------------------------------------------- aba: launcher
async function abaLauncher(c, forcar = false) {
  const r = await carregar('launcher', 'launcherStatus', c, 'Verificando launchers…', forcar);
  if (!r || S.aba !== 'launcher') return;
  const proj = r.lista.find((l) => l.pkg === r.projectivy);
  const projEmUso = proj && proj.emUso;
  const outros = r.lista.filter((l) => l.pkg !== r.projectivy);
  c.innerHTML = `
    <div class="cartao">
      <div class="cartao-cab"><h2>Launcher em uso</h2><button class="btn sec peq" id="btnAtLanc">Atualizar</button></div>
      <p class="mono">${esc(r.atual || 'desconhecido')}</p>
    </div>
    <div class="cartao">
      <div class="cartao-cab"><h2>1. Projectivy Launcher</h2>${projEmUso ? '<span class="selo bloat">em uso</span>' : ''}</div>
      <p class="texto-2">Leve, sem anúncios e feito para controle remoto. Pacote <code>${esc(r.projectivy)}</code>.</p>
      <div class="acoes" style="margin-top:12px">
        ${!r.projectivyInstalado ? `
          <button class="btn" id="btnPlayStore">Abrir na Play Store da TV</button>
          <label class="btn sec" for="apkLauncher">Instalar APK do PC…</label><input type="file" id="apkLauncher" accept=".apk" hidden>`
        : !proj ? '<div class="nota alerta">Projectivy está instalado, mas não aparece como tela inicial. Abra o app uma vez na TV e clique em Atualizar.</div>'
        : !projEmUso ? '<button class="btn" id="btnDefinirProj">Definir como tela inicial padrão</button>'
        : '<span class="texto-2">Pronto. No Google TV, ative em Projectivy → Configurações → “Substituir botão Home”.</span>'}
      </div>
    </div>
    <div class="cartao">
      <div class="cartao-cab"><h2>2. Launchers antigos</h2></div>
      ${!projEmUso ? '<div class="nota info" style="margin-bottom:12px">Por segurança, os launchers antigos só podem ser desativados <b>depois</b> que o Projectivy estiver em uso.</div>' : ''}
      ${outros.length ? `<ul class="lista-simples">${outros.map((l) => `
        <li>
          <div><div class="mono">${esc(l.pkg)}</div><div class="texto-2" style="font-size:13px">${esc(l.desc || (l.protegido ? l.protegido : 'Launcher de fabricante (dúvida)'))}</div></div>
          <div class="acoes">
            ${l.emUso ? '<span class="selo launcher">em uso</span>' : ''}
            ${!l.ativo ? '<span class="selo off">desativado</span>' : ''}
            ${l.ativo && !l.emUso && !l.protegido && projEmUso ? `<button class="btn sec peq" data-desat="${esc(l.pkg)}" data-conhecido="${l.conhecidoComAnuncio ? 1 : 0}">Desativar</button>` : ''}
            ${l.ativo && l.protegido && !l.emUso ? '<span class="selo essencial">protegido</span>' : ''}
            ${l.comp && !l.emUso && l.ativo ? `<button class="btn sec peq" data-usar="${esc(l.comp)}">Usar este</button>` : ''}
          </div>
        </li>`).join('')}</ul>` : '<p class="texto-2">Nenhum outro launcher encontrado.</p>'}
    </div>
    <div class="cartao">
      <div class="cartao-cab"><h2>Apps sugeridos</h2><span><label class="btn" for="apkGeral">Instalar APK do PC…</label><input type="file" id="apkGeral" accept=".apk" hidden></span></div>
      <ul class="lista-simples">
        <li><div><b>SmartTube</b><div class="texto-2" style="font-size:13px">YouTube sem anúncios, com SponsorBlock. Baixe o APK em smarttubeapp.github.io</div></div></li>
        <li><div><b>Kodi</b><div class="texto-2" style="font-size:13px">Mídia local e IPTV (PVR IPTV Simple Client)</div></div><button class="btn sec peq" data-store="org.xbmc.kodi">Abrir na Play Store da TV</button></li>
        <li><div><b>TV Bro</b><div class="texto-2" style="font-size:13px">Navegador leve para controle remoto</div></div><button class="btn sec peq" data-store="com.phlox.tvwebbrowser">Abrir na Play Store da TV</button></li>
        <li><div><b>X-plore File Manager</b><div class="texto-2" style="font-size:13px">Arquivos locais e de rede (SMB)</div></div><button class="btn sec peq" data-store="com.lonelycatgames.Xplore">Abrir na Play Store da TV</button></li>
      </ul>
    </div>`;

  c.querySelector('#btnAtLanc').addEventListener('click', () => abaLauncher(c, true));
  const recarregar = async () => { delete cache().info; await abaLauncher(c, true); };
  const ps = c.querySelector('#btnPlayStore');
  if (ps) ps.addEventListener('click', (ev) => comBotao(ev.currentTarget, () => executarComConfirmacao({ titulo: 'Abrir Play Store na TV', operacao: 'abrirPlayStore', params: { pkg: r.projectivy } })));
  const dp = c.querySelector('#btnDefinirProj');
  if (dp) dp.addEventListener('click', (ev) => comBotao(ev.currentTarget, () => executarComConfirmacao({ titulo: 'Definir launcher padrão', operacao: 'definirLauncher', params: { comp: proj.comp }, depois: recarregar })));
  c.querySelectorAll('[data-usar]').forEach((b) => b.addEventListener('click', () => comBotao(b, () => executarComConfirmacao({ titulo: 'Trocar launcher padrão', operacao: 'definirLauncher', params: { comp: b.dataset.usar }, depois: recarregar }))));
  c.querySelectorAll('[data-desat]').forEach((b) => b.addEventListener('click', () => comBotao(b, () => {
    const conhecido = b.dataset.conhecido === '1';
    return executarComConfirmacao({
      titulo: 'Desativar launcher antigo', operacao: 'desativar',
      params: { pacotes: [b.dataset.desat], permitirLaunchers: true },
      alertaHtml: conhecido
        ? '<div class="nota info">Launcher de fábrica conhecido por mostrar anúncios. Se a tela ficar preta, use a aba Histórico para desfazer.</div>'
        : '<div class="nota alerta"><b>Dúvida:</b> este launcher não está na lista conhecida. Pode ser usado pelo fabricante para menus próprios.</div>',
      exigeCheck: !conhecido, depois: recarregar,
    });
  })));
  c.querySelectorAll('[data-store]').forEach((b) => b.addEventListener('click', () => comBotao(b, () => executarComConfirmacao({ titulo: 'Abrir Play Store na TV', operacao: 'abrirPlayStore', params: { pkg: b.dataset.store } }))));
  ['apkLauncher', 'apkGeral'].forEach((id) => {
    const inp = document.getElementById(id);
    if (inp) inp.addEventListener('change', () => instalarApk(inp, id === 'apkLauncher' ? recarregar : null));
  });
}

async function instalarApk(input, depois) {
  const f = input.files[0];
  input.value = '';
  if (!f) return;
  const ok = await modal({
    titulo: 'Instalar APK',
    html: `<p>Instalar <code>${esc(f.name)}</code> (${(f.size / 1048576).toFixed(1)} MB) no aparelho?</p><div class="passo"><div class="cmd">$ adb install -r "${esc(f.name)}"</div></div><p class="texto-2">Instale só APKs de fontes oficiais.</p>`,
    acoes: [{ texto: 'Cancelar', valor: false, classe: 'sec' }, { texto: 'Instalar', valor: true }],
  });
  if (!ok) return;
  toast('Enviando e instalando… pode levar um minuto.');
  try {
    const r = await api(`/api/instalar?alvo=${encodeURIComponent(S.alvo)}&nome=${encodeURIComponent(f.name)}`, { metodo: 'POST', bruto: f });
    atividade(`Instalação de ${f.name}: ${r.ok ? 'ok' : 'falhou'}`, r.passos);
    toast(r.ok ? `${f.name} instalado.` : 'A instalação falhou. Veja a Atividade.', !r.ok);
    delete cache().apps; delete cache().info; delete cache().desempenho;
    if (r.ok && depois) await depois();
  } catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------------------------- aba: desempenho
async function abaDesempenho(c, forcar = false) {
  const r = await carregar('desempenho', 'desempenhoStatus', c, 'Lendo configurações de desempenho…', forcar);
  if (!r || S.aba !== 'desempenho') return;
  const anims = Object.values(r.anim);
  const meio = anims.every((v) => v === '0.5');
  c.innerHTML = `
    <div class="cartao">
      <div class="cartao-cab"><h2>Animações</h2>${meio ? '<span class="selo bloat">0.5x aplicado</span>' : ''}</div>
      <p class="texto-2">Escalas de animação em 0.5x deixam os menus mais ágeis. Hoje estão em: janela <b>${esc(r.anim.window_animation_scale)}</b>, transição <b>${esc(r.anim.transition_animation_scale)}</b> e duração <b>${esc(r.anim.animator_duration_scale)}</b> (null = padrão 1x).</p>
      <div class="acoes" style="margin-top:12px">
        <button class="btn" data-anim="0.5" ${meio ? 'disabled' : ''}>Aplicar 0.5x</button>
        <button class="btn sec" data-anim="1.0">Voltar para 1x</button>
      </div>
    </div>
    <div class="cartao">
      <div class="cartao-cab"><h2>Apps que rodam sozinhos</h2></div>
      ${!r.appopsSuportado ? `<div class="nota alerta">Android antigo (SDK ${r.sdk}): não dá para restringir segundo plano por ADB neste aparelho.</div>` : `
      <p class="texto-2">Impede que apps instalados por você fiquem rodando escondidos (eles continuam abrindo normalmente). Não restrinja apps de IPTV que gravam programas, nem o Kodi se você usa add-ons de servidor.</p>
      ${r.apps.length ? `<ul class="tabela-apps" style="margin-top:12px">${r.apps.map((a) => `
        <li class="${a.estado === 'ignore' ? 'travado' : ''}">
          <input type="checkbox" data-bg="${esc(a.pkg)}" ${a.estado === 'ignore' ? 'disabled' : ''} ${S.selBg.has(a.pkg) ? 'checked' : ''} aria-label="Selecionar ${esc(a.pkg)}">
          <div class="pkg">${esc(a.pkg)}</div>
          <div class="selos"><span class="selo ${a.estado === 'ignore' ? 'off' : 'usuario'}">${a.estado === 'ignore' ? 'restrito' : 'livre'}</span></div>
        </li>`).join('')}</ul>
        <div class="acoes" style="margin-top:12px"><button class="btn" id="btnBg" ${S.selBg.size ? '' : 'disabled'}>Restringir selecionados</button></div>` : '<p class="texto-2" style="margin-top:8px">Nenhum app instalado por você.</p>'}`}
    </div>
    <div class="grade" style="margin-top:16px">
      <div class="cartao"><h3>Limpar cache</h3><p class="texto-2" style="margin:6px 0 12px">Libera espaço sem apagar logins nem dados. Livre agora: <b>${esc(r.armazenamentoLivre || '?')}</b></p><button class="btn sec" id="btnCache">Limpar cache</button></div>
      <div class="cartao"><h3>Liberar RAM agora</h3><p class="texto-2" style="margin:6px 0 12px">Encerra apps parados em segundo plano. É temporário e não muda nada permanente.</p><button class="btn sec" id="btnKill">Encerrar apps em segundo plano</button></div>
      <div class="cartao"><h3>Limite de processos</h3><p class="texto-2" style="margin-top:6px">Não dá para definir de forma confiável por ADB, e a opção volta ao padrão a cada reinício. Se quiser usar, vá em Opções do desenvolvedor → “Limite de processos em segundo plano” → 2. Só vale a pena em aparelhos com 1 a 2 GB de RAM.</p></div>
    </div>`;

  const recarregar = () => abaDesempenho(c, true);
  c.querySelectorAll('[data-anim]').forEach((b) => b.addEventListener('click', () => comBotao(b, () => executarComConfirmacao({ titulo: `Animações em ${b.dataset.anim}x`, operacao: 'animacoes', params: { valor: b.dataset.anim }, depois: recarregar }))));
  c.querySelectorAll('input[data-bg]').forEach((cb) => cb.addEventListener('change', () => {
    cb.checked ? S.selBg.add(cb.dataset.bg) : S.selBg.delete(cb.dataset.bg);
    c.querySelector('#btnBg').disabled = !S.selBg.size;
  }));
  const bg = c.querySelector('#btnBg');
  if (bg) bg.addEventListener('click', () => comBotao(bg, () => executarComConfirmacao({ titulo: 'Restringir segundo plano', operacao: 'restringirSegundoPlano', params: { pacotes: [...S.selBg] }, depois: async () => { S.selBg.clear(); await recarregar(); } })));
  c.querySelector('#btnCache').addEventListener('click', (ev) => comBotao(ev.currentTarget, () => executarComConfirmacao({ titulo: 'Limpar cache', operacao: 'limparCache', depois: recarregar })));
  c.querySelector('#btnKill').addEventListener('click', (ev) => comBotao(ev.currentTarget, () => executarComConfirmacao({ titulo: 'Encerrar apps em segundo plano', operacao: 'encerrarSegundoPlano', depois: () => { delete cache().info; } })));
}

// ---------------------------------------------------------------------------- aba: HY300
async function abaHy300(c, forcar = false) {
  const r = await carregar('hy300', 'hy300', c, 'Diagnosticando o projetor…', forcar);
  if (!r || S.aba !== 'hy300') return;
  const d = r.dados;
  c.innerHTML = `
    <div class="cartao">
      <div class="cartao-cab"><h2>Resolução</h2><button class="btn sec peq" id="btnAtHy">Diagnosticar de novo</button></div>
      <ul class="lista-simples">
        <li><span>O Android desenha em</span><span class="mono">${esc(d.resolucao || '?')}</span></li>
        <li><span>Densidade</span><span class="mono">${esc(d.densidade || '?')}</span></li>
      </ul>
      <div class="nota info" style="margin-top:12px">O painel do HY300 é <b>1280×720 nativo</b>, mesmo que a caixa diga “4K”. ${d.acimaDoPainel ? `O sistema desenha em ${esc(d.resolucaoFisica)} e o projetor reduz para 720p. Isso é normal. ` : ''}Não altere “wm size”: aceitar sinal 4K não muda o painel.</div>
      ${d.modos.length || d.driver.length ? `<details style="margin-top:12px"><summary>Detalhes técnicos do vídeo</summary><pre class="mono" style="white-space:pre-wrap;font-size:12px">${esc([...d.modos, ...d.driver].join('\n'))}</pre></details>` : ''}
    </div>
    <div class="cartao">
      <h2>Keystone e foco</h2>
      ${d.keystone.length ? `<p class="texto-2" style="margin:8px 0">Apps de correção encontrados (todos <b>protegidos</b> pelo painel):</p><ul class="lista-simples">${d.keystone.map((k) => `<li><span class="mono">${esc(k)}</span></li>`).join('')}</ul>` : '<p class="texto-2" style="margin-top:8px">Nenhum app de keystone/foco com nome reconhecível. Os ajustes ficam no menu do projetor.</p>'}
      ${d.ajustes.length ? `<details style="margin-top:12px"><summary>Configurações relacionadas</summary><pre class="mono" style="white-space:pre-wrap;font-size:12px">${esc(d.ajustes.join('\n'))}</pre></details>` : ''}
      <p class="texto-2" style="margin-top:12px">No projetor, abra Configurações → Projeção / Keystone. Keystone digital forte reduz a nitidez, então alinhe o projetor fisicamente e use o mínimo de correção. Se houver foco automático, refaça depois de mudar a distância.</p>
    </div>
    <div class="cartao">
      <h2>Firmware e atualização</h2>
      <ul class="lista-simples" style="margin-top:8px">
        <li><span>Build</span><span class="mono">${esc(d.firmware.build)}</span></li>
        <li><span>Data do build</span><span class="mono">${esc(d.firmware.data)}</span></li>
        <li><span>Patch de segurança</span><span class="mono">${esc(d.firmware.patch)}</span></li>
        <li><span>Apps de atualização</span><span class="mono">${esc(d.atualizacao.join(', ') || 'nenhum')}</span></li>
      </ul>
      <div class="acoes" style="margin-top:12px">
        ${d.atualizacaoOficial ? `<button class="btn" id="btnOta">Abrir “${esc(d.atualizacaoOficial)}” no projetor</button>` : ''}
      </div>
      <p class="texto-2" style="margin-top:12px;font-size:13px">Atualize só pelo app oficial do aparelho ou pela fonte do vendedor. Este painel nunca instala firmware.</p>
    </div>`;
  c.querySelector('#btnAtHy').addEventListener('click', () => abaHy300(c, true));
  const ota = c.querySelector('#btnOta');
  if (ota) ota.addEventListener('click', () => comBotao(ota, () => executarComConfirmacao({ titulo: 'Abrir app de atualização', operacao: 'abrirApp', params: { pkg: d.atualizacaoOficial } })));
}

// ---------------------------------------------------------------------------- aba: histórico
const ROTULO_TIPO = { DISABLE: 'Desativado', UNINSTALL: 'Removido (usuário 0)', SETTING: 'Configuração', APPOPS: 'Segundo plano', HOME: 'Launcher padrão' };
function descreverEntrada(e) {
  switch (e.tipo) {
    case 'DISABLE': case 'UNINSTALL': return e.a;
    case 'SETTING': return `${e.b}: ${e.c} → ${e.d}`;
    case 'APPOPS': return `${e.a} (${e.b}: ${e.c} → ${e.d})`;
    case 'HOME': return `${e.a.split('/')[0]} (antes: ${(e.b || '?').split('/')[0]})`;
    default: return e.linha;
  }
}

async function abaHistorico(c) {
  carregando(c, 'Lendo histórico…');
  let h, rs;
  try {
    [h, rs] = await Promise.all([op('historico'), cache().resumo ? Promise.resolve(cache().resumo) : op('resumo')]);
  } catch (e) { c.innerHTML = `<div class="nota perigo">${esc(e.message)}</div>`; return; }
  cache().historico = h; cache().resumo = rs;
  if (S.aba !== 'historico' || !c.isConnected) return;
  const d = rs.dados;
  const dif = d.ramAntesMB != null ? d.ramAgoraMB - d.ramAntesMB : null;
  c.innerHTML = `
    <div class="grade">
      <div class="cartao"><div class="rotulo">RAM disponível antes</div><div class="valor">${d.ramAntesMB != null ? d.ramAntesMB + ' MB' : '?'}</div></div>
      <div class="cartao"><div class="rotulo">RAM disponível agora</div><div class="valor">${d.ramAgoraMB} MB</div><div class="det">${dif != null ? (dif >= 0 ? '+' : '') + dif + ' MB' : ''} · de ${d.ramTotalMB} MB</div></div>
      <div class="cartao"><div class="rotulo">Alterações ativas</div><div class="valor">${h.entradas.length}</div><div class="det">${d.desativados.length} desativados · ${d.removidos.length} removidos</div></div>
    </div>
    <p class="texto-2" style="font-size:13px;margin-top:8px">Para comparar de forma justa, reinicie o aparelho e espere 2 minutos antes de olhar a RAM.</p>

    <div class="cartao" style="margin-top:16px">
      <div class="cartao-cab"><h2>Alterações feitas</h2>
        <div class="acoes">
          <button class="btn sec" id="btnScripts" ${h.entradas.length ? '' : 'disabled'}>Gerar scripts reaplicar/desfazer</button>
          <button class="btn perigo" id="btnDesfazerTudo" ${h.entradas.length ? '' : 'disabled'}>Desfazer tudo</button>
        </div>
      </div>
      ${h.entradas.length ? `<ul class="lista-simples">${h.entradas.slice().reverse().map((e) => `
        <li><div><div class="texto-2" style="font-size:12px">${ROTULO_TIPO[e.tipo] || e.tipo}</div><div class="mono">${esc(descreverEntrada(e))}</div></div>
        <button class="btn sec peq" data-desfazer="${e.i}">Desfazer</button></li>`).join('')}</ul>` : '<p class="texto-2">Nenhuma alteração ativa. Tudo está como no original.</p>'}
    </div>

    <div class="cartao">
      <div class="cartao-cab"><h2>Arquivos (backups, relatórios, scripts)</h2></div>
      ${h.arquivos.length ? `<ul class="lista-simples">${h.arquivos.map((f) => `<li><span class="mono">${esc(f)}</span><button class="btn sec peq" data-baixar="${esc(f)}">Baixar</button></li>`).join('')}</ul>` : '<p class="texto-2">Nenhum arquivo ainda.</p>'}
      <p class="texto-2" style="font-size:13px;margin-top:12px">Todos ficam também na pasta <code>saida/</code> do projeto, no seu PC.</p>
    </div>

    <div class="cartao">
      <h2>Próximos passos</h2>
      <ol style="margin:8px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:4px">
        <li>Reinicie o aparelho e use por alguns dias.</li>
        <li>Se algo parar de funcionar, desfaça o item aqui (ou use o <code>desfazer_*.bat</code> gerado).</li>
        <li>Depois de uma atualização de firmware, rode o <code>reaplicar_*.bat</code>, porque atualizações podem reativar apps.</li>
        <li>Desative “Fontes desconhecidas” depois de instalar os APKs.</li>
      </ol>
    </div>`;

  const recarregar = async () => { delete cache().resumo; delete cache().apps; delete cache().launcher; delete cache().desempenho; delete cache().info; await abaHistorico(c); };
  c.querySelector('#btnDesfazerTudo').addEventListener('click', (ev) => comBotao(ev.currentTarget, () => executarComConfirmacao({ titulo: 'Desfazer tudo', operacao: 'desfazer', depois: recarregar })));
  c.querySelectorAll('[data-desfazer]').forEach((b) => b.addEventListener('click', () => comBotao(b, () => executarComConfirmacao({ titulo: 'Desfazer alteração', operacao: 'desfazer', params: { indices: [Number(b.dataset.desfazer)] }, depois: recarregar }))));
  c.querySelector('#btnScripts').addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
    const r = await op('gerarScripts');
    atividade('Scripts gerados: ' + r.arquivos.join(', '));
    toast('Scripts gerados. Baixe-os na lista de arquivos.');
    await abaHistorico(c);
  }));
  c.querySelectorAll('[data-baixar]').forEach((b) => b.addEventListener('click', () => comBotao(b, async () => {
    const resp = await api(`/api/arquivo?alvo=${encodeURIComponent(S.alvo)}&nome=${encodeURIComponent(b.dataset.baixar)}`);
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = b.dataset.baixar;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  })));
}

// ---------------------------------------------------------------------------- início
$('#btnAtividade').addEventListener('click', () => {
  const sec = $('#atividade');
  const aberta = sec.classList.toggle('aberta');
  $('#btnAtividade').setAttribute('aria-expanded', String(aberta));
});

atualizarEstado().then(() => {
  if (S.aparelhos.length === 1) selecionar(S.aparelhos[0].alvo);
});
setInterval(() => { if (!document.hidden) atualizarEstado(); }, 15000);
