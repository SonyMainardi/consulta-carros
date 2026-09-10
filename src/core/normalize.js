// Converte o que cada adapter devolve para o formato unico da tabela `listings`.
// Toda sujeira de parsing (preco em string, km com ponto, ano "2019/2020")
// morre aqui, nunca vaza para o resto do sistema.

const ACCENTS = /[̀-ͯ]/g;

export const stripAccents = (s) =>
  String(s ?? '').normalize('NFD').replace(ACCENTS, '');

export const norm = (s) => stripAccents(s).toLowerCase().trim().replace(/\s+/g, ' ');

/** "R$ 89.900,00" | 89900 | "89900.00" -> 89900 */
export function parsePrice(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const digits = String(value).replace(/[^\d,.]/g, '');
  if (!digits) return null;
  // Formato BR: ponto e milhar, virgula e decimal.
  const cleaned = digits.includes(',')
    ? digits.replace(/\./g, '').replace(',', '.')
    : digits.replace(/\.(?=\d{3}\b)/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "45.000 km" | "45000" | 45000 -> 45000 */
export function parseKm(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const digits = String(value).replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) && n >= 0 && n < 2_000_000 ? n : null;
}

/**
 * Corrige o km que o anunciante digitou em MILHARES.
 *
 * Dois casos reais no banco em 2026-09-10: um Lancer 2015 com "115 km" e um
 * 2016 com "109 km". Ninguem roda 109 km num carro de dez anos — o anunciante
 * quis dizer 109.000 e cortou os zeros. Sem isto, esses dois apareciam no
 * painel como os carros de menor quilometragem da lista, no topo de "menor km",
 * que e o oposto da verdade.
 *
 * A regra tem uma trava de idade de proposito: um carro do ano PODE ter 109 km
 * de verdade, e multiplicar seria estragar o dado bom. So corrigimos quando o
 * carro tem 2 anos ou mais.
 *
 * O valor cru continua em `listings.raw`, entao a correcao e reversivel.
 */
const KM_SUSPEITO = 1000;
const IDADE_MINIMA_PARA_CORRIGIR = 2;
// Teto de plausibilidade do RESULTADO. Sem ele, "800" viraria 800.000 km, que e
// tao implausivel quanto o original — e quando a correcao nao e claramente
// certa, o certo e nao mexer: 800 tanto pode ser 8.000 quanto 80.000.
const KM_MAXIMO_PLAUSIVEL = 400000;

export function corrigirKm(km, anoModelo, hoje = new Date()) {
  if (km == null || km <= 0 || km >= KM_SUSPEITO) return km;
  if (!anoModelo) return km; // sem ano nao da para julgar: nao mexe

  const idade = hoje.getFullYear() - Number(anoModelo);
  if (idade < IDADE_MINIMA_PARA_CORRIGIR) return km;

  const corrigido = km * 1000;
  return corrigido <= KM_MAXIMO_PLAUSIVEL ? corrigido : km;
}

/**
 * Aceita "2019", "2019/2020", 2019, { year: 2019 }.
 * Devolve { fab, model } — o ano-modelo e o que interessa para filtro.
 */
export function parseYears(value) {
  if (value == null) return { fab: null, model: null };
  const text = String(value);
  const found = text.match(/\b(19|20)\d{2}\b/g);
  if (!found || found.length === 0) return { fab: null, model: null };
  const nums = found.map((n) => Number.parseInt(n, 10)).filter((n) => n >= 1950 && n <= 2100);
  if (nums.length === 0) return { fab: null, model: null };
  if (nums.length === 1) return { fab: nums[0], model: nums[0] };
  return { fab: Math.min(nums[0], nums[1]), model: Math.max(nums[0], nums[1]) };
}

export function parseUf(value) {
  if (!value) return null;
  const upper = stripAccents(value).toUpperCase();
  const direct = upper.match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/);
  return direct ? direct[1] : null;
}

export function parseSellerType(value) {
  const n = norm(value);
  if (!n) return 'UNKNOWN';
  if (/(loja|revenda|concession|dealer|pj|empresa|store)/.test(n)) return 'PJ';
  if (/(particular|pessoa fisica|pf|owner)/.test(n)) return 'PF';
  return 'UNKNOWN';
}

/**
 * Monta o registro final. `raw` guarda o payload original do adapter:
 * quando uma fonte muda o contrato, e aqui que voce descobre o que quebrou.
 */
