import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { sandbox, ROOT, RECORDER, collector } from './helpers.js';
import { createPrompter, cancelledError } from '../src/cli/prompt.js';
import { main } from '../src/cli/main.js';
import { readStoredConfig } from '../src/config.js';
import { TEST_SENTENCE } from '../src/core/phrases.js';

const BIN = join(ROOT, 'bin', 'agent-voice.js');
const piped = (opts = {}) => {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = '';
  output.on('data', (d) => { shown += d; });
  return { input, prompter: createPrompter({ input, output, ...opts }), shown: () => shown };
};

test('answers piped in before the questions are asked are all used, in order', async () => {
  const p = piped();
  p.input.end('y\n3\nhello\n\n');
  assert.equal(await p.prompter.confirm('Apply?', false), true);
  assert.equal(await p.prompter.choose('Pick', ['a', 'b', 'c']), 2);
  assert.equal(await p.prompter.ask('Name'), 'hello');
  assert.equal(await p.prompter.ask('Keep', 'def'), 'def');
  assert.match(p.shown(), /Apply\? \[y\/N\] /);
  p.prompter.close();
});

test('an invalid choice asks again with the next line', async () => {
  const p = piped();
  p.input.end('9\n2\n');
  assert.equal(await p.prompter.choose('Pick', ['a', 'b']), 1);
  assert.match(p.shown(), /Not a valid choice/);
});

test('end of input with questions left cancels them', async () => {
  const p = piped();
  p.input.end('y\n');
  assert.equal(await p.prompter.confirm('Apply?'), true);
  await assert.rejects(p.prompter.ask('Name'), (e) => e.code === 'CANCELLED' && e.signal === undefined);
  await assert.rejects(p.prompter.confirm('Again?'), { code: 'CANCELLED' });
});

test('end of input while a question is waiting cancels it', async () => {
  const p = piped();
  const pending = p.prompter.ask('Name');
  p.input.end();
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(p.shown(), 'Name: \n');
});

test('Ctrl+C at a question cancels it as SIGINT', async () => {
  const p = piped({ terminal: true });
  const pending = p.prompter.ask('Name');
  p.input.write('\x03');
  await assert.rejects(pending, (e) => e.code === 'CANCELLED' && e.signal === 'SIGINT');
  p.prompter.close();
});

test('main turns a cancelled question into one line and exit 130 (Ctrl+C) or 1 (end of input)', async () => {
  for (const [signal, code] of [['SIGINT', 130], [undefined, 1]]) {
    const sb = sandbox();
    const c = collector();
    const prompt = { confirm: async () => { throw cancelledError(signal); } };
    assert.equal(await main(['connect', 'claude-code'], { env: sb.env, out: () => {}, err: c.out, prompt }), code);
    assert.deepEqual(c.lines, ['agent-voice: cancelled']);
  }
});

test('setup driven entirely by piped answers', () => {
  const sb = sandbox();
  mkdirSync(sb.env.CLAUDE_CONFIG_DIR, { recursive: true });
  const line = `"${process.execPath}" "${RECORDER}" "${sb.spoken}" {text}`;
  const r = spawnSync(process.execPath, [BIN, 'setup'], { env: sb.env, input: `y\n3\n${line}\ny\n`, encoding: 'utf8' });
  assert.equal(r.stderr, '');
  assert.equal(r.status, 0);
  assert.ok(JSON.parse(readFileSync(join(sb.env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8')).hooks.Stop);
  assert.deepEqual(readStoredConfig(sb.env).outputs, ['command']);
  assert.deepEqual(sb.spokenLines(), [TEST_SENTENCE]);
});

test('setup whose input ends early exits 1 with one line, not an unsettled await', () => {
  const sb = sandbox();
  mkdirSync(sb.env.CLAUDE_CONFIG_DIR, { recursive: true });
  const r = spawnSync(process.execPath, [BIN, 'setup'], { env: sb.env, input: 'y\n', encoding: 'utf8' });
  assert.equal(r.stderr, 'agent-voice: cancelled\n');
  assert.equal(r.status, 1);
});
