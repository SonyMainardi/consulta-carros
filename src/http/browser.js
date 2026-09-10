// Transporte alternativo: a busca e feita pelo PROPRIO SITE, dentro de um
// navegador real, e nos apenas lemos a resposta que ele ja pediu.
//
// POR QUE EXISTE
// O Webmotors usa PerimeterX. Ele nao bloqueia so por volume: avalia
// fingerprint de TLS (JA3/JA4) e o comportamento do cliente. Um `fetch` do Node
// tem assinatura de Node e e barrado na primeira requisicao, com qualquer
// intervalo — por isso subir de 12s para 60s nao mudou nada.
//
// A LICAO DE 2026-09-08 (nao repita o erro)
// A primeira versao deste arquivo abria a pagina e entao FABRICAVA a chamada a
// `/api/search/car` com `page.evaluate(fetch(...))`. Resultado: HTTP 403 mesmo
// dentro do navegador. O motivo e que o cookie do PerimeterX so existe depois
// que o script sensor do site roda; pedir a API logo apos `domcontentloaded` e
// pedir cedo demais.
//
// A abordagem atual nao tem esse problema porque nao fabrica requisicao
// nenhuma: navegamos para a pagina de busca e **interceptamos a chamada que a
// propria SPA faz**. A requisicao e do site, com os headers do site, os cookies
// do site e o TLS do navegador. Nada e forjado nem adivinhado.
//
// O QUE ESTE MODULO NAO FAZ, DE PROPOSITO
// Nao resolve CAPTCHA, nao gira proxy, nao mexe em fingerprint. Se aparecer um
// bloqueio de verdade, a janela fica aberta e QUEM RESOLVE E O USUARIO.
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { acquire } from './rateLimiter.js';
import { HttpError } from './client.js';
// Progresso e preocupacao transversal, como o logger: o transporte precisa
// conseguir dizer "parei, dependo de uma pessoa" sem conhecer quem escuta.
import { setNeedsHuman } from '../core/progress.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('browser');

const USER_DATA_DIR = resolve(process.cwd(), 'data', 'browser');
const SEARCH_API = '/api/search/car';

let context = null;
let chromium = null;

/** Playwright e carregado sob demanda: quem nao usa o navegador nao paga por ele. */
async function loadPlaywright() {
  if (chromium) return chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new HttpError(
      'playwright nao esta instalado — rode `npm i playwright` e `npx playwright install chromium`',
      { url: 'about:blank' },
    );
  }
  return chromium;
}

