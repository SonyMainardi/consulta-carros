import { query, one } from '../pool.js';

const j = (v) => (v == null ? null : JSON.stringify(v));

/**
 * Upsert por (source, external_id). Devolve o estado ANTERIOR do anuncio
 * (ou null se e novo) — o diff engine precisa disso para gerar eventos.
 */
export async function upsertListing(listing, fingerprint) {
  const previous = await one(
    `SELECT id, price, km, active, first_seen FROM listings WHERE source = ? AND external_id = ?`,
    [listing.source, listing.external_id],
  );

  await query(
    `INSERT INTO listings
       (source, external_id, url, title, brand, model, version, year_fab, year_model,
        km, price, color, fuel, transmission, city, uf, seller_type, seller_name,
        photos, fingerprint, raw, last_seen, active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),1)
     ON DUPLICATE KEY UPDATE
       url=VALUES(url), title=VALUES(title), brand=VALUES(brand), model=VALUES(model),
       version=VALUES(version), year_fab=VALUES(year_fab), year_model=VALUES(year_model),
       km=VALUES(km), price=VALUES(price), color=VALUES(color), fuel=VALUES(fuel),
       transmission=VALUES(transmission), city=VALUES(city), uf=VALUES(uf),
       seller_type=VALUES(seller_type), seller_name=VALUES(seller_name),
       photos=VALUES(photos), fingerprint=VALUES(fingerprint), raw=VALUES(raw),
       last_seen=NOW(), active=1`,
    [
      listing.source, listing.external_id, listing.url, listing.title, listing.brand,
      listing.model, listing.version, listing.year_fab, listing.year_model, listing.km,
      listing.price, listing.color, listing.fuel, listing.transmission, listing.city,
      listing.uf, listing.seller_type, listing.seller_name, j(listing.photos),
      fingerprint, j(listing.raw),
    ],
  );

  const row = await one(`SELECT id FROM listings WHERE source = ? AND external_id = ?`, [
    listing.source,
    listing.external_id,
  ]);

  return { id: row.id, previous };
}

export async function recordPrice(listingId, price, km) {
  if (price == null) return;
  await query(`INSERT INTO price_history (listing_id, price, km) VALUES (?,?,?)`, [listingId, price, km]);
}

export async function linkWatch(listingId, watchId) {
  await query(
    `INSERT IGNORE INTO listing_watches (listing_id, watch_id) VALUES (?,?)`,
    [listingId, watchId],
  );
}

/** Anuncios que estavam ativos nesta watch+fonte e nao apareceram na rodada atual. */
export async function findVanished(watchId, source, seenIds) {
  const placeholders = seenIds.length ? seenIds.map(() => '?').join(',') : null;
  const sql = `
    SELECT l.id, l.external_id, l.title, l.price, l.url
      FROM listings l
      JOIN listing_watches lw ON lw.listing_id = l.id
     WHERE lw.watch_id = ? AND l.source = ? AND l.active = 1
       ${placeholders ? `AND l.external_id NOT IN (${placeholders})` : ''}`;
  return query(sql, placeholders ? [watchId, source, ...seenIds] : [watchId, source]);
}

export async function markInactive(ids) {
  if (!ids.length) return;
  await query(
    `UPDATE listings SET active = 0 WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
}

export async function setFipe(listingId, { code, price, ratio }) {
  await query(`UPDATE listings SET fipe_code = ?, fipe_price = ?, fipe_ratio = ? WHERE id = ?`, [
    code, price, ratio, listingId,
  ]);
}
