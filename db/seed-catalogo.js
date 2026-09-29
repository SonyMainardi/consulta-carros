// Semeia o catalogo fixo (marcas, modelos, enderecos) a partir da tabela FIPE.
//
// POR QUE UM CATALOGO FIXO (ESTADO.md 2-X)
// O usuario nao digita mais marca e modelo: escolhe em dois selects. Isso exige
// uma lista finita — e ela e finita mesmo: ~107 marcas, ~30 modelos por marca
// depois de agrupar as versoes, ~3.200 combinacoes. Com a lista no banco:
//   - os selects respondem na hora, sem depender da FIPE estar no ar;
//   - cada combinacao ganha um endereco POR PORTAL, corrigivel em uma linha
//     (na OLX a Volkswagen e `vw-volkswagen`) — e o conserto vale para todos;
//   - modelo com versao embutida ("Vectra GT", ESTADO.md 2-T) fica impossivel.
//
// IDEMPOTENTE, e de proposito CONSERVADOR:
//   - marca e modelo: cria o que falta, atualiza so o nome e a contagem;
//   - endereco: SO CRIA O QUE FALTA. Nunca sobrescreve, porque o endereco pode
//     ter sido confirmado por uma coleta real (CONFIRMADO) ou corrigido a mao.
//
// A FIPE e um servico gratuito de terceiros: uma chamada por marca, a cada
// ~1,5 s (o intervalo esta em src/enrich/fipe.js). A primeira execucao leva
// uns 3 minutos; as seguintes saem do cache em disco.
//
// Uso:
//   node db/seed-catalogo.js                 todas as marcas
//   node db/seed-catalogo.js --marca=Honda   so uma (util para teste)
import { pool, query } from '../src/db/pool.js';
import { marcasFipe, modelosFipe } from '../src/enrich/fipe.js';
import {
  agruparModelosFipe, apelidosDaMarca, nomeDaMarca, slugify, slugsDaBusca, normalizar, PORTAIS,
} from '../src/core/marcas.js';
import { createLogger } from '../src/logger.js';

const log = createLogger('catalogo');

const soAMarca = process.argv.find((a) => a.startsWith('--marca='))?.split('=')[1] ?? null;

const marcas = await marcasFipe();
const escolhidas = soAMarca
  ? marcas.filter((m) => normalizar(nomeDaMarca(m.nome)) === normalizar(soAMarca))
  : marcas;

if (!escolhidas.length) {
  log.error(soAMarca ? `marca "${soAMarca}" nao esta na FIPE` : 'a FIPE nao devolveu marca nenhuma');
  await pool.end();
  process.exit(1);
}

log.info(`semeando ${escolhidas.length} marca(s) — a primeira vez leva alguns minutos`);

const total = { marcas: 0, modelos: 0, enderecos: 0, falhas: [] };

for (const [i, m] of escolhidas.entries()) {
  const nome = nomeDaMarca(m.nome);
  const slug = slugify(nome);

  // A marca entra mesmo que os modelos falhem: o select ja a mostra, e o
  // proximo seed completa.
  await query(
    `INSERT INTO marcas (nome, slug, fipe_codigo, fipe_nome, apelidos)
          VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE nome = VALUES(nome), fipe_codigo = VALUES(fipe_codigo),
                             fipe_nome = VALUES(fipe_nome), apelidos = VALUES(apelidos)`,
    [nome, slug, String(m.codigo), m.nome, JSON.stringify(apelidosDaMarca(nome))],
  );
  const [{ id: marcaId }] = await query('SELECT id FROM marcas WHERE slug = ?', [slug]);
  total.marcas += 1;

  let modelos;
  try {
    modelos = agruparModelosFipe(await modelosFipe(String(m.codigo)));
  } catch (err) {
    log.warn(`${nome}: nao consegui os modelos (${err.message}) — sigo para a proxima`);
    total.falhas.push(nome);
    continue;
  }

  for (const mod of modelos) {
    const modSlug = slugify(mod.nome);
    if (!modSlug) continue;
    await query(
      `INSERT INTO modelos (marca_id, nome, slug, fipe_versoes)
            VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE nome = VALUES(nome), fipe_versoes = VALUES(fipe_versoes)`,
      [marcaId, mod.nome, modSlug, mod.versoes],
    );
    const [{ id: modeloId }] = await query(
      'SELECT id FROM modelos WHERE marca_id = ? AND slug = ?', [marcaId, modSlug],
    );
    total.modelos += 1;

    // INSERT IGNORE: endereco ja existente pode ter sido CONFIRMADO por uma
    // coleta ou corrigido a mao. O seed nao desfaz isso.
    const padrao = slugsDaBusca(nome, mod.nome);
    for (const portal of PORTAIS) {
      const r = await query(
        `INSERT IGNORE INTO enderecos (modelo_id, portal, marca_slug, modelo_slug)
              VALUES (?, ?, ?, ?)`,
        [modeloId, portal, padrao[portal].marca, padrao[portal].modelo],
      );
      total.enderecos += r.affectedRows ?? 0;
    }
  }

  if ((i + 1) % 10 === 0 || i === escolhidas.length - 1) {
    log.info(`${i + 1}/${escolhidas.length} marcas · ${total.modelos} modelos · ${total.enderecos} enderecos novos`);
  }
}

const [{ nm }] = await query('SELECT COUNT(*) nm FROM marcas');
const [{ nmod }] = await query('SELECT COUNT(*) nmod FROM modelos');
const [{ nend }] = await query('SELECT COUNT(*) nend FROM enderecos');
log.info(`catalogo: ${nm} marcas · ${nmod} modelos · ${nend} enderecos`);
if (total.falhas.length) log.warn(`sem modelos (rode de novo para completar): ${total.falhas.join(', ')}`);

await pool.end();
