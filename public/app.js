import { planilhaAnuncios } from './exportar.js';

const $ = (sel) => document.querySelector(sel);
const api = (path) => fetch(path).then((r) => r.json());

const brl = (v) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const num = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));

const ago = (iso) => {
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
};

const LABELS = {
  NEW: 'novo', PRICE_DROP: 'baixou', PRICE_UP: 'subiu',
  DISAPPEARED: 'saiu do ar', RELISTED: 'reanunciado', KM_CHANGED: 'km mudou',
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Renderiza o % em relacao a FIPE, que e a coluna que importa. */
function fipeCell(ratio) {
  if (ratio == null) return '<td class="num">—</td>';
  const pct = (Number(ratio) - 1) * 100;
  const cls = pct < 0 ? 'below' : 'above';
  return `<td class="num ${cls}">${pct > 0 ? '+' : ''}${pct.toFixed(1)}%</td>`;
}

// Nome de exibicao das fontes. O banco guarda o slug ('webmotors'); quem le o
// painel merece o nome escrito certo, com acento e caixa.
const FONTE_NOME = { webmotors: 'Webmotors', olx: 'OLX', mercadolivre: 'Mercado Livre' };

const fonteNome = (slug) => FONTE_NOME[slug] ?? slug;

// Cor semantica so no numero: o label continua secundario nos quatro cards.
const CARDS = [
  { label: 'Anúncios ativos', campo: 'ativos', tom: 'neutro' },
  { label: 'Novos em 24h', campo: 'novos', tom: 'novo' },
  { label: 'Baixas de preço (7d)', campo: 'baixas_7d', tom: 'baixa' },
  { label: 'Saíram do ar (7d)', campo: 'sumiram_7d', tom: 'saida' },
];

async function loadSummary() {
  const s = await api('/api/summary');

  $('#summary').innerHTML = CARDS.map((c) =>
    `<div class="card">
       <div class="value v-${c.tom}">${num(s[c.campo] ?? 0)}</div>
       <div class="label">${c.label}</div>
     </div>`).join('');

}

async function loadEvents() {
  const type = $('#event-filter').value;
  const events = await api(`/api/events?limit=60${type ? `&type=${type}` : ''}`);

  if (!events.length) {
    $('#events').innerHTML = '<div class="empty">Nenhum evento ainda. Rode uma coleta.</div>';
    return;
  }

  $('#events').innerHTML = events.map((e) => {
    const p = typeof e.payload === 'string' ? JSON.parse(e.payload || '{}') : (e.payload ?? {});
    const price = (e.type === 'PRICE_DROP' || e.type === 'PRICE_UP')
      ? `${brl(p.from)} → <strong>${brl(p.to)}</strong> (${p.pct > 0 ? '+' : ''}${p.pct}%)`
      : brl(e.price);
    const meta = [
      price, e.year_model, e.km ? `${num(e.km)} km` : null,
      [e.city, e.uf].filter(Boolean).join('/'), e.source, ago(e.created_at),
    ].filter(Boolean).join(' · ');

    // Duas colunas de grid: badge e conteudo. Titulo e metadados ficam na MESMA
    // coluna, entao comecam sempre no mesmo x — antes o badge variava de largura
    // conforme o texto ("novo" x "reanunciado") e desalinhava a lista inteira.
    return `<div class="event">
      <span class="tag ${e.type}">${LABELS[e.type] ?? e.type}</span>
      <div class="event-body">
        <a href="${esc(e.url)}" target="_blank" rel="noopener" title="${esc(e.title)}">${esc(e.title)}</a>
        <div class="meta">${meta}</div>
      </div>
    </div>`;
  }).join('');
}

// Recortes ativos ('' = todos). Sao dois chips independentes que COMPOEM:
// "manual" + "50-70 mil" mostra os manuais daquela faixa, e a contagem de cada
// chip ja considera o outro filtro.
let bandAtual = '';
let cambioAtual = '';

// Os recortes que moram no CABECALHO da tabela, e nao numa linha de chips:
// estado (LOCAL) e portal (FONTE). Foi como o usuario pediu — e faz sentido,
// porque 27 siglas de estado nao cabem numa linha de chips como cabem 4 faixas
// de km. '' = sem recorte.
const recorte = { uf: '', source: '' };

const BAND_CLASS = { 'ate-50k': 'b1', '50k-70k': 'b2', '70k-100k': 'b3', 'acima-100k': 'b4' };
const BAND_LABEL = {
  'ate-50k': 'ate 50 mil', '50k-70k': '50-70 mil',
  '70k-100k': '70-100 mil', 'acima-100k': '+100 mil',
};

// Nome por extenso ao lado da sigla: o menu e uma lista de escolha, e "ES" e
// "SE" so se distinguem lendo com atencao. A sigla continua sendo o valor.
const UF_NOME = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia',
  RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe',
  TO: 'Tocantins',
  'sem-uf': 'sem estado identificado',
};

