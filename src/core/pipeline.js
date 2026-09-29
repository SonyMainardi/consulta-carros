// Orquestra uma rodada de coleta.
//
//   carro -> adapter.search -> normalize -> a pagina e deste carro?
//         -> upsert -> vinculo por modelo -> eventos -> ausentes
//
// Cada par (carro, fonte) e isolado: se a OLX estiver bloqueada, ML e Webmotors
// seguem normalmente e o erro vira uma linha em fetch_runs.
//
// O QUE MUDOU EM 2026-09-16 (ESTADO.md 2-X)
// A unidade deixou de ser a "busca salva" de alguem e passou a ser o MODELO do
// catalogo. A coleta e um cache do mundo: serve a todo mundo que pedir aquele
// carro, e por isso NAO filtra por km, preco, ano ou versao — isso e recorte de
// quem le (src/db/recorte.js). Aqui so se confere identidade: marca + modelo.
//
// AS REGRAS QUE CONTINUAM VALENDO (vinham de 2-S):
// 1. Pagina que nao e do carro pedido (slug errado, redirecionamento) faz a
//    rodada FALHAR — nada e gravado e nada e marcado como sumido. Alem disso o
//    endereco daquele (modelo, portal) e marcado QUEBRADO no catalogo.
// 2. "Ativo" e por modelo (listing_modelos.ativo), nao do anuncio.
// 3. Ausente so vira "saiu do ar" quando a coleta viu a busca INTEIRA. Coleta
//    parcial (1a pagina da OLX/ML, teto de paginas do Webmotors, pagina que
//    falhou) tira o anuncio da tela em silencio: FORA_DA_JANELA.
// 4. "Reanunciado" so para quem tinha "saido do ar".
//
// E uma regra nova:
// 5. EVENTO SO PARA MODELO ACOMPANHADO. Novo, baixou preco e sumiu exigem
//    coleta repetida para significarem alguma coisa. Numa busca ao vivo, que
//    acontece uma vez porque alguem pediu, todos os 208 anuncios seriam
//    "novos" — ruido pelo qual ninguem pediu. O cache e o historico de preco
//    sao gravados sempre; o FEED de eventos so para quem marcou "acompanhar".
import { getAdapter } from '../adapters/index.js';
import { AdapterError } from '../adapters/base.js';
import { toListing, motivoDescarteColeta, conferirIdentidade } from './normalize.js';
import { fingerprint } from './fingerprint.js';
import {
  upsertListing, recordPrice, setFipe,
  ativarVinculo, ativosNaoVistos, inativarVinculos, recalcularAtivo,
} from '../db/repositories/listings.js';
import { createEvent } from '../db/repositories/events.js';
import { logRun } from '../db/repositories/coletas.js';
import { marcarEndereco } from '../db/repositories/catalogo.js';
import { closeBrowser } from '../http/browser.js';
import { setEtapa, setPlano, etapaConcluida, comFonte } from './progress.js';
import { PAGINAS_POR_BUSCA } from './orcamento.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('pipeline');

// Variacao de preco abaixo disso e reajuste de centavos, nao noticia.
const PRICE_NOISE = 100;

/**
 * Adapter antigo (ou stub de teste) que devolve lista pura nao informa
 * cobertura — e cobertura desconhecida conta como parcial.
 */
function comoResultado(resposta) {
  if (Array.isArray(resposta)) return { itens: resposta, total: null, paginas: null, completa: false };
  return {
    itens: resposta?.itens ?? [],
    total: resposta?.total ?? null,
    paginas: resposta?.paginas ?? null,
    completa: resposta?.completa === true,
  };
}

