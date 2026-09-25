import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, collector } from './helpers.js';
import { runConfig } from '../src/cli/config.js';
import { main } from '../src/cli/main.js';

test('get prints every setting, set persists one', () => {
  const sb = sandbox();
  const c = collector();
  runConfig(['set', 'minSeconds', '45'], { env: sb.env, out: c.out });
  runConfig(['get'], { env: sb.env, out: c.out });
  assert.match(c.text(), /minSeconds=45/);
  assert.match(c.text(), /cooldownSeconds=120/);
});

test('get of one key prints just the value', () => {
  const sb = sandbox();
  const c = collector();
  runConfig(['get', 'maxSpeechChars'], { env: sb.env, out: c.out });
  assert.deepEqual(c.lines, ['90']);
});

test('set rejects unknown keys and non-numbers', () => {
  const sb = sandbox();
  assert.throws(() => runConfig(['set', 'outputs', 'x'], { env: sb.env, out: () => {} }), /unknown key "outputs"/);
  assert.throws(() => runConfig(['set', 'minSeconds', 'soon'], { env: sb.env, out: () => {} }), /whole number of seconds/);
});

test('set warns when the environment overrides the stored value', () => {
  const sb = sandbox();
  const c = collector();
  runConfig(['set', 'minSeconds', '45'], { env: { ...sb.env, AV_MIN_SECONDS: '10' }, out: c.out });
  assert.match(c.text(), /AV_MIN_SECONDS=10 overrides it/);
});

test('a corrupt config.json makes interactive commands exit 1 with the file named', async () => {
  const sb = sandbox();
  mkdirSync(sb.env.AV_CONFIG_DIR, { recursive: true });
  writeFileSync(join(sb.env.AV_CONFIG_DIR, 'config.json'), '{ nope');
  const c = collector();
  assert.equal(await main(['config', 'get'], { env: sb.env, out: c.out, err: c.out }), 1);
  assert.match(c.text(), /config\.json: invalid JSON/);
});