const CAMBIO_LABEL = {
  manual: 'manual', automatico: 'automatico', cvt: 'CVT',
  automatizado: 'automatizado', outro: 'outro',
};

/** Monta a querystring com os filtros ativos. `extra` sobrescreve; null remove —
 *  e assim que a contagem de um chip ignora ele mesmo e respeita os outros. */
function filtrosQS(extra = {}) {
  const qs = new URLSearchParams();
  if (recorte.source) qs.set('source', recorte.source);
  if (bandAtual) qs.set('band', bandAtual);
  if (cambioAtual) qs.set('cambio', cambioAtual);
  if (recorte.uf) qs.set('uf', recorte.uf);
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) qs.delete(k); else qs.set(k, v);
  }
  return qs;
}

/** Desenha uma linha de chips com contagem. `atual` e o id selecionado. */
function renderChips(el, itens, atual, escolher) {
  const total = itens.reduce((acc, i) => acc + i.count, 0);
  el.innerHTML = [
    `<button class="band ${atual === '' ? 'on' : ''}" data-id="">todos <span class="n">${total}</span></button>`,
    ...itens.map((i) =>
      `<button class="band ${atual === i.id ? 'on' : ''}" data-id="${i.id}">${esc(i.label)} <span class="n">${i.count}</span></button>`),
  ].join('');

  for (const b of el.querySelectorAll('.band')) {
    b.addEventListener('click', () => escolher(b.dataset.id));
  }
}

async function loadBands() {
  // Sem `band`: o chip escolhido mostraria o total e os outros zerariam.
  const bands = await api(`/api/km-bands?${filtrosQS({ band: null })}`);
  renderChips($('#bands'), bands, bandAtual, (id) => {
    bandAtual = id;
    recarregarFiltros();
  });
}

async function loadCambios() {
  const cambios = await api(`/api/cambios?${filtrosQS({ cambio: null })}`);
  // Grupos vazios so poluem a linha; o painel mostra o que a coleta realmente
  // trouxe. ('outro' o servidor ja omite quando nao existe.)
  renderChips($('#cambios'), cambios.filter((c) => c.count > 0), cambioAtual, (id) => {
    cambioAtual = id;
    recarregarFiltros();
  });
}

/* ---------------------------------------------------------------------------
   FILTROS NO CABECALHO DA TABELA — LOCAL (estado) e FONTE (portal)

   Uma fabrica, duas instancias. Os dois menus tem exatamente o mesmo
   comportamento; a diferenca cabe em cinco linhas de configuracao, e duplicar
   o codigo garantiria que um dia so um deles ganhasse a proxima correcao.

   Tres cuidados que nao sao obvios:
   1. O menu vive no <body>, nao no <th>: .table-wrap tem overflow-x:auto e
      recortaria o menu. Por isso a posicao e calculada aqui (position: fixed).
   2. Position fixed nao acompanha rolagem — entao qualquer rolagem ou resize
      FECHA o menu, em vez de deixa-lo flutuando longe do cabecalho.
   3. A lista sai do servidor (/api/ufs, /api/fontes) e so traz o que existe na
      coleta. Nenhuma opcao do menu leva a uma tabela vazia.
--------------------------------------------------------------------------- */

const menusCabecalho = [];

