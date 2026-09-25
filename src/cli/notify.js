// The hook entry point. Exits 0 in every scenario, on purpose: a hook that
// hangs or fails is worse than one that does not exist. The log is the only
// place a failure is reported.
import { ADAPTERS } from '../adapters/index.js';
import { createContext } from '../core/context.js';
import { handle } from '../core/handle.js';
import { log } from '../core/log.js';
import { stateDir } from '../platform.js';

// Bounded: an agent that leaves stdin open without writing must not hang us.
export function readStdin(stream = process.stdin, timeoutMs = 3000) {
  if (stream.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream.removeAllListeners?.('data');
      stream.destroy?.();
      resolve(data);
    };
    const timer = setTimeout(finish, timeoutMs);
    stream.setEncoding?.('utf8');
    stream.on('data', (chunk) => { data += chunk; });
    stream.on('end', finish);
    stream.on('error', finish);
  });
}

const errorLine = (e) => `error: ${String(e?.message ?? e).split(/\r?\n/)[0].slice(0, 200)}`;

export async function runNotify(args, { input = '', env = process.env, write = (s) => process.stdout.write(s) } = {}) {
  const [agent = '', sub = ''] = args;
  const fallbackLog = (a, s, m) => log(stateDir(env), a, s, m);
  try {
    if (!agent || !sub) {
      fallbackLog(agent || '?', '-', 'ignored: usage is notify <agent> <subcommand>');
      return 0;
    }
    const adapter = Object.hasOwn(ADAPTERS, agent) ? ADAPTERS[agent] : null;
    if (!adapter) {
      fallbackLog(agent, '-', `no adapter for ${agent}`);
      return 0;
    }
    const reply = adapter.hookReply(sub);
    if (reply) write(reply);
    let payload = {};
    try { payload = JSON.parse(input); } catch { /* garbage in: the core logs the incomplete event */ }
    const event = adapter.translate(sub, payload);
    if (!event) return 0;
    await handle(event, createContext(env));
  } catch (e) {
    fallbackLog(agent || '?', '-', errorLine(e));
  }
  return 0;
}

// The notify process must exit 0 even for failures no try/catch can see: an
// agent that closes our stdout before we write (async EPIPE), or a stray
// error from a callback. They are logged, like every other failure.
export function guardNotifyProcess(args, env = process.env, proc = process) {
  const agent = args[0] || '?';
  const report = (e) => {
    log(stateDir(env), agent, '-', errorLine(e));
    proc.exitCode = 0;
  };
  proc.stdout.on('error', () => { /* the agent stopped listening; nothing to tell it */ });
  proc.on('uncaughtException', report);
  proc.on('unhandledRejection', report);
}
