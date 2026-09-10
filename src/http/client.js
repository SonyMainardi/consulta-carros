// Cliente HTTP educado: rate limit por host, retry com backoff exponencial,
// respeito a Retry-After, cookies persistentes e User-Agent realista.
import { config } from '../config.js';
import { acquire, penalize } from './rateLimiter.js';
import { cookieHeader, storeCookies } from './cookieJar.js';
import { createLogger } from '../logger.js';

const log = createLogger('http');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};

export class HttpError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = info.status;
    this.url = info.url;
    this.body = info.body;
    this.guard = info.guard; // 'PerimeterX' | 'Cloudflare' | 'DataDome' | 'anti-bot'
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Requisicao com todas as protecoes ligadas.
 * @param {string} url
 * @param {object} opts headers, method, body, json, minIntervalMs, jitterMs,
 *                      maxRetries, timeoutMs, skipRateLimit
 */
export async function request(url, opts = {}) {
  const host = new URL(url).host;
  const maxRetries = opts.maxRetries ?? config.http.maxRetries;
  const timeoutMs = opts.timeoutMs ?? config.http.timeoutMs;

  let attempt = 0;
  let lastErr = null;

  while (attempt <= maxRetries) {
    if (!opts.skipRateLimit) {
      await acquire(host, { minIntervalMs: opts.minIntervalMs, jitterMs: opts.jitterMs });
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const cookies = cookieHeader(host);
      const headers = Object.assign({}, BASE_HEADERS, opts.headers || {});
      if (cookies) headers.Cookie = cookies;

      const res = await fetch(url, {
        method: opts.method || 'GET',
        headers,
        body: opts.body,
        redirect: 'follow',
        signal: ac.signal,
      });

      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      storeCookies(host, setCookies);

      // Limite ou bloqueio temporario: recua de verdade em vez de martelar.
      if (res.status === 429 || res.status === 503) {
        clearTimeout(timer);
        const retryAfter = Number.parseInt(res.headers.get('retry-after') || '', 10);
        const backoff = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : Math.min(60000, Math.pow(2, attempt) * 5000) + Math.random() * 3000;
        penalize(host, backoff);
        log.warn('status ' + res.status + ' em ' + host + ', aguardando ' + Math.round(backoff / 1000) + 's');
        await sleep(backoff);
        attempt += 1;
        continue;
      }

      // 403 quase nunca melhora com retry: normalmente e challenge de bot.
      // Insistir so renova o bloqueio, entao identificamos e desistimos.
      if (res.status === 403) {
        clearTimeout(timer);
        const body = await res.text().catch(() => '');
        let guard = 'anti-bot';
        if (/"appId"|jsClientSrc|_px|perimeterx/i.test(body)) guard = 'PerimeterX';
        else if (/cloudflare|__cf_chl/i.test(body)) guard = 'Cloudflare';
        else if (/datadome/i.test(body)) guard = 'DataDome';
        // Segura o host por um bom tempo: novas tentativas so pioram.
        penalize(host, 15 * 60 * 1000);
        throw new HttpError(`403 em ${host} (bloqueio ${guard})`, {
          status: 403,
          url,
          guard,
          body: body.slice(0, 500),
        });
      }

      if (!res.ok) {
        clearTimeout(timer);
        const body = await res.text().catch(() => '');
        if (res.status >= 500 && attempt < maxRetries) {
          const backoff = Math.pow(2, attempt) * 2000 + Math.random() * 1000;
          log.warn('status ' + res.status + ' em ' + host + ', retry em ' + Math.round(backoff / 1000) + 's');
          await sleep(backoff);
          attempt += 1;
          continue;
        }
        throw new HttpError('HTTP ' + res.status + ' em ' + url, {
          status: res.status,
          url,
          body: body.slice(0, 500),
        });
      }

      clearTimeout(timer);
      const text = await res.text();
      if (opts.json === false) return { status: res.status, text, headers: res.headers };
      try {
        return { status: res.status, data: JSON.parse(text), text, headers: res.headers };
      } catch {
        return { status: res.status, text, headers: res.headers };
      }
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof HttpError) throw err;
      lastErr = err;
      if (attempt >= maxRetries) break;
      const backoff = Math.pow(2, attempt) * 2000 + Math.random() * 1000;
      log.warn('falha de rede em ' + host + ': ' + err.message + ', retry em ' + Math.round(backoff / 1000) + 's');
      await sleep(backoff);
      attempt += 1;
    }
  }

  throw new HttpError(
    'falhou apos ' + (maxRetries + 1) + ' tentativas: ' + (lastErr ? lastErr.message : 'erro desconhecido'),
    { url },
  );
}

export const getJson = (url, opts = {}) =>
  request(url, {
    ...opts,
    headers: Object.assign({ Accept: 'application/json, text/plain, */*' }, opts.headers || {}),
  });

export const getHtml = (url, opts = {}) =>
  request(url, {
    ...opts,
    json: false,
    headers: Object.assign(
      {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Upgrade-Insecure-Requests': '1',
      },
      opts.headers || {},
    ),
  });
