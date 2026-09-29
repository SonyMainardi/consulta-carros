// Cria o database (se preciso), aplica db/schema.sql e atualiza bancos antigos.
//
// O schema.sql so tem CREATE TABLE IF NOT EXISTS: num banco que ja existe ele
// nao acrescenta coluna nenhuma. As mudancas de estrutura posteriores ficam
// aqui embaixo, cada uma conferindo o information_schema antes — rodar o
// migrate duas vezes nao pode fazer nada na segunda.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';
import { createLogger } from '../src/logger.js';

const log = createLogger('migrate');
const __dir = dirname(fileURLToPath(import.meta.url));

const { database, ...serverOnly } = config.db;

const conn = await mysql.createConnection({ ...serverOnly, multipleStatements: true }).catch((err) => {
  log.error('Nao consegui conectar no MySQL. Confira DB_USER/DB_PASSWORD no .env', err.message);
  process.exit(1);
});

await conn.query(
  `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
);
log.info(`database pronto: ${database}`);

await conn.changeUser({ database });

async function existeTabela(tabela) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [database, tabela],
  );
  return rows.length > 0;
}

/* ---------------------------------------------------------------------------
   2026-09-16 — catalogo fixo e cache por modelo (ESTADO.md 2-X)

   O projeto deixou de ter "buscas salvas": o que se guarda sao ANUNCIOS
   indexados pelo par (marca, modelo) do catalogo. As tabelas antigas giravam
   em torno de `watches`, que era busca e coleta ao mesmo tempo, e nenhuma
   coluna delas sobrevive a mudanca (listing_watches.watch_id, events.watch_id,
   fetch_runs.watch_id).

   Decisao do usuario: COMECAR DO ZERO, sem migrar os dados. O dump do banco
   antigo ficou em data/backups/backup-consulta_carros-2026-09-16-antes-catalogo.sql.

   Roda so uma vez: depois disto `watches` nao existe mais.
--------------------------------------------------------------------------- */
if (await existeTabela('watches')) {
  log.warn('banco no formato antigo (tabela `watches`) — recriando do zero, como pedido');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['events', 'price_history', 'listing_watches', 'listings', 'fetch_runs', 'watches']) {
    await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  log.info('tabelas antigas removidas (o backup esta em data/backups/)');
}

const sql = readFileSync(resolve(__dir, 'schema.sql'), 'utf8');
await conn.query(sql);
log.info('schema aplicado');

const [tables] = await conn.query('SHOW TABLES');
log.info(`tabelas: ${tables.map((t) => Object.values(t)[0]).join(', ')}`);

const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM modelos');
if (!n) log.warn('catalogo vazio — rode `npm run db:catalogo` para semear marcas e modelos da FIPE');

await conn.end();
