// Interactive questions over readline. Commands receive this through io.prompt,
// so tests can swap in a scripted prompter.
import { createInterface } from 'node:readline/promises';

export function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, output });
  return {
    async ask(question, def = '') {
      const answer = (await rl.question(def ? `${question} [${def}]: ` : `${question}: `)).trim();
      return answer || def;
    },
    async confirm(question, def = true) {
      const answer = (await rl.question(`${question} ${def ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
      return answer ? answer.startsWith('y') || answer.startsWith('s') : def;
    },
    async choose(question, options, def = 0) {
      output.write(`${question}\n`);
      options.forEach((o, i) => output.write(`  ${i + 1}) ${o}\n`));
      for (;;) {
        const answer = (await rl.question(`Choose 1-${options.length} [${def + 1}]: `)).trim();
        if (!answer) return def;
        const n = Number(answer);
        if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
        output.write('Not a valid choice.\n');
      }
    },
    close() { rl.close(); },
  };
}
