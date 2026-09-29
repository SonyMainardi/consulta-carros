// OLX — a API oficial (developers.olx.com.br) e para ANUNCIAR, nao para consultar.
// Entao lemos a pagina de busca e extraimos o JSON que o proprio site embute.
//
// ONDE O JSON MORA (mudou em 2026-09-09)
// A OLX migrou para o App Router do Next.js. Nao existe mais
// `<script id="__NEXT_DATA__">`: o payload chega em pedacos de
// `self.__next_f.push([1,"..."])` — o stream "flight" do React Server
// Components. Cada pedaco e uma STRING JSON escapada; concatenando todos e
// desescapando volta-se ao texto original, onde esta `"ads":[...]`.
// `extractAds()` faz isso. `extractNextData()` continua aqui como plano B,
// para o dia em que a OLX voltar atras ou uma pagina antiga aparecer.
//
// COMO CHEGAMOS ATE AQUI: `npm run probe:olx:browser` (2026-09-09), 200 OK,
// 1,7 MB de HTML, 57 anuncios na primeira pagina. Fixture em
// data/probe-olx-browser.html.
//
// TRANSPORTE: navegador real, sempre. O fetch do Node bate no Cloudflare.
import { getPageHtml } from '../http/browser.js';
import { getHtml } from '../http/client.js';
import { AdapterError, sourceParams, divergenciaDeCaminho } from './base.js';
import { norm } from '../core/normalize.js';
import { config } from '../config.js';
import { setStep } from '../core/progress.js';
import { createLogger } from '../logger.js';

const log = createLogger('adapter:olx');

const HOST = 'https://www.olx.com.br';
const CATEGORIA = '/autos-e-pecas/carros-vans-e-utilitarios';

/**
 * ⚠️ NAO acrescente querystring a estas URLs.
 *
 * O robots.txt da OLX (lido em 2026-09-09, salvo em data/probe-olx-robots.txt)
 * tem Disallow para `q=`, `o=`, `pe=`, `ps=`, `rs=`, `re=` e `sf=` — ou seja,
 * termo de busca, PAGINACAO, preco, ano e ordenacao. Tambem proibe `/q/*`, a
 * forma da busca textual em caminho. Sao exatamente os parametros que a versao
 * anterior deste adapter usava.
 *
 * O caminho de categoria e os caminhos de marca/modelo nao estao na lista.
 * Ficam eles — e o recorte de km, preco e ano acontece depois, no
 * matchesWatch(). Mesma decisao ja tomada para o Webmotors (ESTADO.md 2-D).
 */
function buildPath(watch, extra) {
  if (extra.path) return extra.path;
  // Slugs da busca (watches.params). A OLX foge do padrao em algumas marcas —
  // Volkswagen e `vw-volkswagen` — e quem sabe disso e src/core/marcas.js.
  const partes = [CATEGORIA, extra.marca ?? slug(watch.brand), extra.modelo ?? slug(watch.model)].filter(Boolean);
  return partes.join('/');
}

const slug = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Remonta o stream do React Server Components a partir dos
 * `self.__next_f.push([1,"<json escapado>"])` espalhados pelo HTML.
 *
 * Cada trecho e desescapado com JSON.parse — nao na mao. Desescapar a mao e
 * como se erra acento e barra invertida no meio de 400 KB de texto.
 */
function remontarFlight(html) {
  const re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g;
  let flight = '';
  let m;
  while ((m = re.exec(html))) {
    try {
      flight += JSON.parse(m[1]);
    } catch {
      // Pedaco corrompido nao invalida os outros.
    }
  }
  return flight;
}

/**
 * Recorta um array JSON balanceado a partir de `"<chave>":[`.
 *
 * Regex nao serve aqui: o array tem objetos aninhados e strings com colchetes
 * dentro (nomes de anuncio, opcionais). Contar colchetes ignorando o que esta
 * dentro de string e o unico jeito honesto.
 */
