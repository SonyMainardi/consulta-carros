import 'dotenv/config';

const bool = (v, def = false) =>
  v === undefined ? def : ['1', 'true', 'yes', 'sim'].includes(String(v).toLowerCase());
const int = (v, def) => (v === undefined || v === '' ? def : Number.parseInt(v, 10));

export const config = {
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'consulta_carros',
  },
  server: { port: int(process.env.PORT, 3000) },
  // Sem agendador e sem coleta ao subir, desde 2026-09-15: toda coleta sai de
  // um clique no painel (ou de `npm run collect`). COLLECT_CRON e
  // COLLECT_ON_BOOT, se ainda estiverem no .env, sao ignorados.
  //
  // Os tetos do painel (PANEL_PRICE_MAX / PANEL_KM_MAX) tambem sairam daqui:
  // viraram limites de cada busca, editaveis no painel. O `db:migrate` copiou
  // o valor do .env para as buscas que ja existiam (ESTADO.md 2-S).
  http: {
    minIntervalMs: int(process.env.HTTP_MIN_INTERVAL_MS, 12000),
    jitterMs: int(process.env.HTTP_JITTER_MS, 6000),
    timeoutMs: int(process.env.HTTP_TIMEOUT_MS, 25000),
    maxRetries: int(process.env.HTTP_MAX_RETRIES, 3),
    circuitBreaker: int(process.env.SOURCE_CIRCUIT_BREAKER, 4),
    // Ritmo PROPRIO de um host, no lugar do padrao acima. Decisao do usuario em
    // 2026-09-15 (ESTADO.md 2-W): o Webmotors e o unico portal que pagina e era
    // o que fazia a coleta demorar — de 60-80 s para 30-40 s entre paginas.
    // OLX e Mercado Livre ficam no padrao (leem uma pagina por busca). Se os
    // CAPTCHAs do Webmotors aumentarem, e aqui (ou no .env) que se volta atras.
    porHost: {
      'www.webmotors.com.br': {
        minIntervalMs: int(process.env.HTTP_WEBMOTORS_INTERVAL_MS, 30000),
        jitterMs: int(process.env.HTTP_WEBMOTORS_JITTER_MS, 10000),
      },
    },
  },
  // Coleta via navegador real (Playwright). Ver src/http/browser.js para o
  // porque: o PerimeterX barra o fetch do Node pelo fingerprint de TLS, nao
  // pelo volume. `headless: false` e o padrao de proposito — headless e o
  // primeiro sinal que essas protecoes procuram, e alguem precisa poder
  // resolver um eventual desafio na janela.
  browser: {
    enabled: bool(process.env.HTTP_USE_BROWSER, false),
    headless: bool(process.env.BROWSER_HEADLESS, false),
  },
  ml: {
    clientId: process.env.ML_CLIENT_ID ?? '',
    clientSecret: process.env.ML_CLIENT_SECRET ?? '',
    accessToken: process.env.ML_ACCESS_TOKEN ?? '',
    refreshToken: process.env.ML_REFRESH_TOKEN ?? '',
  },
  notify: {
    enabled: bool(process.env.NOTIFY_ENABLED, false),
    telegram: {
      token: process.env.TELEGRAM_BOT_TOKEN ?? '',
      chatId: process.env.TELEGRAM_CHAT_ID ?? '',
    },
  },
};

/** O ritmo de um host: o proprio (config.http.porHost) ou o padrao do .env. */
export function ritmoDoHost(host) {
  const proprio = config.http.porHost[host] ?? {};
  return {
    minIntervalMs: proprio.minIntervalMs ?? config.http.minIntervalMs,
    jitterMs: proprio.jitterMs ?? config.http.jitterMs,
  };
}
