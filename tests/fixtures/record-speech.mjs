// Records instead of speaking. Words on argv win; otherwise the sentence is
// read from stdin. STUB_FAIL=<reason> makes it fail the way a real speaker would.
import { appendFileSync, readFileSync } from 'node:fs';

const [file, ...words] = process.argv.slice(2);
if (process.env.STUB_FAIL) {
  process.stderr.write(`${process.env.STUB_FAIL}\n`);
  process.exit(3);
}
const text = words.length ? words.join(' ') : readFileSync(0, 'utf8');
appendFileSync(file, `${text.trim()}\n`);
