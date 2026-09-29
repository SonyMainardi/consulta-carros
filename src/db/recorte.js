// O RECORTE DE QUEM LE: km, preco, ano, versao, UF e portais escolhidos na
// tela, traduzidos para SQL.
//
// Substituiu src/db/limites.js em 2026-09-16 (ESTADO.md 2-X). A diferenca nao e
// cosmetica: os limites deixaram de ser de uma "busca salva" e passaram a ser
// da pessoa que esta olhando, agora. Chegam na requisicao, viram condicao SQL,
// e nada disso e gravado.
//
// E a UNICA regra de recorte do sistema. Antes existiam duas — uma na coleta
// (motivoDescarte) e outra na leitura — e o ESTADO.md avisava que "as duas
// precisam concordar, senao o painel contradiz a coleta". Esse risco acabou: a
// coleta agora so confere identidade (marca + modelo).
//
// REGRA QUE NAO MUDA: dado desconhecido PASSA. Anuncio sem preco e justamente o
// que a pessoa quer abrir para conferir; some-lo da tela seria esconder o mais
// interessante.
import { tokensVersao } from '../core/marcas.js';

const inteiro = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const UF = /^[A-Z]{2}$/;

/**
 * Le o recorte de uma querystring do painel, descartando o que nao faz sentido.
 * Devolve sempre o mesmo formato, com null no que nao foi pedido.
 */
export function lerRecorte(q = {}) {
  // `ufs` e `portais` (plural) sao do RECORTE da busca — varios de uma vez.
  // Os chips da tabela usam `uf` e `source` (singular, um so) e sao tratados no
  // server.js: os dois convivem, e o chip refina o que o recorte ja deixou
  // entrar.
  const ufs = String(q.ufs ?? '')
    .split(',').map((u) => u.trim().toUpperCase()).filter((u) => UF.test(u));
  const portais = String(q.portais ?? '')
    .split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  return {
    kmMax: inteiro(q.km ?? q.kmMax),
    precoMin: inteiro(q.precoMin),
    precoMax: inteiro(q.preco ?? q.precoMax),
    anoMin: inteiro(q.anoMin),
    anoMax: inteiro(q.anoMax),
    versao: String(q.versao ?? '').trim() || null,
    ufs,
    portais,
  };
}

/**
 * As condicoes SQL do recorte.
 *
 * @param {ReturnType<lerRecorte>} recorte
 * @param {string} l  alias da tabela listings
 * @returns {{ where: string[], params: unknown[] }} para juntar com AND
 */
export function condicoesDoRecorte(recorte, l = 'l') {
  const where = [];
  const params = [];
  const ano = `COALESCE(${l}.year_model, ${l}.year_fab)`;

  if (recorte.kmMax != null) {
    where.push(`(${l}.km IS NULL OR ${l}.km <= ?)`);
    params.push(recorte.kmMax);
  }
  if (recorte.precoMax != null) {
    where.push(`(${l}.price IS NULL OR ${l}.price <= ?)`);
    params.push(recorte.precoMax);
  }
  if (recorte.precoMin != null) {
    where.push(`(${l}.price IS NULL OR ${l}.price >= ?)`);
    params.push(recorte.precoMin);
  }
  if (recorte.anoMin != null) {
    where.push(`(${ano} IS NULL OR ${ano} >= ?)`);
    params.push(recorte.anoMin);
  }
  if (recorte.anoMax != null) {
    where.push(`(${ano} IS NULL OR ${ano} <= ?)`);
    params.push(recorte.anoMax);
  }

  // VERSAO: todas as palavras, inteiras, em qualquer ordem — a mesma regra que
  // valia antes em JS (o Webmotors escreve "VECTRA 2.0 MPFI GT" e o ML "Vectra
  // Gt 2009": exigir sequencia perderia metade dos anuncios).
  //
  // `texto_busca` ja vem normalizado e cercado de espacos, entao '% gt %' casa
  // palavra inteira. Sem isso, LIKE '%gt%' casaria com "GTI" e "Gutierrez".
  //
  // Anuncio sem `texto_busca` NAO passa aqui, ao contrario dos limites
  // numericos: quem pede versao esta filtrando de proposito, e um titulo vazio
  // nao e evidencia de que a versao esta la.
  for (const palavra of tokensVersao(recorte.versao ?? '')) {
    where.push(`${l}.texto_busca LIKE ?`);
    params.push(`% ${palavra} %`);
  }

  if (recorte.ufs?.length) {
    where.push(`(${l}.uf IS NULL OR ${l}.uf IN (${recorte.ufs.map(() => '?').join(',')}))`);
    params.push(...recorte.ufs);
  }
  if (recorte.portais?.length) {
    where.push(`${l}.source IN (${recorte.portais.map(() => '?').join(',')})`);
    params.push(...recorte.portais);
  }

  return { where, params };
}

/** Resumo em uma linha, para o log e para a tela ("ate 100.000 km · ate R$ 80.000"). */
export function descreverRecorte(r) {
  const partes = [];
  if (r.kmMax != null) partes.push(`ate ${r.kmMax.toLocaleString('pt-BR')} km`);
  if (r.precoMin != null) partes.push(`de R$ ${r.precoMin.toLocaleString('pt-BR')}`);
  if (r.precoMax != null) partes.push(`ate R$ ${r.precoMax.toLocaleString('pt-BR')}`);
  if (r.anoMin != null && r.anoMax != null) partes.push(`${r.anoMin}-${r.anoMax}`);
  else if (r.anoMin != null) partes.push(`de ${r.anoMin}`);
  else if (r.anoMax != null) partes.push(`ate ${r.anoMax}`);
  if (r.versao) partes.push(`versao "${r.versao}"`);
  if (r.ufs?.length) partes.push(r.ufs.join('/'));
  return partes.join(' · ') || 'sem recorte';
}
