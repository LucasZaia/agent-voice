import { loadConfig, readStoredConfig, saveConfig, writeStoredConfig, NUMERIC_KEYS, DEFAULTS } from '../config.js';
import { DEFAULT_PHRASES, validateTemplate } from '../core/phrases.js';

const PHRASE_KEYS = Object.keys(DEFAULT_PHRASES).map((n) => `phrases.${n}`);
const KEYS = [...Object.keys(NUMERIC_KEYS), ...PHRASE_KEYS];
const USAGE = `usage: agent-voice config get [key] | set <key> <value> | reset <key>   (keys: ${KEYS.join(', ')})`;

const phraseName = (key) => (typeof key === 'string' && key.startsWith('phrases.') ? key.slice('phrases.'.length) : null);

function checkKey(key) {
  const name = phraseName(key);
  if (name !== null) {
    if (!Object.hasOwn(DEFAULT_PHRASES, name)) throw new Error(validateTemplate(name, ''));
    return;
  }
  if (!Object.hasOwn(NUMERIC_KEYS, key ?? '')) {
    throw new Error(`unknown key "${key}" (settable: ${KEYS.join(', ')}; outputs are managed with "agent-voice output enable|disable")`);
  }
}

const storedPhrases = (env) => {
  const p = readStoredConfig(env).phrases;
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
};

export function runConfig(args, { env, out }) {
  const [sub, key, value] = args;
  if (sub === 'get') {
    const cfg = loadConfig(env);
    const phrase = (name) => cfg.phrases[name] ?? DEFAULT_PHRASES[name];
    if (!key) {
      for (const k of Object.keys(NUMERIC_KEYS)) out(`${k}=${cfg[k]}`);
      out(`outputs=${cfg.outputs.join(' ')}`);
      for (const name of Object.keys(DEFAULT_PHRASES)) out(`phrases.${name}=${phrase(name)}`);
      return 0;
    }
    if (key === 'outputs') {
      out(cfg.outputs.join(' '));
      return 0;
    }
    checkKey(key);
    out(String(phraseName(key) !== null ? phrase(phraseName(key)) : cfg[key]));
    return 0;
  }
  if (sub === 'set') {
    checkKey(key);
    const name = phraseName(key);
    if (name !== null) {
      const problem = validateTemplate(name, value);
      if (problem) throw new Error(problem);
      saveConfig({ phrases: { ...storedPhrases(env), [name]: value } }, env);
      out(`${key}=${value}`);
      return 0;
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
  if (sub === 'reset') {
    checkKey(key);
    const name = phraseName(key);
    if (name !== null) {
      const { [name]: _dropped, ...rest } = storedPhrases(env);
      saveConfig({ phrases: rest }, env);
      out(`${key}=${DEFAULT_PHRASES[name]}`);
    } else {
      const { [key]: _dropped, ...rest } = readStoredConfig(env);
      writeStoredConfig(rest, env);
      out(`${key}=${DEFAULTS[key]}`);
    }
    return 0;
  }
  throw new Error(USAGE);
}
