// O catalogo fixo: marcas, modelos e o endereco de cada combinacao em cada
// portal. Substituiu as "buscas salvas" em 2026-09-16 (ESTADO.md 2-X).
//
// A peca central e o objeto CARRO, que e o que o pipeline e os adapters
// recebem no lugar do antigo `watch`:
//
//   { id, slug, name, brand, model, apelidos, params, sources }
//
// `brand`, `model` e `params` tem os MESMOS nomes de antes de proposito: os
// adapters leem exatamente esses campos (src/adapters/base.js), e trocar o
// catalogo por baixo deles nao exigiu mudar um adapter sequer. Adapter continua
// sendo peca descartavel.
//
// O que o CARRO nao tem mais: km, preco, ano e versao. Esses sao recorte de
// quem le, escolhidos na hora da busca, e nunca entram na coleta.
import { query, one } from '../pool.js';
import { PORTAIS } from '../../core/marcas.js';

const jsonOu = (v, padrao) => {
  if (v == null) return padrao;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return padrao; }
};

/** Marcas que tem ao menos um modelo ativo — o select nao mostra marca vazia. */
export function listarMarcas() {
  return query(`
    SELECT m.id, m.nome, m.slug, COUNT(mo.id) modelos
      FROM marcas m
      JOIN modelos mo ON mo.marca_id = m.id AND mo.ativo = 1
     WHERE m.ativa = 1
     GROUP BY m.id, m.nome, m.slug
     ORDER BY m.nome`);
}

export function listarModelos(marcaId) {
  return query(`
    SELECT id, nome, slug, fipe_versoes, acompanhado
      FROM modelos
     WHERE marca_id = ? AND ativo = 1
     ORDER BY nome`, [Number(marcaId)]);
}

const SELECT_CARRO = `
  SELECT mo.id, mo.nome AS model, mo.slug AS modelo_slug, mo.acompanhado,
         ma.id AS marca_id, ma.nome AS brand, ma.slug AS marca_slug, ma.apelidos
    FROM modelos mo
    JOIN marcas ma ON ma.id = mo.marca_id`;

async function montarCarro(linha, sources = null) {
  if (!linha) return null;
  const enderecos = await query(
    'SELECT portal, marca_slug, modelo_slug, estado FROM enderecos WHERE modelo_id = ?', [linha.id],
  );
  const params = Object.fromEntries(
    enderecos.map((e) => [e.portal, { marca: e.marca_slug, modelo: e.modelo_slug }]),
  );
  return {
    id: linha.id,
    slug: `${linha.marca_slug}-${linha.modelo_slug}`,
    name: `${linha.brand} ${linha.model}`,
    brand: linha.brand,
    model: linha.model,
    apelidos: jsonOu(linha.apelidos, [linha.brand]),
    acompanhado: Boolean(linha.acompanhado),
    params,
    // Portais desta coleta: os pedidos, ou todos os que tem endereco.
    sources: (sources?.length ? sources : PORTAIS).filter((p) => params[p]),
    estados: Object.fromEntries(enderecos.map((e) => [e.portal, e.estado])),
  };
}

export async function carroPorId(modeloId, sources = null) {
  return montarCarro(await one(`${SELECT_CARRO} WHERE mo.id = ?`, [Number(modeloId)]), sources);
}

export async function carroPorSlugs(marcaSlug, modeloSlug, sources = null) {
  return montarCarro(
    await one(`${SELECT_CARRO} WHERE ma.slug = ? AND mo.slug = ?`, [String(marcaSlug), String(modeloSlug)]),
    sources,
  );
}

/**
 * O endereco de um (modelo, portal) aprendeu algo com uma coleta real.
 *
 * E o que faz o catalogo se corrigir sozinho: a coleta confere se a pagina e
 * mesmo do carro pedido (conferirIdentidade), e o resultado volta para ca. Um
 * endereco QUEBRADO aparece na tela de manutencao para conserto — e o conserto
 * vale para todo mundo que pedir aquele carro.
 *
 * @param {'CONFIRMADO'|'QUEBRADO'} estado
 */