async function collectOne(carro, sourceName, stats) {
  const started = Date.now();
  const adapter = getAdapter(sourceName);
  const eventos = carro.acompanhado === true; // regra 5
  let resultado = null;

  try {
    resultado = comoResultado(await adapter.search(carro, { maxPaginas: PAGINAS_POR_BUSCA[sourceName] }));

    const vistos = resultado.itens
      .map((r) => toListing(sourceName, r))
      .filter((l) => l.external_id && l.external_id !== 'undefined' && l.url);

    // Regra 1: a pagina e deste carro?
    const identidade = conferirIdentidade(vistos, carro);
    if (!identidade.ok) {
      const motivo = `so ${identidade.casam} de ${identidade.total} anuncios sao desse carro`;
      // O catalogo aprende: este endereco esta errado para este portal, e
      // aparece na tela de manutencao para conserto — que vale para todos.
      await marcarEndereco(carro.id, sourceName, 'QUEBRADO', motivo);
      throw new AdapterError(
        `a pagina nao parece ser de ${carro.brand} ${carro.model}: ${motivo}`,
        {
          source: sourceName,
          hint: 'Slug de marca/modelo errado neste portal, ou o portal redirecionou. Corrija o endereco no catalogo.',
        },
      );
    }

    // So identidade: km, preco, ano e versao sao recorte de quem le.
    const casados = [];
    const descartes = {};
    for (const listing of vistos) {
      const motivo = motivoDescarteColeta(listing, carro);
      if (!motivo) { casados.push(listing); continue; }
      descartes[motivo] = (descartes[motivo] ?? 0) + 1;
    }

    const afetados = [];
    for (const listing of casados) {
      const { id, previous } = await upsertListing(listing, fingerprint(listing));
      afetados.push(id);
      const vinculo = await ativarVinculo(id, carro.id); // regra 2

      // Fonte que ja entrega a razao FIPE (Webmotors) dispensa o enrich depois.
      if (listing.fipe_ratio != null && listing.price != null) {
        await setFipe(id, {
          code: null,
          price: Math.round(listing.price / listing.fipe_ratio),
          ratio: listing.fipe_ratio,
        });
      }

      if (!previous) await recordPrice(id, listing.price, listing.km);

      if (!vinculo) {
        // Novo PARA ESTE MODELO — o anuncio pode ja existir, visto por outro.
        if (eventos) await createEvent(id, carro.id, 'NEW', { price: listing.price, km: listing.km });
        stats.new += 1;
      } else if (vinculo.ativo === 0 && vinculo.motivo_inativo === 'SUMIU') {
        if (eventos) await createEvent(id, carro.id, 'RELISTED', { price: listing.price }); // regra 4
        stats.relisted += 1;
      }

      if (!previous) continue;

      // Preco e km sao do anuncio: o historico e gravado sempre, mesmo sem
      // acompanhamento — e o material bruto, e sai de graca.
      const before = previous.price == null ? null : Number(previous.price);
      const after = listing.price;
      if (before != null && after != null && Math.abs(after - before) >= PRICE_NOISE) {
        await recordPrice(id, after, listing.km);
        const type = after < before ? 'PRICE_DROP' : 'PRICE_UP';
        const pct = ((after - before) / before) * 100;
        if (eventos) {
          await createEvent(id, carro.id, type, {
            from: before,
            to: after,
            diff: after - before,
            pct: Number(pct.toFixed(2)),
          });
        }
        stats[after < before ? 'drops' : 'ups'] += 1;
      }

      // Km caindo entre coletas e sinal de anuncio remontado ou erro de digitacao.
      if (eventos && previous.km != null && listing.km != null && listing.km < previous.km - 500) {
        await createEvent(id, carro.id, 'KM_CHANGED', { from: previous.km, to: listing.km });
      }
    }

    // Regra 3: ausentes.
    let ausentes = [];
    if (vistos.length === 0) {
      log.warn(`${carro.slug}/${sourceName}: a busca veio vazia — nada marcado como sumido`);
    } else {
      ausentes = await ativosNaoVistos(carro.id, sourceName, vistos.map((l) => l.external_id));
      if (resultado.completa) {
        await inativarVinculos(carro.id, ausentes.map((a) => a.id), 'SUMIU');
        if (eventos) {
          for (const a of ausentes) {
            await createEvent(a.id, carro.id, 'DISAPPEARED', { last_price: a.price });
          }
        }
        stats.vanished += ausentes.length;
      } else {
        await inativarVinculos(carro.id, ausentes.map((a) => a.id), 'FORA_DA_JANELA');
        stats.foraDaJanela += ausentes.length;
      }
    }

    await recalcularAtivo([...afetados, ...ausentes.map((a) => a.id)]);

    // O endereco funcionou: o catalogo guarda isso para nao ficar "PADRAO"
    // (nunca conferido) em algo que ja provou funcionar.
    if (carro.estados?.[sourceName] !== 'CONFIRMADO') {
      await marcarEndereco(carro.id, sourceName, 'CONFIRMADO', null);
    }

    const cobertura = resultado.completa ? 'COMPLETA' : 'PARCIAL';
    if (!resultado.completa) stats.parciais.push(`${carro.name} / ${sourceName}`);
    await logRun({
      source: sourceName,
      modeloId: carro.id,
      status: 'OK',
      itemsFound: casados.length,
      totalBusca: resultado.total,
      paginas: resultado.paginas,
      cobertura,
      durationMs: Date.now() - started,
      startedAt: started,
    });

    const motivos = Object.entries(descartes).map(([m, n]) => `${m} ${n}`).join(', ');
    log.info(
      `${carro.slug}/${sourceName}: ${casados.length} anuncios (de ${vistos.length} vistos` +
      `${resultado.total ? `; a busca tem ${resultado.total}` : ''}) · cobertura ${cobertura.toLowerCase()}` +
      `${motivos ? ` · fora do carro: ${motivos}` : ''}` +
      `${ausentes.length ? ` · ausentes: ${ausentes.length} (${resultado.completa ? 'sairam do ar' : 'fora da janela'})` : ''}`,
    );
    return { ok: true, count: casados.length };
  } catch (err) {
    await logRun({
      source: sourceName,
      modeloId: carro.id,
      status: 'FAILED',
      totalBusca: resultado?.total ?? null,
      paginas: resultado?.paginas ?? null,
      httpStatus: err.status ?? null,
      durationMs: Date.now() - started,
      startedAt: started,
      error: err.message,
    });
    log.error(`${carro.slug}/${sourceName} falhou: ${err.message}`, err.hint ? { hint: err.hint } : undefined);
    return { ok: false, error: err.message };
  }
}

