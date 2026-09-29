// Quanto uma busca pode custar por coleta. Decisao de projeto, num lugar so: o
// pipeline usa para limitar, o painel usa para estimar o tempo.
import { ritmoDoHost } from '../config.js';
import { adapters } from '../adapters/index.js';

/**
 * Teto de paginas por busca, por portal.
 *
 * Webmotors: 5 paginas (~235 anuncios). Era 10 ate o usuario pedir, em
 * 2026-09-15, "ler menos paginas pela metade" (ESTADO.md 2-W). O Lancer (208
 * anuncios) continua cabendo inteiro — e so busca inteira gera "saiu do ar".
 * Modelo popular (HR-V: 113 paginas) fica parcial de proposito.
 *
 * OLX e Mercado Livre: 1 pagina. Nao e escolha nossa: paginar exige `o=` e
 * `_Desde_`, que o robots.txt dos dois proibe (2-H, 2-J).
 */
export const PAGINAS_POR_BUSCA = { webmotors: 5, olx: 1, mercadolivre: 1 };

/** Host de um portal, tirado do formato de endereco do proprio adapter. */
export function hostDoPortal(portal) {
  const formato = adapters[portal]?.endereco;
  return formato ? new URL(formato.replace('{marca}', 'm').replace('{modelo}', 'm')).host : null;
}

/**
 * Segundos por pagina de cada portal, so para a ESTIMATIVA do painel: o
 * intervalo medio do rate limiter daquele host (minimo + metade do jitter) e
 * ~5 s de carregamento. Quem manda no ritmo e o rateLimiter.
 */
export function ritmoPorPortal() {
  return Object.fromEntries(Object.keys(adapters).map((portal) => {
    const r = ritmoDoHost(hostDoPortal(portal));
    return [portal, { intervaloS: Math.round((r.minIntervalMs + r.jitterMs / 2) / 1000), cargaS: 5 }];
  }));
}
