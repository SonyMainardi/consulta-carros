// Testa o transporte de navegador: navega ate a pagina de busca e le o payload
// que a PROPRIA SPA do Webmotors pede. Uma pagina so.
//
// Responde a pergunta que importa antes de gastar uma coleta de 10 minutos:
// o PerimeterX deixa a busca acontecer quando ela e do proprio site?
//
// Se aparecer bloqueio de verdade, resolva na janela — a sessao fica salva em
// data/browser/ e as proximas rodadas reaproveitam.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSearchPayload, closeBrowser } from '../../src/http/browser.js';

const searchPath = process.argv[2] ?? '/carros-usados/estoque/mitsubishi/lancer';
const pageNum = Number.parseInt(process.argv[3] ?? '1', 10);

console.log('--- PROBE Webmotors (via navegador) ---');
console.log('path   :', searchPath);
console.log('pagina :', pageNum);
console.log('Uma janela do Chromium vai abrir. Se aparecer bloqueio, resolva nela.\n');

try {
  const data = await getSearchPayload(searchPath, pageNum);

  const items = data.SearchResults ?? [];
  console.log('Count total  :', data.Count);
  console.log('itens pagina :', items.length);

  const it = items[0];
  if (it) {
    const spec = it.Specification ?? {};
    console.log('\n--- primeiro item ---');
    console.log('titulo  :', spec.Title);
    console.log('ano     :', spec.YearFabrication, '/', spec.YearModel);
    console.log('km      :', spec.Odometer);
    console.log('preco   :', it.Prices?.Price);
    console.log('FipePct :', it.FipePercent);
  }

  // Quantos desta pagina passariam no filtro de ate 100 mil km.
  const abaixo = items.filter((x) => Number(x.Specification?.Odometer) <= 100000).length;
  console.log(`\nate 100 mil km nesta pagina: ${abaixo} de ${items.length}`);

  const out = resolve(process.cwd(), 'data', 'probe-webmotors-browser.json');
  writeFileSync(out, JSON.stringify(data, null, 2));
  console.log('\n=> FUNCIONOU. Resposta salva em', out);
} catch (err) {
  console.log('\n=> FALHOU:', err.message);
  if (err.guard) console.log('   protecao que respondeu:', err.guard);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
