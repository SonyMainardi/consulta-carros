// Probe da OLX VIA NAVEGADOR REAL.
//
// O probe antigo (`npm run probe:olx`) usa o fetch do Node e bate no Cloudflare.
// Este abre a pagina num Chromium com contexto persistente — a mesma receita
// que resolveu o PerimeterX do Webmotors. Em 2026-09-09 respondeu 200.
//
// Uma URL por execucao. Nao pagina, nao insiste: uma tentativa, um diagnostico.
//
//   npm run probe:olx:browser                      # caminho marca/modelo do watch
//   npm run probe:olx:browser -- <url>             # uma URL especifica
//   npm run probe:olx:browser -- --robots          # so o robots.txt
//
// ⚠️ Nao passe URL com querystring: o robots.txt da OLX proibe q=, o=, pe=,
// ps=, rs=, re= e sf=. O probe avisa se voce tentar.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPageHtml, closeBrowser } from '../../src/http/browser.js';
import { extractAds, extractTotal, mapAd } from '../../src/adapters/olx.js';

const PADRAO = 'https://www.olx.com.br/autos-e-pecas/carros-vans-e-utilitarios/mitsubishi/lancer';
const dataDir = resolve(process.cwd(), 'data');
const arg = process.argv[2];

// Parametros que o robots.txt da OLX proibe. Conferido em 2026-09-09.
const PROIBIDOS = ['q', 'o', 'pe', 'ps', 'rs', 're', 'sf'];

try {
  if (arg === '--robots') {
    console.log('GET https://www.olx.com.br/robots.txt');
    const robots = await getPageHtml('https://www.olx.com.br/robots.txt');
    writeFileSync(resolve(dataDir, 'probe-olx-robots.txt'), robots.text);
    const disallow = robots.text.split('\n').map((l) => l.trim()).filter((l) => /^disallow/i.test(l));
    console.log(`${disallow.length} regras Disallow — salvo em data/probe-olx-robots.txt`);
    for (const p of PROIBIDOS) {
      const tem = disallow.some((l) => l.includes(`*${p}=`));
      console.log(`  ${p.padEnd(3)} ${tem ? 'PROIBIDO' : 'livre'}`);
    }
  } else {
    const url = arg ?? PADRAO;
    const qs = [...new URL(url).searchParams.keys()];
    const proibidos = qs.filter((k) => PROIBIDOS.includes(k));
    if (proibidos.length) {
      console.log(`\n⚠️  ${proibidos.join(', ')} tem Disallow no robots.txt da OLX. Abortando.`);
      process.exit(1);
    }

    console.log('--- PROBE OLX (navegador) ---');
    console.log('GET', url, '\n');

    const res = await getPageHtml(url, { waitForSelector: 'a[href*="/autos-e-pecas/"]' });
    console.log(`HTTP ${res.status} | ${res.html.length} bytes | url final: ${res.url}`);
    writeFileSync(resolve(dataDir, 'probe-olx-browser.html'), res.html);

    const ads = extractAds(res.html);
    const total = extractTotal(res.html);
    console.log(`anuncios extraidos: ${ads.length}${total ? ` (a busca inteira tem ${total})` : ''}`);

    if (!ads.length) {
      console.log('\n=> NADA EXTRAIDO. Primeiros 300 caracteres do texto da tela:');
      console.log(res.text.slice(0, 300));
    } else {
      const uteis = ads.map(mapAd).filter((a) => a.url);
      console.log(`descartados por serem publicidade: ${ads.length - uteis.length}`);
      writeFileSync(resolve(dataDir, 'probe-olx-ads.json'), JSON.stringify(ads.slice(0, 3), null, 2));

      // Quantos sao mesmo do carro que interessa? Uma pagina de categoria
      // generica extrai anuncios normalmente — e traz Gol, Onix e Corolla.
      const lancers = uteis.filter((a) => /lancer/i.test(a.title ?? ''));
      console.log(`com "lancer" no titulo: ${lancers.length} de ${uteis.length}`);

      for (const a of uteis.slice(0, 5)) {
        console.log(`  ${String(a.externalId).padEnd(11)} ${String(a.title).slice(0, 46).padEnd(48)} ${String(a.km ?? '?').padStart(7)} km  ${a.price}  ${a.city}/${a.uf}`);
      }
      console.log('\n=> FUNCIONA. Exemplos em data/probe-olx-ads.json, HTML em data/probe-olx-browser.html');
    }

    // Caminhos de LISTAGEM (sem querystring) que a propria pagina oferece —
    // e assim que se descobre o formato de URL sem inventar nenhum.
    const links = [...new Set(
      [...res.html.matchAll(/href="(\/autos-e-pecas\/[^"?#]*)"/g)].map((m) => m[1]),
    )].filter((h) => !/-\d{8,}$/.test(h)); // tira URL de anuncio (termina no id)
    console.log(`\ncaminhos de listagem oferecidos pela pagina (${links.length}):`);
    for (const l of links.slice(0, 20)) console.log('  ', l);
  }
} catch (err) {
  console.log('\n=> FALHOU:', err.message);
  if (err.guard) console.log('   protecao que respondeu:', err.guard);
} finally {
  await closeBrowser();
}