function criarMenuCabecalho(cfg) {
  let itens = [];

  const btn = $(cfg.botao);
  const menu = $(cfg.menu);
  const aberto = () => !menu.hidden;

  /** O recorte ativo aparece no proprio cabecalho; sem isso o filtro fica
   *  invisivel para quem nao abriu o menu, e a tabela mostra 8 de 63 linhas
   *  sem explicar por que. */
  function pintarCabecalho() {
    const total = itens.reduce((acc, i) => acc + i.count, 0);
    const atual = cfg.get();
    // Com filtro ativo, o cabecalho vira o proprio valor. O prefixo ("Local: ")
    // so fica onde sobra espaco: "Fonte: Mercado Livre" nao cabe na coluna e
    // era o que estourava a largura da tabela.
    $(cfg.rotulo).textContent = !atual
      ? cfg.base
      : (cfg.prefixo === false ? cfg.curto(atual) : `${cfg.base}: ${cfg.curto(atual)}`);
    btn.classList.toggle('on', atual !== '');
    btn.title = atual
      ? `filtrando por ${cfg.nome(atual)} — clique para trocar`
      : cfg.dica(itens.length, total);
  }

  function fechar({ devolverFoco = false } = {}) {
    if (!aberto()) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (devolverFoco) btn.focus();
  }

  function escolher(id) {
    cfg.set(id);
    fechar({ devolverFoco: true });
    recarregarFiltros();
  }

  function abrir() {
    for (const outro of menusCabecalho) if (outro !== controle) outro.fechar();

    const total = itens.reduce((acc, i) => acc + i.count, 0);
    const atual = cfg.get();
    const linha = (id, nome, count) => {
      const sigla = cfg.sigla ? `<span class="mi-uf">${esc(cfg.sigla(id))}</span>` : '';
      return `<button type="button" class="menu-item ${atual === id ? 'on' : ''}" data-id="${esc(id)}" role="option">
                ${sigla}<span class="mi-nome">${esc(nome)}</span><span class="n">${count}</span>
              </button>`;
    };

    menu.innerHTML = [
      linha('', cfg.todos, total),
      ...itens.map((i) => linha(i.id, cfg.nome(i.id), i.count)),
    ].join('');

    for (const item of menu.querySelectorAll('.menu-item')) {
      item.addEventListener('click', () => escolher(item.dataset.id));
    }

    // Posicionado so DEPOIS de ter conteudo: a altura real e o que decide se o
    // menu abre para baixo ou para cima.
    menu.hidden = false;
    const r = btn.getBoundingClientRect();
    const cabeAbaixo = r.bottom + menu.offsetHeight + 8 <= window.innerHeight;
    const topo = cabeAbaixo ? r.bottom + 4 : Math.max(8, r.top - menu.offsetHeight - 4);
    const esquerda = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
    menu.style.top = `${topo}px`;
    menu.style.left = `${Math.max(8, esquerda)}px`;

    btn.setAttribute('aria-expanded', 'true');
    menu.querySelector('.menu-item.on')?.focus();
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (aberto()) fechar();
    else abrir();
  });

  document.addEventListener('click', (e) => {
    if (aberto() && !menu.contains(e.target)) fechar();
  });

  const controle = {
    fechar,
    async carregar() {
      // Sem o proprio filtro: senao a opcao escolhida mostraria o total e as
      // outras zerariam.
      itens = await api(`${cfg.endpoint}?${filtrosQS({ [cfg.chave]: null })}`);
      pintarCabecalho();
      // Se o menu estava aberto quando os numeros mudaram, redesenha com as
      // contagens novas em vez de deixar valores velhos na tela.
      if (aberto()) abrir();
    },
  };
  menusCabecalho.push(controle);
  return controle;
}

// Esc, rolagem e resize fecham QUALQUER menu — registrados uma vez so, e nao
// um par de ouvintes por menu.
const fecharMenus = (opts) => { for (const m of menusCabecalho) m.fechar(opts); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') fecharMenus({ devolverFoco: true });
});
window.addEventListener('resize', () => fecharMenus());
window.addEventListener('scroll', () => fecharMenus(), true);