async function getContext() {
  if (context) return context;
  const cr = await loadPlaywright();
  if (!existsSync(USER_DATA_DIR)) mkdirSync(USER_DATA_DIR, { recursive: true });

  // Contexto persistente: os cookies do PerimeterX sobrevivem entre coletas, o
  // que reduz muito a chance de cair em desafio no dia seguinte.
  context = await cr.launchPersistentContext(USER_DATA_DIR, {
    headless: config.browser.headless,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 768 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  log.info(`navegador aberto (headless=${config.browser.headless}), sessao em data/browser/`);
  return context;
}

export async function closeBrowser() {
  if (!context) return;
  await context.close().catch(() => {});
  context = null;
  log.info('navegador fechado');
}

/** O Chromium morreu (memoria, crash do renderer, usuario fechou a janela). */
const isClosedError = (err) =>
  /has been closed|target closed|browser has disconnected|crashed/i.test(err?.message ?? '');

/**
 * Devolve uma aba utilizavel, reabrindo o contexto se ele tiver morrido.
 * Numa coleta de ~10 minutos com o navegador aberto, morrer no meio e um
 * evento esperado — nao uma excecao.
 */
async function acquirePage() {
  try {
    const ctx = await getContext();
    return ctx.pages().find((p) => !p.isClosed()) ?? (await ctx.newPage());
  } catch (err) {
    if (!isClosedError(err)) throw err;
    log.warn('contexto do navegador estava morto — reabrindo');
    context = null;
    const ctx = await getContext();
    return ctx.pages().find((p) => !p.isClosed()) ?? (await ctx.newPage());
  }
}

/**
 * Detecta BLOQUEIO DE VERDADE — nao a mera presenca do PerimeterX.
 *
 * ⚠️ A versao anterior procurava `jsClientSrc|_px|perimeterx` no HTML e dava
 * falso positivo em TODA pagina boa, porque a pagina normal do Webmotors
 * carrega o script sensor do PerimeterX. O log dizia "desafio detectado" e
 * "desafio resolvido" com 54ms de diferenca. Só assinatura de bloqueio aqui.
 */
function blockSignature(title, text) {
  const hay = `${title} ${text}`.slice(0, 4000);
  if (/press\s*(&|and)\s*hold|access (to this page )?ha[sv]e? been denied|acesso negado/i.test(hay)) {
    return 'PerimeterX';
  }
  if (/attention required|__cf_chl|checking your browser/i.test(hay)) return 'Cloudflare';
  if (/datadome|geo\.captcha/i.test(hay)) return 'DataDome';
  return null;
}

/**
 * Se houver bloqueio real, abre espaco para o usuario resolver na janela.
 * @returns {Promise<boolean>} true se PRECISOU esperar e o bloqueio saiu —
 *   nesse caso quem chamou tem de RENAVEGAR: a aba ainda esta na tela do
 *   desafio e a SPA nao vai disparar a busca sozinha.
 */
async function ensureNotBlocked(page, url) {
  const title = await page.title().catch(() => '');
  const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  const guard = blockSignature(title, text);
  if (!guard) return false;

  if (config.browser.headless) {
    throw new HttpError(
      `bloqueio ${guard} — rode com BROWSER_HEADLESS=false e resolva na janela uma vez`,
      { status: 403, url, guard },
    );
  }

  log.warn(`bloqueio ${guard} na tela — RESOLVA NA JANELA DO NAVEGADOR (aguardo ate 5 min)`);
  // Avisa o painel. Quem clicou no botao esta olhando para o painel, nao para a
  // janela do Chromium — sem isso a espera e invisivel e simplesmente expira,
  // que foi o que aconteceu em 2026-09-08 as 01:20.
  setNeedsHuman(true, `Resolva o ${guard} na janela do navegador`);
  try {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000);
      const t = await page.title().catch(() => '');
      const b = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      if (!blockSignature(t, b)) {
        log.info('bloqueio liberado — vou renavegar para refazer a busca');
        return true;
      }
    }
  } finally {
    setNeedsHuman(false);
  }
  throw new HttpError(`bloqueio ${guard} nao foi resolvido a tempo`, { status: 403, url, guard });
}

/**
 * Carrega uma pagina de busca e devolve o payload que a PROPRIA SPA pediu.
 *
 * @param {string} searchPath ex.: '/carros-usados/estoque/mitsubishi/lancer'
 * @param {number} pageNum    1-based. Vira `?page=N` — `page` nao esta na lista
 *                            de Disallow do robots.txt (ver ESTADO.md 2-D).
 * @returns {Promise<object>} o JSON de /api/search/car (SearchResults, Count...)
 */
