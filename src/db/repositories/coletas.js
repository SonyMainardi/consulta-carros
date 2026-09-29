// A tabela `fetch_runs`: uma linha por (modelo, portal, rodada).
//
// Ela tem DOIS papeis, e os dois importam:
//   1. DIAGNOSTICO — primeiro lugar para olhar quando uma fonte para de
//      responder. A tela engana (a janela do Chromium fecha e o painel mostra
//      a rodada anterior); esta tabela nao.
//   2. RELOGIO DO CACHE — desde 2026-09-16 (ESTADO.md 2-X) e o que diz se a
//      busca de alguem pode ser respondida do banco ou se precisa coletar.
//
// O nome `fetch_runs` ficou de proposito: CLAUDE.md e ESTADO.md mandam
// "conferir fetch_runs" em varios lugares, e renomear invalidaria isso.
import { query } from '../pool.js';

export async function logRun(run) {
  // started_at vai explicito: o DEFAULT CURRENT_TIMESTAMP gravava a hora do
  // INSERT, que acontece no FIM da rodada (achado da sessao 5, 2-F).
  await query(
    `INSERT INTO fetch_runs
       (source, modelo_id, status, items_found, total_busca, paginas, cobertura,
        http_status, duration_ms, error, started_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, COALESCE(FROM_UNIXTIME(?), CURRENT_TIMESTAMP))`,
    [
      run.source, run.modeloId ?? null, run.status, run.itemsFound ?? 0,
      run.totalBusca ?? null, run.paginas ?? null, run.cobertura ?? null,
      run.httpStatus ?? null, run.durationMs ?? null,
      run.error ? String(run.error).slice(0, 2000) : null,
      run.startedAt ? Math.floor(run.startedAt / 1000) : null,
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

/** As ultimas rodadas, para a tela de diagnostico. */
export function ultimasRodadas(limite = 20) {
  return query(
    `SELECT f.id, f.source, f.status, f.items_found, f.total_busca, f.paginas,
            f.cobertura, f.duration_ms, f.error, f.started_at,
            ma.nome marca, mo.nome modelo
       FROM fetch_runs f
       LEFT JOIN modelos mo ON mo.id = f.modelo_id
       LEFT JOIN marcas  ma ON ma.id = mo.marca_id
      ORDER BY f.started_at DESC
      LIMIT ?`,
    [Number(limite)],
  );
}
