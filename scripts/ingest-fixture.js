// Carrega um fixture de probe no banco, SEM tocar na rede.
//
//   node scripts/ingest-fixture.js [arquivo]
//   (padrao: data/probe-webmotors-lancer.json)
//
// Por que existe: o Webmotors tem PerimeterX e nao da para ficar coletando de
// verdade so para ver o painel funcionando ou conferir um mapeamento. Este
// script troca o adapter da fonte por um que devolve os itens do fixture e roda
// EXATAMENTE o mesmo pipeline (normalize -> filtro -> fingerprint -> upsert ->
// eventos). Se o painel mostra certo com fixture, o unico ingrediente que falta
// para a coleta real e a rede.
//
// O registro `adapters` e um objeto comum, entao da para substituir a fonte em
// tempo de execucao sem mexer em nada de producao.
//
// ⚠️ GRAVA NO BANCO DO .env. Fixture e foto velha: rodar contra o banco de uso
// tira da tela os anuncios que nao estao no fixture. Para testar, aponte para
// um banco de teste:  DB_NAME=consulta_carros_teste npm run db:migrate  e
// depois o mesmo DB_NAME na frente deste script.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adapters } from '../src/adapters/index.js';
import { mapItem } from '../src/adapters/webmotors.js';
import { runCollection } from '../src/core/pipeline.js';
import { pool } from '../src/db/pool.js';
import { config } from '../src/config.js';
import { carroPorSlugs } from '../src/db/repositories/catalogo.js';

const file = process.argv[2] ?? 'data/probe-webmotors-lancer.json';

let data;
try {
  data = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
} catch (err) {
  console.error(`nao consegui ler o fixture ${file}: ${err.message}`);
  console.error('rode `npm run probe:wm` para gerar um, quando o PerimeterX deixar.');
  process.exit(1);
}

const items = data.SearchResults ?? [];
if (!items.length) {
  console.error(`o fixture ${file} nao tem SearchResults — arquivo errado?`);
  process.exit(1);
}

console.log(`--- INGEST de fixture (offline) ---`);
console.log(`arquivo : ${file}`);
console.log(`itens   : ${items.length}`);
console.log(`Count    : ${data.Count} (total real da busca quando o probe rodou)`);
if (items.length < Number(data.Count)) {
  console.log(`\nAviso: o fixture tem so uma pagina. O painel vai mostrar ${items.length}`);
  console.log(`anuncios, nao os ${data.Count} da busca real. E amostra, nao coleta.`);
}
// ⚠️ ISTO ESCREVE NO BANCO CONFIGURADO NO .env. Como a cobertura do fixture e
// PARCIAL, todo anuncio do cache real que nao esta nele sai da tela como
// FORA_DA_JANELA — nao vira "saiu do ar" (regra 3), mas o painel encolhe ate a
// proxima coleta de verdade. Para nao mexer no cache de uso:
//     DB_NAME=consulta_carros_teste npm run ingest:fixture
console.log(`Banco    : ${config.db.database}  <- o fixture ESCREVE aqui`);
console.log('           cobertura parcial: o que nao esta no fixture sai da tela');
console.log('           ate a proxima coleta real (FORA_DA_JANELA, sem evento).');
console.log('');

const total = Number(data.Count) || null;

adapters.webmotors = {
  name: 'webmotors',
  verified: true,
  // Mesmo contrato do adapter real (src/adapters/base.js). Fixture de uma
  // pagina so e "busca inteira" se o Count couber nela.
  async search() {
    return { itens: items.map(mapItem), total, paginas: 1, completa: total != null && items.length >= total };
  },
};

// Desde 2026-09-16 o pipeline coleta um CARRO do catalogo, nao "as buscas
// ativas" (ESTADO.md 2-Y). O fixture e do Lancer; para outro carro, passe
// marca/modelo: `npm run ingest:fixture -- honda/civic`.
const alvo = process.argv.slice(2).find((a) => a.includes('/')) ?? 'mitsubishi/lancer';
const [marcaSlug, modeloSlug] = alvo.split('/');
const carro = await carroPorSlugs(marcaSlug, modeloSlug, ['webmotors']);

try {
  if (!carro) {
    console.error(`"${alvo}" nao esta no catalogo — rode npm run db:catalogo`);
    process.exitCode = 1;
  } else {
    const stats = await runCollection({ carros: [carro], fontes: ['webmotors'] });
    console.log('\nresultado:', stats);
  }
} finally {
  await pool.end();
}
