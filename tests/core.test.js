import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './helpers.js';
import { handle } from '../src/core/handle.js';
import { createState } from '../src/core/state.js';
import { log } from '../src/core/log.js';

function setup() {
  const sb = sandbox();
  const spoken = [];
  const stateDir = sb.env.AV_STATE_DIR;
  const ctx = {
    config: { minSeconds: 30, cooldownSeconds: 120, maxSpeechChars: 90 },
    state: createState(stateDir),
    log: (a, s, m) => log(stateDir, a, s, m),
    outputs: [{ name: 'fake', speak: async (s) => { spoken.push(s); } }],
  };
  const logText = () => readFileSync(join(stateDir, 'events.log'), 'utf8');
  const backdate = (session, seconds) =>
    writeFileSync(`${ctx.state.path('claude-code', session)}.start`, String(Math.floor(Date.now() / 1000) - seconds));
  const ev = (type, session, name = '', project = '', text = '') =>
    ({ type, agent: 'claude-code', session_id: session, session_name: name, project, text });
  return { ctx, spoken, logText, backdate, ev };
}

test('a short turn is silent and logs why', async () => {
  const { ctx, spoken, logText, ev } = setup();
  await handle(ev('turn_start', 'c1', 'Repo X', 'proj', 'pedido curto'), ctx);
  await handle(ev('task_done', 'c1', 'Repo X', 'proj'), ctx);
  assert.equal(spoken.length, 0);
  assert.match(logText(), /silent \(turn 0s < 30s\)/);
});

test('a long turn speaks with duration and the stored request', async () => {
  const { ctx, spoken, backdate, ev } = setup();
  await handle(ev('turn_start', 'c2', 'Repo X', 'proj', 'criar o compose'), ctx);
  backdate('c2', 240);
  await handle(ev('task_done', 'c2', 'Repo X', 'proj', 'ignored text'), ctx);
  assert.deepEqual(spoken, ['Claude Code terminou na sessão Repo X, depois de cerca de 4 minutos. Você tinha pedido: criar o compose.']);
});

test('a burst of background events collapses to one; needs_input ignores the cooldown', async () => {
  const { ctx, spoken, ev } = setup();
  for (const i of [1, 2, 3, 4]) await handle(ev('background_done', 'c3', 'Repo X', 'proj', `revisor ${i}`), ctx);
  assert.equal(spoken.length, 1);
  await handle(ev('needs_input', 'c3', 'Repo X', 'proj', 'permission needed'), ctx);
  assert.equal(spoken.at(-1), 'Claude Code precisa de você na sessão Repo X. permission needed.');
});

test('falls back to the colour label with no session name', async () => {
  const { ctx, spoken, backdate, ev } = setup();
  await handle(ev('turn_start', 'c4', '', 'proj', 'x'), ctx);
  backdate('c4', 240);
  await handle(ev('task_done', 'c4', '', 'proj'), ctx);
  assert.match(spoken.at(-1), /na sessão vermelha, do projeto proj/);
});

test('task_done with no marker is silent', async () => {
  const { ctx, spoken, logText, ev } = setup();
  await handle(ev('task_done', 'c9', 'Repo X', 'proj'), ctx);
  assert.equal(spoken.length, 0);
  assert.match(logText(), /ignored: task_done with no turn marker/);
});

test('incomplete or garbage events are logged and ignored', async () => {
  const { ctx, logText } = setup();
  await handle(null, ctx);
  await handle({ type: 'task_done', agent: 'claude-code' }, ctx);
  await handle({ type: 'weird', agent: 'claude-code', session_id: 's' }, ctx);
  assert.equal(logText().match(/ignored: incomplete event/g).length, 2);
  assert.match(logText(), /ignored: unknown type weird/);
});

test('concurrent sessions keep their own request and duration', async () => {
  const { ctx, spoken, backdate, ev } = setup();
  await handle(ev('turn_start', 'cA', 'Sessao A', 'proj-a', 'pedido A'), ctx);
  await handle(ev('turn_start', 'cB', 'Sessao B', 'proj-b', 'pedido B'), ctx);
  backdate('cA', 240);
  backdate('cB', 600);
  await handle(ev('task_done', 'cB', 'Sessao B', 'proj-b'), ctx);
  await handle(ev('task_done', 'cA', 'Sessao A', 'proj-a'), ctx);
  assert.equal(spoken.length, 2);
  assert.match(spoken[0], /pedido B/);
  assert.match(spoken[0], /cerca de 10 minutos/);
  assert.match(spoken[1], /pedido A/);
});

test('session_name is cleaned before it reaches the device', async () => {
  const { ctx, spoken, backdate, ev } = setup();
  const dirty = '[Fix the bug](https://example.com/x) at /home/user/repo/lib/core.sh';
  await handle(ev('turn_start', 'dirty', dirty, 'proj', 'pedido'), ctx);
  backdate('dirty', 240);
  await handle(ev('task_done', 'dirty', dirty, 'proj'), ctx);
  assert.match(spoken.at(-1), /Fix the bug/);
  assert.doesNotMatch(spoken.at(-1), /https:\/\/|\/home\/user/);
});

test('a 200-char project name does not make the sentence unbounded', async () => {
  const { ctx, spoken, backdate, ev } = setup();
  const long = 'x'.repeat(200);
  await handle(ev('turn_start', 'longp', '', long, 'pedido'), ctx);
  backdate('longp', 240);
  await handle(ev('task_done', 'longp', '', long), ctx);
  assert.ok(Array.from(spoken.at(-1)).length <= 200, spoken.at(-1));
});

test('background_done with no content stays silent and says why', async () => {
  const { ctx, spoken, logText, ev } = setup();
  await handle(ev('background_done', 'nocontent', 'Repo X', 'proj', ''), ctx);
  assert.equal(spoken.length, 0);
  assert.match(logText(), /silent \(background_done with no content\)/);
});

test('a failing output logs FAILED with its reason; a missing one logs no such output', async () => {
  const { ctx, logText, ev } = setup();
  ctx.outputs = [
    { name: 'broken', speak: async () => { throw new Error('token missing\nsecond line'); } },
    { name: 'ghost', speak: null },
    { name: 'weird', speak: null, reason: 'unknown output type nope' },
  ];
  await handle(ev('needs_input', 'f1', 'Repo X', 'proj', ''), ctx);
  assert.match(logText(), /FAILED via broken \(token missing\): Claude Code precisa de você/);
  assert.match(logText(), /no such output: ghost/);
  assert.match(logText(), /no such output: weird \(unknown output type nope\)/);
});

test('a successful output logs spoke via', async () => {
  const { ctx, logText, ev } = setup();
  await handle(ev('needs_input', 'ok1', 'Repo X', 'proj', ''), ctx);
  assert.match(logText(), /spoke via fake: Claude Code precisa de você na sessão Repo X\./);
});
