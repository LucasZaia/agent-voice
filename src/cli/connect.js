import { ADAPTERS } from '../adapters/index.js';
import { connectFile, disconnectFile, hookCommand } from '../adapters/hooks-json.js';
import { findOnPath } from '../platform.js';

export function adapterFor(name) {
  if (!Object.hasOwn(ADAPTERS, name ?? '')) {
    throw new Error(`unknown agent "${name}" (available: ${Object.keys(ADAPTERS).join(', ')})`);
  }
  return ADAPTERS[name];
}

export async function connectAgent(adapter, { env, out, prompt, yes = false }) {
  const file = adapter.configFile(env);
  const command = hookCommand(env);
  out(`${adapter.name}: these hooks will be added to ${file}`);
  for (const d of adapter.hooks) out(`  ${d.event.padEnd(18)} → ${command} notify ${adapter.name} ${d.sub}`);
  if (!yes && !(await prompt.confirm('Apply?', true))) {
    out('Nothing changed.');
    return false;
  }
  const { changed, backup } = connectFile(file, adapter.name, adapter.hooks, { command });
  out(changed ? `Connected ${adapter.name}.${backup ? ` Backup: ${backup}` : ''}` : `${adapter.name} was already connected; nothing changed.`);
  if (command === 'agent-voice' && !findOnPath('agent-voice', env)) {
    out('Warning: "agent-voice" is not on your PATH, so these hooks will not run. Install with "npm i -g @lucaszaia/agent-voice".');
  }
  for (const note of adapter.notes) out(`Note: ${note}`);
  return true;
}

export async function runConnect(args, { env, out, prompt }) {
  const adapter = adapterFor(args.find((a) => !a.startsWith('--')));
  await connectAgent(adapter, { env, out, prompt, yes: args.includes('--yes') });
  return 0;
}

export async function runDisconnect(args, { env, out }) {
  const adapter = adapterFor(args[0]);
  const file = adapter.configFile(env);
  const { changed, backup } = disconnectFile(file, adapter.name);
  out(changed ? `Removed agent-voice's hooks from ${file}. Backup: ${backup}` : `${adapter.name} had no agent-voice hooks; nothing changed.`);
  return 0;
}