export async function getSearchPayload(searchPath, pageNum = 1, opts = {}) {
  const host = 'www.webmotors.com.br';

  // O rate limit vale igual aqui: navegador nao e licenca para acelerar.
  if (!opts.skipRateLimit) {
    await acquire(host, { minIntervalMs: opts.minIntervalMs, jitterMs: opts.jitterMs });
  }

  const page = await acquirePage();
  const pageUrl = `https://${host}${searchPath}${pageNum > 1 ? `?page=${pageNum}` : ''}`;
  const timeout = opts.timeoutMs ?? 60000;

  try {
    // Escuta a chamada que o site faz sozinho enquanto navegamos ate a pagina.
    // Nao fabricamos requisicao: so lemos a que a SPA ja ia fazer.
    // Tentativas com OUVINTE NOVO a cada volta.
    //
    // A versao anterior montava o ouvinte uma vez e, se o CAPTCHA aparecesse, o
    // relogio dele seguia correndo durante a espera humana — e depois de o
    // usuario resolver ninguem renavegava, entao a SPA nunca disparava a busca
    // e o ouvinte expirava. Foi assim que a coleta de 2026-09-08 01:37 morreu,
    // com o usuario tendo resolvido o desafio em 15 segundos.
    let data = null;

    for (let tentativa = 1; tentativa <= 3 && !data; tentativa += 1) {
      const ouvinte = esperarBuscaCerta(page, searchPath, timeout);

      // `commit` em vez de `domcontentloaded`: a navegacao so precisa DISPARAR
      // a busca — quem entrega o resultado e o ouvinte acima. Esperar a pagina
      // inteira carregar so nos expos a travar. Em 2026-09-08 01:55 um
      // `goto` com `domcontentloaded` ficou 60s pendurado e matou a coleta.
      // Por isso o timeout do goto tambem e tolerado, nao fatal.
      try {
        await page.goto(pageUrl, { waitUntil: 'commit', timeout: 30000 });
      } catch (navErr) {
        log.warn(`navegacao demorou (${navErr.message.split('\n')[0]}) — sigo ouvindo mesmo assim`);
      }

      // Se houve bloqueio e o usuario resolveu, a aba ficou na tela do desafio:
      // descarta este ouvinte e recomeca a tentativa com navegacao limpa.
      if (await ensureNotBlocked(page, pageUrl)) continue;

      data = await ouvinte;
      if (!data && tentativa < 3) {
        log.warn(`nao vi a busca do nosso path (tentativa ${tentativa}) — renavegando`);
      }
    }

    if (data) return data;

    // Plano B: o payload costuma estar embutido no HTML renderizado.
    const embedded = await page
      .evaluate(() => {
        const el = document.querySelector('#__NEXT_DATA__');
        if (!el) return null;
        try {
          return JSON.parse(el.textContent);
        } catch {
          return null;
        }
      })
      .catch(() => null);

    const found = embedded && findSearchResults(embedded);
    if (found) {
      log.info('payload lido do __NEXT_DATA__ da pagina');
      return found;
    }

    throw new HttpError(
      `nao consegui obter os resultados de ${pageUrl} — nem pela chamada da SPA nem pelo __NEXT_DATA__`,
      { status: response?.status() ?? 0, url: pageUrl, guard: 'PerimeterX' },
    );
  } catch (err) {
    if (err instanceof HttpError) throw err;

    // O Chromium morrer no meio de uma rodada de 10 minutos e evento esperado.
    // Reabrimos UMA vez e repetimos esta pagina. Em 2026-09-08 uma coleta de 7
    // minutos foi perdida inteira por causa disso.
    if (isClosedError(err) && !opts._retried) {
      log.warn('o navegador fechou sozinho — reabrindo e repetindo esta pagina');
      await closeBrowser();
      return getSearchPayload(searchPath, pageNum, { ...opts, _retried: true, skipRateLimit: true });
    }

    throw new HttpError(`falha no navegador em ${pageUrl}: ${err.message}`, { url: pageUrl });
  }
}

/**
 * Transporte GENERICO: abre uma URL num navegador real e devolve o que estiver
 * na tela depois que o site terminou de se montar.
 *
 * Por que existe, se ja ha getSearchPayload(): aquele e do Webmotors — host
 * fixo, /api/search/car e SEO.Canonical. A OLX entrega os anuncios no HTML
 * (Next.js, __NEXT_DATA__), entao o que se precisa dela nao e interceptar uma
 * chamada e sim ler a pagina pronta. As duas coisas compartilham o que
 * importa: rate limiter, contexto persistente e a espera humana no bloqueio.
 *
 * @returns {Promise<{status:number, url:string, html:string, text:string}>}
 */
export async function getPageHtml(url, opts = {}) {
  const host = new URL(url).host;

  // Navegador nao e licenca para acelerar — vale o mesmo intervalo do fetch.
  if (!opts.skipRateLimit) {
    await acquire(host, { minIntervalMs: opts.minIntervalMs, jitterMs: opts.jitterMs });
  }

  const page = await acquirePage();
  const timeout = opts.timeoutMs ?? 60000;

  try {
    // Ate 3 voltas: `ensureNotBlocked` devolvendo true significa que o usuario
    // resolveu um desafio e a aba ficou na tela dele — e preciso RENAVEGAR.
    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      let status = 0;
      try {
        const resp = await page.goto(url, {
          waitUntil: opts.waitUntil ?? 'domcontentloaded',
          timeout: Math.min(timeout, 45000),
        });
        status = resp?.status() ?? 0;
      } catch (navErr) {
        log.warn(`navegacao demorou (${navErr.message.split('\n')[0]}) — sigo com o que estiver na tela`);
      }

      if (await ensureNotBlocked(page, url)) continue;

      // Conteudo que so aparece depois do JS: espera o seletor, mas nao morre
      // por causa dele — quem julga se a pagina serve e quem chamou.
      if (opts.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout: opts.selectorTimeoutMs ?? 15000 })
          .catch(() => log.warn(`seletor "${opts.waitForSelector}" nao apareceu em ${url}`));
      }

      const html = await page.content();
      const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      return { status, url: page.url(), html, text };
    }

    throw new HttpError(`nao consegui carregar ${url} (3 tentativas)`, { url });
  } catch (err) {
    if (err instanceof HttpError) throw err;

    if (isClosedError(err) && !opts._retried) {
      log.warn('o navegador fechou sozinho — reabrindo e repetindo esta pagina');
      await closeBrowser();
      return getPageHtml(url, { ...opts, _retried: true, skipRateLimit: true });
    }

    throw new HttpError(`falha no navegador em ${url}: ${err.message}`, { url });
  }
}

