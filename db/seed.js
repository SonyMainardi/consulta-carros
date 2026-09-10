// Le watches.yaml e sincroniza a tabela `watches` (upsert por slug).
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { pool, query } from '../src/db/pool.js';
import { createLogger } from '../src/logger.js';

const log = createLogger('seed');
const file = resolve(process.cwd(), 'watches.yaml');

if (!existsSync(file)) {
  log.error('watches.yaml nao encontrado na raiz do projeto');
  process.exit(1);
}

const doc = YAML.parse(readFileSync(file, 'utf8'));
const watches = doc?.watches ?? [];

if (!watches.length) {
  log.warn('nenhum watch definido em watches.yaml');
}

for (const w of watches) {
  if (!w.slug) {
    log.warn(`watch sem slug, ignorado: ${JSON.stringify(w)}`);
    continue;
  }
  await query(
    `INSERT INTO watches
       (slug, name, enabled, brand, model, version_contains,
        year_min, year_max, price_min, price_max, km_max, uf, sources, params)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       name=VALUES(name), enabled=VALUES(enabled), brand=VALUES(brand), model=VALUES(model),
       version_contains=VALUES(version_contains), year_min=VALUES(year_min), year_max=VALUES(year_max),
       price_min=VALUES(price_min), price_max=VALUES(price_max), km_max=VALUES(km_max),
       uf=VALUES(uf), sources=VALUES(sources), params=VALUES(params)`,
    [
      w.slug,
      w.name ?? w.slug,
      w.enabled === false ? 0 : 1,
      w.brand ?? null,
      w.model ?? null,
      w.version_contains ?? null,
      w.year_min ?? null,
      w.year_max ?? null,
      w.price_min ?? null,
      w.price_max ?? null,
      w.km_max ?? null,
      Array.isArray(w.uf) ? w.uf.join(',') : (w.uf ?? null),
      JSON.stringify(w.sources ?? ['mercadolivre', 'webmotors', 'olx']),
      JSON.stringify(w.params ?? {}),
    ],
  );
  log.info(`watch sincronizado: ${w.slug}`);
}

await pool.end();
