// Painel local: API JSON + arquivos estaticos.
//
// O DESENHO (ESTADO.md 2-X, 2026-09-16)
// Nao existe "busca salva". A pessoa escolhe marca e modelo (selects do
// catalogo), km, ano, preco e portais, e clica BUSCAR. Essa escolha vive na URL
// dela — nunca no banco. O que o banco tem e um CACHE de anuncios por modelo,
// que serve a todo mundo que pedir o mesmo carro.
//
// Uma busca, entao, e sempre a mesma sequencia:
//   1. o cache deste modelo esta fresco? responde na hora;
//   2. esta velho (ou nao existe)? enfileira a coleta e responde com o que ha,
//      dizendo "de X atras, atualizando";
//   3. o painel acompanha por /api/summary ate a rodada terminar.
//
// SEM AGENDADOR (pedido do usuario, 2026-09-15): nada roda sozinho. Toda coleta
// sai de um clique — ou de `npm run collect`, que tambem e alguem pedindo.
import express from 'express';
import { resolve } from 'node:path';
import { config } from './config.js';
import { query, one } from './db/pool.js';
import { recentEvents, filtroEventos } from './db/repositories/events.js';
import { sourceHealth, ultimasRodadas } from './db/repositories/coletas.js';
import {
  listarMarcas, listarModelos, carroPorId, carroPorSlugs, frescorDoModelo,
  definirAcompanhamento, modelosAcompanhados, enderecosQuebrados, corrigirEndereco,
} from './db/repositories/catalogo.js';
import { listarFavoritos, favoritar, desfavoritar } from './db/repositories/favoritos.js';
import { lerRecorte, condicoesDoRecorte, descreverRecorte } from './db/recorte.js';
import { pedirColeta, estadoDaFila, posicaoNaFila } from './core/fila.js';
import { getProgress } from './core/progress.js';
import { PAGINAS_POR_BUSCA, ritmoPorPortal } from './core/orcamento.js';
import { enrichPendingFipe } from './enrich/run.js';
import { flushNotifications } from './notify/index.js';
import { adapters, adapterNames } from './adapters/index.js';
import { kmBand, KM_BANDS, transmissionGroup, TRANSMISSIONS } from './core/normalize.js';
import { createLogger } from './logger.js';

const log = createLogger('server');
const app = express();
app.use(express.json());
app.use(express.static(resolve(process.cwd(), 'public')));

// Quanto tempo o cache de um (modelo, portal) vale antes de valer a pena
// coletar de novo. Nao e sobre o carro mudar de preco: e sobre nao bater no
// portal a cada F5. Seis horas cobrem "olhei de manha, olhei de tarde".
const VALIDADE_CACHE_MS = 6 * 60 * 60 * 1000;

/* ---------------------------------------------------------------------------
   ANUNCIOS

   Um anuncio aparece se esta ATIVO NAQUELE MODELO (listing_modelos.ativo) e
   dentro do recorte de quem esta olhando (src/db/recorte.js). O recorte chega
   na querystring e nao e gravado em lugar nenhum.
--------------------------------------------------------------------------- */

const FROM_ANUNCIOS = `
  FROM listings l
  JOIN listing_modelos lm ON lm.listing_id = l.id`;

/**
 * Recorte por faixa de km, em SQL.
 *
 * A faixa e derivada na leitura (kmBand), mas o FILTRO precisa acontecer no
 * banco: filtrar em JS depois do LIMIT devolveria uma pagina incompleta.
 */
function bandWhere(id) {
  // O chip "sem km" precisa filtrar de verdade; sem este caso ele nao filtrava
  // nada e a tabela mostrava tudo, contradizendo a contagem do proprio chip.
  if (id === 'sem-km') return { sql: 'l.km IS NULL', params: [] };
  const band = KM_BANDS.find((b) => b.id === id);
  if (!band) return null;
  const min = KM_BANDS[KM_BANDS.indexOf(band) - 1]?.max ?? 0;
  return Number.isFinite(band.max)
    ? { sql: 'l.km > ? AND l.km <= ?', params: [min, band.max] }
    : { sql: 'l.km > ?', params: [min] };
}

