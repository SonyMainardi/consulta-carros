// CLI: node src/cli.js <comando>
//   collect [fonte]   roda uma coleta agora (opcionalmente so uma fonte)
//   fipe              preenche FIPE dos anuncios ativos que ainda nao tem
//   notify            envia notificacoes pendentes
import { pool } from './db/pool.js';
import { runCollection } from './core/pipeline.js';
import { flushNotifications } from './notify/index.js';
import { enrichPendingFipe } from './enrich/run.js';
import { createLogger } from './logger.js';

const log = createLogger('cli');
const [command, arg] = process.argv.slice(2);

try {
  switch (command) {
    case 'collect': {
      const stats = await runCollection({ only: arg ?? null });
      if (stats) {
        await enrichPendingFipe(40);
        await flushNotifications();
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
      console.log('uso: node src/cli.js <collect|fipe|notify> [arg]');
  }
} catch (err) {
  log.error(err.stack ?? err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
