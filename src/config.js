// Precedence: built-in defaults < config.json < AV_* environment variables.
// The environment wins so tests (and one-off runs) never touch real config.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { configDir, stateDir } from './platform.js';

export const DEFAULTS = Object.freeze({ minSeconds: 30, cooldownSeconds: 120, maxSpeechChars: 90, outputs: [] });

export const NUMERIC_KEYS = Object.freeze({
  minSeconds: 'AV_MIN_SECONDS',
  cooldownSeconds: 'AV_COOLDOWN_SECONDS',
  maxSpeechChars: 'AV_MAX_SPEECH_CHARS',
});

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const isValidOutputName = (name) => typeof name === 'string' && NAME_RE.test(name);

function readJson(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error(`${file}: invalid JSON (${e.message})`);
  }
}

function writeJson(file, value, mode) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
  if (mode) {
    try { chmodSync(file, mode); } catch { /* not supported on this OS */ }
  }
}

const configFile = (env) => join(configDir(env), 'config.json');
const instanceFile = (name, env) => join(configDir(env), 'outputs', `${name}.json`);

export function readStoredConfig(env = process.env) {
  const stored = readJson(configFile(env)) ?? {};
  if (typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error(`${configFile(env)}: expected a JSON object`);
  }
  return stored;
}

export function loadConfig(env = process.env) {
  const cfg = { ...DEFAULTS, ...readStoredConfig(env) };
  for (const [key, envName] of Object.entries(NUMERIC_KEYS)) {
    // A hand-edited "30s" or 1.5 must not reach the core as a threshold.
    if (!Number.isSafeInteger(cfg[key]) || cfg[key] < 0) cfg[key] = DEFAULTS[key];
    if (/^[0-9]+$/.test(env[envName] ?? '')) cfg[key] = Number(env[envName]);
  }
  if (env.AV_OUTPUTS !== undefined) cfg.outputs = env.AV_OUTPUTS.split(/\s+/).filter(Boolean);
  cfg.outputs = Array.isArray(cfg.outputs) ? cfg.outputs.filter((n) => typeof n === 'string') : [];
  return { ...cfg, configDir: configDir(env), stateDir: stateDir(env) };
}

export function saveConfig(patch, env = process.env) {
  const next = { ...readStoredConfig(env), ...patch };
  writeJson(configFile(env), next);
  return next;
}

export function readOutputInstance(name, env = process.env) {
  if (!isValidOutputName(name)) return null;
  return readJson(instanceFile(name, env));
}

export function writeOutputInstance(name, conf, env = process.env) {
  if (!isValidOutputName(name)) throw new Error(`invalid output name "${name}" (use a-z, 0-9 and -)`);
  writeJson(instanceFile(name, env), conf, 0o600);
}

// True even for a file too broken to read, so it can still be removed.
export const outputInstanceExists = (name, env = process.env) => isValidOutputName(name) && existsSync(instanceFile(name, env));

export function removeOutputInstance(name, env = process.env) {
  if (isValidOutputName(name)) rmSync(instanceFile(name, env), { force: true });
}

export function listOutputInstances(env = process.env) {
  let files;
  try { files = readdirSync(join(configDir(env), 'outputs')); } catch { return []; }
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .filter(isValidOutputName)
    .sort()
    .map((name) => {
      try { return { name, conf: readOutputInstance(name, env) }; } catch (e) { return { name, conf: null, error: e.message }; }
    });
}