/**
 * Uma rodada de coleta.
 *
 * @param {object} opcoes
 * @param {object[]} opcoes.carros  carros do catalogo (src/db/repositories/catalogo.js)
 * @param {string[]} [opcoes.fontes]  portais; vazio = os que cada carro tem endereco
 */
export async function runCollection({ carros = [], fontes = null } = {}) {
  const filtro = fontes?.length ? fontes : null;

  // O plano inteiro antes de comecar: e o que da "etapa 2 de 6" ao painel.
  const plano = carros.flatMap((carro) =>
    (carro.sources ?? [])
      .filter((fonte) => !filtro || filtro.includes(fonte))
      .map((fonte) => ({ carro, fonte })));

  if (!plano.length) {
    log.warn('nada a coletar — nenhum carro com esses portais');
    return null;
  }

  const stats = {
    new: 0, drops: 0, ups: 0, vanished: 0, relisted: 0, failures: 0,
    foraDaJanela: 0, parciais: [], erros: [],
  };
  // Um trabalhador POR PORTAL, todos ao mesmo tempo (decisao do usuario em
  // 2026-09-15, ESTADO.md 2-W). Dentro de cada portal os carros seguem um de
  // cada vez, e o rateLimiter continua serializando por host: o paralelismo e
  // ENTRE sites diferentes, nunca dentro do mesmo — o ritmo que cada portal
  // recebe nao muda. Antes, a OLX de um carro (2 s) esperava o Webmotors
  // daquele carro terminar (10 min).
  const porFonte = new Map();
  for (const etapa of plano) {
    if (!porFonte.has(etapa.fonte)) porFonte.set(etapa.fonte, []);
    porFonte.get(etapa.fonte).push(etapa);
  }
  setPlano(Object.fromEntries([...porFonte].map(([fonte, etapas]) => [fonte, etapas.length])));

  try {
    const trabalhos = [...porFonte].map(([fonte, etapas]) => comFonte(fonte, async () => {
      let falhas = 0;
      for (const [i, { carro }] of etapas.entries()) {
        setEtapa({ busca: carro.name, buscaId: carro.id, fonte, indice: i + 1, total: etapas.length });

        // Circuit breaker: portal que ja falhou N vezes nesta rodada esta fechado.
        if (falhas >= config.http.circuitBreaker) {
          log.warn(`pulando ${carro.slug}/${fonte} (circuit breaker aberto nesta rodada)`);
          await logRun({ source: fonte, modeloId: carro.id, status: 'SKIPPED', startedAt: Date.now() });
          etapaConcluida(fonte);
          continue;
        }

        const result = await collectOne(carro, fonte, stats);
        if (!result.ok) {
          stats.failures += 1;
          stats.erros.push(`${carro.name} / ${fonte}: ${result.error}`);
          falhas += 1;
        }
        etapaConcluida(fonte);
      }
    }));

    // allSettled, e nao all: se um portal estourar por erro inesperado, os
    // outros terminam o que estavam fazendo em vez de ficarem orfaos com o
    // navegador fechando debaixo deles.
    for (const r of await Promise.allSettled(trabalhos)) {
      if (r.status === 'rejected') log.error(`um portal parou por erro inesperado: ${r.reason?.message ?? r.reason}`);
    }
  } finally {
    // Se alguma fonte usou o navegador, ele fecha aqui. Sem isso o Chromium
    // fica aberto e o processo do CLI nunca termina. No-op quando nao foi usado.
    // `fimDaRodada` libera os hosts que ficaram bloqueados nesta rodada.
    await closeBrowser({ fimDaRodada: true });
  }

  log.info('rodada concluida', stats);
  return stats;
}
