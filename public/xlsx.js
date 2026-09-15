// Gerador minimo de planilha .xlsx, sem dependencia.
//
// Por que nao CSV: CSV e so texto — nao guarda largura de coluna nem link
// clicavel, e as duas coisas foram pedidas (2026-09-15). Por que nao uma
// biblioteca: o painel e HTML estatico sem build, e um .xlsx com uma aba e
// estilos fixos cabe nestas ~200 linhas. O arquivo e um ZIP sem compressao
// ("store") com sete XMLs dentro.
//
// Funcao pura: recebe dados, devolve bytes. Nao toca no DOM — por isso roda
// tambem no Node, que e como ela foi validada.

const enc = new TextEncoder();

/* ---------------------------------------------------------------------------
   ZIP "store" — sem compressao. O Excel aceita, e evita implementar deflate.
--------------------------------------------------------------------------- */

const CRC_TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABELA[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(arquivos) {
  const agora = new Date();
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
  const data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();

  const locais = [];
  const centrais = [];
  let offset = 0;

  for (const { nome, conteudo } of arquivos) {
    const n = enc.encode(nome);
    const d = enc.encode(conteudo);
    const crc = crc32(d);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(10, hora, true);
    lh.setUint16(12, data, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, d.length, true);
    lh.setUint32(22, d.length, true);
    lh.setUint16(26, n.length, true);
    locais.push(new Uint8Array(lh.buffer), n, d);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(12, hora, true);
    ch.setUint16(14, data, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, d.length, true);
    ch.setUint32(24, d.length, true);
    ch.setUint16(28, n.length, true);
    ch.setUint32(42, offset, true);
    centrais.push(new Uint8Array(ch.buffer), n);

    offset += 30 + n.length + d.length;
  }

  const tamCentral = centrais.reduce((acc, p) => acc + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true);
  fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamCentral, true);
  fim.setUint32(16, offset, true);

  const partes = [...locais, ...centrais, new Uint8Array(fim.buffer)];
  const out = new Uint8Array(partes.reduce((acc, p) => acc + p.length, 0));
  let pos = 0;
  for (const p of partes) { out.set(p, pos); pos += p.length; }
  return out;
}

/* ---------------------------------------------------------------------------
   Planilha
--------------------------------------------------------------------------- */

// Caracteres de controle sao invalidos em XML: um so, vindo de titulo de
// anuncio, faria o Excel recusar o arquivo inteiro com "conteudo ilegivel".
const xml = (s) => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const letra = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// Indices de cellXfs em STYLES, abaixo. Mudar a ordem la exige mudar aqui.
const S = {
  info: 1, cabEsq: 2, cabDir: 3, cabCentro: 4,
  texto: 0, centro: 5, inteiro: 6, preco: 7, fipeAbaixo: 8, fipeAcima: 9, link: 10,
};

// Cor do cabecalho = indigo do painel (--indigo-4). Numeros com separador de
// milhar pelo FORMATO, nao pelo texto: o valor continua numero e soma/ordena.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
<numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0"/>
<numFmt numFmtId="165" formatCode="#,##0"/>
<numFmt numFmtId="166" formatCode="+0.0%;\\-0.0%;0.0%"/>
</numFmts>
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF2E7D32"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FFC62828"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF3949AB"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="166" fontId="5" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * Tipos de coluna. `exibe` e o texto como o Excel vai MOSTRAR a celula — e por
 * ele que a largura e calculada, senao "R$ 549.900" caberia pelo numero cru
 * (549900) e apareceria cortado como "####".
 */
