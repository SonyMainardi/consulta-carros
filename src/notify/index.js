import { config } from '../config.js';
import { pendingNotifications, markNotified } from '../db/repositories/events.js';
import { sendTelegram, formatEvent } from './telegram.js';
import { createLogger } from '../logger.js';

const log = createLogger('notify');

// Eventos que valem um alerta no celular. Os demais ficam so no painel.
const ALERT_TYPES = new Set(['NEW', 'PRICE_DROP']);

export async function flushNotifications() {
  if (!config.notify.enabled) return 0;

  const pending = await pendingNotifications(30);
  if (!pending.length) return 0;

  const toSend = pending.filter((e) => ALERT_TYPES.has(e.type));
  if (toSend.length) {
    const text = toSend.map(formatEvent).join('\n\n---\n\n');
    const ok = await sendTelegram(text);
    if (!ok) return 0;
    log.info(`${toSend.length} eventos notificados`);
  }

  // Marca todos como tratados, inclusive os que nao geram alerta.
  await markNotified(pending.map((e) => e.id));
  return toSend.length;
}