const menuUf = criarMenuCabecalho({
  chave: 'uf',
  botao: '#uf-toggle', rotulo: '#uf-label', menu: '#uf-menu',
  base: 'Local', endpoint: '/api/ufs', todos: 'todos os estados',
  get: () => recorte.uf,
  set: (v) => { recorte.uf = v; },
  sigla: (id) => (id === 'sem-uf' ? '—' : id),
  nome: (id) => UF_NOME[id] ?? id,
  // "Local: RJ" cabe de sobra nos 196px da coluna.
  curto: (id) => (id === 'sem-uf' ? '—' : id),
  prefixo: true,
  dica: (n, total) => `filtrar por estado (${n} na coleta, ${total} anúncios)`,
});

const menuFonte = criarMenuCabecalho({
  chave: 'source',
  botao: '#fonte-toggle', rotulo: '#fonte-label', menu: '#fonte-menu',
  base: 'Fonte', endpoint: '/api/fontes', todos: 'todos os portais',
  get: () => recorte.source,
  set: (v) => { recorte.source = v; },
  // Sem coluna de sigla: "Webmotors" ja e o nome curto. O menu leva a classe
  // .sem-sigla no HTML, que troca a grade de tres colunas para duas.
  sigla: null,
  nome: (id) => fonteNome(id),
  curto: (id) => fonteNome(id),
  // Sem "Fonte: " na frente — o nome do portal ja diz o que e, e o prefixo era
  // o que nao cabia na coluna. A cor indigo e a seta continuam sinalizando que
  // ha filtro ativo, e o title do botao explica por extenso.
  prefixo: false,
  dica: (n, total) => `filtrar por portal (${n} com anúncios, ${total} no total)`,
});

/** Um filtro mexe na contagem do outro, entao os quatro recarregam juntos. */
function recarregarFiltros() {
  return Promise.all([loadBands(), loadCambios(), menuUf.carregar(), menuFonte.carregar(), loadListings()]);
}

/* ---------------------------------------------------------------------------
   ORDENACAO — clique no cabecalho da coluna

   Regra pedida pelo usuario: 1 clique ordena crescente, outro clique inverte.
   Vale para ANO, KM, PRECO e FIPE.

   O estado e UM SO (`ordem`), compartilhado com o select do topo do painel:
   o select escolhe o CRITERIO, o cabecalho escolhe criterio + DIRECAO. Dois
   controles com estados separados foi exatamente o problema que fez o antigo
   select de fontes sair quando o menu FONTE entrou — aqui o select fica porque
   "mais recentes" nao tem coluna para clicar.
--------------------------------------------------------------------------- */

const ordem = { campo: 'fipe', dir: 'asc' };

/** O que a API recebe: `preco`, `preco_desc`, `novos`... */
const ordemParaApi = () =>
  ordem.dir === 'desc' && ordem.campo !== 'novos' ? `${ordem.campo}_desc` : ordem.campo;

/** Seta acesa so na coluna que manda; as outras ficam apagadas. */
function pintarOrdem() {
  $('#sort').value = ordem.campo;
  for (const b of document.querySelectorAll('.ordena')) {
    const ativa = b.dataset.campo === ordem.campo;
    b.classList.toggle('asc', ativa && ordem.dir === 'asc');
    b.classList.toggle('desc', ativa && ordem.dir === 'desc');
    b.title = ativa
      ? `${ordem.dir === 'asc' ? 'crescente' : 'decrescente'} — clique para inverter`
      : `ordenar por ${b.dataset.campo}`;
  }
}

function ordenarPor(campo) {
  // Mesma coluna inverte; coluna nova comeca crescente, que e o que se espera
  // de um primeiro clique ("do menor para o maior").
  if (ordem.campo === campo) ordem.dir = ordem.dir === 'asc' ? 'desc' : 'asc';
  else { ordem.campo = campo; ordem.dir = 'asc'; }
  pintarOrdem();
  loadListings();
}

// Delegado: um handler para os quatro cabecalhos.
for (const b of document.querySelectorAll('.ordena')) {
  b.addEventListener('click', () => ordenarPor(b.dataset.campo));
}

