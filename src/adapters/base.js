/**
 * Contrato que todo adapter implementa.
 *
 *   name: string                       identificador curto, vira `listings.source`
 *   verified: boolean                  false = contrato nao confirmado (rode o probe)
 *   search(watch, opcoes): Promise<Resultado>
 *
 *   opcoes    { maxPaginas }           teto de paginas desta busca (decisao do core)
 *   Resultado { itens: RawListing[],   o que a pagina trouxe, ANTES de qualquer filtro
 *               total: number|null,    quantos anuncios o PORTAL diz que a busca tem
 *               paginas: number,       quantas paginas foram lidas
 *               completa: boolean }    leu a busca inteira? So com `true` um anuncio
 *                                      ausente pode virar "saiu do ar" (ESTADO.md 2-S)
 *
 * Na duvida, `completa: false`. Errar para esse lado so deixa de noticiar uma
 * venda; errar para o outro inventa "saiu do ar" para carro que segue anunciado.
 *
 * O adapter tambem confere se a pagina que voltou e da busca pedida (canonical
 * da pagina, redirecionamento) e lanca AdapterError se nao for.
 *
 * RawListing e o formato solto que `core/normalize.toListing` sabe traduzir:
 *   { externalId, url, title, brand, model, version, year|yearFab|yearModel,
 *     km, price, color, fuel, transmission, city, uf, sellerType, sellerName,
 *     photos: string[], raw }
 *
 * Regra de ouro deste projeto: adapter e descartavel. Ele so busca e mapeia.
 * Nada de regra de negocio, banco ou filtro aqui — quando a fonte mudar o
 * contrato voce reescreve este arquivo e mais nada.
 */

export class AdapterError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = 'AdapterError';
    this.source = info.source;
    this.status = info.status;
    this.hint = info.hint;
  }
}

/** Le params.<source> do watch, com fallback para objeto vazio. */
export function sourceParams(watch, source) {
  const p = watch.params;
  if (!p) return {};
  const parsed = typeof p === 'string' ? JSON.parse(p) : p;
  return parsed[source] ?? {};
}

/** A URL canonica que a PROPRIA pagina declara (<link rel="canonical"> ou og:url). */
export function canonicalDoHtml(html) {
  const s = String(html ?? '');
  const m = s.match(/<link[^>]+rel="canonical"[^>]*href="([^"]+)"/i)
    ?? s.match(/<link[^>]+href="([^"]+)"[^>]*rel="canonical"/i)
    ?? s.match(/<meta[^>]+property="og:url"[^>]*content="([^"]+)"/i);
  return m ? m[1] : null;
}

/** Caminho comparavel: sem host, sem querystring, sem barra no fim, minusculo. */
export function caminhoDe(url) {
  if (!url) return null;
  try {
    const p = decodeURIComponent(new URL(url, 'https://portal.invalid').pathname);
    return p.replace(/\/+$/, '').toLowerCase() || '/';
  } catch {
    return null;
  }
}

/**
 * A pagina e a busca pedida? Confere o canonical que ela declara e a URL em que
 * o navegador terminou (redirecionamento). Devolve a divergencia, ou null.
 *
 * Slug errado nao costuma dar 404: o portal redireciona para a marca, para a
 * categoria inteira, ou mostra outra listagem. Sem esta conferencia, a coleta
 * gravava a pagina errada como se fosse a certa.
 */
export function divergenciaDeCaminho(pedido, { html, urlFinal } = {}) {
  const alvo = caminhoDe(pedido);
  const canonical = caminhoDe(canonicalDoHtml(html));
  if (canonical && canonical !== alvo) return `a pagina declara ser ${canonical}`;
  const final = caminhoDe(urlFinal);
  if (final && final !== alvo) return `o navegador terminou em ${final}`;
  return null;
}

/** Monta o termo de busca textual a partir do watch. */
export function searchTerm(watch) {
  return [watch.brand, watch.model, watch.version_contains].filter(Boolean).join(' ').trim();
}
