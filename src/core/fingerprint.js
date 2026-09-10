// AGRUPADOR DE CANDIDATOS a dedupe — nao e identidade.
//
// Lojista anuncia o mesmo carro em varias plataformas, e sem agrupar o painel
// mostraria o mesmo veiculo tres vezes. Mas ATENCAO ao limite disto:
//
// Verificado em 2026-09-06 com dados reais do Webmotors: dois Corolla 2017/2018
// pretos, da MESMA concessionaria em Sao Paulo, com 64.501 e 64.643 km, geram o
// mesmo fingerprint — e sao carros diferentes (R$ 101.990 e R$ 99.990).
// Nenhuma combinacao destes campos separa os dois, porque eles sao mesmo quase
// identicos.
//
// Conclusao: NUNCA fundir anuncios so porque o fingerprint bate. Isto serve para
// pre-selecionar candidatos; a confirmacao precisa de uma segunda evidencia
// (hash perceptual da primeira foto e o caminho natural, ja que as fotos
// costumam ser as mesmas nos varios portais).
import { createHash } from 'node:crypto';
import { norm } from './normalize.js';

// Km arredondado por faixa: o anunciante atualiza o odometro de vez em quando,
// entao 45.230 e 45.900 devem cair no mesmo balde.
const kmBucket = (km) => (km == null ? 'x' : String(Math.round(km / 5000)));

export function fingerprint(listing) {
  const parts = [
    norm(listing.model ?? ''),
    listing.year_fab ?? 'x',
    listing.year_model ?? 'x',
    kmBucket(listing.km),
    norm(listing.color ?? ''),
    norm(listing.city ?? ''),
  ];
  // Sem modelo e sem ano nao ha identidade confiavel: nao arrisca dedupe errado.
  if (!parts[0] || (parts[1] === 'x' && parts[2] === 'x')) return null;
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
