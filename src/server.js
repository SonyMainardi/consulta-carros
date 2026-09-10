// Painel local: API JSON + arquivos estaticos + agendador.
import express from 'express';
import cron from 'node-cron';
import { resolve } from 'node:path';
import { config } from './config.js';
import { query } from './db/pool.js';
import { recentEvents } from './db/repositories/events.js';
import { allWatches, sourceHealth } from './db/repositories/watches.js';
import { runCollection } from './core/pipeline.js';
import { startProgress, endProgress, getProgress } from './core/progress.js';
import { enrichPendingFipe } from './enrich/run.js';
import { flushNotifications } from './notify/index.js';
import { adapterNames } from './adapters/index.js';
import { kmBand, KM_BANDS, transmissionGroup, TRANSMISSIONS } from './core/normalize.js';
import { tetosDoPainel } from './core/panelLimits.js';
import { createLogger } from './logger.js';

const log = createLogger('server');
const app = express();
app.use(express.json());
app.use(express.static(resolve(process.cwd(), 'public')));

let collecting = false;

async function collectNow(only = null) {
  if (collecting) return { skipped: true, reason: 'ja existe uma coleta em andamento' };
  collecting = true;
  startProgress(only);
  try {
    const stats = await runCollection({ only });
    if (stats) {
      await enrichPendingFipe(40);
      await flushNotifications();
    }
    endProgress({ stats });
    return { stats };
  } catch (err) {
    endProgress({ error: err.message });
    throw err;
  } finally {
    collecting = false;
  }
}

/**
 * Dispara a coleta e volta NA HORA.
 *
 * A versao anterior fazia `await collectNow()` dentro da rota. Como uma coleta
 * leva ~6 minutos (rate limit de 60-80s por pagina), o fetch do painel estourava
 * o timeout e o botao voltava ao normal como se tivesse terminado — enquanto a
 * coleta seguia rodando no servidor. Queixa do usuario em 2026-09-08.
 *
 * Agora quem acompanha e o painel, por /api/summary (campo `progress`).
 */
function startCollect(only = null) {
  if (collecting) return { started: false, reason: 'ja existe uma coleta em andamento' };
  collectNow(only).catch((err) => log.error(`coleta falhou: ${err.message}`));
  return { started: true };
}

app.get('/api/summary', async (_req, res, next) => {
  try {
    // Os cartoes contam o MESMO universo que a tabela mostra. Sem o teto aqui,
    // o topo dizia "89 anuncios ativos" com 70 linhas na tabela logo abaixo.
    const teto = tetosDoPainel('l');
    const tetoSql = teto.where.length ? `WHERE ${teto.where.join(' AND ')}` : '';

    const [totals] = await query(
      `SELECT COUNT(*) AS total,
              SUM(active = 1) AS ativos,
              SUM(first_seen >= NOW() - INTERVAL 1 DAY) AS novos_24h
         FROM listings l
         ${tetoSql}`,
      teto.params,
    );
    // Eventos entram pelo JOIN so para o teto poder olhar o anuncio: evento de
    // carro escondido nao pode aparecer na conta do que "mudou".
    const [evts] = await query(
      `SELECT SUM(e.type = 'NEW' AND e.created_at >= NOW() - INTERVAL 1 DAY)         AS novos,
              SUM(e.type = 'PRICE_DROP' AND e.created_at >= NOW() - INTERVAL 7 DAY)  AS baixas_7d,
              SUM(e.type = 'DISAPPEARED' AND e.created_at >= NOW() - INTERVAL 7 DAY) AS sumiram_7d
         FROM events e
         JOIN listings l ON l.id = e.listing_id
         ${tetoSql}`,
      teto.params,
    );
    res.json({ ...totals, ...evts, health: await sourceHealth(), collecting, progress: getProgress() });
  } catch (err) { next(err); }
});

app.get('/api/events', async (req, res, next) => {
  try {
    res.json(await recentEvents({
      type: req.query.type || null,
      limit: Math.min(Number(req.query.limit) || 60, 300),
    }));
  } catch (err) { next(err); }
});

/**
 * Recorte por faixa de km, em SQL.
 *
 * A faixa e derivada na leitura (kmBand), mas o FILTRO precisa acontecer no
 * banco: filtrar em JS depois do LIMIT devolveria uma pagina incompleta.
 */
