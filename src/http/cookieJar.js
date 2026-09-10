// Cookie jar minimo, persistido em disco por host.
// Sessao estavel entre rodadas reduz muito a chance de challenge anti-bot.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'data', 'cookies');
mkdirSync(DIR, { recursive: true });

const fileFor = (host) => resolve(DIR, host.replace(/[^a-z0-9.-]/gi, '_') + '.json');
const jars = new Map(); // host -> Map(name -> value)

function load(host) {
  if (jars.has(host)) return jars.get(host);
  const jar = new Map();
  const f = fileFor(host);
  if (existsSync(f)) {
    try {
      const saved = JSON.parse(readFileSync(f, 'utf8'));
      for (const [k, v] of Object.entries(saved)) jar.set(k, v);
    } catch {
      // jar corrompido: comeca vazio
    }
  }
  jars.set(host, jar);
  return jar;
}

export function cookieHeader(host) {
  const jar = load(host);
  if (jar.size === 0) return undefined;
  return [...jar].map(([k, v]) => k + '=' + v).join('; ');
}

export function storeCookies(host, setCookieValues) {
  if (!setCookieValues || setCookieValues.length === 0) return;
  const jar = load(host);
  for (const raw of setCookieValues) {
    const pair = raw.split(';')[0];
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  try {
    writeFileSync(fileFor(host), JSON.stringify(Object.fromEntries(jar), null, 2));
  } catch {
    // persistencia e best-effort
  }
}
