import { query } from '../pool.js';
import { tetosDoPainel } from '../../core/panelLimits.js';

export async function createEvent(listingId, watchId, type, payload) {
  await query(`INSERT INTO events (listing_id, watch_id, type, payload) VALUES (?,?,?,?)`, [
    listingId,
    watchId ?? null,
    type,
    payload == null ? null : JSON.stringify(payload),
  ]);
}

export async function pendingNotifications(limit = 50) {
  // Mesmo teto do painel: quem nao quer VER carro acima do teto tambem nao quer
  // ser acordado por ele no Telegram.
  const teto = tetosDoPainel('l');
  return query(
    `SELECT e.id, e.type, e.payload, e.created_at,
            l.title, l.price, l.url, l.source, l.km, l.year_model, l.city, l.uf, l.fipe_ratio,
            w.name AS watch_name
       FROM events e
       JOIN listings l ON l.id = e.listing_id
       LEFT JOIN watches w ON w.id = e.watch_id
      WHERE e.notified = 0 ${teto.where.length ? 'AND ' + teto.where.join(' AND ') : ''}
      ORDER BY e.created_at ASC
      LIMIT ${Number(limit)}`,
    teto.params,
  );
}

export async function markNotified(ids) {
  if (!ids.length) return;
  await query(`UPDATE events SET notified = 1 WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
}

export async function recentEvents({ since = null, type = null, limit = 100 } = {}) {
  // O "O que mudou" obedece aos mesmos tetos da tabela: nao adianta esconder o
  // Evolution de R$ 549.900 da lista e anunciar a baixa de preco dele logo
  // acima, no mesmo painel.
  const teto = tetosDoPainel('l');
  const where = [...teto.where];
  const params = [...teto.params];
  if (since) { where.push('e.created_at >= ?'); params.push(since); }
  if (type) { where.push('e.type = ?'); params.push(type); }
  return query(
    `SELECT e.id, e.type, e.payload, e.created_at, e.listing_id,
            l.title, l.price, l.url, l.source, l.km, l.year_model,
            l.city, l.uf, l.fipe_ratio, l.photos,
            w.name AS watch_name
       FROM events e
       JOIN listings l ON l.id = e.listing_id
       LEFT JOIN watches w ON w.id = e.watch_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY e.created_at DESC
      LIMIT ${Number(limit)}`,
    params,
  );
}