// As linhas que estao NA TELA agora. A exportacao le daqui, e nao de uma nova
// chamada a API: assim o arquivo e exatamente o que o usuario esta vendo —
// mesmos filtros, mesma ordem, mesmo limite — e nunca uma versao que mudou
// entre o olhar e o clique.
let linhasVisiveis = [];

async function loadListings() {
  const rows = await api(`/api/listings?${filtrosQS({ sort: ordemParaApi(), limit: '200' })}`);
  const tbody = $('#listings tbody');

  linhasVisiveis = rows;
  $('#export').disabled = !rows.length;
  $('#export').title = rows.length
    ? `exportar os ${rows.length} anúncios desta visualização (planilha do Excel, com links)`
    : 'nada para exportar com esses filtros';

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">Nenhum anuncio com esses filtros.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((l) => `
    <tr>
      <td><a href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.title)}">${esc(l.title)}</a></td>
      <td class="num">${l.year_model ?? '—'}</td>
      <td class="num">${num(l.km)}</td>
      <td class="badge">${l.km_band ? `<span class="kmband ${BAND_CLASS[l.km_band]}">${BAND_LABEL[l.km_band]}</span>` : '—'}</td>
      <td class="badge">${l.cambio ? `<span class="gear g-${l.cambio}" title="${esc(l.transmission)}">${CAMBIO_LABEL[l.cambio] ?? esc(l.cambio)}</span>` : '—'}</td>
      <td class="num">${brl(l.price)}</td>
      ${fipeCell(l.fipe_ratio)}
      <td>${esc([l.city, l.uf].filter(Boolean).join('/')) || '—'}</td>
      <td class="src">${esc(l.source)}</td>
    </tr>`).join('');
}

/* ---------------------------------------------------------------------------
   EXPORTAR — planilha .xlsx da visualizacao atual, com links clicaveis

   Comecou como CSV (ESTADO.md 2-P) e virou .xlsx (2-Q): CSV e so texto, nao
   guarda largura de coluna nem link clicavel. As colunas estao em exportar.js
   e o arquivo em xlsx.js — nenhum dos dois toca no DOM. Aqui fica so o que e
   da TELA: as linhas visiveis, os filtros e a ordem.
--------------------------------------------------------------------------- */

const ORDEM_NOME = { fipe: '% da FIPE', preco: 'preço', km: 'km', ano: 'ano', novos: 'mais recentes' };

/** Linha 1 da planilha: quem abrir o arquivo dias depois sabe que recorte e. */
function descricaoVisualizacao() {
  const filtros = [
    recorte.source && `fonte ${fonteNome(recorte.source)}`,
    recorte.uf && `estado ${UF_NOME[recorte.uf] ?? recorte.uf}`,
    bandAtual && `km ${BAND_LABEL[bandAtual]}`,
    cambioAtual && `câmbio ${CAMBIO_LABEL[cambioAtual] ?? cambioAtual}`,
  ].filter(Boolean);
  const direcao = ordem.campo === 'novos' ? '' : ` (${ordem.dir === 'asc' ? 'crescente' : 'decrescente'})`;
  const n = linhasVisiveis.length;
  const d = new Date();
  return [
    `Anúncios ativos: ${n} anúncio${n === 1 ? '' : 's'}`,
    filtros.length ? filtros.join(', ') : 'sem filtros',
    `ordem: ${ORDEM_NOME[ordem.campo]}${direcao}`,
    `exportado em ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
  ].join('  ·  ');
}

/** O nome do arquivo tambem diz qual visualizacao ele e: data, filtros e ordem. */
function nomeExport() {
  const d = new Date();
  const data = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const partes = [
    'anuncios', data, recorte.source, recorte.uf, bandAtual, cambioAtual,
    `ordem-${ordem.campo}${ordem.dir === 'desc' && ordem.campo !== 'novos' ? '-desc' : ''}`,
  ];
  return `${partes.filter(Boolean).join('_')}.xlsx`;
}

function exportarPlanilha() {
  if (!linhasVisiveis.length) return;
  const bytes = planilhaAnuncios(linhasVisiveis, { info: descricaoVisualizacao(), fonte: fonteNome });
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nomeExport() });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

