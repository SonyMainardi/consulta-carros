// Webmotors — sem API publica, mas a SPA consome um endpoint JSON interno que
// responde bem.
//
// CONTRATO VERIFICADO em 2026-09-06 contra a resposta real (ver data/probe-webmotors.json).
// Se voltar a quebrar, rode `npm run probe:wm` e compare com mapItem() abaixo.
import { getJson } from '../http/client.js';
import { getSearchPayload } from '../http/browser.js';
import { AdapterError, sourceParams } from './base.js';
import { config } from '../config.js';
import { setStep } from '../core/progress.js';
import { createLogger } from '../logger.js';

const log = createLogger('adapter:wm');

const ENDPOINT = 'https://www.webmotors.com.br/api/search/car';
const IMAGE_CDN = 'https://image.webmotors.com.br/_fotos/anunciousados/gigante';
const PAGE_SIZE = 24;
// Teto de seguranca, nao meta de coleta: o loop para sozinho quando alcanca
// `Count`. Existe so para nao paginar sem fim se o payload vier estranho.
// Era 4 (96 anuncios) e truncava a busca do Lancer, que tem 205. [2026-09-07]
const MAX_PAGES = 20;

/**
 * Monta a URL de busca no formato que o site usa, se o watch nao trouxer uma.
 *
 * Os nomes dos filtros NAO sao adivinhados: vieram da barra de endereco do
 * proprio Webmotors, copiada pelo usuario em 2026-09-07 depois de aplicar os
 * filtros na interface. Os que eu tinha inventado antes (`quilometragemfinal`,
 * `precomaximo`, `anofabricacaoinicial`) foram testados no mesmo dia e o site
 * os ignorava em silencio — mesmo Count, `SEO.Canonical` sem a querystring.
 *
 * ⚠️ NAO acrescente filtros de querystring aqui. O robots.txt do Webmotors
 * (lido em 2026-09-07) da Disallow para URLs com `tipoveiculo=`, `kmate=`,
 * `kmde=`, `precode=`, `precoate=`, `cambio=`, `combustivel=`, `cor=` e outros.
 * Sao exatamente os parametros que a interface do site gera — legitimos para
 * uma pessoa navegando, proibidos para acesso automatizado. Ja foram tentados e
 * revertidos nesta mesma data; ver ESTADO.md secao 2-D antes de reintroduzir.
 *
 * O path puro, sem querystring, nao esta na lista de Disallow. Fica ele.
 * `marca1`, `modelo1` e `page` tambem nao estao, mas sao redundantes com o path.
 *
 * Consequencia: a busca vem inteira (todos os Lancer) e o recorte de km, preco
 * e ano fica por conta de matchesWatch(), depois da coleta. Sai mais caro em
 * paginas — e a forma que respeita a regra escrita da fonte.
 */
function buildSearchPath(watch, extra = {}) {
  // Os slugs vem da busca (watches.params, gravados quando ela e criada — ver
  // src/core/marcas.js). O slugify do nome e so o plano B de busca antiga.
  return ['/carros-usados/estoque', extra.marca ?? slug(watch.brand), extra.modelo ?? slug(watch.model)]
    .filter(Boolean)
    .join('/');
}

const slug = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * O payload nao traz a URL do anuncio, entao montamos no padrao do site:
 * /comprar/{marca}/{modelo}/{versao}/{portas}-portas/{anoFab}-{anoModelo}/{id}
 */
function buildListingUrl(spec, id) {
  const parts = [
    slug(spec?.Make?.Value),
    slug(spec?.Model?.Value),
    slug(spec?.Version?.Value),
    spec?.NumberPorts ? `${spec.NumberPorts}-portas` : null,
    spec?.YearFabrication && spec?.YearModel ? `${spec.YearFabrication}-${spec.YearModel}` : null,
    id,
  ].filter(Boolean);
  return `https://www.webmotors.com.br/comprar/${parts.join('/')}`;
}

// O combustivel nao vem em campo proprio: esta embutido no texto da versao.
const FUELS = [
  [/\bflex\b/i, 'Flex'],
  [/\bdiesel\b/i, 'Diesel'],
  [/\bhibrid|\bhybrid/i, 'Híbrido'],
  [/\beletric|\belectric/i, 'Elétrico'],
  [/\betanol|\balcool/i, 'Etanol'],
  [/\bgasolina\b/i, 'Gasolina'],
];

