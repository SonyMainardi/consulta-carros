// Estado da coleta em andamento, para o painel poder mostrar progresso.
//
// Existe porque uma coleta leva minutos (rate limit entre paginas). Sem isso o
// botao fica mudo esse tempo todo e parece travado — foi exatamente a queixa do
// usuario em 2026-09-08.
//
// De proposito e um modulo bobo, em memoria: progresso nao e dado de negocio,
// nao vai para o banco e pode se perder num restart sem prejuizo nenhum.
//
// PORTAIS EM PARALELO (2026-09-15, ESTADO.md 2-W): cada portal roda num
// "trabalhador" proprio e tem o seu progresso em `fontes`. Os adapters
// continuam chamando setStep() sem dizer de qual portal sao — quem sabe e o
// AsyncLocalStorage que o pipeline abre com comFonte(). Assim os adapters
// seguem descartaveis: nao precisaram mudar.
import { AsyncLocalStorage } from 'node:async_hooks';

const contexto = new AsyncLocalStorage();

/** Roda `fn` marcando que tudo dentro dela (inclusive depois dos awaits) e do portal `fonte`. */
export const comFonte = (fonte, fn) => contexto.run({ fonte }, fn);

const fonteAtual = () => contexto.getStore()?.fonte ?? null;

// Quando varios portais rodam, os campos "planos" do progresso (fonte, page,
// totalPages...) mostram o que pede uma pessoa; senao, o primeiro desta ordem
// que ainda trabalha — o Webmotors, que e o que demora.
const DESTAQUE = ['webmotors', 'olx', 'mercadolivre'];
const ordem = (fonte) => {
  const i = DESTAQUE.indexOf(fonte);
  return i < 0 ? 99 : i;
};

const novoPortal = () => ({
  busca: null,
  buscaId: null,
  etapa: 0,
  etapas: 0,
  step: null,
  page: null,
  totalPages: null,
  collected: null,
  total: null,
  // A coleta parou e depende de UMA PESSOA (CAPTCHA na janela do navegador).
  // Sem isto o painel diz "Coletando..." enquanto o sistema espera o usuario —
  // foi assim que a coleta das 01:20 de 2026-09-08 expirou em silencio.
  needsHuman: false,
  needsHumanText: null,
  terminou: false,
});

const state = {
  running: false,
  // Portal do botao clicado (null = modal, que pode pedir varios). O painel
  // usa para saber QUAL botao pintar quando abre no meio de uma coleta.
  source: null,
  buscas: null,
  startedAt: null,
  finishedAt: null,
  stats: null, // stats da ultima rodada concluida
  error: null, // mensagem do ultimo erro, se houve
  etapas: 0, // total de etapas (busca x portal) da rodada
  concluidas: 0,
  fontes: {}, // portal -> novoPortal()
};

// Chamadas fora de um portal (probe, teste do navegador).
let solto = novoPortal();

const portal = (fonte = fonteAtual()) => {
  if (!fonte) return solto;
  state.fontes[fonte] ??= novoPortal();
  return state.fontes[fonte];
};

/** @param {{fonte?: string|null, buscas?: number[]|null}} [pedido] */
export function startProgress({ fonte = null, buscas = null } = {}) {
  Object.assign(state, {
    running: true,
    source: fonte,
    buscas,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    etapas: 0,
    concluidas: 0,
    fontes: {},
  });
  solto = novoPortal();
}

/** O plano da rodada: quantas etapas cada portal vai fazer. */
export function setPlano(etapasPorFonte) {
  if (!state.running) return;
  state.fontes = Object.fromEntries(
    Object.entries(etapasPorFonte).map(([fonte, n]) => [fonte, { ...novoPortal(), etapas: n }]),
  );
  state.etapas = Object.values(etapasPorFonte).reduce((acc, n) => acc + n, 0);
}

/** Comeca uma etapa (uma busca num portal). A barra daquele portal recomeca. */
export function setEtapa({ busca, buscaId, fonte, indice, total }) {
  if (!state.running) return;
  Object.assign(portal(fonte), {
    busca,
    buscaId,
    etapa: indice,
    etapas: total,
    step: `${busca} · ${fonte}`,
    page: null,
    totalPages: null,
    collected: null,
    total: null,
  });
}

export function etapaConcluida(fonte) {
  if (!state.running) return;
  state.concluidas += 1;
  const p = portal(fonte);
  if (p.etapa >= p.etapas) {
    p.terminou = true;
    p.step = null;
  }
}

/**
 * Marca que a coleta DESTE portal esta travada esperando uma acao humana.
 * O painel usa isto para gritar, em vez de fingir que esta trabalhando.
 */
export function setNeedsHuman(needs, text = null) {
  const p = portal();
  p.needsHuman = Boolean(needs);
  p.needsHumanText = needs ? text : null;
}

export function setStep(text, meta = {}) {
  if (!state.running) return;
  const p = portal();
  p.step = text;
  for (const campo of ['page', 'totalPages', 'collected', 'total']) {
    if (meta[campo] != null) p[campo] = meta[campo];
  }
}

export function endProgress({ stats = null, error = null } = {}) {
  state.running = false;
  state.finishedAt = Date.now();
  for (const p of [...Object.values(state.fontes), solto]) {
    p.needsHuman = false;
    p.needsHumanText = null;
    p.step = null;
  }
  if (stats) state.stats = stats;
  if (error) state.error = error;
}

/**
 * O estado para o painel: `fontes` com o detalhe de cada portal, e os campos
 * "planos" de antes (fonte, busca, page, totalPages, needsHuman...) preenchidos
 * pelo portal em destaque.
 */
export function getProgress() {
  const lista = Object.entries(state.fontes).sort(([a], [b]) => ordem(a) - ordem(b));
  const humano = lista.find(([, p]) => p.needsHuman) ?? (solto.needsHuman ? [null, solto] : null);
  const trabalhando = lista.find(([, p]) => p.etapa > 0 && !p.terminou);
  const [fonte, p] = humano ?? trabalhando ?? lista[0] ?? [null, solto];
  return {
    running: state.running,
    source: state.source,
    buscas: state.buscas,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    stats: state.stats,
    error: state.error,
    etapas: state.etapas,
    concluidas: state.concluidas,
    fontes: state.fontes,
    fonte,
    busca: p.busca,
    buscaId: p.buscaId,
    step: p.step,
    page: p.page,
    totalPages: p.totalPages,
    collected: p.collected,
    total: p.total,
    needsHuman: Boolean(humano),
    needsHumanText: humano ? humano[1].needsHumanText : null,
    elapsedMs: state.running && state.startedAt ? Date.now() - state.startedAt : null,
  };
}
