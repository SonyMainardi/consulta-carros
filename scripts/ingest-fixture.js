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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adapters } from '../src/adapters/index.js';
import { mapItem } from '../src/adapters/webmotors.js';
import { runCollection } from '../src/core/pipeline.js';
import { pool } from '../src/db/pool.js';

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
console.log('');

adapters.webmotors = {
  name: 'webmotors',
  verified: true,
  async search() {
    return items.map(mapItem);
  },
};

try {
  const stats = await runCollection({ only: 'webmotors' });
  console.log('\nresultado:', stats);
} finally {
  await pool.end();
}
