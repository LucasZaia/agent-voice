import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTERS } from '../adapters/index.js';
import { fileStatus } from '../adapters/hooks-json.js';
import { loadConfig, listOutputInstances, NUMERIC_KEYS } from '../config.js';
import { OUTPUT_TYPES } from '../outputs/index.js';

export async function runStatus(args, { env, out }) {
  const cfg = loadConfig(env);

  out('Agents');
  for (const a of Object.values(ADAPTERS)) {
    const state = a.detect(env) ? fileStatus(a.configFile(env), a.name, a.hooks) : 'not installed';
    const hint = state === 'legacy' ? ' (old bash hooks — run "agent-voice connect ' + a.name + '" to upgrade)' : '';
    out(`  ${a.name.padEnd(12)} ${state}${hint}`);
  }

  out('Outputs (* = enabled)');
  const instances = listOutputInstances(env);
  const known = new Set(instances.map((i) => i.name));
  for (const { name, conf, error } of instances) {
    const mark = cfg.outputs.includes(name) ? '*' : ' ';
    const what = conf && Object.hasOwn(OUTPUT_TYPES, conf.type)
      ? `${conf.type.padEnd(8)} ${OUTPUT_TYPES[conf.type].describe(conf)}`
      : `broken   ${error ?? `unknown type ${conf?.type}`}`;
    out(`  ${mark} ${name.padEnd(16)} ${what}`);
  }
  for (const name of cfg.outputs.filter((n) => !known.has(n))) {
    out(`  * ${name.padEnd(16)} (missing — enabled but not configured)`);
  }
  if (instances.length === 0 && cfg.outputs.length === 0) out('  none — add one with: agent-voice output add <alexa|local|command>');

  out('Settings');
  for (const k of Object.keys(NUMERIC_KEYS)) out(`  ${k}=${cfg[k]}`);

  const logFile = join(cfg.stateDir, 'events.log');
  out(`Log (${logFile})`);
  let lines = [];
  try { lines = readFileSync(logFile, 'utf8').trimEnd().split('\n').filter(Boolean); } catch { /* no log yet */ }
  if (lines.length === 0) out('  (empty)');
  for (const line of lines.slice(-10)) out(`  ${line}`);
  return 0;
}
