// Probe do Mercado Livre VIA NAVEGADOR, sem token.
//
// POR QUE EXISTE
// O outro probe (`npm run probe:ml`) fala com a API oficial e depende de app
// cadastrado + OAuth. Este pergunta outra coisa: o SITE publico responde a um
// navegador de verdade, como o Webmotors e a OLX responderam? Se responder,
// o ML entra sem cadastro nenhum.
//
//   npm run probe:ml:browser                 # busca padrao (Lancer)
//   npm run probe:ml:browser -- <url>        # uma URL especifica
//   npm run probe:ml:browser -- --robots     # robots.txt dos hosts de busca
//
// Uma URL por execucao. Nao pagina, nao insiste: uma tentativa, um diagnostico.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPageHtml, closeBrowser } from '../../src/http/browser.js';

const PADRAO = 'https://lista.mercadolivre.com.br/veiculos/carros-caminhonetes/mitsubishi/lancer/';
const HOSTS_ROBOTS = [
  'https://lista.mercadolivre.com.br/robots.txt',
  'https://www.mercadolivre.com.br/robots.txt',
];
const dataDir = resolve(process.cwd(), 'data');
const arg = process.argv[2];

/** Conta ocorrencias sem montar array gigante. */
const conta = (txt, agulha) => txt.split(agulha).length - 1;

try {
  if (arg === '--robots') {
    for (const url of HOSTS_ROBOTS) {
      console.log('\nGET', url);
      const r = await getPageHtml(url);
      const nome = `probe-ml-robots-${new URL(url).host.split('.')[0]}.txt`;
      writeFileSync(resolve(dataDir, nome), r.text);
      const linhas = r.text.split('\n').map((l) => l.trim());
      const disallow = linhas.filter((l) => /^disallow/i.test(l));
      console.log(`  HTTP ${r.status} | ${linhas.length} linhas, ${disallow.length} Disallow -> data/${nome}`);
      // O que interessa: os padroes que a URL de busca do ML usa sao caminhos
      // (_Desde_, _OrderId_, /veiculos/...), nao querystring.
      const relevantes = disallow.filter((l) => /desde|orderid|veiculo|carro|lista|\*_|noindex/i.test(l));
      for (const l of relevantes.slice(0, 30)) console.log('   ', l);
      if (!relevantes.length) console.log('    (nenhuma regra tocando busca de veiculos)');
    }
  } else {
    const url = arg ?? PADRAO;
    console.log('--- PROBE Mercado Livre (navegador, sem token) ---');
    console.log('GET', url, '\n');

    const res = await getPageHtml(url, { waitForSelector: '.ui-search-layout, .andes-card, main' });
    console.log(`HTTP ${res.status} | ${res.html.length} bytes | url final: ${res.url}`);
    writeFileSync(resolve(dataDir, 'probe-ml-browser.html'), res.html);

    // Onde pode estar o dado, em ordem de preferencia.
    const pistas = {
      '__PRELOADED_STATE__': conta(res.html, '__PRELOADED_STATE__'),
      'self.__next_f (RSC)': conta(res.html, 'self.__next_f'),
      'application/ld+json': conta(res.html, 'application/ld+json'),
      'ui-search-layout__item': conta(res.html, 'ui-search-layout__item'),
      'permalink': conta(res.html, 'permalink'),
      '"MLB': conta(res.html, '"MLB'),
      'poly-component__title': conta(res.html, 'poly-component__title'),
    };
    console.log('\npistas de onde estao os anuncios:');
    for (const [k, v] of Object.entries(pistas)) console.log(`  ${String(v).padStart(5)}  ${k}`);

    // Bloqueio costuma vir com pagina curta e sem nenhuma das pistas acima.
    if (Object.values(pistas).every((v) => v === 0)) {
      console.log('\n=> NADA RECONHECIDO. Primeiros 400 caracteres do texto da tela:');
      console.log(res.text.slice(0, 400));
    } else {
      // O que da para ler direto do DOM renderizado, so para saber se ha
      // anuncio de verdade na tela (o mapeamento fino fica no adapter).
      const amostra = [...res.html.matchAll(/href="(https:\/\/(?:carro|produto|articulo)[^"]*MLB-?\d+[^"]*)"/g)]
        .map((m) => m[1].split('#')[0])
        .filter((u, i, a) => a.indexOf(u) === i);
      console.log(`\nlinks de anuncio distintos no HTML: ${amostra.length}`);
      for (const u of amostra.slice(0, 5)) console.log('  ', u.slice(0, 110));
      console.log('\nHTML salvo em data/probe-ml-browser.html');
    }
  }
} catch (err) {
  console.log('\n=> FALHOU:', err.message);
  if (err.guard) console.log('   protecao que respondeu:', err.guard);
} finally {
  await closeBrowser();
}