/**
 * A pagina de busca dispara MAIS DE UMA chamada a /api/search/car: a busca de
 * verdade e outras genericas (destaques, recomendados). Pegar "a primeira que
 * aparecer" traz o estoque inteiro do site.
 *
 * Aconteceu em 2026-09-08: `pagina 1/12700: +47 anuncios (acumulado 47 de
 * 304793)` — 304.793 e o site todo; a busca do Lancer tem 206. Este matcher so
 * aceita a chamada cujo parametro `url=` aponta para o nosso searchPath.
 */
// NAO reintroduza um filtro por URL da requisicao. Ja tentamos: o formato exato
// da chamada que a SPA faz e suposicao nossa, e errar a suposicao faz ignorar a
// resposta boa e expirar o prazo — foi a causa de 3 coletas perdidas em
// 2026-09-08. Julgue pelo CONTEUDO, com esperarBuscaCerta() abaixo.

/**
 * Espera a busca CERTA, julgando pelo CONTEUDO e nao pela URL.
 *
 * Por que nao `page.waitForResponse` com filtro de URL: o formato exato da
 * chamada que a SPA faz e uma suposicao nossa, e adivinhar errado significa
 * ignorar a resposta boa e expirar. Foi o que aconteceu em todas as tentativas
 * de 2026-09-08 ("nao vi a chamada da SPA"), inclusive nas que o usuario
 * resolveu o CAPTCHA em 12-15 segundos.
 *
 * Aqui escutamos TODA resposta de /api/search/car e aceitamos a primeira cujo
 * payload tenha `SearchResults` e cujo `SEO.Canonical` bata com o nosso path.
 * Payload de outra busca (destaques, recomendados, estoque do site inteiro) nao
 * resolve a promessa: seguimos ouvindo ate a certa chegar ou o prazo acabar.
 */
function esperarBuscaCerta(page, searchPath, timeout) {
  return new Promise((resolve) => {
    let pronto = false;

    const finalizar = (valor) => {
      if (pronto) return;
      pronto = true;
      clearTimeout(timer);
      page.off('response', aoResponder);
      resolve(valor);
    };

    const aoResponder = async (r) => {
      if (pronto) return;
      if (!r.url().includes(SEARCH_API)) return;
      if (r.request().method() !== 'GET' || r.status() !== 200) return;

      const data = await r.json().catch(() => null);
      if (!data || !Array.isArray(data.SearchResults)) return;

      if (!payloadMatchesPath(data, searchPath)) {
        log.warn(`ignorando busca alheia (canonical: ${data?.SEO?.Canonical ?? '?'})`);
        return; // continua ouvindo
      }
      finalizar(data);
    };

    const timer = setTimeout(() => finalizar(null), timeout);
    page.on('response', aoResponder);
  });
}

/**
 * Segunda barreira, agora sobre o conteudo: o payload traz `SEO.Canonical` com
 * a URL canonica da busca. Se ela nao bate com o que pedimos, o payload e de
 * outra busca — descartar e melhor que gravar carro errado.
 */
function payloadMatchesPath(data, searchPath) {
  const canonical = data?.SEO?.Canonical;
  if (!canonical) return true; // sem canonical nao da para julgar; nao reprova
  return String(canonical).includes(searchPath);
}

/** Procura, em qualquer profundidade do __NEXT_DATA__, um objeto com SearchResults. */
function findSearchResults(root, depth = 0) {
  if (!root || typeof root !== 'object' || depth > 8) return null;
  if (Array.isArray(root.SearchResults)) return root;
  for (const value of Object.values(root)) {
    const hit = findSearchResults(value, depth + 1);
    if (hit) return hit;
  }
  return null;
}