function bandWhere(id) {
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
 * Recorte por estado (UF).
 *
 * Aqui NAO existe derivacao: `parseUf` ja normaliza para a sigla de duas letras
 * na gravacao, entao a coluna e limpa e o filtro e uma igualdade simples. O
 * balde 'sem-uf' existe pelo mesmo motivo do 'outro' do cambio: se uma fonte
 * passar a mandar local em formato que o parseUf nao reconhece, esses anuncios
 * aparecem no menu em vez de sumirem em silencio.
 */
function ufWhere(id) {
  if (!id) return null;
  if (id === 'sem-uf') return { sql: 'l.uf IS NULL', params: [] };
  return /^[A-Za-z]{2}$/.test(id) ? { sql: 'l.uf = ?', params: [id.toUpperCase()] } : null;
}

/**
 * Filtros compartilhados pelos CINCO endpoints da listagem. Fica num lugar so
 * para os chips COMPOREM: escolher "manual" tem de mudar a contagem por faixa
 * de km, e escolher uma faixa tem de mudar a contagem por cambio.
 */
function filtrosComuns(q) {
  const where = ['l.active = 1'];
  const params = [];

  // Tetos do painel antes de qualquer filtro escolhido pelo usuario. Ficam
  // aqui, e nao em /api/listings, para valerem tambem para os chips de km e
  // cambio e para os menus de LOCAL e FONTE: carro que nao aparece na lista
  // nao pode continuar sendo contado nos filtros.
  const tetos = tetosDoPainel('l');
  where.push(...tetos.where);
  params.push(...tetos.params);

  if (q.watch) { where.push('lw.watch_id = ?'); params.push(Number(q.watch)); }
  if (q.source) { where.push('l.source = ?'); params.push(q.source); }
  for (const f of [bandWhere(q.band), cambioWhere(q.cambio), ufWhere(q.uf)]) {
    if (f) { where.push(`(${f.sql})`); params.push(...f.params); }
  }
  return { where, params };
}

app.get('/api/listings', async (req, res, next) => {
  try {
    const { where, params } = filtrosComuns(req.query);

    // Quatro criterios com as duas direcoes, mais "mais recentes". O painel
    // manda `<criterio>` ou `<criterio>_desc` conforme o clique no cabecalho da
    // coluna (ANO, KM, PRECO, FIPE).
    //
    // `<campo> IS NULL` vem primeiro em TODAS: anuncio sem preco nao pode
    // encabecar a lista de "menor preco" so por ser nulo — e, na direcao
    // contraria, os nulos tambem ficam no fim, onde nao atrapalham a leitura.
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

    const rows = await query(
      `SELECT DISTINCT l.id, l.source, l.url, l.title, l.brand, l.model, l.version,
              l.year_fab, l.year_model, l.km, l.price, l.transmission, l.city, l.uf,
              l.seller_type, l.photos, l.fipe_price, l.fipe_ratio, l.first_seen, l.last_seen
         FROM listings l
         LEFT JOIN listing_watches lw ON lw.listing_id = l.id
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

// Contagem por faixa de km — alimenta os chips de classificacao do painel.
// Respeita o cambio selecionado, mas nao a propria faixa: senao o chip
// escolhido mostraria o total e os outros zerariam.
app.get('/api/km-bands', async (req, res, next) => {
  try {
    const { where, params } = filtrosComuns({ ...req.query, band: null });
    const rows = await query(
      `SELECT DISTINCT l.id, l.km
         FROM listings l
         LEFT JOIN listing_watches lw ON lw.listing_id = l.id
        WHERE ${where.join(' AND ')} AND l.km IS NOT NULL`,
      params,
    );
    const counts = Object.fromEntries(KM_BANDS.map((b) => [b.id, 0]));
    for (const r of rows) {
      const b = kmBand(r.km);
      if (b) counts[b] += 1;
    }
    res.json(KM_BANDS.map((b) => ({ id: b.id, label: b.label, count: counts[b.id] })));
  } catch (err) { next(err); }
});

// Contagem por grupo de cambio, contada com a MESMA funcao que classifica a
// tabela. O grupo 'outro' so aparece quando existe: e o sinal de que a fonte
// comecou a mandar um rotulo que nao conhecemos.
app.get('/api/cambios', async (req, res, next) => {
  try {
    const { where, params } = filtrosComuns({ ...req.query, cambio: null });
    const rows = await query(
      `SELECT DISTINCT l.id, l.transmission
         FROM listings l
         LEFT JOIN listing_watches lw ON lw.listing_id = l.id
        WHERE ${where.join(' AND ')} AND l.transmission IS NOT NULL`,
      params,
    );
    const counts = {};
    for (const r of rows) {
      const g = transmissionGroup(r.transmission);
      if (g) counts[g] = (counts[g] ?? 0) + 1;
    }
    const grupos = TRANSMISSIONS.map((t) => ({ id: t.id, label: t.label, count: counts[t.id] ?? 0 }));
    if (counts.outro) grupos.push({ id: 'outro', label: 'outro', count: counts.outro });
    res.json(grupos);
  } catch (err) { next(err); }
});

// Estados presentes na coleta, com contagem. Alimenta o menu que abre no
// cabecalho LOCAL da tabela. Nao ha lista fixa de UFs de proposito: o menu
// mostra o que a coleta REALMENTE trouxe, entao nenhuma opcao leva a uma tela
// vazia. Respeita os outros filtros, mas nao o proprio (senao o estado
// escolhido mostraria o total e os demais zerariam).
app.get('/api/ufs', async (req, res, next) => {
  try {
    const { where, params } = filtrosComuns({ ...req.query, uf: null });
    const rows = await query(
      `SELECT DISTINCT l.id, l.uf
         FROM listings l
         LEFT JOIN listing_watches lw ON lw.listing_id = l.id
        WHERE ${where.join(' AND ')}`,
      params,
    );
    const counts = {};
    let semUf = 0;
    for (const r of rows) {
      if (r.uf) counts[r.uf] = (counts[r.uf] ?? 0) + 1;
      else semUf += 1;
    }
    // Mais anuncios primeiro: quem abre o menu quer SP no topo, nao AC.
    const ufs = Object.entries(counts)
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
    if (semUf) ufs.push({ id: 'sem-uf', count: semUf });
    res.json(ufs);
  } catch (err) { next(err); }
});

// Fontes presentes na coleta, com contagem. Alimenta o menu do cabecalho
// FONTE, irmao do de LOCAL. Nao devolve a lista de adapters (isso e
// /api/sources): devolve quem REALMENTE tem anuncio ativo agora, pelo mesmo
// motivo do /api/ufs — nenhuma opcao do menu pode levar a uma tela vazia.
app.get('/api/fontes', async (req, res, next) => {
  try {
    const { where, params } = filtrosComuns({ ...req.query, source: null });
    const rows = await query(
      `SELECT DISTINCT l.id, l.source
         FROM listings l
         LEFT JOIN listing_watches lw ON lw.listing_id = l.id
        WHERE ${where.join(' AND ')}`,
      params,
    );
    const counts = {};
    for (const r of rows) counts[r.source] = (counts[r.source] ?? 0) + 1;
    res.json(
      Object.entries(counts)
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    );
  } catch (err) { next(err); }
});

app.get('/api/listings/:id/history', async (req, res, next) => {
  try {
    res.json(await query(
      `SELECT price, km, captured_at FROM price_history WHERE listing_id = ? ORDER BY captured_at`,
      [Number(req.params.id)],
    ));
  } catch (err) { next(err); }
});

app.get('/api/watches', async (_req, res, next) => {
  try { res.json(await allWatches()); } catch (err) { next(err); }
});

app.get('/api/sources', (_req, res) => res.json(adapterNames));

app.post('/api/collect', (req, res) => {
  res.status(202).json(startCollect(req.body?.source ?? null));
});

app.use((err, _req, res, _next) => {
  log.error(err.stack ?? err.message);
  res.status(500).json({ error: err.message });
});

app.listen(config.server.port, () => {
  log.info(`painel em http://localhost:${config.server.port}`);
});

// COLLECT_CRON vazio = agendador desligado de proposito. Distinguimos de cron
// invalido porque as duas coisas sao muito diferentes: uma e decisao, a outra e
// erro de digitacao que faria a coleta parar sem ninguem notar.
if (!String(config.collect.cron).trim()) {
  log.warn('agendador DESLIGADO (COLLECT_CRON vazio) — nenhuma coleta automatica');
} else if (cron.validate(config.collect.cron)) {
  cron.schedule(config.collect.cron, () => {
    log.info('coleta agendada disparada');
    collectNow().catch((err) => log.error(err.message));
  });
  log.info(`agendador ativo: ${config.collect.cron}`);
} else {
  log.error(`COLLECT_CRON invalido: "${config.collect.cron}" — nenhuma coleta automatica`);
}

if (config.collect.onBoot) {
  collectNow().catch((err) => log.error(err.message));
}
