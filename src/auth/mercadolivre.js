// Gerenciador de token do Mercado Livre.
//
// O access_token do ML vale 6 HORAS. Guardar um token fixo no .env nao funciona:
// ele morre no meio do dia e a coleta para em silencio. Entao os tokens vivem em
// data/ml-tokens.json e sao renovados sozinhos pelo refresh_token (que vale ~6 meses).
//
// Ordem de precedencia:
//   1. data/ml-tokens.json  (gerado por `npm run ml:auth`, com renovacao automatica)
//   2. ML_ACCESS_TOKEN do .env  (fallback manual, sem renovacao)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('auth:ml');

const DIR = resolve(process.cwd(), 'data');
mkdirSync(DIR, { recursive: true });
export const TOKEN_FILE = resolve(DIR, 'ml-tokens.json');

export const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
export const AUTH_URL = 'https://auth.mercadolivre.com.br/authorization';

// Renova um pouco antes de expirar, para nao correr o risco de usar um token
// que morre no meio de uma rodada de coleta.
const RENEW_MARGIN_MS = 10 * 60 * 1000;

export function readTokens() {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function saveTokens(payload) {
  const tokens = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    user_id: payload.user_id ?? null,
    scope: payload.scope ?? null,
    // expires_in vem em segundos (normalmente 21600 = 6h)
    expires_at: Date.now() + (payload.expires_in ?? 21600) * 1000,
    saved_at: new Date().toISOString(),
  };
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  return tokens;
}

/** Troca de codigo/refresh por token. Parametros vao no BODY, nunca na query. */
async function postToken(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`resposta invalida do ML (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} — ${data.error ?? 'erro'}: ${data.message ?? data.error_description ?? text.slice(0, 200)}`,
    );
  }
  return data;
}

/** Primeira autorizacao: troca o `code` da URL de callback pelos tokens. */
export async function exchangeCode(code, redirectUri) {
  const data = await postToken({
    grant_type: 'authorization_code',
    client_id: config.ml.clientId,
    client_secret: config.ml.clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  return saveTokens(data);
}

/** Renovacao usando o refresh_token. O ML devolve um refresh_token NOVO: sempre salve. */
export async function refreshTokens(refreshToken) {
  const data = await postToken({
    grant_type: 'refresh_token',
    client_id: config.ml.clientId,
    client_secret: config.ml.clientSecret,
    refresh_token: refreshToken,
  });
  log.info('access token renovado');
  return saveTokens(data);
}

/**
 * Token valido para usar agora. Renova sozinho quando esta perto de expirar.
 * @returns {Promise<string>}
 */
export async function getAccessToken() {
  const tokens = readTokens();

  if (!tokens) {
    if (config.ml.accessToken) {
      log.warn('usando ML_ACCESS_TOKEN do .env (sem renovacao automatica — expira em 6h)');
      return config.ml.accessToken;
    }
    throw new Error(
      'Nenhum token do Mercado Livre. Rode `npm run ml:auth` para autorizar o app.',
    );
  }

  if (Date.now() < tokens.expires_at - RENEW_MARGIN_MS) return tokens.access_token;

  if (!tokens.refresh_token) {
    throw new Error(
      'Token expirado e sem refresh_token. Rode `npm run ml:auth` pedindo o escopo offline_access.',
    );
  }

  const renewed = await refreshTokens(tokens.refresh_token);
  return renewed.access_token;
}

/** URL para a qual o usuario deve ser mandado no navegador. */
export function buildAuthUrl(redirectUri, state = 'consulta-carros') {
  const url = new URL(AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.ml.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}
