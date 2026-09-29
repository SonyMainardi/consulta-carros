// Marcas e modelos: o nome que se mostra, os apelidos que se reconhecem no
// titulo de um anuncio e o slug que cada portal usa na URL.
//
// POR QUE EXISTE (ESTADO.md 2-R/2-S)
// Enquanto so havia o Lancer, `slug('Mitsubishi')` servia nos tres portais.
// Com qualquer marca a mais isso quebra: a OLX escreve `vw-volkswagen`, o
// Mercado Livre e o Webmotors escrevem `volkswagen`, e a FIPE chama a mesma
// marca de "VW - VolksWagen". Esta tabela e o unico lugar que sabe disso.
//
// Modulo puro, sem banco e sem rede: da para testar com `node -e`.

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '');

export const normalizar = (s) => semAcento(s).toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Palavras de um texto, sem acento, sem pontuacao. "HR-V" vira ["hr", "v"] e
 * "Up!" vira ["up"]. E sobre ESTAS listas que se compara marca e modelo —
 * comparar texto cru e o que fazia "Gol" casar com "Golf".
 */
export const tokens = (s) => normalizar(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

export const slugify = (s) => tokens(s).join('-');

/** `agulha` aparece em `palheiro` como sequencia de palavras inteiras? */
export function contemSequencia(palheiro, agulha) {
  if (!agulha.length) return true;
  for (let i = 0; i + agulha.length <= palheiro.length; i += 1) {
    let igual = true;
    for (let j = 0; j < agulha.length; j += 1) {
      if (palheiro[i + j] !== agulha[j]) { igual = false; break; }
    }
    if (igual) return true;
  }
  return false;
}

/**
 * Ajustes por marca, pela chave normalizada do nome na FIPE.
 *
 * `slugs` so lista o portal que FOGE do padrao slugify(nome). Tudo que nao
 * esta aqui usa o padrao — e se o padrao estiver errado para alguma marca, a
 * coleta falha com "a página não é da busca pedida" em vez de gravar carro
 * errado, e o slug se corrige no cadastro da busca (painel, "endereço em cada
 * portal").
 */
const AJUSTES = {
  // Visto em 2026-09-15 nos links da propria pagina salva da OLX
  // (data/probe-olx-browser.html): /carros-vans-e-utilitarios/vw-volkswagen/gol
  'vw - volkswagen': { nome: 'Volkswagen', apelidos: ['VW'], slugs: { olx: 'vw-volkswagen' } },
  // Mesmo padrao da VW na OLX. NAO verificado — a primeira coleta confirma.
  'gm - chevrolet': { nome: 'Chevrolet', apelidos: ['GM'], slugs: { olx: 'gm-chevrolet' } },
  'kia motors': { nome: 'Kia', apelidos: ['Kia Motors'] },
  'caoa chery/chery': { nome: 'Chery', apelidos: ['Caoa Chery'] },
  'caoa chery': { apelidos: ['Chery'] },
  'mercedes-benz': { apelidos: ['Mercedes'] },
  'land rover': { apelidos: ['Land-Rover'] },
  'rolls-royce': { apelidos: ['Rolls Royce'] },
};

/** "GREAT WALL" -> "Great Wall"; siglas curtas (BMW, JAC, RAM) ficam como estao. */
function capitalizar(nome) {
  const s = String(nome ?? '').trim();
  const soMaiuscula = s === s.toUpperCase() && /[A-Z]{4,}/.test(s);
  const soMinuscula = s === s.toLowerCase();
  if (!soMaiuscula && !soMinuscula) return s;
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, sep, letra) => sep + letra.toUpperCase());
}

const ajusteDe = (nome) => {
  const chave = normalizar(nome);
  if (AJUSTES[chave]) return AJUSTES[chave];
  // Pelo nome de exibicao tambem: a busca guarda "Volkswagen", nao o nome FIPE.
  return Object.values(AJUSTES).find((a) => a.nome && normalizar(a.nome) === chave) ?? null;
};

/** Nome de exibicao de uma marca vinda da FIPE ("VW - VolksWagen" -> "Volkswagen"). */
export function nomeDaMarca(nomeFipe) {
  return ajusteDe(nomeFipe)?.nome ?? capitalizar(nomeFipe);
}

