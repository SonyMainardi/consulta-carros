// Colunas da planilha de anuncios ativos. Separado do app.js de proposito: nao
// toca no DOM, entao da para gerar a planilha no Node com dado real e abrir no
// Excel para conferir — foi assim que ela foi validada (ESTADO.md 2-Q).
import { planilhaXlsx } from './xlsx.js';

// Rotulos da planilha levam acento; os do painel sao ASCII por historico.
const FAIXA = {
  'ate-50k': 'até 50 mil', '50k-70k': '50 a 70 mil',
  '70k-100k': '70 a 100 mil', 'acima-100k': 'acima de 100 mil',
};
const CAMBIO = {
  manual: 'manual', automatico: 'automático', cvt: 'CVT',
  automatizado: 'automatizado', outro: 'outro',
};

const numero = (v) => (v == null || v === '' ? null : Number(v));

/**
 * @param {Array<object>} linhas  as linhas de /api/listings, na ordem da tela
 * @param {object} opcoes
 * @param {string} [opcoes.info]   descricao da visualizacao (linha 1)
 * @param {(slug: string) => string} [opcoes.fonte]  nome de exibicao do portal
 * @returns {Uint8Array} o .xlsx
 */
export function planilhaAnuncios(linhas, { info, fonte = (s) => s } = {}) {
  return planilhaXlsx({
    aba: 'Anúncios',
    info,
    linhas,
    colunas: [
      { titulo: 'Anúncio', tipo: 'texto', valor: (l) => l.title },
      { titulo: 'Ano', tipo: 'centro', valor: (l) => numero(l.year_model) },
      { titulo: 'KM', tipo: 'inteiro', valor: (l) => numero(l.km) },
      { titulo: 'Faixa de km', tipo: 'centro', valor: (l) => FAIXA[l.km_band] },
      { titulo: 'Câmbio', tipo: 'centro', valor: (l) => (l.cambio ? CAMBIO[l.cambio] ?? l.cambio : null) },
      // DECIMAL chega do mysql2 como texto "49900.00"; anuncio nao tem centavos.
      { titulo: 'Preço', tipo: 'preco', valor: (l) => (l.price == null ? null : Math.round(Number(l.price))) },
      // Guardado como fracao (-0,217) com formato de %: o Excel mostra -21,7% e
      // a coluna continua ordenavel. Arredondado a 0,1%, como o painel mostra.
      {
        titulo: 'FIPE', tipo: 'fipe',
        valor: (l) => (l.fipe_ratio == null ? null : Math.round((Number(l.fipe_ratio) - 1) * 1000) / 1000),
      },
      { titulo: 'Cidade', tipo: 'texto', valor: (l) => l.city },
      { titulo: 'UF', tipo: 'centro', valor: (l) => l.uf },
      { titulo: 'Fonte', tipo: 'texto', valor: (l) => fonte(l.source) },
      // A URL inteira nao aparece: ninguem le link, so clica. A celula mostra
      // "Abrir anúncio" e o endereco fica no link (e no balao ao passar o mouse).
      { titulo: 'Link', tipo: 'link', rotulo: 'Abrir anúncio', valor: (l) => l.url },
    ],
  });
}
