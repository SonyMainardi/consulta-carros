import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'logs');
mkdirSync(DIR, { recursive: true });

const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

function write(level, scope, msg, extra) {
  const ts = new Date().toISOString();
  const tail = extra === undefined ? '' : ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
  const line = `${ts} [${level.toUpperCase()}] (${scope}) ${msg}${tail}`;
  console.log(`${COLORS[level] ?? ''}${line}${RESET}`);
  try {
    appendFileSync(resolve(DIR, `${ts.slice(0, 10)}.log`), `${line}\n`);
  } catch { /* log em disco e best-effort */ }
}

export const createLogger = (scope) => ({
  debug: (m, e) => write('debug', scope, m, e),
  info: (m, e) => write('info', scope, m, e),
  warn: (m, e) => write('warn', scope, m, e),
  error: (m, e) => write('error', scope, m, e),
});
