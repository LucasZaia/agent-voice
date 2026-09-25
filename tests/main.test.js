import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { sandbox, ROOT, collector } from './helpers.js';
import { main } from '../src/cli/main.js';

test('help is printed with no command', async () => {
  const c = collector();
  assert.equal(await main([], { env: sandbox().env, out: c.out, err: c.out }), 0);
  assert.match(c.text(), /\n  setup\s/);
});

test('an unknown command exits 1 with a hint', async () => {
  const c = collector();
  assert.equal(await main(['nope'], { env: sandbox().env, out: c.out, err: c.out }), 1);
  assert.match(c.text(), /unknown command "nope"/);
});

test('the executable runs and prints help', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'agent-voice.js'), '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: agent-voice/);
});

test('a closed stdout (agent-voice status | head) exits quietly', async () => {
  const child = spawn(process.execPath, [join(ROOT, 'bin', 'agent-voice.js'), 'help'], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.destroy();
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(stderr, '');
  assert.equal(code, 0);
});
