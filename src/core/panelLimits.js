// Os tetos de EXIBIÇÃO do painel, traduzidos para SQL num lugar só.
//
// POR QUE EXISTE UM MODULO PARA DUAS LINHAS DE SQL
// O teto precisa valer em quatro consultas diferentes — a lista de anuncios, as
// contagens dos filtros, os cartoes do topo e o "O que mudou". Se cada uma
// tivesse a sua copia, bastaria esquecer de uma para o painel se contradizer:
// o cartao dizendo "89 anuncios ativos" com 70 linhas na tabela embaixo. Foi
// exatamente o que aconteceu na primeira versao desta mudanca.
//
// O QUE ESTES TETOS NAO SAO
// Nao sao recorte de coleta. O `matchesWatch` continua decidindo o que entra no
// banco, e o anuncio caro segue sendo guardado, com historico de preco e tudo.
// Estes tetos so decidem o que APARECE. A diferenca importa: mudar de ideia
// aqui e instantaneo (um valor no .env), nao exige recoletar nada e nao inventa
// evento de "saiu do ar" para anuncio que continua no ar.
import { config } from '../config.js';

/**
 * @param {string} alias  o alias da tabela `listings` na consulta ('l')
 * @returns {{ where: string[], params: number[] }}
 */
export function tetosDoPainel(alias = 'l') {
  const where = [];
  const params = [];

  // `IS NULL OR` de proposito: preco ou km desconhecido nao e motivo para
  // esconder o anuncio — some quem comprovadamente estoura o teto. Anuncio sem
  // preco e justamente o que a pessoa quer ver para investigar.
  if (config.panel.priceMax > 0) {
    where.push(`(${alias}.price IS NULL OR ${alias}.price <= ?)`);
    params.push(config.panel.priceMax);
  }
  if (config.panel.kmMax > 0) {
    where.push(`(${alias}.km IS NULL OR ${alias}.km <= ?)`);
    params.push(config.panel.kmMax);
  }

  return { where, params };
}
