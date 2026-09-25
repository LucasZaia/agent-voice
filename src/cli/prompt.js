// Interactive questions over readline. Commands receive this through io.prompt,
// so tests can swap in a scripted prompter.
//
// Lines are queued as they arrive rather than read per question: piped input
// (`printf 'y\n3\n' | agent-voice setup`) delivers every line at once, before
// most questions are asked. When input ends (EOF, Ctrl+D) or Ctrl+C is pressed,
// every question still waiting — and every later one — fails with a
// "cancelled" error, which main turns into one line and an exit code.
import { createInterface } from 'node:readline';

export const cancelledError = (signal) => Object.assign(new Error('cancelled'), { code: 'CANCELLED', signal });
export const isCancelled = (e) => e?.code === 'CANCELLED';

export function createPrompter({ input = process.stdin, output = process.stdout, terminal } = {}) {
  const rl = createInterface({ input, output, terminal: terminal ?? Boolean(input.isTTY && output.isTTY) });
  const lines = [];
  const waiting = [];
  let ended = null;
  let closed = false;
  const end = (error) => {
    ended ??= error;
    // A question is on screen with the cursor after it; the error goes below.
    if (waiting.length) output.write('\n');
    for (const w of waiting.splice(0)) w.reject(ended);
  };
  rl.on('line', (line) => {
    const w = waiting.shift();
    if (w) w.resolve(line);
    else lines.push(line);
  });
  rl.on('SIGINT', () => {
    end(cancelledError('SIGINT'));
    rl.close();
  });
  rl.on('close', () => {
    closed = true;
    end(cancelledError());
  });

  const question = (text) => {
    // Through readline while it is open, so redrawing the line (backspace in
    // a terminal) keeps the question on screen.
    if (closed) output.write(text);
    else {
      rl.setPrompt(text);
      rl.prompt();
    }
    if (lines.length) return Promise.resolve(lines.shift());
    if (ended) return Promise.reject(ended);
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  };

  return {
    async ask(q, def = '') {
      const answer = (await question(def ? `${q} [${def}]: ` : `${q}: `)).trim();
      return answer || def;
    },
    async confirm(q, def = true) {
      const answer = (await question(`${q} ${def ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
      return answer ? answer.startsWith('y') || answer.startsWith('s') : def;
    },
    async choose(q, options, def = 0) {
      output.write(`${q}\n`);
      options.forEach((o, i) => output.write(`  ${i + 1}) ${o}\n`));
      for (;;) {
        const answer = (await question(`Choose 1-${options.length} [${def + 1}]: `)).trim();
        if (!answer) return def;
        const n = Number(answer);
        if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
        output.write('Not a valid choice.\n');
      }
    },
    close() { rl.close(); },
  };
}