/** Um grupo de cambio virado em SQL, a partir da MESMA tabela que classifica na
 *  leitura — assim a regra existe num lugar so e as duas nunca divergem. */
function grupoCambioSql(t) {
  const sql = [`(${t.match.map(() => 'l.transmission LIKE ?').join(' OR ')})`];
  const params = t.match.map((m) => `%${m}%`);
  for (const e of t.except ?? []) {
    sql.push('l.transmission NOT LIKE ?');
    params.push(`%${e}%`);
  }
  return { sql: sql.join(' AND '), params };
}

// Os trechos de `match`/`except` sao ASCII de proposito ("autom", nao
// "automatica"): assim o LIKE funciona mesmo se a coluna deixar de ser
// utf8mb4_unicode_ci, que hoje ignora acento.
function cambioWhere(id) {
  if (!id) return null;
  // Como o "sem km": o chip precisa filtrar, senao a soma dos chips nao bate
  // com o total da tabela e o painel se contradiz.
  if (id === 'sem-cambio') return { sql: 'l.transmission IS NULL', params: [] };
  if (id === 'outro') {
    const partes = TRANSMISSIONS.map(grupoCambioSql);
    return {
      sql: `l.transmission IS NOT NULL AND ${partes.map((p) => `NOT (${p.sql})`).join(' AND ')}`,
      params: partes.flatMap((p) => p.params),
    };
  }
  const t = TRANSMISSIONS.find((x) => x.id === id);
  return t ? grupoCambioSql(t) : null;
}

/**
 * Recorte por estado (UF) escolhido no menu. Diferente do `uf` do recorte, que
 * e uma lista; este e o chip de um estado so, e tem o balde 'sem-uf' para
 * anuncio de local nao reconhecido aparecer em vez de sumir em silencio.
 */
function ufWhere(id) {
  if (!id) return null;
  if (id === 'sem-uf') return { sql: 'l.uf IS NULL', params: [] };
  return /^[A-Za-z]{2}$/.test(id) ? { sql: 'l.uf = ?', params: [id.toUpperCase()] } : null;
}

const modeloDe = (q) => Number(q.modelo) || null;

/**
 * Filtros compartilhados pelos endpoints da listagem. Fica num lugar so para os
 * chips COMPOREM (escolher "manual" muda a contagem por faixa de km) e para o
 * recorte valer igual na lista, nas contagens e nos cartoes — senao o painel se
 * contradiz (o achado de 2-L).
 */
function filtrosComuns(q) {
  const where = ['lm.ativo = 1'];
  const params = [];

  const modelo = modeloDe(q);
  if (modelo) { where.push('lm.modelo_id = ?'); params.push(modelo); }

  const r = condicoesDoRecorte(lerRecorte(q), 'l');
  where.push(...r.where);
  params.push(...r.params);

  // Chips da tabela: refinam o que o recorte ja deixou entrar.
  if (q.source) { where.push('l.source = ?'); params.push(q.source); }
  for (const f of [bandWhere(q.band), cambioWhere(q.cambio), ufWhere(q.uf)]) {
    if (f) { where.push(`(${f.sql})`); params.push(...f.params); }
  }
  return { where, params };
}

/* ---------------------------------------------------------------------------
   CATALOGO — os dois selects
--------------------------------------------------------------------------- */

app.get('/api/catalogo/marcas', async (_req, res, next) => {
  try { res.json(await listarMarcas()); } catch (err) { next(err); }
});

app.get('/api/catalogo/modelos', async (req, res, next) => {
  try {
    const marca = Number(req.query.marca);
    if (!marca) return res.status(400).json({ error: 'informe a marca' });
    res.json(await listarModelos(marca));
  } catch (err) { next(err); }
});