/** Formas pelas quais a marca aparece num anuncio. A primeira e o proprio nome. */
export function apelidosDaMarca(nome) {
  const ajuste = ajusteDe(nome);
  const lista = [nome, ajuste?.nome, ...(ajuste?.apelidos ?? [])].filter(Boolean);
  const vistos = new Set();
  return lista.filter((a) => {
    const k = normalizar(a);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

export const PORTAIS = ['webmotors', 'olx', 'mercadolivre'];

/**
 * Slugs padrao de uma busca em cada portal. Sao gravados na busca quando ela e
 * criada (watches.params), e nao recalculados a cada coleta: mudar esta tabela
 * nao pode trocar em silencio o endereco de uma busca que ja funciona.
 */
export function slugsDaBusca(marca, modelo) {
  const ajuste = ajusteDe(marca);
  return Object.fromEntries(PORTAIS.map((p) => [p, {
    marca: ajuste?.slugs?.[p] ?? slugify(ajuste?.nome ?? marca),
    modelo: slugify(modelo),
  }]));
}

/**
 * Palavras de uma VERSAO. Diferente de tokens(): o ponto dentro de numero fica
 * ("2.0" continua "2.0"), porque em versao ele distingue motor — "2.0 GT" nao
 * pode casar com um titulo que so tem "1.0", "2" e "GT" soltos.
 */
export const tokensVersao = (s) => normalizar(s)
  .replace(/[^a-z0-9.]+/g, ' ')
  .split(' ')
  .map((t) => t.replace(/^\.+|\.+$/g, ''))
  .filter(Boolean);

/**
 * Confere um modelo DIGITADO contra os modelos (agrupados) da FIPE de uma marca.
 *
 * Existe por causa do teste do Vectra GT (ESTADO.md 2-T): "GT" e versao nos
 * enderecos do Webmotors e da OLX, e a busca com modelo "Vectra GT" falhou nos
 * dois. Quando o digitado nao esta na lista mas COMECA por um modelo dela, a
 * sugestao e separar: modelo "Vectra" + versao "GT".
 *
 * @param {string} digitado
 * @param {Array<{nome: string}>} modelosAgrupados  saida de agruparModelosFipe()
 * @returns {{ naLista: boolean, sugestao: { modelo: string, versao: string } | null }}
 */
export function conferirModelo(digitado, modelosAgrupados) {
  const alvo = tokens(digitado);
  if (!alvo.length) return { naLista: false, sugestao: null };
  const lista = (modelosAgrupados ?? []).map((m) => ({ nome: m.nome, t: tokens(m.nome) }));
  if (lista.some((m) => m.t.join(' ') === alvo.join(' '))) return { naLista: true, sugestao: null };

  // O MAIOR modelo da lista que e prefixo do digitado ("Space Wagon" antes de "Space").
  const prefixo = lista
    .filter((m) => m.t.length && m.t.length < alvo.length && m.t.every((p, i) => p === alvo[i]))
    .sort((a, b) => b.t.length - a.t.length)[0];
  if (!prefixo) return { naLista: false, sugestao: null };

  // A versao sai do texto como a pessoa escreveu. Consome palavras do digitado
  // ate cobrir as do modelo: "HR V EXL" com o modelo "HR-V" deixa "EXL".
  const palavras = String(digitado).trim().split(/\s+/);
  let cobertas = 0;
  let i = 0;
  while (i < palavras.length && cobertas < prefixo.t.length) {
    cobertas += tokens(palavras[i]).length;
    i += 1;
  }
  const versao = palavras.slice(i).join(' ');
  return { naLista: false, sugestao: versao ? { modelo: prefixo.nome, versao } : null };
}

// Primeiras palavras que nao sao modelo sozinhas: "Grand Siena", "Range Rover
// Evoque", "Classe C", "Space Fox".
const PREFIXOS_COMPOSTOS = new Set(['grand', 'range', 'new', 'nova', 'novo', 'classe', 'serie', 'space', 'santa']);

const capitalizarModelo = (palavra) =>
  (/^[A-Z]{4,}$/.test(palavra) ? palavra[0] + palavra.slice(1).toLowerCase() : palavra);

/**
 * A FIPE lista VERSOES ("Lancer GT 2.0 16V 160cv Aut."): 218 so na Mitsubishi.
 * A busca quer o MODELO. Agrupa pelo nome-base — a primeira palavra, ou as duas
 * primeiras quando a primeira e prefixo (ver acima).
 *
 * E heuristica, e o painel deixa digitar um modelo que nao esteja na lista.
 *
 * @param {Array<{nome: string}>} modelosFipe
 * @returns {Array<{nome: string, versoes: number}>}
 */
export function agruparModelosFipe(modelosFipe) {
  const grupos = new Map();
  for (const m of modelosFipe ?? []) {
    const palavras = String(m.nome ?? '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!palavras.length) continue;
    const base = PREFIXOS_COMPOSTOS.has(normalizar(palavras[0])) && palavras[1]
      ? `${palavras[0]} ${palavras[1]}`
      : palavras[0];
    const chave = slugify(base);
    if (!chave) continue;
    const atual = grupos.get(chave);
    if (atual) atual.versoes += 1;
    else grupos.set(chave, { nome: base.split(' ').map(capitalizarModelo).join(' '), versoes: 1 });
  }
  return [...grupos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
