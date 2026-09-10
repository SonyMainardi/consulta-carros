// Autorizacao do Mercado Livre, passo a passo.
//   npm run ml:auth
//
// Faz o fluxo OAuth inteiro e salva access_token + refresh_token em
// data/ml-tokens.json. Depois disso a renovacao (a cada 6h) e automatica.
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { spawn } from 'node:child_process';
import { config } from '../src/config.js';
import { buildAuthUrl, exchangeCode, readTokens, TOKEN_FILE } from '../src/auth/mercadolivre.js';

const rl = createInterface({ input: stdin, output: stdout });
const redirectUri = process.env.ML_REDIRECT_URI || 'https://localhost/callback';

console.log('\n=== Autorizacao Mercado Livre ===\n');

if (!config.ml.clientId || !config.ml.clientSecret) {
  console.log('Faltam credenciais no .env.\n');
  console.log('  1. Acesse https://developers.mercadolivre.com.br/devcenter');
  console.log('  2. "Criar aplicacao"');
  console.log(`  3. Em "URIs de redirect" coloque exatamente: ${redirectUri}`);
  console.log('  4. Marque os escopos: read  e  offline_access');
  console.log('  5. Copie App ID -> ML_CLIENT_ID e Chave secreta -> ML_CLIENT_SECRET no .env\n');
  rl.close();
  process.exit(1);
}

const existing = readTokens();
if (existing) {
  const horas = ((existing.expires_at - Date.now()) / 3600000).toFixed(1);
  console.log(`Ja existe um token salvo (expira em ${horas}h, user_id ${existing.user_id}).`);
  const again = await rl.question('Autorizar de novo mesmo assim? [s/N] ');
  if (again.trim().toLowerCase() !== 's') {
    rl.close();
    process.exit(0);
  }
}

const authUrl = buildAuthUrl(redirectUri);

console.log('1) Abra esta URL no navegador e autorize o app:\n');
console.log(`   ${authUrl}\n`);
console.log('2) Depois de autorizar, o ML vai te redirecionar para uma URL como:');
console.log(`   ${redirectUri}?code=TG-xxxxxxxx&state=consulta-carros`);
console.log('   A pagina provavelmente vai dar erro de conexao. Isso e normal e nao importa —');
console.log('   o que interessa e a URL na barra de enderecos.\n');

// Tenta abrir o navegador; se falhar, o usuario copia a URL acima na mao.
try {
  spawn('cmd', ['/c', 'start', '', authUrl], { detached: true, stdio: 'ignore' }).unref();
  console.log('   (tentei abrir seu navegador automaticamente)\n');
} catch {
  /* sem problema: a URL esta impressa acima */
}

const answer = await rl.question('3) Cole aqui a URL COMPLETA para onde voce foi redirecionado:\n   > ');
rl.close();

// Aceita tanto a URL inteira quanto so o code colado direto.
let code = answer.trim();
if (code.includes('code=')) {
  try {
    code = new URL(code).searchParams.get('code') ?? '';
  } catch {
    code = code.match(/code=([^&\s]+)/)?.[1] ?? '';
  }
}

if (!code) {
  console.log('\nNao consegui achar o parametro "code" no que voce colou.');
  process.exit(1);
}

console.log('\nTrocando o code por tokens...');

try {
  const tokens = await exchangeCode(code, redirectUri);
  console.log('\n=> Pronto. Tokens salvos em', TOKEN_FILE);
  console.log('   user_id:      ', tokens.user_id);
  console.log('   escopos:      ', tokens.scope);
  console.log('   access_token: ', String(tokens.access_token).slice(0, 18) + '...');
  console.log('   refresh_token:', tokens.refresh_token ? 'sim (renovacao automatica ativa)' : 'NAO VEIO');

  if (!tokens.refresh_token) {
    console.log('\n   Sem refresh_token o token morre em 6h e voce tera que repetir isso.');
    console.log('   Volte ao devcenter e habilite o escopo "offline_access" no app.');
  }

  // Confirma que o token realmente funciona.
  const me = await fetch('https://api.mercadolibre.com/users/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  console.log(`\n   Teste em /users/me: HTTP ${me.status}${me.ok ? ' (token valido)' : ''}`);
  console.log('\nAgora rode: npm run probe:ml');
} catch (err) {
  console.log('\nFalhou:', err.message);
  console.log('\nCausas comuns:');
  console.log('  - redirect_uri diferente do cadastrado no app (tem que ser IDENTICO)');
  console.log('  - o code ja foi usado (cada code so serve uma vez — refaca o passo 1)');
  console.log('  - o code expira em poucos minutos');
  console.log('  - ML_CLIENT_SECRET errado no .env');
  process.exit(1);
}
