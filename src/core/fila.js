// A FILA DE COLETA — uma rodada de cada vez, no processo inteiro.
//
// POR QUE EXISTE (ESTADO.md 2-X, 2026-09-16)
// Com "busca ao vivo" qualquer pessoa pode clicar BUSCAR a qualquer momento, e
// duas pessoas podem pedir carros diferentes no mesmo segundo. Mas os recursos
// nao se multiplicam:
//
//   - ha UM navegador (src/http/browser.js), e o `closeBrowser({fimDaRodada})`
//     do fim de uma rodada fecharia o Chromium debaixo da outra;
//   - o rate limiter e serial POR HOST: duas rodadas no mesmo portal nao
//     andariam em paralelo de verdade, so disputariam a fila;
//   - pedir a mesma pagina duas vezes ao mesmo portal e exatamente o
//     "insistir" que o CLAUDE.md proibe.
//
// Entao: uma rodada por vez, e quem pedir o MESMO carro que ja esta na fila
// espera aquela rodada em vez de criar outra. E o que faz a coleta nao se
// multiplicar com o numero de usuarios.
//
// E TAMBEM O SEAM PARA O FUTURO ONLINE: hoje a fila e um array em memoria e o
// mesmo processo consome. Quando o painel e a coleta virarem duas maquinas,
// `pedirColeta()` passa a gravar numa tabela e o worker passa a ler dela — quem
// chama nao muda.
import { runCollection } from './pipeline.js';
import { startProgress, endProgress } from './progress.js';
import { createLogger } from '../logger.js';

const log = createLogger('fila');

/** modeloId -> item. Serve de indice para nao enfileirar o mesmo carro duas vezes. */
const porCarro = new Map();
const fila = [];
let rodando = null; // item em execucao, ou null

function novoItem(carro, portais) {
  const item = { carro, portais: new Set(portais), estado: 'na fila', pedidoEm: Date.now() };
  item.promessa = new Promise((resolve, reject) => {
    item.resolver = resolve;
    item.rejeitar = reject;
  });
  // Ninguem precisa tratar: quem espera trata, e quem so disparou nao quer
  // derrubar o processo com uma rejeicao sem dono.
  item.promessa.catch(() => {});
  return item;
}

/**
 * Pede a coleta de um carro. Devolve a promessa da RODADA (stats do pipeline).
 *
 * Se o mesmo carro ja estiver na fila, os portais sao somados ao pedido que ja
 * existe e a promessa devolvida e a dele. Se ele ja estiver RODANDO, a promessa
 * e a da rodada em andamento: os portais novos nao entram nela — quem precisar
 * deles pede de novo depois que ela terminar.
 */
export function pedirColeta(carro, portais = null) {
  const alvos = portais?.length ? portais : (carro.sources ?? []);
  if (!alvos.length) return Promise.resolve(null);

  const existente = porCarro.get(carro.id);
  if (existente) {
    if (existente.estado === 'na fila') for (const p of alvos) existente.portais.add(p);
    return existente.promessa;
  }

  const item = novoItem(carro, alvos);
  porCarro.set(carro.id, item);
  fila.push(item);
  log.info(`${carro.slug}: na fila (${[...item.portais].join(', ')}) · ${fila.length} na frente`);
  tocarFila();
  return item.promessa;
}

async function tocarFila() {
  if (rodando) return;
  while (fila.length) {
    const item = fila.shift();
    rodando = item;
    item.estado = 'rodando';
    item.comecouEm = Date.now();
    const portais = [...item.portais];
    startProgress({ fonte: portais.length === 1 ? portais[0] : null, buscas: [item.carro.id] });
    try {
      const stats = await runCollection({
        carros: [{ ...item.carro, sources: portais }],
        fontes: portais,
      });
      endProgress({ stats });
      item.resolver(stats);
    } catch (err) {
      log.error(`${item.carro.slug}: rodada falhou — ${err.message}`);
      endProgress({ error: err.message });
      item.rejeitar(err);
    } finally {
      porCarro.delete(item.carro.id);
      rodando = null;
    }
  }
}

/** O que a fila esta fazendo — para o painel dizer "2 na frente" em vez de travar. */
export function estadoDaFila() {
  return {
    rodando: rodando
      ? { carroId: rodando.carro.id, carro: rodando.carro.name, portais: [...rodando.portais], desde: rodando.comecouEm }
      : null,
    esperando: fila.map((i) => ({ carroId: i.carro.id, carro: i.carro.name, portais: [...i.portais] })),
  };
}

/** Este carro esta na fila ou rodando agora? */
export function posicaoNaFila(modeloId) {
  const id = Number(modeloId);
  if (rodando?.carro.id === id) return 0;
  const i = fila.findIndex((x) => x.carro.id === id);
  return i < 0 ? null : i + 1;
}
