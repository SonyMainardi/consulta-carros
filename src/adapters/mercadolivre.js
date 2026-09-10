// Mercado Livre — o SITE publico, num navegador real. Sem token, sem cadastro.
//
// POR QUE NAO A API OFICIAL
// A API existe e esta documentada, mas `/sites/MLB/search` exige app cadastrado
// (OAuth) e o ML vem restringindo o endpoint mesmo para quem tem token — sem
// token da 403, confirmado em 2026-09-06. O usuario adiou o cadastro tres
// sessoes seguidas. Em 2026-09-09, depois de a OLX cair pelo mesmo caminho,
// testamos o site publico: **200 na primeira tentativa, 48 anuncios, sem
// token**. O codigo de OAuth continua no projeto (`src/auth/mercadolivre.js`,
// `npm run ml:auth`, `npm run probe:ml`) para o dia em que a API for desejada;
// este adapter simplesmente nao precisa dele.
//
// ONDE ESTAO OS DADOS
// Nao ha `__NEXT_DATA__` nem stream RSC aqui: a busca do ML e HTML renderizado
// no servidor. Cada anuncio e um `<li class="ui-search-layout__item">` com
// titulo, preco, ano, km e cidade. `extractItems()` le esse HTML e e uma funcao
// PURA — da para testar contra data/probe-ml-browser.html sem tocar na rede.
//
// Isso e casca de site, a coisa mais fragil que existe: uma troca de classe do
// ML quebra o mapeamento. E aceitavel porque adapter e peca descartavel — se
// quebrar, reescreve-se este arquivo e nada mais. `npm run probe:ml:browser`
// mostra na hora se as pistas sumiram.
import { getPageHtml } from '../http/browser.js';
import { getHtml } from '../http/client.js';
import { AdapterError, sourceParams } from './base.js';
import { config } from '../config.js';
import { setStep } from '../core/progress.js';
import { createLogger } from '../logger.js';

const log = createLogger('adapter:ml');

const HOST = 'https://lista.mercadolivre.com.br';
const CATEGORIA = '/veiculos/carros-caminhonetes';

const slug = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * ⚠️ Nada de filtro na URL — nem em caminho, nem em querystring.
 *
 * O robots.txt de lista.mercadolivre.com.br (lido em 2026-09-09, salvo em
 * data/probe-ml-robots-lista.txt) da Disallow para `_PriceRange_`, `_OrderId_`,
 * `_FilterId_`, `_NoIndex_True`, `_CarDealer_` e — importante — `_Desde_`, que
 * e a PAGINACAO. Sao segmentos de caminho, nao querystring, mas a proibicao
 * vale igual.
 *
 * Sobra o caminho de categoria + marca + modelo, que nao esta na lista. O
 * recorte de km, preco e ano fica no matchesWatch, depois da coleta — mesma
 * decisao do Webmotors (ESTADO.md 2-D) e da OLX (2-H).
 */
function buildUrl(watch, extra) {
  if (extra.url) return extra.url;
  const partes = [CATEGORIA, slug(watch.brand), slug(watch.model)].filter(Boolean);
  return `${HOST}${partes.join('/')}/`;
}

const ENTIDADES = { amp: '&', quot: '"', '#39': "'", apos: "'", lt: '<', gt: '>', nbsp: ' ' };

const decode = (s) =>
  String(s ?? '').replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, (_, e) => ENTIDADES[e] ?? _).trim();

const primeiro = (txt, re) => {
  const m = txt.match(re);
  return m ? decode(m[1]) : null;
};

// Estado por extenso -> sigla. O ML escreve "Brasilia - Distrito Federal", e o
// parseUf() so reconhece sigla de duas letras; sem esta tabela a coluna LOCAL
// do painel ficaria sem UF para TODOS os anuncios do ML.
const UF_POR_NOME = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA',
  ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO',
  maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR',
  pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO',
  roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE',
  tocantins: 'TO',
};

const semAcento = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "Bragança Paulista - São Paulo" -> { city: 'Bragança Paulista', uf: 'SP' } */
function partesDoLocal(texto) {
  if (!texto) return { city: null, uf: null };
  const [cidade, estado] = texto.split(' - ').map((x) => x.trim());
  const chave = semAcento(estado);
  return {
    city: cidade || null,
    // Se vier sigla ("SP"), aproveita; se vier o nome, traduz; senao, null.
    uf: /^[A-Za-z]{2}$/.test(estado ?? '') ? estado.toUpperCase() : (UF_POR_NOME[chave] ?? null),
  };
}

// Cambio e combustivel NAO existem no card do ML — so dentro do anuncio, que
// custaria uma requisicao por carro. Mas o titulo quase sempre diz ("Lancer
// 2015 2.0 Cvt 4p"), e o Webmotors ja faz o mesmo com combustivel.
const CAMBIOS = [
  [/\bcvt\b/i, 'CVT'],
  [/\baut(o|om[aá]tic[oa])?\b\.?/i, 'Automático'],
  [/\bmec(?:[aâ]nic[oa])?\b\.?|\bmanual\b/i, 'Manual'],
];
const COMBUSTIVEIS = [
  [/\bflex\b/i, 'Flex'],
  [/\bdiesel\b/i, 'Diesel'],
  [/\bh[ií]brid|hybrid/i, 'Híbrido'],
  [/\bel[eé]tric/i, 'Elétrico'],
  [/\betanol|[aá]lcool/i, 'Etanol'],
  [/\bgasolina\b/i, 'Gasolina'],
];

const porTexto = (tabela, texto) => {
  for (const [re, valor] of tabela) if (re.test(texto ?? '')) return valor;
  return null;
};

