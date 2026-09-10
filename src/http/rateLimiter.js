// Serializa requisicoes por host, com intervalo minimo + jitter aleatorio.
// Cada host tem sua propria fila: fontes diferentes nao esperam umas pelas outras.
import { config } from '../config.js';

const lastHit = new Map(); // host -> timestamp da ultima batida
const queues = new Map(); // host -> Promise (cadeia serial)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function acquire(host, opts = {}) {
  const minInterval = opts.minIntervalMs ?? config.http.minIntervalMs;
  const jitter = opts.jitterMs ?? config.http.jitterMs;

  const prev = queues.get(host) ?? Promise.resolve();
  const next = prev.then(async () => {
    const last = lastHit.get(host) ?? 0;
    const wait = last + minInterval + Math.random() * jitter - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
  });
  queues.set(host, next.catch(() => {}));
  return next;
}

// Usado apos um 429/503: empurra o proximo acesso ao host para o futuro.
export function penalize(host, ms) {
  lastHit.set(host, Date.now() + ms);
}
