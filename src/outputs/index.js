import * as command from './command.js';
import { readOutputInstance } from '../config.js';

export const OUTPUT_TYPES = { command };

// Turns the active output names into speak() closures for the core. A name with
// no usable instance gets speak: null, which the core logs as "no such output".
export function resolveOutputs(names, env = process.env) {
  return names.map((name) => {
    let conf;
    try {
      conf = readOutputInstance(name, env);
    } catch (e) {
      return { name, speak: null, reason: e.message };
    }
    if (!conf) return { name, speak: null };
    const mod = Object.hasOwn(OUTPUT_TYPES, conf.type) ? OUTPUT_TYPES[conf.type] : null;
    if (!mod) return { name, speak: null, reason: `unknown output type ${conf.type}` };
    return { name, speak: (sentence) => mod.speak(sentence, conf) };
  });
}
