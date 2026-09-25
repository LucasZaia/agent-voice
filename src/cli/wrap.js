// For agents with no hooks: run the command, marking the turn's start and end.
// The core applies the usual rules, so a short command stays silent.
import { spawn as nodeSpawn } from 'node:child_process';
import { constants } from 'node:os';
import { createContext } from '../core/context.js';
import { handle } from '../core/handle.js';
import { projectOf } from '../adapters/common.js';
import { spawnCommand, spawnErrorMessage } from '../spawn-command.js';

const USAGE = 'usage: agent-voice wrap [--name <label>] -- <command> [args...]';

export function parseWrapArgs(args) {
  let name = '';
  let i = 0;
  while (i < args.length && args[i] !== '--') {
    if (args[i] === '--name') {
      name = args[i + 1] ?? '';
      i += 2;
      continue;
    }
    throw new Error(`wrap: unknown option ${args[i]} (${USAGE})`);
  }
  const command = args.slice(i + 1);
  if (i >= args.length || command.length === 0) throw new Error(USAGE);
  return { name, command };
}

export async function runWrap(args, {
  env = process.env, spawn = nodeSpawn, platform = process.platform, cwd = process.cwd(), pid = process.pid, notify,
  err = (s) => process.stderr.write(`${s}\n`),
} = {}) {
  const { name, command } = parseWrapArgs(args);
  const emit = notify ?? (async (event) => {
    try { await handle(event, createContext(env)); } catch { /* announcing must never break the wrapped command */ }
  });
  const base = { agent: 'wrap', session_id: `wrap-${pid}`, session_name: name, project: projectOf(cwd) };

  await emit({ ...base, type: 'turn_start', text: command.join(' ') });

  const code = await new Promise((resolve) => {
    let child;
    let settled = false;
    // Ctrl+C already reaches the child through the terminal; the parent just
    // must not die first. SIGTERM is forwarded.
    const onInt = () => {};
    const onTerm = () => { try { child?.kill('SIGTERM'); } catch { /* already gone */ } };
    const finish = (c) => {
      if (settled) return;
      settled = true;
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      resolve(c);
    };
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    try {
      // No shell on any OS: `git commit -m "fix a & b"` must commit, not run b.
      child = spawnCommand(command[0], command.slice(1), { stdio: 'inherit', env }, { spawn, platform });
    } catch (e) {
      err(`agent-voice wrap: ${spawnErrorMessage(e, command[0], env, platform)}`);
      finish(127);
      return;
    }
    child.on('error', (e) => {
      err(`agent-voice wrap: ${spawnErrorMessage(e, command[0], env, platform)}`);
      finish(127);
    });
    child.on('exit', (c, signal) => finish(c ?? 128 + (constants.signals[signal] ?? 0)));
  });

  await emit({ ...base, type: 'task_done', text: '' });
  return code;
}
