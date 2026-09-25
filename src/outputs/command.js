// Runs any command that makes noise. {text} in its arguments is replaced by the
// sentence; without {text}, the sentence goes on stdin. No shell is involved.
import { run } from './run.js';

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
  const [cmd, ...rest] = conf.argv;
  const placeholder = rest.some((a) => a.includes('{text}'));
  const args = rest.map((a) => a.replaceAll('{text}', sentence));
  await run(cmd, args, { input: placeholder ? '' : sentence, spawn: deps.spawn, timeoutMs: deps.timeoutMs });
}
