// Serializa requisicoes por host, com intervalo minimo + jitter aleatorio.
// Cada host tem sua propria fila: fontes diferentes nao esperam umas pelas outras.
import { ritmoDoHost } from '../config.js';

const lastHit = new Map(); // host -> timestamp da ultima batida
const queues = new Map(); // host -> Promise (cadeia serial)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function acquire(host, opts = {}) {
  // Cada host pode ter ritmo proprio (config.http.porHost): o Webmotors e o
  // unico que pagina e anda em 30-40 s desde 2026-09-15, enquanto o padrao dos
  // outros segue em 60-80 s.
  const ritmo = ritmoDoHost(host);
  const minInterval = opts.minIntervalMs ?? ritmo.minIntervalMs;
  const jitter = opts.jitterMs ?? ritmo.jitterMs;

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