/**
 * Marca, modelo e versao saem do TITULO.
 *
 * O card do ML nao publica esses campos separados, e sem marca+modelo a FIPE
 * nao resolve nada — `enrichPendingFipe` exige os dois. Foi o mesmo tropeco da
 * OLX (ESTADO.md 2-H), onde a FIPE saiu de 3/12 para 12/12 depois de ler o
 * titulo.
 *
 * O formato do ML e "<Marca> <Modelo> <Ano> <Versao>" — repare que aqui o ano
 * fica no MEIO, diferente da OLX:
 *   "Mitsubishi Lancer 2019 2.0 Hl-t 16v Gasolina 4p Automático"
 *      -> brand "Mitsubishi" · model "Lancer" · version "2.0 Hl-t 16v ..."
 *
 * Heuristica assumida: marca e modelo tem uma palavra cada. Erra em "Land
 * Rover Range Rover" e parecidos; para o uso deste projeto (uma marca, um
 * modelo, conferidos pelo matchesWatch no titulo inteiro) e suficiente, e
 * adapter e peca descartavel.
 */
function partesDoTitulo(titulo) {
  const palavras = String(titulo ?? '').split(/\s+/).filter(Boolean);
  if (!palavras.length) return { brand: null, model: null, version: null };

  const [marca, modelo, ...resto] = palavras;
  // O ano vira campo proprio (`year`); no meio da versao so atrapalha o
  // casamento com a FIPE.
  const versao = resto.filter((p) => !/^(19|20)\d{2}$/.test(p)).join(' ');

  return { brand: marca, model: modelo ?? null, version: versao || null };
}

/**
 * Os anuncios de uma pagina de busca do ML, no formato cru deste adapter.
 *
 * Funcao pura: recebe HTML, devolve objetos. E o que permite testar o
 * mapeamento contra o fixture sem rede.
 */
export function extractItems(html) {
  // Cada pedaco do split e exatamente um card: o proprio split termina onde o
  // proximo comeca. O ultimo carrega o rodape junto, mas como so pegamos a
  // PRIMEIRA ocorrencia de cada campo, o que sobra depois nao contamina.
  const cards = String(html).split('<li class="ui-search-layout__item"').slice(1);

  return cards.map((card) => {
    const href = primeiro(card, /href="(https:\/\/[^"]*?MLB-?\d+[^"]*?)"/);
    if (!href) return null;

    const url = href.split('#')[0];
    const id = url.match(/MLB-?(\d+)/)?.[1];
    if (!id) return null;

    // Ano e km sao os itens de uma lista de atributos, sem rotulo: julga-se
    // pelo formato ("2015" e ano, "223.000 Km" e km).
    const atributos = [...card.matchAll(/poly-attributes_list__item[^>]*>([^<]+)</g)].map((m) => decode(m[1]));
    const ano = atributos.find((a) => /^(19|20)\d{2}$/.test(a)) ?? null;
    const km = atributos.find((a) => /km/i.test(a)) ?? null;

    const titulo = primeiro(card, /class="poly-component__title"[^>]*>([^<]+)</);
    const local = partesDoLocal(primeiro(card, /class="poly-component__location"[^>]*>([^<]+)</));
    const { brand, model, version } = partesDoTitulo(titulo);

    return {
      // Sem hifen, como a API do ML nomeia o item: se um dia a coleta passar
      // pela API oficial, os ids batem e nao viram anuncio duplicado.
      externalId: `MLB${id}`,
      url,
      title: titulo,
      // Do titulo: o card nao traz esses campos separados — ver partesDoTitulo().
      brand,
      model,
      version,
      year: ano,
      km,
      // `aria-label="53000 reais"` e o numero limpo; a fracao ("53.000") e o
      // plano B, e parsePrice sabe ler as duas formas.
      price: primeiro(card, /aria-label="(\d[\d.,]*) reais"/)
        ?? primeiro(card, /andes-money-amount__fraction"[^>]*>([\d.,]+)</),
      color: null,
      fuel: porTexto(COMBUSTIVEIS, titulo),
      transmission: porTexto(CAMBIOS, titulo),
      city: local.city,
      uf: local.uf,
      sellerType: null,
      sellerName: null,
      photos: [primeiro(card, /class="poly-component__picture[^"]*"[^>]*src="([^"]+)"/)].filter(Boolean),
      raw: { card_len: card.length },
    };
  }).filter(Boolean);
}

export const mercadolivre = {
  name: 'mercadolivre',
  verified: true,

  async search(watch) {
    const extra = sourceParams(watch, 'mercadolivre');
    const url = buildUrl(watch, extra);

    // Sem navegador o ML devolve challenge, como Webmotors e OLX. Deixamos o
    // caminho HTTP existir para o dia em que a fonte afrouxar, mas o normal e
    // HTTP_USE_BROWSER=true.
    const res = config.browser.enabled
      ? await getPageHtml(url, { waitForSelector: '.ui-search-layout__item, .ui-search-rescue' })
      : await getHtml(url);

    const html = res.html ?? res.text ?? '';
    const items = extractItems(html);

    if (!items.length) {
      throw new AdapterError(
        `nenhum anuncio extraido de ${url} — challenge, caminho errado ou o ML trocou as classes do card`,
        {
          source: 'mercadolivre',
          hint: 'Rode `npm run probe:ml:browser` e veja se as pistas (ui-search-layout__item) ainda existem',
        },
      );
    }

    // Uma pagina. Paginar exigiria `_Desde_51`, que o robots.txt proibe.
    const resumo = `pagina 1: ${items.length} anuncios`;
    log.info(`${resumo} em ${url}`);
    setStep(`mercadolivre ${resumo}`, {
      page: 1, totalPages: 1, collected: items.length, total: items.length,
    });

    return items;
  },
};
