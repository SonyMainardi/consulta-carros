import { query, one } from '../pool.js';
import { textoBusca } from '../../core/normalize.js';

const j = (v) => (v == null ? null : JSON.stringify(v));
const marcas = (arr) => arr.map(() => '?').join(',');

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
        photos, fingerprint, raw, texto_busca, last_seen, active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),1)
     ON DUPLICATE KEY UPDATE
       url=VALUES(url), title=VALUES(title), brand=VALUES(brand), model=VALUES(model),
       version=VALUES(version), year_fab=VALUES(year_fab), year_model=VALUES(year_model),
       km=VALUES(km), price=VALUES(price), color=VALUES(color), fuel=VALUES(fuel),
       transmission=VALUES(transmission), city=VALUES(city), uf=VALUES(uf),
       seller_type=VALUES(seller_type), seller_name=VALUES(seller_name),
       photos=VALUES(photos), fingerprint=VALUES(fingerprint), raw=VALUES(raw),
       texto_busca=VALUES(texto_busca), last_seen=NOW(), active=1`,
    [
      listing.source, listing.external_id, listing.url, listing.title, listing.brand,
      listing.model, listing.version, listing.year_fab, listing.year_model, listing.km,
      listing.price, listing.color, listing.fuel, listing.transmission, listing.city,
      listing.uf, listing.seller_type, listing.seller_name, j(listing.photos),
      fingerprint, j(listing.raw), textoBusca(listing),
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

/* ---------------------------------------------------------------------------
   VINCULO ANUNCIO x MODELO — o cache (ESTADO.md 2-X, 2026-09-16)

   Antes este vinculo era com a "busca salva" de alguem (listing_watches). Agora
   e com o MODELO do catalogo: "este anuncio apareceu na busca deste carro". Nao
   pertence a usuario nenhum, e por isso serve a todos que pedirem o mesmo carro.

   `motivo_inativo` perdeu o FORA_DO_RECORTE: recorte e de quem le, nao do
   banco. Sobraram SUMIU (a coleta viu a busca inteira e o anuncio nao estava —
   gera evento) e FORA_DA_JANELA (a coleta viu so parte; sai da tela calado).

   `listings.active` continua existindo, derivado: ativo em algum modelo.
--------------------------------------------------------------------------- */

/**
 * Marca o anuncio como visto e ativo neste modelo.
 * @returns {Promise<{ativo: number, motivo_inativo: string|null} | null>}
 *   o vinculo ANTERIOR — null se o anuncio e novo para este modelo.
 */
export async function ativarVinculo(listingId, modeloId) {
  const anterior = await one(
    `SELECT ativo, motivo_inativo FROM listing_modelos WHERE listing_id = ? AND modelo_id = ?`,
    [listingId, modeloId],
  );
  await query(
    `INSERT INTO listing_modelos (listing_id, modelo_id, ativo, ultimo_visto)
     VALUES (?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE ativo = 1, ultimo_visto = NOW(),
                             motivo_inativo = NULL, inativo_desde = NULL`,
    [listingId, modeloId],
  );
  return anterior;
}

/** Vinculos ativos deste modelo+fonte cujo anuncio NAO esta entre os vistos. */
export async function ativosNaoVistos(modeloId, source, externalIdsVistos) {
  const filtro = externalIdsVistos.length ? `AND l.external_id NOT IN (${marcas(externalIdsVistos)})` : '';
  return query(
    `SELECT l.id, l.external_id, l.price
       FROM listing_modelos lm
       JOIN listings l ON l.id = lm.listing_id
      WHERE lm.modelo_id = ? AND lm.ativo = 1 AND l.source = ? ${filtro}`,
    [modeloId, source, ...externalIdsVistos],
  );
}

export async function inativarVinculos(modeloId, listingIds, motivo) {
  if (!listingIds.length) return;
  await query(
    `UPDATE listing_modelos
        SET ativo = 0, motivo_inativo = ?, inativo_desde = NOW()
      WHERE modelo_id = ? AND listing_id IN (${marcas(listingIds)})`,
    [motivo, modeloId, ...listingIds],
  );
}

/** `listings.active` = ativo em pelo menos um modelo. */
export async function recalcularAtivo(listingIds) {
  if (!listingIds.length) return;
  await query(
    `UPDATE listings l
        SET l.active = (SELECT COUNT(*) > 0 FROM listing_modelos lm
                         WHERE lm.listing_id = l.id AND lm.ativo = 1)
      WHERE l.id IN (${marcas(listingIds)})`,
    listingIds,
  );
}

export async function setFipe(listingId, { code, price, ratio }) {
  await query(`UPDATE listings SET fipe_code = ?, fipe_price = ?, fipe_ratio = ? WHERE id = ?`, [
    code, price, ratio, listingId,
  ]);
}
