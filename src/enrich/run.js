import { query } from '../db/pool.js';
import { setFipe } from '../db/repositories/listings.js';
import { lookupFipe } from './fipe.js';
import { createLogger } from '../logger.js';

const log = createLogger('enrich');

/** Preenche FIPE dos anuncios ativos que ainda nao tem valor. */
export async function enrichPendingFipe(limit = 50) {
  const rows = await query(
    `SELECT id, brand, model, version, year_model, price
       FROM listings
      WHERE active = 1 AND fipe_price IS NULL AND price IS NOT NULL
        AND brand IS NOT NULL AND model IS NOT NULL AND year_model IS NOT NULL
      ORDER BY first_seen DESC
      LIMIT ${Number(limit)}`,
  );

  let hits = 0;
  for (const row of rows) {
    const fipe = await lookupFipe({
      brand: row.brand,
      model: row.model,
      version: row.version,
      year: row.year_model,
    });
    if (!fipe) continue;
    const ratio = Number((Number(row.price) / fipe.price).toFixed(3));
    await setFipe(row.id, { code: fipe.code, price: fipe.price, ratio });
    hits += 1;
  }

  if (rows.length) log.info(`FIPE: ${hits}/${rows.length} resolvidos`);
  return hits;
}