/** Um carro do catalogo, com endereco por portal e frescor do cache. */
app.get('/api/catalogo/carro/:id', async (req, res, next) => {
  try {
    const carro = await carroPorId(req.params.id);
    if (!carro) return res.status(404).json({ error: 'carro nao esta no catalogo' });
    res.json({ ...carro, frescor: await frescorDoModelo(carro.id) });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   A BUSCA
--------------------------------------------------------------------------- */

/** Ha quanto tempo cada portal foi coletado, e o que disso ja esta velho. */
function avaliarFrescor(frescor, portais, validadeMs = VALIDADE_CACHE_MS) {
  const agora = Date.now();
  const situacao = {};
  const velhos = [];
  for (const p of portais) {
    const f = frescor[p];
    const idadeMs = f ? agora - new Date(f.quando).getTime() : null;
    const fresco = idadeMs != null && idadeMs < validadeMs;
    situacao[p] = { visto: f?.quando ?? null, idadeMs, itens: f?.itens ?? null, cobertura: f?.cobertura ?? null, fresco };
    if (!fresco) velhos.push(p);
  }
  return { situacao, velhos };
}

/**
 * BUSCAR: o coracao do sistema.
 *
 * Responde SEMPRE com o que existe no cache — mesmo velho, mesmo vazio — e, se
 * estiver velho, enfileira a coleta e diz que esta atualizando. Nunca segura a
 * requisicao esperando o Webmotors: sao 5 paginas a 30-40 s, e ninguem espera
 * 4 minutos numa tela (ESTADO.md 2-X).
 *
 * `so_cache=1` desliga o disparo da coleta — e o que o painel usa quando so
 * esta remexendo nos filtros de uma busca que ja fez.
 */
app.get('/api/buscar', async (req, res, next) => {
  try {
    const carro = await carroPorId(modeloDe(req.query));
    if (!carro) return res.status(404).json({ error: 'escolha uma marca e um modelo da lista' });

    const recorte = lerRecorte(req.query);
    const portais = (recorte.portais.length ? recorte.portais : adapterNames)
      .filter((p) => carro.params[p]);
    if (!portais.length) return res.status(400).json({ error: 'nenhum portal valido para este carro' });

    const { situacao, velhos } = avaliarFrescor(await frescorDoModelo(carro.id), portais);

    let coleta = { pedida: false, portais: [], posicao: posicaoNaFila(carro.id) };
    if (velhos.length && req.query.so_cache !== '1') {
      // Nao esperamos a promessa: a resposta sai agora, com o cache.
      pedirColeta(carro, velhos)
        .then(() => Promise.all([enrichPendingFipe(40), flushNotifications()]))
        .catch((err) => log.error(`coleta de ${carro.slug} falhou: ${err.message}`));
      coleta = { pedida: true, portais: velhos, posicao: posicaoNaFila(carro.id) };
    }

    log.info(`busca: ${carro.name} · ${portais.join(', ')} · ${descreverRecorte(recorte)}` +
      `${coleta.pedida ? ` · coletando ${velhos.join(', ')}` : ' · do cache'}`);

    res.json({
      carro: { id: carro.id, nome: carro.name, marca: carro.brand, modelo: carro.model, acompanhado: carro.acompanhado },
      portais,
      recorte,
      cache: situacao,
      coleta,
    });
  } catch (err) { next(err); }
});

app.get('/api/summary', async (req, res, next) => {
  try {
    const { where, params } = filtrosComuns(req.query);
    const totais = await one(
      `SELECT COUNT(DISTINCT l.id) AS ativos ${FROM_ANUNCIOS} WHERE ${where.join(' AND ')}`,
      params,
    );
    // Eventos pelos mesmos criterios da lista. DISTINCT por anuncio: o mesmo
    // carro novo visto duas vezes e uma noticia, nao duas.
    const f = filtroEventos({ modelo: modeloDe(req.query), recorte: lerRecorte(req.query) });
    const evts = await one(
      `SELECT COUNT(DISTINCT CASE WHEN e.type = 'NEW' AND e.created_at >= NOW() - INTERVAL 1 DAY THEN e.listing_id END) AS novos,
              COUNT(DISTINCT CASE WHEN e.type = 'PRICE_DROP' AND e.created_at >= NOW() - INTERVAL 7 DAY THEN e.id END) AS baixas_7d,
              COUNT(DISTINCT CASE WHEN e.type = 'DISAPPEARED' AND e.created_at >= NOW() - INTERVAL 7 DAY THEN e.listing_id END) AS sumiram_7d
         FROM events e
         JOIN listings l ON l.id = e.listing_id
        ${f.where.length ? `WHERE ${f.where.join(' AND ')}` : ''}`,
      f.params,
    );
    res.json({
      ...totais,
      ...evts,
      health: await sourceHealth(),
      fila: estadoDaFila(),
      progress: getProgress(),
    });
  } catch (err) { next(err); }
});

app.get('/api/listings', async (req, res, next) => {
  try {
    const { where, params } = filtrosComuns(req.query);

    // Quatro criterios com as duas direcoes, mais "mais recentes". `<campo> IS
    // NULL` vem primeiro em TODAS: anuncio sem preco nao pode encabecar a lista
    // de "menor preco" so por ser nulo.
    const orders = {
      fipe: 'l.fipe_ratio IS NULL, l.fipe_ratio ASC',
      fipe_desc: 'l.fipe_ratio IS NULL, l.fipe_ratio DESC',
      preco: 'l.price IS NULL, l.price ASC',
      preco_desc: 'l.price IS NULL, l.price DESC',
      km: 'l.km IS NULL, l.km ASC',
      km_desc: 'l.km IS NULL, l.km DESC',
      ano: 'l.year_model IS NULL, l.year_model ASC',
      ano_desc: 'l.year_model IS NULL, l.year_model DESC',
      novos: 'l.first_seen DESC',
    };
    const order = orders[req.query.sort] ?? orders.novos;
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    // `external_id` vai junto porque e a chave do favorito (source + external_id):
    // o coracao de cada linha precisa dela.
    const rows = await query(
      `SELECT DISTINCT l.id, l.source, l.external_id, l.url, l.title, l.brand, l.model, l.version,
              l.year_fab, l.year_model, l.km, l.price, l.transmission, l.city, l.uf,
              l.seller_type, l.photos, l.fipe_price, l.fipe_ratio, l.first_seen, l.last_seen
         ${FROM_ANUNCIOS}
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}
        LIMIT ${limit}`,
      params,
    );
    // km_band e cambio saem derivados na leitura, nunca do banco.
    res.json(rows.map((r) => ({
      ...r,
      km_band: kmBand(r.km),
      cambio: transmissionGroup(r.transmission),
    })));
  } catch (err) { next(err); }
});

app.get('/api/events', async (req, res, next) => {
  try {
    res.json(await recentEvents({
      type: req.query.type || null,
      limit: Math.min(Number(req.query.limit) || 60, 300),
      modelo: modeloDe(req.query),
      recorte: lerRecorte(req.query),
    }));
  } catch (err) { next(err); }
});

// Contagem por faixa de km — alimenta os chips. Respeita os outros filtros,
// mas nao a propria faixa: senao o chip escolhido mostraria o total e os
// outros zerariam.
//
// AS QUATRO ROTAS DE FILTRO DEVOLVEM O MESMO FORMATO: uma LISTA de
// `{id, label, count}`. O painel monta chips e menus com a mesma funcao
// (renderChips e criarMenuCabecalho), e e esse contrato que ele espera —
// devolver `{bands: [...], total}` faz os chips sumirem em silencio.
app.get('/api/km-bands', async (req, res, next) => {
  try {
    const { where, params } = filtrosComuns({ ...req.query, band: null });
    const rows = await query(
      `SELECT l.id, l.km ${FROM_ANUNCIOS} WHERE ${where.join(' AND ')} GROUP BY l.id, l.km`,
      params,
    );
    const contagem = {};
    for (const r of rows) {
      const b = kmBand(r.km) ?? 'sem-km';
      contagem[b] = (contagem[b] ?? 0) + 1;
    }
    const lista = KM_BANDS
      .map((b) => ({ id: b.id, label: b.label, count: contagem[b.id] ?? 0 }))
      .filter((b) => b.count > 0);
    // Anuncio sem km aparece em vez de sumir: a soma dos chips tem de bater
    // com o total da tabela, senao o painel se contradiz.
    if (contagem['sem-km']) lista.push({ id: 'sem-km', label: 'sem km', count: contagem['sem-km'] });
    res.json(lista);
  } catch (err) { next(err); }
});

app.get('/api/cambios', async (req, res, next) => {
  try {
    const { where, params } = filtrosComuns({ ...req.query, cambio: null });
    const rows = await query(
      `SELECT l.id, l.transmission ${FROM_ANUNCIOS} WHERE ${where.join(' AND ')} GROUP BY l.id, l.transmission`,
      params,
    );
    const contagem = {};
    for (const r of rows) {
      const g = transmissionGroup(r.transmission) ?? 'sem-cambio';
      contagem[g] = (contagem[g] ?? 0) + 1;
    }
    const lista = [...TRANSMISSIONS.map((t) => ({ id: t.id, label: t.label ?? t.id })), { id: 'outro', label: 'outro' }]
      .map((t) => ({ ...t, count: contagem[t.id] ?? 0 }))
      .filter((t) => t.count > 0);
    if (contagem['sem-cambio']) lista.push({ id: 'sem-cambio', label: 'sem câmbio', count: contagem['sem-cambio'] });
    res.json(lista);
  } catch (err) { next(err); }
});

app.get('/api/ufs', async (req, res, next) => {
  try {
    const { where, params } = filtrosComuns({ ...req.query, uf: null });
    const rows = await query(
      `SELECT l.uf, COUNT(DISTINCT l.id) total ${FROM_ANUNCIOS}
        WHERE ${where.join(' AND ')} GROUP BY l.uf ORDER BY total DESC`,
      params,
    );
    res.json(rows.map((r) => ({ id: r.uf ?? 'sem-uf', label: r.uf ?? 'sem estado', count: Number(r.total) })));
  } catch (err) { next(err); }
});

app.get('/api/fontes', async (req, res, next) => {
  try {
    const { where, params } = filtrosComuns({ ...req.query, source: null });
    const rows = await query(
      `SELECT l.source, COUNT(DISTINCT l.id) total ${FROM_ANUNCIOS}
        WHERE ${where.join(' AND ')} GROUP BY l.source ORDER BY total DESC`,
      params,
    );
    res.json(rows.map((r) => ({ id: r.source, label: r.source, count: Number(r.total) })));
  } catch (err) { next(err); }
});

app.get('/api/listings/:id/history', async (req, res, next) => {
  try {
    res.json(await query(
      `SELECT price, km, captured_at FROM price_history
        WHERE listing_id = ? ORDER BY captured_at ASC`,
      [Number(req.params.id)],
    ));
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   COLETA
--------------------------------------------------------------------------- */

/** Forca a coleta de um carro agora, ignorando o frescor do cache. */
app.post('/api/coleta', async (req, res, next) => {
  try {
    const carro = await carroPorId(req.body?.modelo);
    if (!carro) return res.status(404).json({ error: 'carro nao esta no catalogo' });
    const portais = (req.body?.portais?.length ? req.body.portais : adapterNames)
      .filter((p) => carro.params[p]);
    if (!portais.length) return res.status(400).json({ error: 'nenhum portal valido para este carro' });

    pedirColeta(carro, portais)
      .then(() => Promise.all([enrichPendingFipe(40), flushNotifications()]))
      .catch((err) => log.error(`coleta de ${carro.slug} falhou: ${err.message}`));

    res.status(202).json({ pedida: true, portais, posicao: posicaoNaFila(carro.id) });
  } catch (err) { next(err); }
});

app.get('/api/coleta', (_req, res) => {
  res.json({ fila: estadoDaFila(), progress: getProgress() });
});

app.get('/api/coleta/rodadas', async (req, res, next) => {
  try { res.json(await ultimasRodadas(Math.min(Number(req.query.limit) || 20, 100))); } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   ACOMPANHAR — o monitoramento por cima do cache

   Eventos (novo, baixou preco, sumiu) so existem com coleta repetida. Marcar um
   modelo aqui e o que o torna digno de recoleta e de feed. Nao e a busca de
   ninguem: e o carro que esta sendo acompanhado, e quem pedir aquele carro
   ganha o historico junto.
--------------------------------------------------------------------------- */

app.get('/api/acompanhados', async (_req, res, next) => {
  try { res.json(await modelosAcompanhados()); } catch (err) { next(err); }
});

app.put('/api/acompanhados/:modelo', async (req, res, next) => {
  try {
    const carro = await definirAcompanhamento(req.params.modelo, req.body?.acompanhar !== false);
    if (!carro) return res.status(404).json({ error: 'carro nao esta no catalogo' });
    res.json(carro);
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   FAVORITOS — os anuncios que a pessoa guardou (ESTADO.md 2-AA)

   A unica coisa pessoal no banco. Todas as outras rotas respondem igual a
   qualquer um; estas respondem "os favoritos de QUEM?".
--------------------------------------------------------------------------- */

// Quem e o dono dos favoritos desta requisicao. Hoje ha um so — quem usa este
// computador —, entao e uma constante. E o seam do online (2-X): quando houver
// login, e SO esta funcao que muda, porque as consultas ja filtram por dono.
// Enquanto ela devolver uma constante, o painel NAO pode ir ao ar com
// favoritos: todo visitante veria e mexeria nos mesmos.
const donoDe = (_req) => 'local';

app.get('/api/favoritos', async (req, res, next) => {
  try { res.json(await listarFavoritos(donoDe(req))); } catch (err) { next(err); }
});

const FONTE_OK = /^[a-z0-9-]{1,32}$/;

/** Mesmo formato do ☆ Acompanhar: `{ favorito: false }` tira, o resto guarda. */
app.put('/api/favoritos/:source/:externalId', async (req, res, next) => {
  try {
    const { source, externalId } = req.params;
    if (!FONTE_OK.test(source) || !externalId || externalId.length > 160) {
      return res.status(400).json({ error: 'anuncio invalido' });
    }
    const dono = donoDe(req);
    if (req.body?.favorito === false) {
      await desfavoritar(dono, source, externalId);
      return res.json({ favorito: false });
    }
    if (!await favoritar(dono, source, externalId, Number(req.body?.modelo) || null)) {
      return res.status(404).json({ error: 'anuncio nao esta no cache' });
    }
    res.json({ favorito: true });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   MANUTENCAO DO CATALOGO

   O endereco de cada (modelo, portal) se corrige sozinho no uso: a coleta o
   marca CONFIRMADO quando a pagina e do carro certo, e QUEBRADO quando nao e.
   Aqui ficam os quebrados, para o conserto — que vale para todos.
--------------------------------------------------------------------------- */

app.get('/api/manutencao/enderecos', async (_req, res, next) => {
  try { res.json(await enderecosQuebrados()); } catch (err) { next(err); }
});

const SLUG_OK = /^[a-z0-9-]+$/;

app.put('/api/manutencao/enderecos/:modelo/:portal', async (req, res, next) => {
  try {
    const marca = String(req.body?.marca ?? '').trim().toLowerCase();
    const modelo = String(req.body?.modelo ?? '').trim().toLowerCase();
    if (!SLUG_OK.test(marca) || !SLUG_OK.test(modelo)) {
      return res.status(400).json({ error: 'use so letras minusculas, numeros e hifen' });
    }
    if (!adapterNames.includes(req.params.portal)) {
      return res.status(400).json({ error: 'portal desconhecido' });
    }
    const e = await corrigirEndereco(req.params.modelo, req.params.portal, { marca, modelo });
    if (!e) return res.status(404).json({ error: 'endereco nao encontrado' });
    res.json(e);
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   METADADOS
--------------------------------------------------------------------------- */

app.get('/api/sources', (_req, res) => res.json(adapterNames));

/** Quanto custa uma coleta: o painel estima o tempo com isto. */
app.get('/api/orcamento', (_req, res) => {
  res.json({
    paginasPorBusca: PAGINAS_POR_BUSCA,
    ritmo: ritmoPorPortal(),
    // Formato da URL de cada portal, vindo do proprio adapter: a tela de
    // manutencao mostra o endereco sem repetir a regra de cada site.
    enderecos: Object.fromEntries(adapterNames.map((n) => [n, adapters[n].endereco ?? null])),
    validadeCacheMs: VALIDADE_CACHE_MS,
  });
});

app.use((err, _req, res, _next) => {
  log.error(err.message, { stack: err.stack });
  res.status(500).json({ error: err.message });
});

app.listen(config.server.port, () => {
  log.info(`painel em http://localhost:${config.server.port} — busca ao vivo, sem agendador`);
});
