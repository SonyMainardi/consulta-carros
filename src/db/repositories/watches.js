import { query } from '../pool.js';

export async function activeWatches() {
  const rows = await query(`SELECT * FROM watches WHERE enabled = 1 ORDER BY id`);
  return rows.map((w) => ({
    ...w,
    sources: typeof w.sources === 'string' ? JSON.parse(w.sources) : (w.sources ?? []),
    params: typeof w.params === 'string' ? JSON.parse(w.params) : (w.params ?? {}),
  }));
}

export async function allWatches() {
  return query(`SELECT * FROM watches ORDER BY enabled DESC, name`);
}

export async function logRun(run) {
  await query(
    `INSERT INTO fetch_runs (source, watch_id, status, items_found, http_status, duration_ms, error)
     VALUES (?,?,?,?,?,?,?)`,
    [
      run.source, run.watchId ?? null, run.status, run.itemsFound ?? 0,
      run.httpStatus ?? null, run.durationMs ?? null,
      run.error ? String(run.error).slice(0, 2000) : null,
    ],
  );
}

/** Saude por fonte: quanto tempo faz que uma fonte nao traz nada? */
export async function sourceHealth() {
  return query(
    `SELECT source,
            MAX(started_at) AS last_run,
            SUM(status = 'OK')     AS ok_count,
            SUM(status = 'FAILED') AS fail_count,
            MAX(CASE WHEN status = 'OK' THEN started_at END) AS last_ok
       FROM fetch_runs
      WHERE started_at >= NOW() - INTERVAL 7 DAY
      GROUP BY source`,
  );
}
