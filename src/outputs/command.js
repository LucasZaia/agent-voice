// Runs any command that makes noise. {text} in its arguments is replaced by the
// sentence; without {text}, the sentence goes on stdin. No shell is involved.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run as runProcess, SPEAK_TIMEOUT_MS } from './run.js';

export const type = 'command';

export function parseCommandLine(line) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (const ch of String(line)) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) out.push(cur);
      cur = '';
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (quote) throw new Error('unclosed quote in command');
  if (started) out.push(cur);
  return out;
}

// No shell means no ~ expansion, yet `~/softwares/falar.sh -a {text}` is what
// people type. A leading ~, $HOME, ${HOME} or %USERPROFILE% in the command or
// an argument is the home directory; the sentence is never expanded.
const HOME_PREFIX = /^(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)(?=$|[\\/])/i;

export function expandHome(arg, home = homedir()) {
  const m = HOME_PREFIX.exec(arg);
  if (!m) return arg;
  const rest = arg.slice(m[0].length).replace(/^[\\/]+/, '');
  return rest ? join(home, rest) : home;
}

export const describe = (conf) => (conf.argv ?? []).join(' ');

export async function questions(prompt, current = {}) {
  const line = await prompt.ask(
    'Command that speaks a sentence ({text} marks where the sentence goes; without it, the sentence is sent on stdin)',
    current.argv ? current.argv.join(' ') : '',
  );
  const argv = parseCommandLine(line);
  if (argv.length === 0) throw new Error('a command is required');
  return { type, argv };
}

export async function speak(sentence, conf, deps = {}) {
  if (!Array.isArray(conf.argv) || conf.argv.length === 0) throw new Error('command output has no argv');
  const [cmd, ...rest] = conf.argv.map((a) => expandHome(String(a), deps.home));
  const placeholder = rest.some((a) => a.includes('{text}'));
  const args = rest.map((a) => a.replaceAll('{text}', sentence));
  const run = deps.run ?? runProcess;
  await run(cmd, args, { input: placeholder ? '' : sentence, spawn: deps.spawn, timeoutMs: deps.timeoutMs ?? SPEAK_TIMEOUT_MS });
}
