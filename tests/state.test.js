import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createState } from '../src/core/state.js';

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-state-'));
  return { dir, st: createState(dir) };
};
const nowS = () => Math.floor(Date.now() / 1000);

test('stores the request and reports elapsed 0 right away', () => {
  const { st } = fresh();
  st.turnStart('claude-code', 's-a', 'pedido da sessao A');
  assert.equal(st.turnText('claude-code', 's-a'), 'pedido da sessao A');
  assert.equal(st.turnElapsed('claude-code', 's-a'), 0);
});

test('elapsed reflects a backdated marker', () => {
  const { st } = fresh();
  st.turnStart('claude-code', 's-a', 'x');
  writeFileSync(`${st.path('claude-code', 's-a')}.start`, String(nowS() - 300));
  assert.equal(st.turnElapsed('claude-code', 's-a'), 300);
});

test('reads markers the bash version wrote (trailing newline)', () => {
  const { st } = fresh();
  writeFileSync(`${st.path('claude-code', 'old')}.start`, `${nowS() - 90}\n`);
  assert.equal(st.turnElapsed('claude-code', 'old'), 90);
});

test('path layout matches bash: <agent>_<cksum>/<session>_<cksum>', () => {
  const { dir, st } = fresh();
  assert.equal(st.path('claude-code', 'sid1'), join(dir, 'claude-code_3860518746', 'sid1_123442821'));
});

test('sessions are isolated and clearing one leaves the other', () => {
  const { st } = fresh();
  st.turnStart('claude-code', 's-a', 'A');
  st.turnStart('claude-code', 's-b', 'B');
  st.turnClear('claude-code', 's-a');
  assert.equal(st.turnElapsed('claude-code', 's-a'), null);
  assert.equal(st.turnText('claude-code', 's-b'), 'B');
});

test('cooldown: open when unset, closed right after, reopens after the window', () => {
  const { st } = fresh();
  assert.equal(st.cooldownOk('claude-code', 's-c', 120), true);
  st.cooldownStamp('claude-code', 's-c');
  assert.equal(st.cooldownOk('claude-code', 's-c', 120), false);
  writeFileSync(`${st.path('claude-code', 's-c')}.cooldown`, String(nowS() - 200));
  assert.equal(st.cooldownOk('claude-code', 's-c', 120), true);
});

test('path traversal stays inside the state dir', () => {
  const { dir, st } = fresh();
  st.turnStart('claude-code', '../../etc/passwd', 'x');
  const p = resolve(st.path('claude-code', '../../etc/passwd'));
  assert.ok(p.startsWith(resolve(dir) + sep), p);
  assert.ok(existsSync(`${p}.start`));
});

test('a/b and ab do not collide', () => {
  const { st } = fresh();
  st.turnStart('claude-code', 'a/b', 'from a/b');
  st.turnStart('claude-code', 'ab', 'from ab');
  assert.equal(st.turnText('claude-code', 'a/b'), 'from a/b');
  assert.equal(st.turnText('claude-code', 'ab'), 'from ab');
});

test('a future marker (clock skew) clamps to 0', () => {
  const { st } = fresh();
  st.turnStart('claude-code', 'skew', 'x');
  writeFileSync(`${st.path('claude-code', 'skew')}.start`, String(nowS() + 100));
  assert.equal(st.turnElapsed('claude-code', 'skew'), 0);
});

test('a garbage marker counts as no marker', () => {
  const { st } = fresh();
  writeFileSync(`${st.path('claude-code', 'bad')}.start`, 'yesterday');
  assert.equal(st.turnElapsed('claude-code', 'bad'), null);
});
