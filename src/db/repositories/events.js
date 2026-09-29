// O feed de mudancas: novo, baixou preco, subiu, sumiu, reanunciado.
//
// DESDE 2026-09-16 (ESTADO.md 2-X) o evento e do MODELO, nao da busca de
// ninguem: "baixou preco" e fato do anuncio, e serve a todos que pedirem aquele
// carro. Cada pessoa ve os eventos do modelo que pediu, passados pelo RECORTE
// dela (km, preco, ano...) na leitura — o mesmo recorte da tabela de anuncios.
//
// Eventos so sao GRAVADOS para modelo acompanhado (pipeline.js, regra 5): sem
// coleta repetida eles nao significam nada.
import { query } from '../pool.js';
import { condicoesDoRecorte } from '../recorte.js';

export async function createEvent(listingId, modeloId, type, payload) {
  await query(`INSERT INTO events (listing_id, modelo_id, type, payload) VALUES (?,?,?,?)`, [
    listingId,
    modeloId ?? null,
    type,
    payload == null ? null : JSON.stringify(payload),
  ]);
}

// Eventos que sao do ANUNCIO, nao do modelo: preco e km mudam uma vez so, mesmo
// que dois modelos vejam o mesmo carro (raro, mas possivel). O pipeline grava
// um evento desses com o modelo que percebeu primeiro, e a leitura o mostra em
// todo modelo que tem o anuncio.
const DO_ANUNCIO = `'PRICE_DROP','PRICE_UP','KM_CHANGED'`;

/**
 * JOIN + WHERE dos eventos de um modelo — ou de todos, com `modelo` nulo.
 *
 * O recorte vale aqui como na tabela: nao adianta esconder o Evolution de
 * R$ 549.900 da lista e anunciar a baixa de preco dele logo acima, no mesmo
 * painel (o achado de 2-L).
 */
export function filtroEventos({ modelo = null, recorte = null } = {}) {
  const r = recorte ? condicoesDoRecorte(recorte, 'l') : { where: [], params: [] };
  if (!modelo) return { where: r.where, params: r.params };
  return {
    where: [
      `(e.modelo_id = ? OR (e.type IN (${DO_ANUNCIO})
         AND EXISTS (SELECT 1 FROM listing_modelos x
                      WHERE x.listing_id = e.listing_id AND x.modelo_id = ?)))`,
      ...r.where,
    ],
    params: [Number(modelo), Number(modelo), ...r.params],
  };
}

export async function pendingNotifications(limit = 50) {
  return query(
    `SELECT e.id, e.type, e.payload, e.created_at,
            l.title, l.price, l.url, l.source, l.km, l.year_model, l.city, l.uf, l.fipe_ratio,
            CONCAT(ma.nome, ' ', mo.nome) AS carro
       FROM events e
       JOIN listings l ON l.id = e.listing_id
       LEFT JOIN modelos mo ON mo.id = e.modelo_id
       LEFT JOIN marcas  ma ON ma.id = mo.marca_id
      WHERE e.notified = 0
      ORDER BY e.created_at ASC
      LIMIT ${Number(limit)}`,
  );
}

export async function markNotified(ids) {
  if (!ids.length) return;
  await query(`UPDATE events SET notified = 1 WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
}

export async function recentEvents({
  since = null, type = null, limit = 100, modelo = null, recorte = null,
} = {}) {
  const f = filtroEventos({ modelo, recorte });
  const where = [...f.where];
  const params = [...f.params];
  if (since) { where.push('e.created_at >= ?'); params.push(since); }
  if (type) { where.push('e.type = ?'); params.push(type); }
  return query(
    `SELECT e.id, e.type, e.payload, e.created_at, e.listing_id,
            l.title, l.price, l.url, l.source, l.km, l.year_model,
            l.city, l.uf, l.fipe_ratio, l.photos,
            CONCAT(ma.nome, ' ', mo.nome) AS carro
       FROM events e
       JOIN listings l ON l.id = e.listing_id
       LEFT JOIN modelos mo ON mo.id = e.modelo_id
       LEFT JOIN marcas  ma ON ma.id = mo.marca_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY e.created_at DESC
      LIMIT ${Number(limit)}`,
    params,
  );
}
