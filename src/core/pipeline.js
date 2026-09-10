// Orquestra uma rodada completa de coleta.
//
//   watch -> adapter.search -> normalize -> filtro -> fingerprint
//         -> upsert -> diff (eventos) -> marca sumidos
//
// Cada par (watch, fonte) e isolado: se a OLX estiver bloqueada, ML e Webmotors
// seguem normalmente e o erro vira uma linha em fetch_runs.
import { getAdapter } from '../adapters/index.js';
import { toListing, matchesWatch } from './normalize.js';
import { fingerprint } from './fingerprint.js';
import { upsertListing, recordPrice, linkWatch, findVanished, markInactive, setFipe } from '../db/repositories/listings.js';
import { createEvent } from '../db/repositories/events.js';
import { activeWatches, logRun } from '../db/repositories/watches.js';
import { closeBrowser } from '../http/browser.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('pipeline');

// Variacao de preco abaixo disso e reajuste de centavos, nao noticia.
const PRICE_NOISE = 100;

async function collectOne(watch, sourceName, stats) {
  const started = Date.now();
  const adapter = getAdapter(sourceName);

  try {
    const raw = await adapter.search(watch);

    const listings = raw
      .map((r) => toListing(sourceName, r))
      .filter((l) => l.external_id && l.external_id !== 'undefined' && l.url)
      .filter((l) => matchesWatch(l, watch));

    const seenIds = [];

    for (const listing of listings) {
      seenIds.push(listing.external_id);
      const fp = fingerprint(listing);
      const { id, previous } = await upsertListing(listing, fp);
      await linkWatch(id, watch.id);

      // Fonte que ja entrega a razao FIPE (Webmotors) dispensa o enrich depois.
      if (listing.fipe_ratio != null && listing.price != null) {
        await setFipe(id, {
          code: null,
          price: Math.round(listing.price / listing.fipe_ratio),
          ratio: listing.fipe_ratio,
        });
      }

      if (!previous) {
        await recordPrice(id, listing.price, listing.km);
        await createEvent(id, watch.id, 'NEW', { price: listing.price, km: listing.km });
        stats.new += 1;
        continue;
      }

      if (previous.active === 0) {
        await createEvent(id, watch.id, 'RELISTED', { price: listing.price });
        stats.relisted += 1;
      }

      const before = previous.price == null ? null : Number(previous.price);
      const after = listing.price;
      if (before != null && after != null && Math.abs(after - before) >= PRICE_NOISE) {
        await recordPrice(id, after, listing.km);
        const type = after < before ? 'PRICE_DROP' : 'PRICE_UP';
        const pct = ((after - before) / before) * 100;
        await createEvent(id, watch.id, type, {
          from: before,
          to: after,
          diff: after - before,
          pct: Number(pct.toFixed(2)),
        });
        stats[after < before ? 'drops' : 'ups'] += 1;
      }

      // Km caindo entre coletas e sinal de anuncio remontado ou erro de digitacao.
      if (previous.km != null && listing.km != null && listing.km < previous.km - 500) {
        await createEvent(id, watch.id, 'KM_CHANGED', { from: previous.km, to: listing.km });
      }
    }

    // Sumiu do resultado = vendido ou removido. E o sinal de preco mais honesto que existe.
    const vanished = await findVanished(watch.id, sourceName, seenIds);
    if (vanished.length) {
      await markInactive(vanished.map((v) => v.id));
      for (const v of vanished) {
        await createEvent(v.id, watch.id, 'DISAPPEARED', { last_price: v.price });
      }
      stats.vanished += vanished.length;
    }

    await logRun({
      source: sourceName,
      watchId: watch.id,
      status: 'OK',
      itemsFound: listings.length,
      durationMs: Date.now() - started,
    });

    log.info(`${watch.slug}/${sourceName}: ${listings.length} anuncios (de ${raw.length} brutos)`);
    return { ok: true, count: listings.length };
  } catch (err) {
    await logRun({
      source: sourceName,
      watchId: watch.id,
      status: 'FAILED',
      httpStatus: err.status ?? null,
      durationMs: Date.now() - started,
      error: err.message,
    });
    log.error(`${watch.slug}/${sourceName} falhou: ${err.message}`, err.hint ? { hint: err.hint } : undefined);
    return { ok: false, error: err.message };
  }
}

export async function runCollection({ only = null } = {}) {
  const watches = await activeWatches();
  if (!watches.length) {
    log.warn('nenhum watch ativo — edite watches.yaml e rode `npm run db:seed`');
    return null;
  }

  const stats = { new: 0, drops: 0, ups: 0, vanished: 0, relisted: 0, failures: 0 };
  const failuresBySource = new Map();

  try {
    for (const watch of watches) {
      const sources = only ? [only] : watch.sources;
      for (const sourceName of sources) {
        // Circuit breaker: fonte que ja falhou N vezes nesta rodada esta bloqueada.
        if ((failuresBySource.get(sourceName) ?? 0) >= config.http.circuitBreaker) {
          log.warn(`pulando ${sourceName} (circuit breaker aberto nesta rodada)`);
          await logRun({ source: sourceName, watchId: watch.id, status: 'SKIPPED' });
          continue;
        }
        const result = await collectOne(watch, sourceName, stats);
        if (!result.ok) {
          stats.failures += 1;
          failuresBySource.set(sourceName, (failuresBySource.get(sourceName) ?? 0) + 1);
        }
      }
    }
  } finally {
    // Se alguma fonte usou o navegador, ele fecha aqui. Sem isso o Chromium
    // fica aberto e o processo do CLI nunca termina. No-op quando nao foi usado.
    await closeBrowser();
  }

  log.info('rodada concluida', stats);
  return stats;
}
