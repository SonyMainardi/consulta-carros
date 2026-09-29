// CLI: node src/cli.js <comando>
//   collect <marca/modelo> [fonte]  coleta um carro do catalogo agora
//   collect --acompanhados [fonte]  coleta todos os carros marcados como acompanhados
//   fipe                            preenche FIPE dos anuncios ativos que ainda nao tem
//   notify                          envia notificacoes pendentes
//
// Desde 2026-09-16 (ESTADO.md 2-X) nao existem "buscas ativas": o que se coleta
// e um CARRO do catalogo. Por isso `collect` passou a exigir qual.
import { pool } from './db/pool.js';
import { runCollection } from './core/pipeline.js';
import { carroPorSlugs, modelosAcompanhados } from './db/repositories/catalogo.js';
import { flushNotifications } from './notify/index.js';
import { enrichPendingFipe } from './enrich/run.js';
import { createLogger } from './logger.js';

const log = createLogger('cli');
const [command, arg, arg2] = process.argv.slice(2);

async function carrosDoPedido(alvo) {
  if (!alvo || alvo === '--acompanhados') {
    const carros = await modelosAcompanhados();
    if (!carros.length) log.warn('nenhum carro acompanhado — marque um no painel, ou passe marca/modelo');
    return carros;
  }
  const [marca, modelo] = alvo.split('/');
  if (!marca || !modelo) {
    log.error('use marca/modelo, como em: npm run collect mitsubishi/lancer');
    return [];
  }
  const carro = await carroPorSlugs(marca, modelo);
  if (!carro) log.error(`"${marca}/${modelo}" nao esta no catalogo (rode npm run db:catalogo)`);
  return carro ? [carro] : [];
}

try {
  switch (command) {
    case 'collect': {
      const carros = await carrosDoPedido(arg);
      if (carros.length) {
        const fonte = arg === '--acompanhados' ? arg2 : arg2;
        const stats = await runCollection({ carros, fontes: fonte ? [fonte] : null });
        if (stats) {
          await enrichPendingFipe(40);
          await flushNotifications();
        }
      }
      break;
    }
    case 'fipe':
      await enrichPendingFipe(Number(arg) || 100);
      break;
    case 'notify':
      await flushNotifications();
      break;
    default:
      console.log('uso: node src/cli.js <collect marca/modelo | collect --acompanhados | fipe | notify>');
  }
} catch (err) {
  log.error(err.stack ?? err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