$('#export').addEventListener('click', exportarPlanilha);

async function refresh() {
  await Promise.all([
    loadSummary(), loadEvents(), loadBands(), loadCambios(),
    menuUf.carregar(), menuFonte.carregar(), loadListings(),
  ]);
}

// A coleta leva ~6 min (rate limit de 60-80s por pagina). A rota responde na
// hora com 202 e quem acompanha e este polling — antes o fetch esperava a
// coleta inteira, estourava o timeout e o botao mentia que tinha terminado.
const botoes = () => [...document.querySelectorAll('#collect-group .collect')];

const partesBotao = (btn) => ({ btn, bar: btn.querySelector('.bar'), label: btn.querySelector('.rotulo') });

/** O botao de uma fonte; '' (ou null) e o "Coletar tudo". */
const botaoDaFonte = (source) =>
  botoes().find((b) => b.dataset.source === (source ?? '')) ?? botoes()[0];

/** O servidor so roda UMA coleta por vez, entao todos os botoes travam juntos —
 *  senao o segundo clique recebe um "ja existe uma coleta em andamento" que o
 *  painel teria de explicar. Melhor nem deixar clicar. */
function travarBotoes() {
  for (const b of botoes()) b.disabled = true;
}

function destravarBotoes() {
  for (const b of botoes()) b.disabled = false;
}

/** Zera classes de estado e devolve o botao ao repouso. */
function resetBotao(btn) {
  const { bar, label } = partesBotao(btn);
  btn.classList.remove('collecting', 'indeterminate', 'done', 'failed', 'needs-human');
  bar.style.width = '0%';
  label.textContent = btn.dataset.rotulo;
  btn.title = '';
  destravarBotoes();
}

/**
 * Desenha a barra. A porcentagem vem das PAGINAS, nao do tempo: o tempo por
 * pagina varia demais (rate limit com jitter, CAPTCHA, recarga) e uma barra
 * baseada em relogio andaria errado.
 *
 * Enquanto `totalPages` nao e conhecido — a 1a pagina inclui abrir o navegador
 * e um eventual CAPTCHA — fica indeterminada em vez de inventar um numero.
 */
function pintarProgresso(btn, p) {
  const { bar, label } = partesBotao(btn);
  btn.classList.add('collecting');
  travarBotoes();

  // Prioridade maxima: a coleta parou e depende de uma pessoa. Fingir progresso
  // aqui foi o que fez uma coleta expirar sem ninguem perceber (2026-09-08).
  if (p.needsHuman) {
    btn.classList.remove('indeterminate', 'done');
    btn.classList.add('needs-human');
    bar.style.width = '100%';
    label.textContent = '⚠ Resolva o CAPTCHA na janela';
    btn.title = p.needsHumanText ?? '';
    return;
  }
  btn.classList.remove('needs-human');

  if (p.totalPages && p.page) {
    btn.classList.remove('indeterminate');
    // Teto de 95%: os ultimos passos (gravar, FIPE, notificar) vem depois da
    // ultima pagina. Cravar 100% antes da hora e a mentira classica de barra.
    const pct = Math.min(95, Math.round((p.page / p.totalPages) * 100));
    bar.style.width = `${pct}%`;
    label.textContent = `Coletando ${p.page}/${p.totalPages}`;
  } else {
    btn.classList.add('indeterminate');
    label.textContent = 'Coletando...';
  }

  const detalhe = p.collected != null && p.total != null ? ` — ${p.collected} de ${p.total}` : '';
  btn.title = (p.step ?? '') + detalhe;
}