function recortarArray(txt, chave) {
  const marca = `"${chave}":[`;
  const at = txt.indexOf(marca);
  if (at < 0) return null;

  const start = txt.indexOf('[', at);
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let k = start; k < txt.length; k += 1) {
    const c = txt[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(txt.slice(start, k + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Plano B: o formato antigo, com `<script id="__NEXT_DATA__">`. */
export function extractNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** A OLX ja mudou o caminho dos anuncios varias vezes; procuramos em varios lugares. */
function findAds(nextData) {
  const pp = nextData?.props?.pageProps ?? {};
  const candidates = [pp.ads, pp.listing?.ads, pp.data?.ads, pp.initialState?.ads?.list];
  for (const c of candidates) if (Array.isArray(c) && c.length) return c;
  return [];
}

/**
 * Os anuncios de uma pagina de busca, no formato cru da OLX.
 * Exportado para o probe e para teste com fixture, sem tocar na rede.
 */
export function extractAds(html) {
  const flight = remontarFlight(html);
  if (flight) {
    const ads = recortarArray(flight, 'ads');
    if (Array.isArray(ads) && ads.length) return ads;
  }
  const nextData = extractNextData(html);
  if (nextData) return findAds(nextData);
  return [];
}

/** Total de anuncios da busca, quando a pagina informa. So para log/progresso. */
export function extractTotal(html) {
  const m = remontarFlight(html).match(/"totalOfAds":\s*(\d+)/);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * Modelo e versao saem do TITULO, nao da propriedade `vehicle_model`.
 *
 * Motivo, medido em 2026-09-09: a OLX manda
 *   vehicle_model = "Mitsubishi GT 2.0 16V 160cv Aut."
 * — a marca no comeco e **sem a palavra Lancer**. Com isso o casamento com a
 * tabela FIPE resolveu so 3 dos 12 anuncios, porque `bestMatch` procura o nome
 * do modelo na lista da FIPE e o nome nao estava la.
 *
 * O titulo, esse, e regular: "<Marca> <Modelo> <Versao> <Ano>".
 *   "Mitsubishi Lancer GT 2.0 16V 160cv Aut. 2014"
 *      -> model = "Lancer", version = "GT 2.0 16V 160cv Aut."
 *
 * Se o titulo nao tiver o formato esperado, cai de volta em `vehicle_model` —
 * pior mapeamento e melhor que anuncio perdido.
 */
function partesDoTitulo(ad) {
  const titulo = String(ad.subject ?? ad.title ?? '').trim();
  const marca = propOf(ad, 'vehicle_brand');

  let resto = titulo;
  if (marca && norm(resto).startsWith(norm(marca))) resto = resto.slice(marca.length).trim();
  // O ano no fim e redundante com `regdate` e atrapalha o casamento na FIPE.
  resto = resto.replace(/\s+(19|20)\d{2}\s*$/, '').trim();

  const [primeira, ...demais] = resto.split(/\s+/).filter(Boolean);
  if (!primeira) return { model: propOf(ad, 'vehicle_model'), version: null };

  return { model: primeira, version: demais.join(' ') || null };
}

const propOf = (ad, name) => {
  const found = (ad.properties ?? []).find((p) => p.name === name);
  return found?.value ?? found?.label ?? null;
};

/**
 * Um anuncio cru -> o formato solto que core/normalize.toListing entende.
 * Contrato conferido em 2026-09-09 contra data/probe-olx-ads.json.
 */
export function mapAd(ad) {
  const loc = ad.locationDetails ?? {};
  const { model, version } = partesDoTitulo(ad);

  return {
    externalId: String(ad.listId ?? ad.id ?? ad.adId),
    url: ad.url ?? ad.friendlyUrl,
    title: ad.subject ?? ad.title,
    brand: propOf(ad, 'vehicle_brand'),
    // Do titulo, nao de `vehicle_model` — ver partesDoTitulo() acima.
    model,
    version,
    year: propOf(ad, 'regdate'),
    km: propOf(ad, 'mileage'),
    // `price` e `priceValue` vem como "R$ 69.900" — parsePrice resolve.
    price: ad.price ?? ad.priceValue,
    color: propOf(ad, 'carcolor'),
    fuel: propOf(ad, 'fuel'),
    transmission: propOf(ad, 'gearbox'),
    city: loc.municipality ?? null,
    // `location` cru ("Belo Horizonte -  MG") fica de reserva: parseUf sabe
    // achar a sigla nele se locationDetails faltar.
    uf: loc.uf ?? ad.location ?? null,
    sellerType: ad.professionalAd ? 'PJ' : 'PF',
    sellerName: ad.user?.name ?? null,
    photos: (ad.images ?? ad.thumbnails ?? [])
      .map((i) => (typeof i === 'string' ? i : i?.original ?? i?.originalWebp ?? i?.url))
      .filter(Boolean),
    raw: ad,
  };
}

export const olx = {
  name: 'olx',
  verified: true,
  // Formato do endereco, para o painel mostrar a URL de cada busca. E o mesmo
  // caminho de buildPath(); mudar um exige mudar o outro.
  endereco: 'https://www.olx.com.br/autos-e-pecas/carros-vans-e-utilitarios/{marca}/{modelo}',

  async search(watch) {
    const extra = sourceParams(watch, 'olx');
    const path = buildPath(watch, extra);
    const url = `${HOST}${path}`;

    // Uma pagina, e so. Paginar exigiria `?o=2`, que o robots.txt proibe (ver
    // buildPath acima). Nao e limitacao de codigo: e o teto que a fonte impoe a
    // acesso automatizado. A pagina 1 traz ~57 anuncios, ordenados por
    // relevancia/recencia — que e justamente o que interessa a quem monitora
    // todo dia. Se a OLX publicar uma forma de paginar em caminho, e aqui que entra.
    const res = config.browser.enabled
      ? await getPageHtml(url, { waitForSelector: 'a[href*="/autos-e-pecas/"]' })
      : await getHtml(url);

    const html = res.html ?? res.text ?? '';

    // Slug errado nao da 404 na OLX: a pagina cai em outra listagem. O canonical
    // que a propria pagina declara diz qual busca ela e.
    const divergencia = divergenciaDeCaminho(path, { html, urlFinal: res.url });
    if (divergencia) {
      throw new AdapterError(
        `a OLX nao devolveu a busca ${path}: ${divergencia} — a marca ou o modelo tem outro endereco na OLX`,
        {
          source: 'olx',
          hint: 'Corrija o slug da OLX na busca (Coletar tudo > Editar > endereco em cada portal). Ex.: Volkswagen na OLX e vw-volkswagen.',
        },
      );
    }

    const ads = extractAds(html);
    const total = extractTotal(html);

    if (!ads.length) {
      // Busca que existe e esta vazia: nada a gravar, e nada pode "sair do ar".
      if (total === 0) return { itens: [], total: 0, paginas: 1, completa: true };
      throw new AdapterError(
        `nenhum anuncio extraido de ${url} — pagina de challenge, caminho errado ou formato novo`,
        {
          source: 'olx',
          hint: 'Rode `npm run probe:olx:browser <url>` e confira data/probe-olx-browser.html',
        },
      );
    }

    const resumo = `pagina 1: ${ads.length} anuncios${total ? ` (a busca tem ${total})` : ''}`;
    log.info(`${resumo} em ${path}`);
    setStep(`olx ${resumo}`, { page: 1, totalPages: 1, collected: ads.length, total: total ?? ads.length });

    const itens = ads.map(mapAd).filter((a) => a.externalId && a.externalId !== 'undefined' && a.url);
    // Uma pagina so cobre a busca inteira quando a busca cabe nela. O Lancer tem
    // 447 anuncios na OLX contra ~50 por pagina: parcial, e quem cai para a
    // pagina 2 NAO saiu do ar (ESTADO.md 2-R, item 3).
    return { itens, total, paginas: 1, completa: total != null && itens.length >= total };
  },
};