const TIPOS = {
  texto: { estilo: () => S.texto, cab: S.cabEsq, exibe: (v) => String(v) },
  centro: { estilo: () => S.centro, cab: S.cabCentro, exibe: (v) => String(v) },
  // Cabecalho de coluna numerica e CENTRALIZADO, nao a direita: a direita o
  // botao do autofiltro cobre o fim do texto ("KM" virou "K", "Preço" virou
  // "Pre" na foto do Excel). O AutoFit do Excel nao conta o botao, entao so a
  // foto mostrou isso (2-Q).
  inteiro: { estilo: () => S.inteiro, cab: S.cabCentro, exibe: (v) => v.toLocaleString('pt-BR') },
  preco: { estilo: () => S.preco, cab: S.cabCentro, exibe: (v) => `R$ ${v.toLocaleString('pt-BR')}` },
  fipe: {
    estilo: (v) => (v < 0 ? S.fipeAbaixo : S.fipeAcima),
    cab: S.cabCentro,
    exibe: (v) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`,
  },
  link: { estilo: () => S.link, cab: S.cabEsq, exibe: (_v, col) => col.rotulo },
};

/**
 * Largura aproximada em "caracteres de digito" do Calibri 11, que e a unidade
 * da largura de coluna do Excel. Maiuscula e mais larga que digito; i, l, ponto
 * e espaco sao mais estreitos. O erro e proposital para CIMA: sobra de 1-2
 * caracteres nao incomoda, e texto cortado e justamente o que foi pedido evitar.
 */
function larguraTexto(s) {
  let w = 0;
  for (const ch of s) {
    if (/[A-ZÀ-ÝMW%@]/.test(ch)) w += 1.3;
    else if (/[ilIjft.,;:'|!() -]/.test(ch)) w += 0.6;
    else w += 1;
  }
  return w;
}

/**
 * @param {object} p
 * @param {string} p.aba      nome da aba (ate 31 caracteres, sem : \ / ? * [ ])
 * @param {string} [p.info]   linha 1, em italico: o que e esta planilha
 * @param {Array<{titulo: string, tipo: keyof TIPOS, valor: Function, rotulo?: string, largura?: number}>} p.colunas
 *   `largura` fixa a coluna (a de link); sem ela, a largura sai do conteudo.
 * @param {Array<object>} p.linhas
 * @returns {Uint8Array} o arquivo .xlsx
 */
export function planilhaXlsx({ aba, info, colunas, linhas }) {
  const LIN_CAB = info ? 2 : 1;
  const primeiraDado = LIN_CAB + 1;
  const ultimaLinha = LIN_CAB + linhas.length;
  const ultimaCol = letra(colunas.length - 1);

  // +6 no cabecalho: o botao do autofiltro ocupa ~2,5 caracteres no canto
  // direito da celula, e texto em negrito e mais largo. Com +4 o Excel mostrou
  // "Ano", "UF" e "Câmbio" encostando no botao (conferido por AutoFit, 2-Q).
  // Cabecalho CENTRALIZADO pede +9: o texto centraliza na celula inteira, entao
  // precisa de folga do tamanho do botao dos dois lados, nao so de um.
  const larguras = colunas.map((c) => larguraTexto(c.titulo) + (TIPOS[c.tipo].cab === S.cabCentro ? 9 : 6));
  const links = [];

  const linhasXml = linhas.map((linha, i) => {
    const r = primeiraDado + i;
    const celulas = colunas.map((col, j) => {
      const v = col.valor(linha);
      if (v == null || v === '' || Number.isNaN(v)) return '';
      const tipo = TIPOS[col.tipo];
      const ref = `${letra(j)}${r}`;
      larguras[j] = Math.max(larguras[j], larguraTexto(tipo.exibe(v, col)) + 3);

      if (col.tipo === 'link') {
        links.push({ ref, url: String(v) });
        return `<c r="${ref}" s="${tipo.estilo(v)}" t="inlineStr"><is><t>${xml(col.rotulo)}</t></is></c>`;
      }
      if (typeof v === 'number') return `<c r="${ref}" s="${tipo.estilo(v)}"><v>${v}</v></c>`;
      return `<c r="${ref}" s="${tipo.estilo(v)}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r}">${celulas}</row>`;
  }).join('');

  const cabecalho = `<row r="${LIN_CAB}" ht="22" customHeight="1">${colunas.map((c, j) =>
    `<c r="${letra(j)}${LIN_CAB}" s="${TIPOS[c.tipo].cab}" t="inlineStr"><is><t>${xml(c.titulo)}</t></is></c>`).join('')}</row>`;

  const linhaInfo = info
    ? `<row r="1"><c r="A1" s="${S.info}" t="inlineStr"><is><t xml:space="preserve">${xml(info)}</t></is></c></row>`
    : '';

  const cols = colunas.map((c, j) => {
    const w = c.largura ?? Math.min(Math.ceil(larguras[j]), 255);
    return `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`;
  }).join('');

  const faixaFiltro = `$A$${LIN_CAB}:$${ultimaCol}$${Math.max(ultimaLinha, LIN_CAB)}`;

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${ultimaCol}${Math.max(ultimaLinha, LIN_CAB)}"/>
<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="${LIN_CAB}" topLeftCell="A${primeiraDado}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${primeiraDado}" sqref="A${primeiraDado}"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${linhaInfo}${cabecalho}${linhasXml}</sheetData>
<autoFilter ref="${faixaFiltro.replace(/\$/g, '')}"/>
${links.length ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}" tooltip="${xml(l.url.slice(0, 250))}"/>`).join('')}</hyperlinks>` : ''}
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;

  const sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map((l, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(l.url)}" TargetMode="External"/>`).join('')}</Relationships>`;

  const nomeAba = xml(aba);
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets><sheet name="${nomeAba}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${nomeAba}'!${faixaFiltro}</definedName></definedNames>
</workbook>`;

  return zipStore([
    { nome: '[Content_Types].xml', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
    { nome: '_rels/.rels', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nome: 'xl/workbook.xml', conteudo: workbook },
    { nome: 'xl/_rels/workbook.xml.rels', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nome: 'xl/styles.xml', conteudo: STYLES },
    { nome: 'xl/worksheets/sheet1.xml', conteudo: sheet },
    { nome: 'xl/worksheets/_rels/sheet1.xml.rels', conteudo: sheetRels },
  ]);
}
