/**
 * Contrato que todo adapter implementa.
 *
 *   name: string                       identificador curto, vira `listings.source`
 *   verified: boolean                  false = contrato nao confirmado (rode o probe)
 *   search(watch): Promise<RawListing[]>
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

/** Monta o termo de busca textual a partir do watch. */
export function searchTerm(watch) {
  return [watch.brand, watch.model, watch.version_contains].filter(Boolean).join(' ').trim();
}