function extractFuel(text) {
  for (const [re, label] of FUELS) if (re.test(text ?? '')) return label;
  return null;
}

/** Fotos vem como caminho relativo com barra invertida do Windows. */
function photoUrls(item) {
  const photos = item.Media?.Photos ?? [];
  const paths = photos.length ? photos.map((p) => p?.PhotoPath) : [item.PhotoPath];
  return paths
    .filter(Boolean)
    .map((p) => `${IMAGE_CDN}/${String(p).replace(/\\/g, '/')}`);
}

// Exportado para permitir testar o mapeamento contra os fixtures em data/
// sem tocar na rede (ver scripts/ingest-fixture.js). Com o PerimeterX no meio,
// testar contra fixture deixou de ser elegancia e virou necessidade.
export function mapItem(item) {
  const spec = item.Specification ?? {};
  const seller = item.Seller ?? {};
  const id = item.UniqueId;

  // O Webmotors ja calcula o preco como % da FIPE (104 = 4% acima da tabela).
  // Isso poupa 4 chamadas encadeadas na API da FIPE por anuncio.
  const fipePercent = Number(item.FipePercent);
  const fipeRatio = Number.isFinite(fipePercent) && fipePercent > 0
    ? Number((fipePercent / 100).toFixed(3))
    : null;

  return {
    externalId: String(id),
    url: buildListingUrl(spec, id),
    title: spec.Title ?? [spec.Make?.Value, spec.Model?.Value, spec.Version?.Value].filter(Boolean).join(' '),
    brand: spec.Make?.Value ?? null,
    model: spec.Model?.Value ?? null,
    version: spec.Version?.Value ?? null,
    yearFab: Number.parseInt(spec.YearFabrication, 10) || null,
    yearModel: Number.parseInt(spec.YearModel, 10) || null,
    km: spec.Odometer,
    price: item.Prices?.Price ?? item.Prices?.SearchPrice,
    color: spec.Color?.Primary ?? null,
    fuel: extractFuel(spec.Version?.Value ?? spec.Title),
    transmission: spec.Transmission ?? null,
    city: seller.City ?? null,
    uf: seller.State ?? null, // vem como "São Paulo (SP)"; parseUf extrai a sigla
    sellerType: seller.SellerType ?? null,
    sellerName: seller.FantasyName ?? null,
    photos: photoUrls(item),
    fipeRatio,
    raw: item,
  };
}