export function toListing(source, input) {
  const years = input.yearFab || input.yearModel
    ? { fab: input.yearFab ?? null, model: input.yearModel ?? input.yearFab ?? null }
    : parseYears(input.year ?? input.title);

  return {
    source,
    external_id: String(input.externalId),
    url: input.url,
    title: (input.title ?? '').slice(0, 320),
    brand: input.brand ? String(input.brand).slice(0, 64) : null,
    model: input.model ? String(input.model).slice(0, 96) : null,
    version: input.version ? String(input.version).slice(0, 160) : null,
    year_fab: years.fab,
    year_model: years.model,
    // Corrigido na ENTRADA, nao na leitura: km errado envenena o filtro de
    // faixa, a ordenacao e o proprio matchesWatch, que sao coisas diferentes
    // do painel. Ver corrigirKm() acima.
    km: corrigirKm(parseKm(input.km), years.model),
    price: parsePrice(input.price),
    color: input.color ? String(input.color).slice(0, 48) : null,
    fuel: input.fuel ? String(input.fuel).slice(0, 32) : null,
    transmission: input.transmission ? String(input.transmission).slice(0, 32) : null,
    city: input.city ? String(input.city).slice(0, 96) : null,
    uf: parseUf(input.uf ?? input.city ?? input.location),
    seller_type: parseSellerType(input.sellerType),
    seller_name: input.sellerName ? String(input.sellerName).slice(0, 160) : null,
    photos: Array.isArray(input.photos) ? input.photos.slice(0, 12) : [],
    // Algumas fontes ja entregam a comparacao com a FIPE (o Webmotors manda
    // FipePercent). Quando vem, evita 4 chamadas na API da FIPE por anuncio.
    fipe_ratio: Number.isFinite(input.fipeRatio) ? input.fipeRatio : null,
    raw: input.raw ?? null,
  };
}

/**
 * Faixas de quilometragem usadas para classificar os anuncios no painel.
 * Derivadas do km na leitura, nunca gravadas — assim nao ficam defasadas
 * quando o anunciante atualiza o odometro.
 */
export const KM_BANDS = [
  { id: 'ate-50k', label: 'ate 50 mil', max: 50000 },
  { id: '50k-70k', label: '50 a 70 mil', max: 70000 },
  { id: '70k-100k', label: '70 a 100 mil', max: 100000 },
  { id: 'acima-100k', label: 'acima de 100 mil', max: Infinity },
];

export function kmBand(km) {
  if (km == null) return null;
  return KM_BANDS.find((b) => km <= b.max)?.id ?? 'acima-100k';
}

/**
 * Grupos de cambio usados nos chips do painel.
 *
 * Mesma decisao das faixas de km: derivado na leitura, NUNCA gravado. Cada fonte
 * escreve o cambio do seu jeito ("Automatica", "Automatizada DCT",
 * "Semi-automatica") e esse texto vem cru para `listings.transmission`; quem
 * agrupa e esta tabela. Se o Webmotors mudar o rotulo amanha, muda-se aqui e
 * nada precisa ser recoletado.
 *
 * `match` e `except` sao trechos SEM ACENTO e em minusculas, comparados contra
 * norm(valor). Sao tambem a origem do recorte em SQL (ver cambioWhere() no
 * server.js), para a regra existir num lugar so.
 *
 * Os grupos sao mutuamente exclusivos de proposito — cada anuncio cai em
 * exatamente um, entao a soma dos chips fecha com o total.
 */
export const TRANSMISSIONS = [
  { id: 'manual', label: 'manual', match: ['manual'], except: ['semi', 'automatizad'] },
  { id: 'automatico', label: 'automatico', match: ['autom'], except: ['automatizad', 'semi', 'cvt'] },
  { id: 'cvt', label: 'CVT', match: ['cvt'] },
  // Cambio robotizado: DCT, "automatizada", "semi-automatica". E outra coisa de
  // dirigir e de manter que um automatico de conversor, entao vale separar.
  { id: 'automatizado', label: 'automatizado', match: ['automatizad', 'dct', 'semi'] },
];

/**
 * Devolve o id do grupo, ou 'outro' quando a fonte manda um rotulo que nenhum
 * grupo reconhece — esse balde e proposital: e como um contrato novo da fonte
 * aparece no painel em vez de sumir em silencio.
 */
export function transmissionGroup(value) {
  if (!value) return null;
  const v = norm(value);
  const hit = TRANSMISSIONS.find(
    (t) => t.match.some((m) => v.includes(m)) && !(t.except ?? []).some((e) => v.includes(e)),
  );
  return hit?.id ?? 'outro';
}

/** Filtro pos-coleta: as fontes ignoram parte dos filtros, entao conferimos aqui. */
export function matchesWatch(listing, watch) {
  if (watch.model && !norm(listing.title + ' ' + (listing.model ?? '')).includes(norm(watch.model))) {
    return false;
  }
  if (watch.version_contains) {
    const hay = norm(listing.title + ' ' + (listing.version ?? ''));
    if (!hay.includes(norm(watch.version_contains))) return false;
  }
  const year = listing.year_model ?? listing.year_fab;
  if (watch.year_min && (year == null || year < watch.year_min)) return false;
  if (watch.year_max && (year == null || year > watch.year_max)) return false;
  if (watch.price_max && (listing.price == null || listing.price > Number(watch.price_max))) return false;
  if (watch.price_min && (listing.price == null || listing.price < Number(watch.price_min))) return false;
  if (watch.km_max && listing.km != null && listing.km > watch.km_max) return false;
  if (watch.uf) {
    const wanted = String(watch.uf).split(',').map((u) => u.trim().toUpperCase()).filter(Boolean);
    if (wanted.length && listing.uf && !wanted.includes(listing.uf)) return false;
  }
  return true;
}
