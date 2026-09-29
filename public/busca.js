// A BARRA DE BUSCA — a porta de entrada do sistema (ESTADO.md 2-X).
//
// Substituiu o public/buscas.js (a modal de "buscas salvas") em 2026-09-16.
// A diferenca e o produto inteiro: nao ha mais busca salva, nem busca de outra
// pessoa na tela de ninguem. Quem entra escolhe marca e modelo em dois selects
// do catalogo, diz km, ano, preco e portais, e clica BUSCAR.
//
// ONDE A BUSCA MORA: na URL. `?modelo=901&km=100000&anoMin=2015&portais=olx`
// e um link que se manda para alguem, e e o que o botao "voltar" do navegador
// desfaz. O localStorage guarda so a ultima busca, por conveniencia de quem
// volta amanha — se nao existir (janela anonima), a tela funciona igual.
//
// O QUE ESTA TELA NAO FAZ: esperar. O Webmotors leva 3-5 minutos (5 paginas a
// 30-40 s). BUSCAR responde com o cache na hora e, se ele estiver velho,
// enfileira a coleta e avisa que esta atualizando.
import { $, api, esc, fonteNome, ordenarFontes, preferencia } from './comum.js';

const estado = {
  marcas: [],
  modelos: new Map(), // marcaId -> modelos
  portais: [],
  carro: null,
};

let aoBuscar = () => {};

