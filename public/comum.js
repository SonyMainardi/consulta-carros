// Utilitarios do painel, compartilhados pelo app.js e pelo buscas.js (a modal).
// Nada aqui sabe de tela especifica: e o que evita dois modulos com duas
// copias do mesmo formatador de preco.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

/**
 * Chamada a API local. Resposta de erro (4xx/5xx) vira excecao com a mensagem
 * do servidor — a modal mostra "ja existe uma busca para X" em vez de "HTTP 409".
 */
export async function api(caminho, { metodo = 'GET', corpo } = {}) {
  const r = await fetch(caminho, {
    method: metodo,
    headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = { error: texto };
  }
  if (!r.ok) {
    throw Object.assign(new Error(dados?.error ?? dados?.reason ?? `HTTP ${r.status}`), { status: r.status, dados });
  }
  return dados;
}

export const brl = (v) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export const num = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));

export const ago = (iso) => {
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
};

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Nome de exibicao das fontes. O banco guarda o slug ('webmotors'); quem le o
// painel merece o nome escrito certo, com acento e caixa.
export const FONTE_NOME = { webmotors: 'Webmotors', olx: 'OLX', mercadolivre: 'Mercado Livre' };

export const fonteNome = (slug) => FONTE_NOME[slug] ?? slug;

// A ordem e a do interesse pratico, nao a do servidor: primeiro o portal que
// mais traz. Fonte nova que nao estiver aqui entra no fim, em vez de sumir.
export const ORDEM_FONTES = ['webmotors', 'olx', 'mercadolivre'];

export const ordenarFontes = (fontes) => [...fontes].sort((a, b) => {
  const ia = ORDEM_FONTES.indexOf(a);
  const ib = ORDEM_FONTES.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});

/**
 * localStorage so para conveniencia (a busca escolhida no seletor). Pode nao
 * existir (janela anonima, bloqueio): o painel funciona igual sem ele.
 */
export const preferencia = {
  ler(chave, padrao = null) {
    try {
      const v = localStorage.getItem(`consulta-carros:${chave}`);
      return v == null ? padrao : JSON.parse(v);
    } catch {
      return padrao;
    }
  },
  gravar(chave, valor) {
    try {
      localStorage.setItem(`consulta-carros:${chave}`, JSON.stringify(valor));
    } catch { /* sem localStorage, sem preferencia — e so isso */ }
  },
};
