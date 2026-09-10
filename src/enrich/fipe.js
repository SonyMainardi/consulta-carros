// Enriquecimento com a tabela FIPE (API publica gratuita da parallelum).
// E o que transforma o painel: em vez de listar precos, ele passa a mostrar
// "-12% FIPE", que e a coluna pela qual voce realmente vai ordenar.
//
// A API exige 4 chamadas encadeadas (marca > modelo > ano > valor), entao tudo
// e cacheado em disco. Sem cache isso viraria centenas de requests por rodada.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { getJson } from '../http/client.js';
import { norm, parsePrice } from '../core/normalize.js';
import { createLogger } from '../logger.js';

const log = createLogger('fipe');
const API = 'https://parallelum.com.br/fipe/api/v1/carros';

const DIR = resolve(process.cwd(), 'data');
mkdirSync(DIR, { recursive: true });
const CACHE_FILE = resolve(DIR, 'fipe-cache.json');

const cache = existsSync(CACHE_FILE)
  ? JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
  : { brands: null, models: {}, values: {} };

const persist = () => {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch { /* cache e best-effort */ }
};

// A FIPE tem rate limit proprio e e um servico gratuito de terceiros:
// batemos devagar de proposito.
const fipeOpts = { minIntervalMs: 1500, jitterMs: 500 };

async function brands() {
  if (cache.brands) return cache.brands;
  const res = await getJson(`${API}/marcas`, fipeOpts);
  cache.brands = res.data ?? [];
  persist();
  return cache.brands;
}

async function modelsOf(brandCode) {
  if (cache.models[brandCode]) return cache.models[brandCode];
  const res = await getJson(`${API}/marcas/${brandCode}/modelos`, fipeOpts);
  cache.models[brandCode] = res.data?.modelos ?? [];
  persist();
  return cache.models[brandCode];
}

/** Melhor candidato por sobreposicao de palavras — a FIPE nomeia versoes de forma muito verbosa. */
function bestMatch(items, target, key = 'nome') {
  const wanted = norm(target).split(' ').filter((w) => w.length > 1);
  if (!wanted.length) return null;
  let best = null;
  let bestScore = 0;
  for (const item of items) {
    const hay = norm(item[key]);
    let score = 0;
    for (const w of wanted) if (hay.includes(w)) score += w.length;
    // Penaliza nomes muito longos para nao casar com a versao mais exotica.
    score -= hay.length * 0.02;
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore > 0 ? best : null;
}

/**
 * @returns {Promise<{code: string, price: number} | null>}
 */
export async function lookupFipe({ brand, model, version, year }) {
  if (!brand || !model || !year) return null;

  const cacheKey = norm([brand, model, version, year].join('|'));
  if (cache.values[cacheKey] !== undefined) return cache.values[cacheKey];

  try {
    const brandItem = bestMatch(await brands(), brand);
    if (!brandItem) return null;

    const modelList = await modelsOf(brandItem.codigo);
    const modelItem = bestMatch(modelList, [model, version].filter(Boolean).join(' '));
    if (!modelItem) return null;

    const yearsRes = await getJson(
      `${API}/marcas/${brandItem.codigo}/modelos/${modelItem.codigo}/anos`,
      fipeOpts,
    );
    const yearItem = (yearsRes.data ?? []).find((y) => String(y.codigo).startsWith(String(year)));
    if (!yearItem) return null;

    const valueRes = await getJson(
      `${API}/marcas/${brandItem.codigo}/modelos/${modelItem.codigo}/anos/${yearItem.codigo}`,
      fipeOpts,
    );
    const price = parsePrice(valueRes.data?.Valor);
    if (!price) return null;

    const result = { code: valueRes.data?.CodigoFipe ?? null, price };
    cache.values[cacheKey] = result;
    persist();
    return result;
  } catch (err) {
    log.warn(`lookup falhou para ${brand} ${model} ${year}: ${err.message}`);
    cache.values[cacheKey] = null; // nao insiste no mesmo miss a cada rodada
    persist();
    return null;
  }
}
