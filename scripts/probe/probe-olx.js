// Testa se a busca da OLX responde HTML util (com __NEXT_DATA__) ou challenge.
// Salva o HTML e o JSON extraido para inspecao.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractNextData } from '../../src/adapters/olx.js';
import { getHtml } from '../../src/http/client.js';

const term = process.argv[2] ?? 'corolla xei';
const url = new URL('https://www.olx.com.br/autos-e-pecas/carros-vans-e-utilitarios');
url.searchParams.set('q', term);

console.log('--- PROBE OLX ---');
console.log('GET', url.toString());

let res, html;
try {
  res = await getHtml(url.toString());
  html = res.text;
  console.log('HTTP', res.status, '| tamanho:', html.length, 'bytes');
} catch (err) {
  html = err.body ?? '';
  res = { ok: false, status: err.status ?? 0 };
  console.log('HTTP', err.status ?? '(erro)', '|', err.message);
}

const dataDir = resolve(process.cwd(), 'data');
writeFileSync(resolve(dataDir, 'probe-olx.html'), html);

// Identifica QUAL protecao respondeu — muda a estrategia de contorno.
const blockers = [
  [/cloudflare|cf-browser-verification|__cf_chl/i, 'Cloudflare'],
  [/datadome/i, 'DataDome'],
  [/captcha|hcaptcha|recaptcha/i, 'CAPTCHA'],
  [/access denied|forbidden/i, 'bloqueio generico'],
];
const detected = blockers.filter(([re]) => re.test(html)).map(([, nome]) => nome);

if (detected.length || !res.ok) {
  console.log(`\n=> BLOQUEADO${detected.length ? ': ' + [...new Set(detected)].join(' + ') : ''}`);
  console.log('   Esta fonte precisa de navegador real (Playwright com contexto');
  console.log('   persistente) ou de um provedor terceiro.');
  console.log('   HTML salvo em data/probe-olx.html');
} else {
  const nextData = extractNextData(html);

  if (!nextData) {
    console.log('\n=> __NEXT_DATA__ nao encontrado.');
    console.log('   Ou o layout mudou, ou a pagina veio incompleta.');
    console.log('   Inspecione data/probe-olx.html');
  } else {
    writeFileSync(resolve(dataDir, 'probe-olx.json'), JSON.stringify(nextData, null, 2));
    const pp = nextData?.props?.pageProps ?? {};
    console.log('chaves de pageProps:', Object.keys(pp).join(', '));

    const ads = pp.ads ?? pp.listing?.ads ?? pp.data?.ads ?? [];
    console.log('anuncios encontrados:', Array.isArray(ads) ? ads.length : 0);

    if (Array.isArray(ads) && ads.length) {
      const a = ads[0];
      console.log('\n--- primeiro anuncio ---');
      console.log('listId:  ', a.listId ?? a.id);
      console.log('titulo:  ', a.subject ?? a.title);
      console.log('preco:   ', a.price);
      console.log('url:     ', a.url);
      console.log('props:   ', (a.properties ?? []).map((p) => p.name).join(', '));
      console.log('\n=> FUNCIONA. JSON salvo em data/probe-olx.json');
    }
  }
}
