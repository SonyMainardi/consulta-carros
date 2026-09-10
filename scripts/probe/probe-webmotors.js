// Testa o endpoint JSON interno do Webmotors e revela o formato real do payload.
// Se o contrato tiver mudado, e aqui que voce descobre quais campos usar
// em src/adapters/webmotors.js.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Usa o cliente educado do projeto (rate limit por host, cookies, backoff).
// NAO usar fetch cru aqui: o Webmotors tem PerimeterX e sinaliza rajadas de
// requisicoes — foi exatamente assim que tomamos 403 em 2026-09-06.
import { getJson } from '../../src/http/client.js';

const searchPath = process.argv[2] ?? '/carros/estoque/toyota/corolla';
const url = new URL('https://www.webmotors.com.br/api/search/car');
url.searchParams.set('url', `https://www.webmotors.com.br${searchPath}`);
url.searchParams.set('actualPage', '1');
url.searchParams.set('displayPerPage', '5');
url.searchParams.set('order', '1');
url.searchParams.set('showMenu', 'false');
url.searchParams.set('showCount', 'true');
url.searchParams.set('showBreadCrumb', 'false');
url.searchParams.set('testAB', 'false');
url.searchParams.set('returnUrl', 'false');

console.log('--- PROBE Webmotors ---');
console.log('GET', url.toString());

let res;
try {
  res = await getJson(url.toString(), {
    headers: {
      Referer: `https://www.webmotors.com.br${searchPath}`,
      Origin: 'https://www.webmotors.com.br',
    },
  });
} catch (err) {
  const body = err.body ?? '';
  console.log('\n=> BLOQUEADO ou endpoint mudou:', err.message);
  if (/"appId"|jsClientSrc|_px|perimeterx/i.test(body)) {
    console.log('\n   A resposta e do PerimeterX (protecao anti-bot do Webmotors).');
    console.log('   Costuma liberar sozinho em minutos/horas. NAO insista —');
    console.log('   cada tentativa nova renova o bloqueio.');
  } else {
    console.log('\n   Abra o site, DevTools > Network > Fetch/XHR, faca uma busca');
    console.log('   e compare a URL real da chamada de listagem com a de cima.');
  }
  console.log('\n   Body:', body.slice(0, 300));
  process.exitCode = 1;
}

if (res) {
  console.log('HTTP', res.status, '| content-type:', res.headers.get('content-type'));
  const data = res.data;

  if (!data) {
    console.log('\n=> Resposta nao era JSON (provavel challenge de bot).');
    console.log(res.text.slice(0, 400));
  } else {
    writeFileSync(resolve(process.cwd(), 'data', 'probe-webmotors.json'), JSON.stringify(data, null, 2));
    console.log('chaves do topo:', Object.keys(data).join(', '));
    console.log('total da busca (Count):', data.Count);

    const items = data.SearchResults ?? [];
    console.log('itens nesta pagina:', Array.isArray(items) ? items.length : 'array nao encontrado');

    if (Array.isArray(items) && items.length) {
      const it = items[0];
      const spec = it.Specification ?? {};
      console.log('\n--- primeiro item (resumo) ---');
      console.log('UniqueId :', it.UniqueId);
      console.log('titulo   :', spec.Title);
      console.log('ano      :', spec.YearFabrication, '/', spec.YearModel);
      console.log('km       :', spec.Odometer);
      console.log('preco    :', it.Prices?.Price);
      console.log('FipePct  :', it.FipePercent);
      console.log('vendedor :', it.Seller?.SellerType, '-', it.Seller?.FantasyName);
      console.log('local    :', it.Seller?.City, '/', it.Seller?.State);
      console.log('fotos    :', (it.Media?.Photos ?? []).length);
    }
    console.log('\n=> Resposta completa salva em data/probe-webmotors.json');
  }
}
