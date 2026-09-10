// Cria o database (se preciso) e aplica db/schema.sql.
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
const sql = readFileSync(resolve(__dir, 'schema.sql'), 'utf8');
await conn.query(sql);
log.info('schema aplicado');

const [tables] = await conn.query('SHOW TABLES');
log.info(`tabelas: ${tables.map((t) => Object.values(t)[0]).join(', ')}`);

await conn.end();