/** O recorte que esta nos campos agora. Campo vazio = sem limite. */
function lerCampos() {
  const n = (sel) => {
    const v = Number.parseInt($(sel)?.value ?? '', 10);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const portais = [...document.querySelectorAll('[name="portal"]:checked')].map((i) => i.value);
  return {
    marca: Number($('#f-marca')?.value) || null,
    modelo: Number($('#f-modelo')?.value) || null,
    km: n('#f-km'),
    anoMin: n('#f-ano-min'),
    anoMax: n('#f-ano-max'),
    preco: n('#f-preco'),
    versao: $('#f-versao')?.value.trim() || null,
    portais,
  };
}

/** O recorte virado querystring — o mesmo formato que a API e a URL usam. */
export function paraQuery(c) {
  const qs = new URLSearchParams();
  if (c.modelo) qs.set('modelo', c.modelo);
  for (const campo of ['km', 'anoMin', 'anoMax', 'preco', 'versao']) {
    if (c[campo]) qs.set(campo, c[campo]);
  }
  // So manda `portais` quando NAO sao todos: link curto para o caso comum.
  if (c.portais?.length && c.portais.length < estado.portais.length) {
    qs.set('portais', c.portais.join(','));
  }
  return qs;
}

function lerDaUrl() {
  const q = new URLSearchParams(location.search);
  if (!q.get('modelo')) return preferencia.ler('busca', null);
  return {
    marca: null, // descoberto ao carregar o carro
    modelo: Number(q.get('modelo')) || null,
    km: Number(q.get('km')) || null,
    anoMin: Number(q.get('anoMin')) || null,
    anoMax: Number(q.get('anoMax')) || null,
    preco: Number(q.get('preco')) || null,
    versao: q.get('versao') || null,
    portais: (q.get('portais') ?? '').split(',').filter(Boolean),
  };
}

function gravarNaUrl(c) {
  const qs = paraQuery(c);
  const nova = `${location.pathname}?${qs}`;
  if (nova !== `${location.pathname}${location.search}`) history.pushState({ busca: c }, '', nova);
  preferencia.gravar('busca', c);
}

/* ---------------------------------------------------------------------------
   Os dois selects
--------------------------------------------------------------------------- */

async function carregarMarcas() {
  estado.marcas = await api('/api/catalogo/marcas');
  $('#f-marca').innerHTML = '<option value="">Marca…</option>' +
    estado.marcas.map((m) => `<option value="${m.id}">${esc(m.nome)}</option>`).join('');
}

async function carregarModelos(marcaId, selecionar = null) {
  const sel = $('#f-modelo');
  if (!marcaId) {
    sel.innerHTML = '<option value="">Modelo…</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = true;
  sel.innerHTML = '<option value="">carregando…</option>';
  if (!estado.modelos.has(marcaId)) {
    estado.modelos.set(marcaId, await api(`/api/catalogo/modelos?marca=${marcaId}`));
  }
  const modelos = estado.modelos.get(marcaId);
  sel.innerHTML = '<option value="">Modelo…</option>' +
    modelos.map((m) => `<option value="${m.id}">${esc(m.nome)}</option>`).join('');
  sel.disabled = false;
  if (selecionar) sel.value = String(selecionar);
}

/* ---------------------------------------------------------------------------
   BUSCAR
--------------------------------------------------------------------------- */

function avisar(texto, tipo = 'info') {
  const el = $('#busca-aviso');
  if (!el) return;
  el.className = `busca-aviso ${tipo}`;
  el.innerHTML = texto;
  el.hidden = !texto;
}

const HA = (ms) => {
  if (ms == null) return 'nunca';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h}h` : `há ${Math.floor(h / 24)}d`;
};

/** Conta, em uma frase, de quando e o que esta na tela. */
function descreverCache(cache, coleta) {
  const partes = ordenarFontes(Object.keys(cache)).map((p) => {
    const c = cache[p];
    if (!c.visto) return `${fonteNome(p)}: nunca coletado`;
    return `${fonteNome(p)}: ${HA(c.idadeMs)}${c.cobertura === 'PARCIAL' ? ' (1ª página)' : ''}`;
  });
  const base = partes.join(' · ');
  if (!coleta.pedida) return base;
  const fila = coleta.posicao > 0 ? ` — ${coleta.posicao} na frente na fila` : '';
  return `${base} — <b>atualizando ${coleta.portais.map(fonteNome).join(', ')}</b>${fila}`;
}

async function buscar({ daUrl = false } = {}) {
  const campos = lerCampos();
  if (!campos.modelo) {
    avisar('Escolha uma marca e um modelo.', 'alerta');
    return;
  }
  const botao = $('#btn-buscar');
  botao.disabled = true;
  try {
    const qs = paraQuery(campos);
    if (!daUrl) gravarNaUrl(campos);
    const r = await api(`/api/buscar?${qs}`);
    estado.carro = r.carro;
    avisar(descreverCache(r.cache, r.coleta), r.coleta.pedida ? 'info' : 'ok');
    atualizarBotaoAcompanhar(r.carro);
    aoBuscar({ campos, resposta: r });
  } catch (err) {
    avisar(esc(err.message), 'erro');
  } finally {
    botao.disabled = false;
  }
}

function atualizarBotaoAcompanhar(carro) {
  const b = $('#btn-acompanhar');
  if (!b) return;
  b.hidden = !carro;
  b.classList.toggle('on', Boolean(carro?.acompanhado));
  b.textContent = carro?.acompanhado ? '★ Acompanhando' : '☆ Acompanhar';
  b.title = carro?.acompanhado
    ? 'Este carro é recoletado de tempos em tempos, e por isso tem histórico de "novo", "baixou preço" e "saiu do ar". Clique para parar.'
    : 'Acompanhar: o carro passa a ser recoletado, e só então os eventos (novo, baixou preço, saiu do ar) passam a existir.';
}

/* ---------------------------------------------------------------------------
   A tela
--------------------------------------------------------------------------- */

function desenhar() {
  $('#busca-bar').innerHTML = `
    <form id="form-busca" class="form-busca" autocomplete="off">
      <div class="busca-linha">
        <select id="f-marca" class="f-carro" aria-label="Marca"><option value="">Marca…</option></select>
        <select id="f-modelo" class="f-carro" aria-label="Modelo" disabled><option value="">Modelo…</option></select>
        <input id="f-km" type="number" min="0" step="1000" placeholder="km máx." aria-label="Km máximo">
        <input id="f-ano-min" type="number" min="1900" max="2100" placeholder="ano de" aria-label="Ano mínimo">
        <input id="f-ano-max" type="number" min="1900" max="2100" placeholder="ano até" aria-label="Ano máximo">
        <input id="f-preco" type="number" min="0" step="1000" placeholder="preço máx." aria-label="Preço máximo">
        <button type="submit" id="btn-buscar" class="btn-pri">Buscar</button>
      </div>
      <div class="busca-linha busca-linha-2">
        <input id="f-versao" placeholder="versão contém (opcional): GT, Elite…" aria-label="Versão">
        <span class="busca-portais">
          ${estado.portais.map((p) => `<label class="chk"><input type="checkbox" name="portal" value="${p}" checked> ${esc(fonteNome(p))}</label>`).join('')}
        </span>
        <button type="button" id="btn-acompanhar" class="btn-sec" hidden>☆ Acompanhar</button>
      </div>
      <p id="busca-aviso" class="busca-aviso" hidden></p>
    </form>`;

  $('#f-marca').addEventListener('change', (e) => carregarModelos(Number(e.target.value) || null));
  $('#form-busca').addEventListener('submit', (e) => { e.preventDefault(); buscar(); });
  $('#btn-acompanhar').addEventListener('click', async () => {
    if (!estado.carro) return;
    const carro = await api(`/api/acompanhados/${estado.carro.id}`, {
      metodo: 'PUT',
      corpo: { acompanhar: !estado.carro.acompanhado },
    });
    estado.carro = { ...estado.carro, acompanhado: carro.acompanhado };
    atualizarBotaoAcompanhar(estado.carro);
  });
}

/** Preenche os campos com uma busca (da URL ou do localStorage) e executa. */
async function restaurar(c) {
  if (!c?.modelo) return false;
  let carro;
  try {
    carro = await api(`/api/catalogo/carro/${c.modelo}`);
  } catch {
    return false; // catalogo mudou: comeca em branco, sem erro na cara
  }
  $('#f-marca').value = String(carro.marca_id ?? '');
  // O carro nao devolve marca_id; descobre pela lista carregada.
  const marca = estado.marcas.find((m) => m.nome === carro.brand);
  if (marca) {
    $('#f-marca').value = String(marca.id);
    await carregarModelos(marca.id, c.modelo);
  }
  for (const [sel, valor] of [['#f-km', c.km], ['#f-ano-min', c.anoMin], ['#f-ano-max', c.anoMax], ['#f-preco', c.preco]]) {
    if (valor) $(sel).value = String(valor);
  }
  if (c.versao) $('#f-versao').value = c.versao;
  if (c.portais?.length) {
    for (const i of document.querySelectorAll('[name="portal"]')) i.checked = c.portais.includes(i.value);
  }
  await buscar({ daUrl: true });
  return true;
}

/**
 * @param {object} opcoes
 * @param {(info: {campos: object, resposta: object}) => void} opcoes.aoBuscar
 *        chamado quando uma busca responde — o app.js recarrega o painel.
 */
export async function iniciarBusca(opcoes = {}) {
  aoBuscar = opcoes.aoBuscar ?? (() => {});
  estado.portais = ordenarFontes(await api('/api/sources'));
  desenhar();
  await carregarMarcas();
  await restaurar(lerDaUrl());

  // Voltar/avancar do navegador refaz a busca daquele endereco.
  window.addEventListener('popstate', () => restaurar(lerDaUrl()));
}

/** O carro que esta na tela — o app.js usa para rotular e para pedir coleta. */
export const carroAtual = () => estado.carro;

/** Os portais marcados agora. */
export const portaisEscolhidos = () =>
  [...document.querySelectorAll('[name="portal"]:checked')].map((i) => i.value);
