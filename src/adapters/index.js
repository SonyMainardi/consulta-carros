import { mercadolivre } from './mercadolivre.js';
import { webmotors } from './webmotors.js';
import { olx } from './olx.js';

export const adapters = { mercadolivre, webmotors, olx };

export function getAdapter(name) {
  const a = adapters[name];
  if (!a) throw new Error(`adapter desconhecido: ${name}`);
  return a;
}

export const adapterNames = Object.keys(adapters);
