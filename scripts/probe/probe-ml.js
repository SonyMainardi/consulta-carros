// Descobre se o Mercado Livre libera a API OFICIAL de busca para o seu token.
// Salva a resposta crua em data/probe-ml.json para voce inspecionar o contrato.
//
// ⚠️ Isto NAO e o caminho que a coleta usa hoje. Desde 2026-09-09 o adapter le
// o site publico num navegador, sem token (`npm run probe:ml:browser`). Este
// probe existe para o dia em que a API oficial for desejada.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAccessToken, readTokens } from '../../src/auth/mercadolivre.js';
import { getJson } from '../../src/http/client.js';

const TERM = process.argv[2] ?? 'corolla xei';
const url =
  `https://api.mercadolibre.com/sites/MLB/search?category=MLB1744&q=${encodeURIComponent(TERM)}&limit=5`;

console.log('--- PROBE Mercado Livre ---');

const saved = readTokens();
if (saved) {
  const horas = ((saved.expires_at - Date.now()) / 3600000).toFixed(1);
  console.log(`token salvo: user_id ${saved.user_id}, expira em ${horas}h`);
} else {
  console.log('token salvo: nenhum (rode `npm run ml:auth`)');
}

let token = null;
try {
  token = await getAccessToken();
} catch (err) {
  console.log('\n=> Sem token utilizavel:', err.message);
  console.log('   Testando sem autenticacao so para ver o que o ML responde...\n');
}

console.log('GET', url);

const headers = {};
if (token) headers.Authorization = `Bearer ${token}`;

// Nada de `fetch` cru contra as fontes, nem em probe — a regra do projeto vale
// aqui tambem. `getJson` passa pelo rate limiter, e um 403 vira HttpError com
// `status`, `body` e `guard`, em vez de resposta solta. (Em 2026-09-06 um
// script com fetch cru derrubou o acesso ao Webmotors por ~21h.)
let res;
let text = '';
try {
  res = await getJson(url, { headers });
  text = res.text;
} catch (err) {
  res = { status: err.status ?? 0, ok: false };
  text = err.body ?? err.message;
}

console.log('HTTP', res.status);

if (res.status === 401) {
  console.log('\n=> Token invalido ou expirado. Rode `npm run ml:auth` de novo.');
} else if (res.status === 403) {
  console.log('\n=> 403: o ML bloqueou o search para este app.');
  console.log('   Este e o cenario esperado para apps que nao sao de vendedor —');
  console.log('   e o motivo pelo qual esta fonte precisa ser testada antes de tudo.');
  console.log('   Body:', text.slice(0, 300));
} else if (res.status === 200) {
  const data = res.data ?? JSON.parse(text);
  console.log('total disponivel:', data.paging?.total);
  console.log('itens nesta pagina:', data.results?.length);
  const first = data.results?.[0];
  if (first) {
    console.log('\n--- primeiro item ---');
    console.log('id:      ', first.id);
    console.log('titulo:  ', first.title);
    console.log('preco:   ', first.price);
    console.log('link:    ', first.permalink);
    console.log('atributos:', (first.attributes ?? []).map((a) => a.id).join(', '));
  }
  writeFileSync(resolve(process.cwd(), 'data', 'probe-ml.json'), JSON.stringify(data, null, 2));
  console.log('\n=> FUNCIONA. Resposta salva em data/probe-ml.json');
} else {
  console.log('body:', text.slice(0, 500));
}
