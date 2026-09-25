// The front door: connect the agents found on this machine, add one speaker,
// prove it speaks. Safe to re-run — it only offers what is still missing.
import { ADAPTERS } from '../adapters/index.js';
import { fileStatus } from '../adapters/hooks-json.js';
import { OUTPUT_TYPES } from '../outputs/index.js';
import { loadConfig, readOutputInstance, removeOutputInstance } from '../config.js';
import { connectAgent } from './connect.js';
import { addOutput, testOutput, disableOutput } from './output.js';
import { isCancelled } from './prompt.js';

const LABELS = {
  alexa: 'alexa    an Echo, through Home Assistant',
  local: "local    this computer's own voice",
  command: 'command  any command that speaks a sentence',
};

export async function runSetup(args, io) {
  const { env, out, prompt } = io;
  out('agent-voice setup');
  out('');

  const found = Object.values(ADAPTERS).filter((a) => a.detect(env));
  if (found.length === 0) {
    out('No supported agent found (Claude Code, Codex). Any other CLI works through: agent-voice wrap -- <command>');
  }
  for (const adapter of found) {
    if (fileStatus(adapter.configFile(env), adapter.name, adapter.hooks) === 'connected') {
      out(`${adapter.name}: already connected.`);
      continue;
    }
    await connectAgent(adapter, { env, out, prompt, yes: false });
  }
  out('');

  const active = loadConfig(env).outputs.filter((n) => readOutputInstance(n, env));
  let wantOutput = active.length === 0 || await prompt.confirm(`Active outputs: ${active.join(', ')}. Add another?`, false);
  const types = Object.keys(OUTPUT_TYPES);

  while (wantOutput) {
    const i = await prompt.choose('How should agent-voice speak?', types.map((t) => LABELS[t] ?? t), 0);
    let name;
    try {
      name = await addOutput(types[i], undefined, io);
    } catch (e) {
      if (isCancelled(e)) throw e;
      out(`Could not set up ${types[i]}: ${e.message}`);
      if (!(await prompt.confirm('Try again?', true))) break;
      continue;
    }
    out('Speaking a test sentence…');
    const spoke = await testOutput(name, io);
    if (spoke && await prompt.confirm('Did you hear it?', true)) {
      wantOutput = false;
    } else {
      removeOutputInstance(name, env);
      disableOutput(name, env);
      out(`Removed "${name}".`);
      if (!(await prompt.confirm('Try again?', true))) break;
    }
  }

  out('');
  out('Done. Check everything with: agent-voice status');
  return 0;
}