async function acompanharColeta(btn) {
  const { bar, label } = partesBotao(btn);
  btn.classList.add('collecting', 'indeterminate');
  travarBotoes();

  while (true) {
    await new Promise((r) => setTimeout(r, 2000));

    let s;
    try {
      s = await api('/api/summary');
    } catch {
      continue; // servidor ocupado (a coleta e pesada): tenta no proximo ciclo
    }

    if (s.progress?.running) {
      pintarProgresso(btn, s.progress);
      continue;
    }

    // Terminou. Fecha a barra em 100% e mostra o resultado por alguns segundos.
    await refresh();
    btn.classList.remove('indeterminate');
    bar.style.width = '100%';

    const st = s.progress?.stats;
    if (s.progress?.error) {
      btn.classList.add('failed');
      label.textContent = 'Falhou — ver logs';
      btn.title = s.progress.error;
    } else if (st) {
      btn.classList.add('done');
      label.textContent = `+${st.new} novos, ${st.drops} baixas`;
      btn.title = JSON.stringify(st);
    } else {
      btn.classList.add('done');
      label.textContent = 'Coleta concluida';
    }

    setTimeout(() => resetBotao(btn), 6000);
    destravarBotoes();
    return;
  }
}

// Delegado no grupo: os botoes por fonte sao injetados depois, quando
// /api/sources responde, e um handler por botao daria condicao de corrida.
$('#collect-group').addEventListener('click', async (e) => {
  const btn = e.target.closest('.collect');
  if (!btn || btn.disabled) return;

  const { label } = partesBotao(btn);
  btn.classList.add('collecting', 'indeterminate');
  travarBotoes();
  label.textContent = 'Iniciando...';
  try {
    await fetch('/api/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // '' = todas as fontes. O servidor ja aceitava `source` desde o comeco;
      // era o painel que so sabia pedir tudo.
      body: JSON.stringify({ source: btn.dataset.source || null }),
    }).then((x) => x.json());
    // Vale acompanhar mesmo se `started` vier false: nesse caso ja existe uma
    // coleta em andamento, e o usuario quer ver o progresso dela do mesmo jeito.
    await acompanharColeta(btn);
  } catch (err) {
    btn.classList.remove('indeterminate');
    btn.classList.add('failed');
    label.textContent = 'Erro ao iniciar';
    btn.title = String(err);
    destravarBotoes();
    setTimeout(() => resetBotao(btn), 6000);
  }
});

// Se a pagina abrir no meio de uma coleta (a diaria das 9h, por exemplo),
// o botao ja entra no modo de acompanhamento em vez de mentir que esta livre.
api('/api/summary')
  .then((s) => {
    // `progress.source` diz QUAL portal esta rodando (null = todos), entao o
    // botao certo entra em modo de acompanhamento em vez de sempre o primeiro.
    if (s.progress?.running) acompanharColeta(botaoDaFonte(s.progress.source));
  })
  .catch(() => {});

$('#event-filter').addEventListener('change', loadEvents);
// Trocar o criterio pelo select recomeca em crescente — menos "mais
// recentes", que so faz sentido do mais novo para o mais antigo.
$('#sort').addEventListener('change', () => {
  ordem.campo = $('#sort').value;
  ordem.dir = 'asc';
  pintarOrdem();
  loadListings();
});
pintarOrdem();
// A ordem e a do interesse pratico, nao a que o servidor devolve: primeiro o
// portal que funciona. Fonte nova que o servidor tiver e nao estiver aqui
// entra no fim, em vez de sumir.
const ORDEM_FONTES = ['webmotors', 'olx', 'mercadolivre'];

api('/api/sources').then((sources) => {
  // Um botao por portal — pedido do usuario: testar uma fonte sem rodar as
  // tres. A lista vem do servidor de proposito; repetir os nomes das fontes no
  // HTML e garantir que um dia eles fiquem diferentes.
  const ordenadas = [...sources].sort((a, b) => {
    const ia = ORDEM_FONTES.indexOf(a);
    const ib = ORDEM_FONTES.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  $('#collect-group').insertAdjacentHTML(
    'beforeend',
    ordenadas.map((s) => {
      const rotulo = esc(fonteNome(s));
      return `<button class="collect fonte" data-source="${esc(s)}" data-rotulo="${rotulo}" title="coletar so ${rotulo}">
                <i class="bar"></i><i class="spin" aria-hidden="true"></i><span class="rotulo">${rotulo}</span>
              </button>`;
    }).join(''),
  );
});

refresh();
setInterval(refresh, 60000);
