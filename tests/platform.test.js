import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { configDir, stateDir, findOnPath } from '../src/platform.js';

const home = join('/', 'h', 'u');

test('linux uses XDG defaults, matching the bash version', () => {
  assert.equal(configDir({}, 'linux', home), join(home, '.config', 'agent-voice'));
  assert.equal(stateDir({}, 'linux', home), join(home, '.local', 'state', 'agent-voice'));
});

test('linux honours XDG_CONFIG_HOME and XDG_STATE_HOME', () => {
  assert.equal(configDir({ XDG_CONFIG_HOME: join('/', 'x') }, 'linux', home), join('/', 'x', 'agent-voice'));
  assert.equal(stateDir({ XDG_STATE_HOME: join('/', 'y') }, 'linux', home), join('/', 'y', 'agent-voice'));
});

test('macOS uses Application Support', () => {
  assert.equal(configDir({}, 'darwin', home), join(home, 'Library', 'Application Support', 'agent-voice'));
  assert.equal(stateDir({}, 'darwin', home), join(home, 'Library', 'Application Support', 'agent-voice', 'state'));
});

test('windows uses APPDATA and LOCALAPPDATA', () => {
  const env = { APPDATA: join('/', 'r'), LOCALAPPDATA: join('/', 'l') };
  assert.equal(configDir(env, 'win32', home), join('/', 'r', 'agent-voice'));
  assert.equal(stateDir(env, 'win32', home), join('/', 'l', 'agent-voice'));
});

test('AV_CONFIG_DIR and AV_STATE_DIR override every platform', () => {
  for (const p of ['linux', 'darwin', 'win32']) {
    assert.equal(configDir({ AV_CONFIG_DIR: 'C' }, p, home), 'C');
    assert.equal(stateDir({ AV_STATE_DIR: 'S' }, p, home), 'S');
  }
});

test('findOnPath finds an existing file and returns null otherwise', () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-'));
  const name = process.platform === 'win32' ? 'fake-tool.exe' : 'fake-tool';
  writeFileSync(join(dir, name), '');
  if (process.platform !== 'win32') chmodSync(join(dir, name), 0o755);
  const env = { PATH: [dir, join(dir, 'nope')].join(delimiter), PATHEXT: '.EXE;.CMD' };
  assert.equal(findOnPath('fake-tool', env), join(dir, name));
  assert.equal(findOnPath('missing-tool', env), null);
});