export const webmotors = {
  name: 'webmotors',
  verified: true,
  // Formato do endereco, para o painel mostrar a URL de cada busca. E o mesmo
  // caminho de buildSearchPath(); mudar um exige mudar o outro.
  endereco: 'https://www.webmotors.com.br/carros-usados/estoque/{marca}/{modelo}',

  async search(watch, { maxPaginas = MAX_PAGES } = {}) {
    const extra = sourceParams(watch, 'webmotors');
    const searchPath = extra.url ?? buildSearchPath(watch, extra);
    const results = [];
    let porPagina = null; // fixado na 1a pagina; ver comentario no laco abaixo
    let total = 0;
    let paginasLidas = 0;
    // Por que o laco parou. So 'fim' (a busca acabou) permite afirmar que um
    // anuncio ausente saiu do ar; 'teto' e 'falha' deixam a cobertura parcial.
    let parada = 'teto';

    for (let page = 1; page <= maxPaginas; page += 1) {
      // Dois transportes, mesmo formato de payload no fim.
      //
      // browser: navega ate a pagina de busca e le a chamada que a PROPRIA SPA
      //   faz. Nao fabricamos requisicao — foi justamente fabricar que rendeu
      //   403 em 2026-09-08 (o cookie do PerimeterX so existe depois que o
      //   script do site roda). Ver src/http/browser.js.
      // http: o cliente educado de sempre. Funciona quando a fonte deixa.
      let data;

      if (config.browser.enabled) {
        // Paginacao tolerante a falha. Uma coleta do Lancer sao ~9 paginas e
        // ~10 minutos com o navegador aberto; a chance de algo morrer no meio
        // nao e desprezivel. Se ja temos paginas boas, elas VALEM: devolvemos o
        // parcial em vez de perder tudo.
        //
        // Em 2026-09-08 o Chromium caiu na 6a pagina e a rodada inteira foi
        // descartada — 7 minutos de coleta viraram `items_found: 0`. Nao repita:
        // so propague o erro quando nao houver nada coletado.
        try {
          data = await getSearchPayload(searchPath, page);
        } catch (err) {
          if (results.length === 0) throw err;
          log.warn(
            `pagina ${page} falhou (${err.message}) — seguindo com as ${results.length} ja coletadas`,
          );
          parada = 'falha';
          break;
        }
      } else {
        const url = new URL(ENDPOINT);
        url.searchParams.set('url', `https://www.webmotors.com.br${searchPath}`);
        url.searchParams.set('actualPage', String(page));
        url.searchParams.set('displayPerPage', String(PAGE_SIZE));
        url.searchParams.set('order', '1');
        url.searchParams.set('showMenu', 'false');
        url.searchParams.set('showCount', 'true');
        url.searchParams.set('showBreadCrumb', 'false');
        url.searchParams.set('testAB', 'false');
        url.searchParams.set('returnUrl', 'false');

        const res = await getJson(url.toString(), {
          headers: {
            Referer: `https://www.webmotors.com.br${searchPath}`,
            Origin: 'https://www.webmotors.com.br',
          },
        });
        data = res.data;
      }

      if (!data) {
        throw new AdapterError('resposta nao era JSON — contrato do endpoint provavelmente mudou', {
          source: 'webmotors',
          hint: 'Rode `npm run probe:wm:browser` e compare com mapItem em src/adapters/webmotors.js',
        });
      }

      const items = data.SearchResults ?? [];
      if (!Array.isArray(items) || items.length === 0) {
        parada = 'fim';
        break;
      }

      results.push(...items.map(mapItem));
      paginasLidas = page;

      // `Count` e o total de anuncios da busca: para de paginar quando ja pegou tudo.
      total = Number(data.Count) || 0;

      // Progresso por pagina. NAO e enfeite: com 60-80s de intervalo entre
      // paginas, uma coleta leva ~10 min. Sem esta linha o processo fica mudo
      // esse tempo todo e parece travado — foi exatamente o que aconteceu na
      // primeira coleta real (2026-09-08), com o usuario sem saber se esperava
      // ou matava o processo.
      // Tamanho de pagina OBSERVADO, nao o PAGE_SIZE que pedimos: no modo
      // navegador quem decide e a SPA (veio 47, nao 24).
      //
      // Fixado na PRIMEIRA pagina de proposito. A ultima vem menor (18 de 206),
      // e recalcular com ela dava "pagina 5/12" — a barra de progresso pularia
      // de 80% para 42% bem no fim. Visto em 2026-09-08 02:06.
      if (porPagina == null) porPagina = items.length || PAGE_SIZE;
      const totalPaginas = total ? Math.ceil(total / porPagina) : null;
      // Busca maior que o teto (Corolla: ~142 paginas): a barra anda ate o teto,
      // nao ate um total que esta coleta nunca vai alcancar.
      const paginasDaBarra = totalPaginas ? Math.min(totalPaginas, maxPaginas) : null;
      const aviso = totalPaginas && totalPaginas > maxPaginas
        ? ` — busca grande: leio so ${maxPaginas} de ${totalPaginas} paginas`
        : '';
      const resumo =
        `pagina ${page}/${paginasDaBarra ?? '?'}: +${items.length} anuncios ` +
        `(acumulado ${results.length}${total ? ` de ${total}` : ''})${aviso}`;
      log.info(resumo);
      setStep(`webmotors ${resumo}`, {
        page,
        totalPages: paginasDaBarra,
        collected: results.length,
        total: total || null,
      });
      if (items.length < PAGE_SIZE || (total && results.length >= total)) {
        parada = 'fim';
        break;
      }
    }

    // Completa exige as duas coisas: o laco chegou ao fim da busca E os ids
    // distintos cobrem o total. Anuncio que muda de pagina durante os ~5 min de
    // coleta pode aparecer duas vezes e empurrar outro para fora — esse outro
    // nao pode virar "saiu do ar".
    const distintos = new Set(results.map((r) => r.externalId)).size;
    const completa = parada === 'fim' && (!total || distintos >= total);
    log.info(
      `${results.length} anuncios para ${searchPath} ` +
      `(${completa ? 'busca inteira' : `cobertura parcial: ${parada}, ${distintos} de ${total || '?'}`})`,
    );
    return { itens: results, total: total || null, paginas: paginasLidas, completa };
  },
};
