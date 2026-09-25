import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatLine, log } from '../src/core/log.js';

const at = new Date(2026, 8, 25, 16, 5, 23);

test('line is timestamp, agent, session, message in that order', () => {
  assert.equal(formatLine('claude-code', 'sess1', 'hello', at),
    '2026-09-25 16:05:23 claude-code  sess1      hello\n');
});

test('session is truncated to 8 characters', () => {
  const line = formatLine('test-agent', 'long-session-id-1234567890', 'x', at);
  assert.match(line, / long-ses /);
  assert.doesNotMatch(line, /long-session-id/);
});

test('log appends to events.log, creating the directory', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'av-')), 'nested', 'state');
  log(dir, 'claude-code', 'sess1', 'hello', at);
  log(dir, 'claude-code', 'sess1', 'file*.txt', at);
  const lines = readFileSync(join(dir, 'events.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /file\*\.txt$/);
});

test('log never throws, even when the directory cannot be created', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'av-')), 'a-file');
  writeFileSync(file, 'not a directory');
  assert.doesNotThrow(() => log(join(file, 'state'), 'a', 'b', 'c'));
});