export function marcarEndereco(modeloId, portal, estado, observacao = null) {
  return query(
    `UPDATE enderecos
        SET estado = ?, conferido_em = CURRENT_TIMESTAMP, observacao = ?
      WHERE modelo_id = ? AND portal = ?`,
    [estado, observacao ? String(observacao).slice(0, 255) : null, Number(modeloId), String(portal)],
  );
}

/** Correcao manual do endereco. Volta para PADRAO: a proxima coleta reconfirma. */
export async function corrigirEndereco(modeloId, portal, { marca, modelo }) {
  await query(
    `UPDATE enderecos
        SET marca_slug = ?, modelo_slug = ?, estado = 'PADRAO',
            conferido_em = NULL, observacao = NULL
      WHERE modelo_id = ? AND portal = ?`,
    [String(marca), String(modelo), Number(modeloId), String(portal)],
  );
  return one('SELECT * FROM enderecos WHERE modelo_id = ? AND portal = ?', [Number(modeloId), String(portal)]);
}

export function enderecosQuebrados() {
  return query(`
    SELECT e.modelo_id, e.portal, e.marca_slug, e.modelo_slug, e.observacao, e.conferido_em,
           ma.nome marca, mo.nome modelo
      FROM enderecos e
      JOIN modelos mo ON mo.id = e.modelo_id
      JOIN marcas  ma ON ma.id = mo.marca_id
     WHERE e.estado = 'QUEBRADO'
     ORDER BY e.conferido_em DESC`);
}

/* ---------------------------------------------------------------------------
   Monitoramento por cima do cache

   Eventos (novo, baixou preco, sumiu) exigem coleta REPETIDA: sem duas rodadas
   nao ha o que comparar. Numa busca ao vivo isso nao acontece sozinho, entao o
   modelo precisa ser marcado como acompanhado. Nao e a busca de ninguem — e o
   modelo que esta sendo acompanhado, e todo mundo que pedir aquele carro ganha
   o historico junto.
--------------------------------------------------------------------------- */

export function modelosAcompanhados() {
  return query(`${SELECT_CARRO} WHERE mo.acompanhado = 1 ORDER BY ma.nome, mo.nome`)
    .then((linhas) => Promise.all(linhas.map((l) => montarCarro(l))));
}

export async function definirAcompanhamento(modeloId, acompanhar) {
  await query(
    `UPDATE modelos
        SET acompanhado = ?,
            acompanhado_desde = IF(? = 1, COALESCE(acompanhado_desde, CURRENT_TIMESTAMP), NULL)
      WHERE id = ?`,
    [acompanhar ? 1 : 0, acompanhar ? 1 : 0, Number(modeloId)],
  );
  return carroPorId(modeloId);
}

/* ---------------------------------------------------------------------------
   O relogio do cache
--------------------------------------------------------------------------- */

/**
 * Quando cada portal foi coletado pela ultima vez COM SUCESSO, para este
 * modelo. E o que decide se a busca responde do banco na hora ou se precisa
 * coletar. `fetch_runs` ja era a tabela de diagnostico; agora e tambem o
 * relogio do cache.
 *
 * @returns {Promise<Record<string, {quando: Date, itens: number, cobertura: string}>>}
 */
export async function frescorDoModelo(modeloId) {
  const linhas = await query(`
    SELECT f.source, f.started_at, f.items_found, f.cobertura, f.total_busca
      FROM fetch_runs f
      JOIN (SELECT source, MAX(started_at) ultima
              FROM fetch_runs
             WHERE modelo_id = ? AND status IN ('OK','PARTIAL')
             GROUP BY source) u
        ON u.source = f.source AND u.ultima = f.started_at
     WHERE f.modelo_id = ?`, [Number(modeloId), Number(modeloId)]);
  return Object.fromEntries(linhas.map((l) => [l.source, {
    quando: l.started_at,
    itens: l.items_found,
    cobertura: l.cobertura,
    totalPortal: l.total_busca,
  }]));
}
