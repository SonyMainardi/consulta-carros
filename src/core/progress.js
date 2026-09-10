// Estado da coleta em andamento, para o painel poder mostrar progresso.
//
// Existe porque uma coleta leva ~6 minutos (5 paginas x 60-80s de rate limit).
// Sem isso o botao "Coletar agora" fica mudo esse tempo todo e parece travado —
// foi exatamente a queixa do usuario em 2026-09-08.
//
// De proposito e um modulo bobo, em memoria: progresso nao e dado de negocio,
// nao vai para o banco e pode se perder num restart sem prejuizo nenhum.

const state = {
  running: false,
  // Qual fonte esta sendo coletada (null = todas). O painel tem um botao por
  // portal desde 2026-09-09; sem isto ele nao sabe QUAL botao pintar quando a
  // pagina abre no meio de uma coleta.
  source: null,
  startedAt: null,
  finishedAt: null,
  step: null, // texto curto: "webmotors pagina 3/5 — 141 anuncios"
  stats: null, // stats da ultima rodada concluida
  error: null, // mensagem do ultimo erro, se houve

  // Numeros estruturados, para o painel desenhar a barra sem interpretar texto.
  // `totalPages` so e conhecido depois da 1a pagina responder (vem do Count do
  // payload) — ate la a barra fica em modo indeterminado, o que e honesto:
  // a 1a pagina inclui abrir o navegador e um eventual CAPTCHA.
  page: null,
  totalPages: null,
  collected: null,
  total: null,

  // A coleta parou e depende de UMA PESSOA (CAPTCHA na janela do navegador).
  // Sem isto o painel diz "Coletando..." enquanto o sistema espera o usuario —
  // que esta olhando o painel, nao a janela. Foi assim que a coleta das 01:20
  // de 2026-09-08 expirou depois de 5 minutos de espera silenciosa.
  needsHuman: false,
  needsHumanText: null,
};

export function startProgress(source = null) {
  state.running = true;
  state.source = source;
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.step = 'iniciando';
  state.error = null;
  state.page = null;
  state.totalPages = null;
  state.collected = null;
  state.total = null;
  state.needsHuman = false;
  state.needsHumanText = null;
}

/**
 * Marca que a coleta esta travada esperando uma acao humana.
 * O painel usa isto para gritar, em vez de fingir que esta trabalhando.
 */
export function setNeedsHuman(needs, text = null) {
  state.needsHuman = Boolean(needs);
  state.needsHumanText = needs ? text : null;
}

export function setStep(text, meta = {}) {
  if (!state.running) return;
  state.step = text;
  if (meta.page != null) state.page = meta.page;
  if (meta.totalPages != null) state.totalPages = meta.totalPages;
  if (meta.collected != null) state.collected = meta.collected;
  if (meta.total != null) state.total = meta.total;
}

export function endProgress({ stats = null, error = null } = {}) {
  state.running = false;
  state.finishedAt = Date.now();
  state.step = null;
  state.needsHuman = false;
  state.needsHumanText = null;
  if (stats) state.stats = stats;
  if (error) state.error = error;
}

export function getProgress() {
  return {
    ...state,
    elapsedMs: state.running && state.startedAt ? Date.now() - state.startedAt : null,
  };
}
