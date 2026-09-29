// FAVORITOS — os anuncios que uma pessoa guardou (ESTADO.md 2-AA, 2026-09-28).
//
// E a unica coisa PESSOAL no banco. Todo o resto e cache do mundo: um anuncio
// de Lancer e o mesmo para quem quer que pergunte. Um favorito e de alguem, e
// por isso toda funcao aqui recebe `dono` — nenhuma consulta sai sem ele.
//
// O anuncio e apontado por (source, external_id), a mesma chave natural do
// upsert de listings, e nao por listings.id: sem FK, o favorito sobrevive ao
// cache ser recriado e volta a mostrar o preco de hoje quando o anuncio
// reaparece numa coleta.
import { query, one } from '../pool.js';
import { kmBand, transmissionGroup } from '../../core/normalize.js';

/**
 * A situacao de um favorito, dita com a mesma cautela do resto do sistema:
 *   NO_AR          ativo em algum modelo na ultima coleta;
 *   SAIU           uma coleta que leu a busca INTEIRA nao o encontrou — o
 *                  unico caso em que da para dizer "saiu do ar";
 *   NAO_VISTO      a ultima coleta leu so parte da busca e ele nao estava
 *                  nela. Pode ter so mudado de pagina (FORA_DA_JANELA);
 *   FORA_DO_CACHE  o anuncio nao esta mais no banco. Sobra a foto.
 */
function situacaoDe(r) {
  if (r.listing_id == null) return 'FORA_DO_CACHE';
  if (Number(r.ativo)) return 'NO_AR';
  return Number(r.sumiu) ? 'SAIU' : 'NAO_VISTO';
}

/** Os favoritos de `dono`, do mais recente para o mais antigo. */
export async function listarFavoritos(dono) {
  const rows = await query(
    `SELECT f.source, f.external_id, f.modelo_id, f.criado_em,
            f.url AS f_url, f.title AS f_title, f.price AS f_price, f.km AS f_km,
            f.year_model AS f_year_model, f.city AS f_city, f.uf AS f_uf,
            l.id AS listing_id, l.url, l.title, l.price, l.km, l.year_model,
            l.transmission, l.city, l.uf, l.fipe_ratio, l.last_seen,
            (SELECT MAX(lm.ativo) FROM listing_modelos lm WHERE lm.listing_id = l.id) AS ativo,
            (SELECT MAX(lm.motivo_inativo = 'SUMIU') FROM listing_modelos lm WHERE lm.listing_id = l.id) AS sumiu,
            CONCAT(ma.nome, ' ', mo.nome) AS carro
       FROM favoritos f
       LEFT JOIN listings l ON l.source = f.source AND l.external_id = f.external_id
       LEFT JOIN modelos mo ON mo.id = f.modelo_id
       LEFT JOIN marcas  ma ON ma.id = mo.marca_id
      WHERE f.dono = ?
      ORDER BY f.criado_em DESC, f.id DESC`,
    [dono],
  );

  return rows.map((r) => {
    // Com o anuncio no cache vale o dado de hoje; fora dele, a foto.
    const hoje = r.listing_id != null;
    const km = hoje ? r.km : r.f_km;
    return {
      chave: `${r.source}:${r.external_id}`,
      source: r.source,
      external_id: r.external_id,
      situacao: situacaoDe(r),
      url: hoje ? r.url : r.f_url,
      title: hoje ? r.title : r.f_title,
      price: hoje ? r.price : r.f_price,
      km,
      year_model: hoje ? r.year_model : r.f_year_model,
      city: hoje ? r.city : r.f_city,
      uf: hoje ? r.uf : r.f_uf,
      fipe_ratio: r.fipe_ratio,
      // Derivados na leitura, como em /api/listings — nunca gravados.
      km_band: kmBand(km),
      cambio: transmissionGroup(r.transmission),
      // "visto" e a ultima coleta que o encontrou. E o que impede o painel de
      // mostrar preco de semanas atras com cara de preco de hoje.
      visto_em: r.last_seen,
      favoritado_em: r.criado_em,
      preco_favoritado: r.f_price,
      carro: r.modelo_id ? { id: r.modelo_id, nome: r.carro } : null,
    };
  });
}

/**
 * Guarda o anuncio nos favoritos de `dono`, com a foto de agora.
 *
 * Idempotente, e sem trocar a foto: favoritar de novo o que ja esta la mantem o
 * preco e a data da primeira vez — "baixou desde que guardei" mede dali.
 *
 * So se favorita o que esta no cache: e dele que sai a foto, e e o que garante
 * que (source, external_id) aponta para um anuncio que existiu.
 *
 * @param {number|null} modeloDaTela  o carro da busca em que a pessoa estava
 * @returns {Promise<boolean>} false se o anuncio nao esta no cache
 */
export async function favoritar(dono, source, externalId, modeloDaTela = null) {
  const l = await one(
    `SELECT id, url, title, price, km, year_model, city, uf
       FROM listings WHERE source = ? AND external_id = ?`,
    [source, externalId],
  );
  if (!l) return false;

  // O carro do favorito: o da tela, se o anuncio de fato esta nele; senao o
  // ultimo em que ele foi visto.
  const vinculo = await one(
    `SELECT modelo_id FROM listing_modelos WHERE listing_id = ?
      ORDER BY modelo_id = ? DESC, ultimo_visto DESC LIMIT 1`,
    [l.id, modeloDaTela ?? 0],
  );

  await query(
    `INSERT INTO favoritos
       (dono, source, external_id, modelo_id, url, title, price, km, year_model, city, uf)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      dono, source, externalId, vinculo?.modelo_id ?? null,
      l.url, l.title, l.price, l.km, l.year_model, l.city, l.uf,
    ],
  );
  return true;
}

export async function desfavoritar(dono, source, externalId) {
  await query(
    `DELETE FROM favoritos WHERE dono = ? AND source = ? AND external_id = ?`,
    [dono, source, externalId],
  );
}
