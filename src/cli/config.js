import { loadConfig, saveConfig, NUMERIC_KEYS } from '../config.js';

const USAGE = `usage: agent-voice config get [key] | set <key> <value>   (keys: ${Object.keys(NUMERIC_KEYS).join(', ')})`;

export function runConfig(args, { env, out }) {
  const [sub, key, value] = args;
  if (sub === 'get') {
    const cfg = loadConfig(env);
    if (!key) {
      for (const k of Object.keys(NUMERIC_KEYS)) out(`${k}=${cfg[k]}`);
      out(`outputs=${cfg.outputs.join(' ')}`);
      return 0;
    }
    if (key === 'outputs') out(cfg.outputs.join(' '));
    else if (Object.hasOwn(NUMERIC_KEYS, key)) out(String(cfg[key]));
    else throw new Error(`unknown key "${key}". ${USAGE}`);
    return 0;
  }
  if (sub === 'set') {
    if (!Object.hasOwn(NUMERIC_KEYS, key ?? '')) {
      throw new Error(`unknown key "${key}" (settable: ${Object.keys(NUMERIC_KEYS).join(', ')}; outputs are managed with "agent-voice output enable|disable")`);
    }
    if (!/^[0-9]+$/.test(value ?? '')) {
      throw new Error(`${key} must be a whole number of ${key === 'maxSpeechChars' ? 'characters' : 'seconds'}`);
    }
    saveConfig({ [key]: Number(value) }, env);
    out(`${key}=${value}`);
    const envName = NUMERIC_KEYS[key];
    if (env[envName] !== undefined) out(`Note: ${envName}=${env[envName]} overrides it in this environment.`);
    return 0;
  }
  throw new Error(USAGE);
}
