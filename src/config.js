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
  // Tetos do PAINEL — recorte de exibicao, nao de coleta.
  //
  // A coleta continua guardando tudo o que a busca traz (o `matchesWatch` e
  // quem decide o que entra no banco). Estes tetos so decidem o que APARECE na
  // tela, e por isso mudar de ideia e instantaneo: nao exige recoletar nada,
  // nem apaga historico, nem inventa evento de "saiu do ar" para anuncio que
  // continua no ar. 0 (ou vazio) desliga o teto.
  panel: {
    priceMax: int(process.env.PANEL_PRICE_MAX, 100000),
    kmMax: int(process.env.PANEL_KM_MAX, 100000),
  },
  collect: {
    cron: process.env.COLLECT_CRON ?? '7 * * * *',
    onBoot: bool(process.env.COLLECT_ON_BOOT, false),
  },
  http: {
    minIntervalMs: int(process.env.HTTP_MIN_INTERVAL_MS, 12000),
    jitterMs: int(process.env.HTTP_JITTER_MS, 6000),
    timeoutMs: int(process.env.HTTP_TIMEOUT_MS, 25000),
    maxRetries: int(process.env.HTTP_MAX_RETRIES, 3),
    circuitBreaker: int(process.env.SOURCE_CIRCUIT_BREAKER, 4),
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
