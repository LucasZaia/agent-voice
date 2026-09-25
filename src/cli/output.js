import { OUTPUT_TYPES } from '../outputs/index.js';
import {
  loadConfig, readStoredConfig, saveConfig, readOutputInstance, writeOutputInstance,
  removeOutputInstance, listOutputInstances, isValidOutputName,
} from '../config.js';
import { TEST_SENTENCE } from '../core/phrases.js';

const USAGE = 'usage: agent-voice output add <alexa|local|command> [name] | list | remove <name> | enable <name> | disable <name> | test [name]';

const storedOutputs = (env) => {
  const list = readStoredConfig(env).outputs;
  return Array.isArray(list) ? list : [];
};

export function enableOutput(name, env) {
  if (!readOutputInstance(name, env)) throw new Error(`no output named "${name}"`);
  const list = storedOutputs(env);
  if (!list.includes(name)) saveConfig({ outputs: [...list, name] }, env);
}

export function disableOutput(name, env) {
  saveConfig({ outputs: storedOutputs(env).filter((n) => n !== name) }, env);
}

export function nextFreeName(type, env) {
  let name = type;
  for (let i = 2; readOutputInstance(name, env); i++) name = `${type}-${i}`;
  return name;
}

const typeModule = (type) => {
  if (!Object.hasOwn(OUTPUT_TYPES, type ?? '')) {
    throw new Error(`unknown output type "${type}" (available: ${Object.keys(OUTPUT_TYPES).join(', ')})`);
  }
  return OUTPUT_TYPES[type];
};

export async function addOutput(type, name, { env, out, prompt, deps }) {
  const mod = typeModule(type);
  const finalName = name || nextFreeName(type, env);
  if (!isValidOutputName(finalName)) throw new Error(`invalid output name "${finalName}" (use a-z, 0-9 and -)`);
  const current = readOutputInstance(finalName, env) ?? {};
  if (current.type && current.type !== type) throw new Error(`output "${finalName}" already exists with type ${current.type}`);
  const conf = await mod.questions(prompt, current, deps);
  writeOutputInstance(finalName, conf, env);
  enableOutput(finalName, env);
  out(`Saved output "${finalName}" (${mod.describe(conf)}) and enabled it.`);
  return finalName;
}

export async function testOutput(name, { env, out, deps }) {
  const conf = readOutputInstance(name, env);
  if (!conf) throw new Error(`no output named "${name}"`);
  const mod = typeModule(conf.type);
  try {
    await mod.speak(TEST_SENTENCE, conf, deps);
    out(`ok    ${name}`);
    return true;
  } catch (e) {
    out(`FAIL  ${name}: ${e.message}`);
    return false;
  }
}

export async function testActive(io) {
  const names = loadConfig(io.env).outputs;
  if (names.length === 0) throw new Error('no active outputs — add one with: agent-voice output add <alexa|local|command>');
  let ok = true;
  for (const name of names) ok = (await testOutput(name, io)) && ok;
  return ok ? 0 : 1;
}

export async function runOutput(args, io) {
  const [sub, a, b] = args;
  const { env, out } = io;
  switch (sub) {
    case 'add': {
      const name = await addOutput(a, b, io);
      return (await testOutput(name, io)) ? 0 : 1;
    }
    case 'list': {
      const active = loadConfig(env).outputs;
      const all = listOutputInstances(env);
      if (all.length === 0) {
        out('No outputs yet. Add one with: agent-voice output add <alexa|local|command>');
        return 0;
      }
      for (const { name, conf, error } of all) {
        const mark = active.includes(name) ? '*' : ' ';
        const what = conf ? `${String(conf.type).padEnd(8)} ${Object.hasOwn(OUTPUT_TYPES, conf.type) ? OUTPUT_TYPES[conf.type].describe(conf) : '(unknown type)'}` : `broken   ${error}`;
        out(`${mark} ${name.padEnd(16)} ${what}`);
      }
      out('(* = enabled)');
      return 0;
    }
    case 'remove':
      if (!a) throw new Error(USAGE);
      removeOutputInstance(a, env);
      disableOutput(a, env);
      out(`Removed output "${a}".`);
      return 0;
    case 'enable':
      if (!a) throw new Error(USAGE);
      enableOutput(a, env);
      out(`Enabled "${a}".`);
      return 0;
    case 'disable':
      if (!a) throw new Error(USAGE);
      disableOutput(a, env);
      out(`Disabled "${a}".`);
      return 0;
    case 'test':
      return a ? ((await testOutput(a, io)) ? 0 : 1) : testActive(io);
    default:
      throw new Error(USAGE);
  }
}
