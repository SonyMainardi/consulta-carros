import { config } from '../config.js';
import { request } from '../http/client.js';
import { createLogger } from '../logger.js';

const log = createLogger('telegram');

const brl = (v) =>
  v == null ? 's/ preco' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const LABELS = {
  NEW: 'NOVO',
  PRICE_DROP: 'BAIXOU',
  PRICE_UP: 'SUBIU',
  DISAPPEARED: 'SAIU DO AR',
  RELISTED: 'REANUNCIADO',
  KM_CHANGED: 'KM MUDOU',
};

export function formatEvent(ev) {
  const payload = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : (ev.payload ?? {});
  const lines = [`[${LABELS[ev.type] ?? ev.type}] ${ev.title}`];

  if (ev.type === 'PRICE_DROP' || ev.type === 'PRICE_UP') {
    lines.push(`${brl(payload.from)} -> ${brl(payload.to)} (${payload.pct > 0 ? '+' : ''}${payload.pct}%)`);
  } else {
    lines.push(brl(ev.price));
  }

  const meta = [
    ev.year_model,
    ev.km != null ? `${Number(ev.km).toLocaleString('pt-BR')} km` : null,
    [ev.city, ev.uf].filter(Boolean).join('/'),
    ev.source,
  ].filter(Boolean);
  lines.push(meta.join(' | '));

  if (ev.fipe_ratio != null) {
    const pct = ((Number(ev.fipe_ratio) - 1) * 100).toFixed(1);
    lines.push(`FIPE: ${pct > 0 ? '+' : ''}${pct}%`);
  }
  lines.push(ev.url);
  return lines.join('\n');
}

export async function sendTelegram(text) {
  const { token, chatId } = config.notify.telegram;
  if (!token || !chatId) {
    log.warn('TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID nao configurados');
    return false;
  }
  try {
    await request(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: false,
      }),
      skipRateLimit: true,
    });
    return true;
  } catch (err) {
    log.error(`falha ao enviar: ${err.message}`);
    return false;
  }
}
