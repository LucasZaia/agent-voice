import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { sandbox, scriptedPrompter, collector } from './helpers.js';
import { runStatus } from '../src/cli/status.js';
import { runConnect } from '../src/cli/connect.js';
import { writeOutputInstance, saveConfig } from '../src/config.js';
import { log } from '../src/core/log.js';

test('status shows agents, outputs, settings and recent log lines', async () => {
  const sb = sandbox();
  mkdirSync(sb.env.CODEX_HOME, { recursive: true });
  await runConnect(['claude-code', '--yes'], { env: sb.env, out: () => {}, prompt: scriptedPrompter([]) });
  writeOutputInstance('sala', { type: 'alexa', url: 'http://h', token: 'secret', entity: 'notify.e' }, sb.env);
  saveConfig({ outputs: ['sala', 'ghost'] }, sb.env);
  log(sb.env.AV_STATE_DIR, 'claude-code', 's1', 'turn started');
  const c = collector();
  assert.equal(await runStatus([], { env: sb.env, out: c.out }), 0);
  const text = c.text();
  assert.match(text, /claude-code\s+connected/);
  assert.match(text, /codex\s+not connected/);
  assert.match(text, /\* sala\s+alexa\s+notify\.e @ http:\/\/h/);
  assert.match(text, /\* ghost\s+\(missing — enabled but not configured\)/);
  assert.match(text, /minSeconds=30/);
  assert.match(text, /turn started/);
  assert.doesNotMatch(text, /secret/);
});

test('status says when an agent is not installed and the log is empty', async () => {
  const sb = sandbox();
  const c = collector();
  await runStatus([], { env: sb.env, out: c.out });
  assert.match(c.text(), /claude-code\s+not installed/);
  assert.match(c.text(), /\(empty\)/);
});
