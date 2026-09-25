# agent-voice Node CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bash agent-voice with a behaviour-identical Node port that installs on macOS, Windows and Linux via npm and adds a management CLI (`setup`, `connect`, `output`, `wrap`, `status`, `config`, `test`).

**Architecture:** Same three-stage pipeline as today — adapter (pure translation) → core (decides, keeps per-session state, builds the pt-BR sentence) → output (makes a device speak). Adapters also know how to merge their hooks into the agent's config file. Output *types* are code; output *instances* are JSON files in the per-OS config dir. `agent-voice notify` is the hook entry point and always exits 0.

**Tech Stack:** Node ≥ 20, plain ESM JavaScript, zero runtime and test dependencies (`node:test`, `node:assert`, `fetch`, `node:readline/promises`, `node:child_process`).

**Spec:** `docs/superpowers/specs/2026-09-25-agent-voice-node-cli-design.md`

## Global Constraints

- Node `>=20`; `"type": "module"`; no entries in `dependencies` or `devDependencies`.
- npm package name `@lucaszaia/agent-voice`; executable name `agent-voice`.
- `agent-voice notify …` exits 0 in every scenario; failures go to `events.log` only.
- Every spoken string (pt-BR) lives in `src/core/phrases.js`. CLI messages, code and docs are English.
- `events.log` line format is unchanged: `YYYY-MM-DD HH:MM:SS <agent padded to 12> <session first 8 chars padded to 10> <message>`.
- State file layout is unchanged (`<stateDir>/<agent>_<cksum>/<session>_<cksum>.{start,text,cooldown}`), so Linux state carries over from the bash version.
- Defaults: `minSeconds` 30, `cooldownSeconds` 120, `maxSpeechChars` 90. Env overrides: `AV_MIN_SECONDS`, `AV_COOLDOWN_SECONDS`, `AV_MAX_SPEECH_CHARS`, `AV_OUTPUTS`, `AV_CONFIG_DIR`, `AV_STATE_DIR`, `AV_HOOK_COMMAND`.
- Must run on `ubuntu-latest`, `macos-latest`, `windows-latest` — use `path.join`, never hard-coded `/`; tests spawn `process.execPath`, never shell scripts.
- Tests live in `tests/` (not `test/`: Node's default discovery runs every `.js` under a `test/` dir, which would execute fixtures). Run with `npm test` (= `node --test`).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A `settings.json`/`hooks.json` whose `hooks` has an unexpected shape** (e.g. `"Stop": {}`) — `connect` must abort with a clear message and leave the file byte-identical, not crash or half-write. Test in Task 11.
2. **Claude Code transcript written with CRLF line endings (Windows)** — the session name must still be found. Test in Task 9.
3. **A hook that leaves stdin open and never writes** — `notify` must give up reading after a bounded wait instead of hanging the agent. Test in Task 12.
4. **Home Assistant down or hanging** — the `alexa` output must fail with a readable reason within its timeout, never hang the async hook forever. Test in Task 6.
5. **A corrupt `config.json`** — `notify` must still exit 0 and log why; interactive commands must print the file and the parse error and exit 1. Tests in Tasks 4 and 12.

---

### Task 1: Package scaffold, cksum hash, log, platform paths

**Files:**
- Create: `package.json`, `src/core/hash.js`, `src/core/log.js`, `src/platform.js`
- Create: `tests/hash.test.js`, `tests/log.test.js`, `tests/platform.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `cksum(str: string): number` (POSIX cksum CRC, unsigned 32-bit)
- Produces: `timestamp(d?: Date): string`, `formatLine(agent, session, message, d?): string` (ends in `\n`), `log(stateDir, agent, session, message, d?): void` (never throws)
- Produces: `configDir(env?, platform?, home?): string`, `stateDir(env?, platform?, home?): string`, `findOnPath(cmd, env?, platform?): string | null`

- [ ] **Step 1: Write `package.json` and extend `.gitignore`**

```json
{
  "name": "@lucaszaia/agent-voice",
  "version": "1.0.0",
  "description": "Make your coding agent talk to you: a smart speaker says when a long task finishes or when the agent needs you.",
  "type": "module",
  "bin": { "agent-voice": "bin/agent-voice.js" },
  "files": ["bin", "src", "docs/adapters.md", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "scripts": { "test": "node --test" },
  "repository": { "type": "git", "url": "git+https://github.com/LucasZaia/agent-voice.git" },
  "keywords": ["claude-code", "codex", "alexa", "home-assistant", "tts", "notifications"],
  "license": "MIT"
}
```

Append to `.gitignore`:

```
node_modules/
*.tgz
```

- [ ] **Step 2: Write the failing tests**

`tests/hash.test.js` — expected values were produced by the system `cksum`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cksum } from '../src/core/hash.js';

test('cksum matches POSIX cksum byte for byte', () => {
  const known = {
    abc123: 719354, sid1: 123442821, c4: 3439070372, 'claude-code': 3860518746,
    'a/b': 3840401949, ab: 2072780115, '': 4294967295, 'ação': 1164746233,
  };
  for (const [input, expected] of Object.entries(known)) assert.equal(cksum(input), expected, input);
});

test('cksum is order-sensitive: a/b and ab differ', () => {
  assert.notEqual(cksum('a/b'), cksum('ab'));
});
```

`tests/log.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
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
```

(`tests/log.test.js` imports `mkdtempSync, readFileSync, writeFileSync` from `node:fs`.)

`tests/platform.test.js`:

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/core/hash.js'` (and the same for log/platform).

- [ ] **Step 4: Implement**

`src/core/hash.js`:

```js
// POSIX `cksum` CRC, so state paths and spoken session colours stay identical
// to the bash version (which shelled out to cksum). Not a security hash.
const TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i << 24;
  for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
  TABLE[i] = c >>> 0;
}

export function cksum(str) {
  const bytes = Buffer.from(String(str), 'utf8');
  let crc = 0;
  const feed = (b) => { crc = ((crc << 8) ^ TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0; };
  for (const b of bytes) feed(b);
  for (let n = bytes.length; n > 0; n = Math.floor(n / 256)) feed(n & 0xff);
  return (~crc) >>> 0;
}
```

`src/core/log.js`:

```js
// One line per firing. Without this, a hook that chose to stay silent and a
// hook that died look identical from the outside.
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const pad2 = (n) => String(n).padStart(2, '0');

export function timestamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatLine(agent, session, message, d = new Date()) {
  return `${timestamp(d)} ${String(agent).padEnd(12)} ${String(session).slice(0, 8).padEnd(10)} ${message}\n`;
}

export function log(stateDir, agent, session, message, d = new Date()) {
  try {
    mkdirSync(stateDir, { recursive: true });
    appendFileSync(join(stateDir, 'events.log'), formatLine(agent, session, message, d));
  } catch {
    // The log is the last resort; there is nothing left to report a failure to.
  }
}
```

`src/platform.js`:

```js
// Everything that differs between macOS, Windows and Linux lives here.
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { existsSync } from 'node:fs';

export function configDir(env = process.env, platform = process.platform, home = homedir()) {
  if (env.AV_CONFIG_DIR) return env.AV_CONFIG_DIR;
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'agent-voice');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'agent-voice');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'agent-voice');
}

export function stateDir(env = process.env, platform = process.platform, home = homedir()) {
  if (env.AV_STATE_DIR) return env.AV_STATE_DIR;
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'agent-voice');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'agent-voice', 'state');
  return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'agent-voice');
}

export function findOnPath(cmd, env = process.env, platform = process.platform) {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const exts = platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      // Windows file lookup is case-insensitive; lower-case keeps the result predictable.
      const candidate = join(dir, cmd + ext.toLowerCase());
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests in the three files.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore src/core/hash.js src/core/log.js src/platform.js tests/
git commit -m "feat(node): package scaffold, cksum hash, event log, per-OS paths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Speech cleanup and pt-BR phrases

**Files:**
- Create: `src/core/speech.js`, `src/core/phrases.js`
- Test: `tests/speech.test.js`, `tests/phrases.test.js`

**Interfaces:**
- Consumes: `cksum` (Task 1)
- Produces: `cleanSpeech(text: string, max: number): string`, `stripTrailingPunct(text: string): string`
- Produces: `agentName(agent)`, `sessionLabel(sessionId)`, `where(sessionId, name, project)`, `durationPhrase(seconds)`, `phraseTaskDone(agentName, where, duration, text)`, `phraseBackgroundDone(agentName, where, text)`, `translateNotice(text)`, `phraseNeedsInput(agentName, where, text)`, constant `TEST_SENTENCE`

- [ ] **Step 1: Write the failing tests**

`tests/speech.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpeech, stripTrailingPunct } from '../src/core/speech.js';

const cases = [
  ['strips markdown link, keeps label', 'olha [essa card](https://app.clickup.com/t/86a) e arruma', 'olha essa card e arruma'],
  ['strips bare URL', 'veja https://exemplo.com/x isto', 'veja isto'],
  ['underscore becomes a space', 'handler de list_pickup', 'handler de list pickup'],
  ['drops bracketed card id', '[#196829] Selly PRO Davi Parra', 'Selly PRO Davi Parra'],
  ['collapses doubled periods', 'pronto.. Foco: x', 'pronto. Foco: x'],
  ['newlines become spaces', 'uma linha\noutra linha', 'uma linha outra linha'],
  ['removes stray brackets', 'text [ with bracket', 'text with bracket'],
  ['strips a file path', 'arruma o /srv/projeto/lib/core.sh agora', 'arruma o agora'],
  ['strips two file paths', 'compara /home/a/b.txt e /home/c/d.txt', 'compara e'],
  ['path rule does not eat a URL', 'veja https://exemplo.com/a/b isto e arruma /home/x/y', 'veja isto e arruma'],
  ['strips emoji and markdown symbols', '✅ **pronto** `ok` # > feito 🚀', 'pronto ok feito'],
];
for (const [name, input, expected] of cases) {
  test(`speech: ${name}`, () => assert.equal(cleanSpeech(input, 90), expected));
}

test('speech: truncates to the limit', () => {
  assert.equal(cleanSpeech('a'.repeat(30), 20), 'a'.repeat(20));
});

test('speech: truncation is safe at a character boundary', () => {
  assert.equal(cleanSpeech('ação extra stuff', 4), 'ação');
});

test('speech: non-string input becomes empty', () => {
  assert.equal(cleanSpeech(undefined, 90), '');
});

test('speech: strips trailing punctuation', () => {
  assert.equal(stripTrailingPunct('travados.'), 'travados');
  assert.equal(stripTrailingPunct('ok !:; - '), 'ok');
});
```

`tests/phrases.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../src/core/phrases.js';

test('known agents get a display name', () => {
  assert.equal(p.agentName('claude-code'), 'Claude Code');
  assert.equal(p.agentName('codex'), 'Codex');
  assert.equal(p.agentName('wrap'), 'O comando');
});
test('unknown agent falls back to its id', () => assert.equal(p.agentName('aider'), 'aider'));

test('session labels are pinned to the bash values', () => {
  assert.equal(p.sessionLabel('abc123'), 'roxa');
  assert.equal(p.sessionLabel('sid1'), 'verde');
  assert.equal(p.sessionLabel('c4'), 'vermelha');
});

test('where prefers the session name', () =>
  assert.equal(p.where('sid1', 'Home assistant repo', 'home-assistant'), 'na sessão Home assistant repo'));
test('where falls back to label plus project', () =>
  assert.equal(p.where('sid1', '', 'home-assistant'), 'na sessão verde, do projeto home-assistant'));
test('where with neither name nor project', () => assert.equal(p.where('sid1', '', ''), 'na sessão verde'));

test('durations', () => {
  assert.equal(p.durationPhrase(61), 'cerca de um minuto');
  assert.equal(p.durationPhrase(240), 'cerca de 4 minutos');
  assert.equal(p.durationPhrase(600), 'cerca de 10 minutos');
});

test('task done with and without request', () => {
  assert.equal(p.phraseTaskDone('Claude Code', 'na sessão X', 'cerca de 4 minutos', 'criar o compose.'),
    'Claude Code terminou na sessão X, depois de cerca de 4 minutos. Você tinha pedido: criar o compose.');
  assert.equal(p.phraseTaskDone('Claude Code', 'na sessão X', 'cerca de 4 minutos', ''),
    'Claude Code terminou na sessão X, depois de cerca de 4 minutos.');
});

test('background done', () => assert.equal(
  p.phraseBackgroundDone('Claude Code', 'na sessão X', 'revisor'),
  'Claude Code terminou um trabalho em segundo plano na sessão X. Era: revisor.'));

test('needs input: notices are translated or dropped', () => {
  const s = (t) => p.phraseNeedsInput('Claude Code', 'na sessão X', t);
  assert.equal(s('Claude needs your permission'), 'Claude Code precisa de você na sessão X.');
  assert.equal(s('Claude needs your permission to use Bash'), 'Claude Code precisa de você na sessão X, para usar o Bash.');
  assert.equal(s('Claude is waiting for your input'), 'Claude Code precisa de você na sessão X, e está esperando sua resposta.');
  assert.equal(s('algo inesperado'), 'Claude Code precisa de você na sessão X. algo inesperado.');
  assert.equal(s(''), 'Claude Code precisa de você na sessão X.');
});

test('the test sentence is Portuguese', () => assert.match(p.TEST_SENTENCE, /agent voice/));
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/core/speech.js'`.

- [ ] **Step 3: Implement**

`src/core/speech.js`:

```js
// Turns written text into something worth hearing. A speaker reading a URL or
// a card id out loud is unbearable, and markdown syntax is noise in speech.
const EMOJI = /[\u{2190}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FFFF}]/gu;

export function cleanSpeech(input, max) {
  const text = (typeof input === 'string' ? input : '')
    .replace(/\n/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/[^ ]*/g, '')
    // File paths. Must run after the URL rule: by now every URL is gone, so this
    // cannot eat half of one. Needs two slashes; a lone "/etc" is left alone.
    .replace(/\/[^ ]*\/[^ ]*/g, '')
    .replace(/\[#?[0-9]+\]\s*/g, '')
    .replace(/[[\]]/g, '')
    .replace(/[`*#>]/g, '')
    .replace(/_/g, ' ')
    .replace(EMOJI, '')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/^ /, '')
    .replace(/ $/, '');
  return Array.from(text).slice(0, max).join('');
}

// Used before joining two fragments, so "travados." + "." does not become "travados..".
export function stripTrailingPunct(text) {
  return String(text).replace(/[\s.!:;,-]+$/u, '');
}
```

`src/core/phrases.js`:

```js
// Everything spoken lives here, and it is the only file in Portuguese. Adding a
// language, or changing what the speaker says, touches this file and nothing else.
import { cksum } from './hash.js';
import { stripTrailingPunct } from './speech.js';

const AGENT_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex', wrap: 'O comando' };

// Spoken fallback identity when an agent cannot supply a session name.
// "sessão zero quatro cê zero" is useless to hear; a colour is not.
export const LABELS = ['azul', 'verde', 'vermelha', 'amarela', 'roxa', 'laranja', 'dourada', 'prateada', 'turquesa', 'violeta'];

export const TEST_SENTENCE = 'Teste do agent voice. Se você está ouvindo, está funcionando.';

export const agentName = (agent) => (Object.hasOwn(AGENT_NAMES, agent) ? AGENT_NAMES[agent] : agent);

export const sessionLabel = (sessionId) => LABELS[cksum(sessionId) % LABELS.length];

export function where(sessionId, name, project) {
  if (name) return `na sessão ${name}`;
  if (project) return `na sessão ${sessionLabel(sessionId)}, do projeto ${project}`;
  return `na sessão ${sessionLabel(sessionId)}`;
}

export function durationPhrase(seconds) {
  const minutes = Math.floor((seconds + 30) / 60);
  return minutes <= 1 ? 'cerca de um minuto' : `cerca de ${minutes} minutos`;
}

export function phraseTaskDone(agent, place, duration, text) {
  const s = `${agent} terminou ${place}, depois de ${duration}.`;
  return text ? `${s} Você tinha pedido: ${stripTrailingPunct(text)}.` : s;
}

export function phraseBackgroundDone(agent, place, text) {
  const s = `${agent} terminou um trabalho em segundo plano ${place}.`;
  return text ? `${s} Era: ${stripTrailingPunct(text)}.` : s;
}

// Agent notices arrive in English. Speaking one verbatim after a Portuguese
// sentence says the same thing twice, so known notices are translated — and the
// one that merely restates the sentence is dropped. Unknown ones are kept.
export function translateNotice(text) {
  const marker = 'needs your permission to use ';
  const at = text.lastIndexOf(marker);
  if (at !== -1) return `, para usar o ${text.slice(at + marker.length)}`;
  if (text.includes('needs your permission')) return '';
  if (text.includes('waiting for your input')) return ', e está esperando sua resposta';
  return `. ${text}`;
}

export function phraseNeedsInput(agent, place, text) {
  const s = `${agent} precisa de você ${place}`;
  return text ? `${s}${translateNotice(stripTrailingPunct(text))}.` : `${s}.`;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/speech.js src/core/phrases.js tests/speech.test.js tests/phrases.test.js
git commit -m "feat(node): speech cleanup and pt-BR phrases, ported from bash

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Per-session state

**Files:**
- Create: `src/core/state.js`
- Test: `tests/state.test.js`

**Interfaces:**
- Consumes: `cksum` (Task 1)
- Produces: `createState(stateDir: string, now?: () => number)` returning `{ path(agent, session): string, turnStart(agent, session, text): void, turnElapsed(agent, session): number | null, turnText(agent, session): string, turnClear(agent, session): void, cooldownStamp(agent, session): void, cooldownOk(agent, session, seconds): boolean }`. `now` returns epoch seconds.

- [ ] **Step 1: Write the failing tests**

`tests/state.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/core/state.js'`.

- [ ] **Step 3: Implement**

`src/core/state.js`:

```js
// Per-session state, used by the core only. Keyed by agent and session so that
// concurrent sessions — and concurrent agents — never clobber each other.
// Layout is identical to the bash version, so existing state carries over.
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cksum } from './hash.js';

const segment = (raw) => {
  const s = String(raw);
  return `${s.replace(/[^a-zA-Z0-9_-]/g, '') || 'unknown'}_${cksum(s)}`;
};

const epochNow = () => Math.floor(Date.now() / 1000);

export function createState(stateDir, now = epochNow) {
  const path = (agent, session) => {
    const dir = join(stateDir, segment(agent));
    mkdirSync(dir, { recursive: true });
    return join(dir, segment(session));
  };
  const read = (file) => {
    try { return readFileSync(file, 'utf8'); } catch { return null; }
  };
  const readEpoch = (file) => {
    const v = read(file)?.trim();
    return v && /^[0-9]+$/.test(v) ? Number(v) : null;
  };

  return {
    path,
    turnStart(agent, session, text) {
      const p = path(agent, session);
      writeFileSync(`${p}.start`, String(now()));
      writeFileSync(`${p}.text`, text ?? '');
    },
    turnElapsed(agent, session) {
      const started = readEpoch(`${path(agent, session)}.start`);
      return started === null ? null : Math.max(0, now() - started);
    },
    turnText(agent, session) {
      return read(`${path(agent, session)}.text`) ?? '';
    },
    turnClear(agent, session) {
      const p = path(agent, session);
      rmSync(`${p}.start`, { force: true });
      rmSync(`${p}.text`, { force: true });
    },
    cooldownStamp(agent, session) {
      writeFileSync(`${path(agent, session)}.cooldown`, String(now()));
    },
    cooldownOk(agent, session, seconds) {
      const last = readEpoch(`${path(agent, session)}.cooldown`);
      return last === null || now() - last >= seconds;
    },
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/state.js tests/state.test.js
git commit -m "feat(node): per-session state with the bash on-disk layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Configuration and output instances

**Files:**
- Create: `src/config.js`
- Create: `tests/helpers.js` (shared test helpers used by later tasks)
- Test: `tests/config.test.js`

**Interfaces:**
- Consumes: `configDir`, `stateDir` (Task 1)
- Produces: `DEFAULTS`, `NUMERIC_KEYS` (`{ minSeconds: 'AV_MIN_SECONDS', cooldownSeconds: 'AV_COOLDOWN_SECONDS', maxSpeechChars: 'AV_MAX_SPEECH_CHARS' }`), `isValidOutputName(name): boolean`, `readStoredConfig(env): object` (throws on invalid JSON), `loadConfig(env): { minSeconds, cooldownSeconds, maxSpeechChars, outputs: string[], configDir, stateDir }`, `saveConfig(patch, env): object`, `readOutputInstance(name, env): object | null`, `writeOutputInstance(name, conf, env): void`, `removeOutputInstance(name, env): void`, `listOutputInstances(env): Array<{ name, conf, error? }>`
- Produces (tests): `sandbox()` → `{ dir, env, spoken, spokenLines() }`, `RECORDER` path, `ROOT` path, `scriptedPrompter(answers)`, `collector()` → `{ lines, out }`

- [ ] **Step 1: Write the shared test helpers**

`tests/helpers.js`:

```js
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RECORDER = join(ROOT, 'tests', 'fixtures', 'record-speech.mjs');

// A throwaway world: config, state, Claude Code and Codex dirs all under one
// temp dir, and no AV_* tunables inherited from the developer's shell.
export function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'av-'));
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('AV_')) delete env[k];
  Object.assign(env, {
    HOME: join(dir, 'home'),
    USERPROFILE: join(dir, 'home'),
    AV_CONFIG_DIR: join(dir, 'config'),
    AV_STATE_DIR: join(dir, 'state'),
    CLAUDE_CONFIG_DIR: join(dir, 'claude'),
    CODEX_HOME: join(dir, 'codex'),
  });
  const spoken = join(dir, 'spoken.txt');
  const spokenLines = () => (existsSync(spoken) ? readFileSync(spoken, 'utf8').split('\n').filter(Boolean) : []);
  return { dir, env, spoken, spokenLines };
}

// Stands in for readline in tests: answers are consumed in order.
// ask → string ('' means "accept default"), confirm → boolean, choose → index.
export function scriptedPrompter(answers) {
  const queue = [...answers];
  const asked = [];
  const next = (q) => {
    asked.push(q);
    if (queue.length === 0) throw new Error(`unexpected prompt: ${q}`);
    return queue.shift();
  };
  return {
    asked,
    async ask(q, def = '') { const a = next(q); return a === '' ? def : a; },
    async confirm(q, def = true) { const a = next(q); return a === '' ? def : a; },
    async choose(q, options, def = 0) { const a = next(q); return a === '' ? def : a; },
    close() {},
  };
}

export function collector() {
  const lines = [];
  return { lines, out: (s) => lines.push(String(s)), text: () => lines.join('\n') };
}
```

- [ ] **Step 2: Write the failing tests**

`tests/config.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './helpers.js';
import * as c from '../src/config.js';

test('defaults when nothing is stored', () => {
  const { env } = sandbox();
  const cfg = c.loadConfig(env);
  assert.equal(cfg.minSeconds, 30);
  assert.equal(cfg.cooldownSeconds, 120);
  assert.equal(cfg.maxSpeechChars, 90);
  assert.deepEqual(cfg.outputs, []);
  assert.equal(cfg.stateDir, env.AV_STATE_DIR);
});

test('config.json overrides defaults, environment overrides config.json', () => {
  const { env } = sandbox();
  c.saveConfig({ minSeconds: 45, outputs: ['alexa'] }, env);
  assert.equal(c.loadConfig(env).minSeconds, 45);
  assert.equal(c.loadConfig({ ...env, AV_MIN_SECONDS: '10', AV_OUTPUTS: 'a b' }).minSeconds, 10);
  assert.deepEqual(c.loadConfig({ ...env, AV_OUTPUTS: ' a  b ' }).outputs, ['a', 'b']);
});

test('a non-numeric env override is ignored', () => {
  const { env } = sandbox();
  assert.equal(c.loadConfig({ ...env, AV_MIN_SECONDS: 'soon' }).minSeconds, 30);
});

test('saveConfig merges instead of replacing', () => {
  const { env } = sandbox();
  c.saveConfig({ minSeconds: 45 }, env);
  c.saveConfig({ outputs: ['x'] }, env);
  assert.deepEqual(c.readStoredConfig(env), { minSeconds: 45, outputs: ['x'] });
});

test('corrupt config.json throws naming the file', () => {
  const { env } = sandbox();
  mkdirSync(env.AV_CONFIG_DIR, { recursive: true });
  writeFileSync(join(env.AV_CONFIG_DIR, 'config.json'), '{ nope');
  assert.throws(() => c.loadConfig(env), /config\.json: invalid JSON/);
});

test('output instances round-trip, list sorted, and are removable', () => {
  const { env } = sandbox();
  c.writeOutputInstance('sala', { type: 'alexa', url: 'u', token: 't', entity: 'e' }, env);
  c.writeOutputInstance('local', { type: 'local', backend: 'say', voice: '' }, env);
  assert.equal(c.readOutputInstance('sala', env).token, 't');
  assert.deepEqual(c.listOutputInstances(env).map((o) => o.name), ['local', 'sala']);
  c.removeOutputInstance('sala', env);
  assert.equal(c.readOutputInstance('sala', env), null);
});

test('instance files are private (0600) where the OS supports it', { skip: process.platform === 'win32' }, () => {
  const { env } = sandbox();
  c.writeOutputInstance('sala', { type: 'alexa', token: 'secret' }, env);
  assert.equal(statSync(join(env.AV_CONFIG_DIR, 'outputs', 'sala.json')).mode & 0o777, 0o600);
});

test('output names are validated, so AV_OUTPUTS cannot escape the config dir', () => {
  const { env } = sandbox();
  assert.equal(c.isValidOutputName('alexa-sala'), true);
  assert.equal(c.isValidOutputName('../x'), false);
  assert.equal(c.isValidOutputName('Alexa'), false);
  assert.equal(c.readOutputInstance('../../etc/passwd', env), null);
  assert.throws(() => c.writeOutputInstance('../x', {}, env), /invalid output name/);
});

test('a corrupt instance is listed with its error instead of breaking the list', () => {
  const { env } = sandbox();
  mkdirSync(join(env.AV_CONFIG_DIR, 'outputs'), { recursive: true });
  writeFileSync(join(env.AV_CONFIG_DIR, 'outputs', 'bad.json'), 'nope');
  const [bad] = c.listOutputInstances(env);
  assert.equal(bad.name, 'bad');
  assert.equal(bad.conf, null);
  assert.match(bad.error, /invalid JSON/);
});

test('written JSON is pretty-printed with a trailing newline', () => {
  const { env } = sandbox();
  c.saveConfig({ minSeconds: 45 }, env);
  assert.equal(readFileSync(join(env.AV_CONFIG_DIR, 'config.json'), 'utf8'), '{\n  "minSeconds": 45\n}\n');
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/config.js'`.

- [ ] **Step 4: Implement**

`src/config.js`:

```js
// Precedence: built-in defaults < config.json < AV_* environment variables.
// The environment wins so tests (and one-off runs) never touch real config.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { configDir, stateDir } from './platform.js';

export const DEFAULTS = Object.freeze({ minSeconds: 30, cooldownSeconds: 120, maxSpeechChars: 90, outputs: [] });

export const NUMERIC_KEYS = Object.freeze({
  minSeconds: 'AV_MIN_SECONDS',
  cooldownSeconds: 'AV_COOLDOWN_SECONDS',
  maxSpeechChars: 'AV_MAX_SPEECH_CHARS',
});

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const isValidOutputName = (name) => typeof name === 'string' && NAME_RE.test(name);

function readJson(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${file}: invalid JSON (${e.message})`);
  }
}

function writeJson(file, value, mode) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
  if (mode) {
    try { chmodSync(file, mode); } catch { /* not supported on this OS */ }
  }
}

const configFile = (env) => join(configDir(env), 'config.json');
const instanceFile = (name, env) => join(configDir(env), 'outputs', `${name}.json`);

export function readStoredConfig(env = process.env) {
  const stored = readJson(configFile(env)) ?? {};
  if (typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error(`${configFile(env)}: expected a JSON object`);
  }
  return stored;
}

export function loadConfig(env = process.env) {
  const cfg = { ...DEFAULTS, ...readStoredConfig(env) };
  for (const [key, envName] of Object.entries(NUMERIC_KEYS)) {
    if (/^[0-9]+$/.test(env[envName] ?? '')) cfg[key] = Number(env[envName]);
  }
  if (env.AV_OUTPUTS !== undefined) cfg.outputs = env.AV_OUTPUTS.split(/\s+/).filter(Boolean);
  if (!Array.isArray(cfg.outputs)) cfg.outputs = [];
  return { ...cfg, configDir: configDir(env), stateDir: stateDir(env) };
}

export function saveConfig(patch, env = process.env) {
  const next = { ...readStoredConfig(env), ...patch };
  writeJson(configFile(env), next);
  return next;
}

export function readOutputInstance(name, env = process.env) {
  if (!isValidOutputName(name)) return null;
  return readJson(instanceFile(name, env));
}

export function writeOutputInstance(name, conf, env = process.env) {
  if (!isValidOutputName(name)) throw new Error(`invalid output name "${name}" (use a-z, 0-9 and -)`);
  writeJson(instanceFile(name, env), conf, 0o600);
}

export function removeOutputInstance(name, env = process.env) {
  if (isValidOutputName(name)) rmSync(instanceFile(name, env), { force: true });
}

export function listOutputInstances(env = process.env) {
  let files;
  try { files = readdirSync(join(configDir(env), 'outputs')); } catch { return []; }
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .filter(isValidOutputName)
    .sort()
    .map((name) => {
      try { return { name, conf: readOutputInstance(name, env) }; } catch (e) { return { name, conf: null, error: e.message }; }
    });
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config.js tests/helpers.js tests/config.test.js
git commit -m "feat(node): config file, env precedence and output instances

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Process runner, `command` output, output registry

**Files:**
- Create: `src/outputs/run.js`, `src/outputs/command.js`, `src/outputs/index.js`
- Create: `tests/fixtures/record-speech.mjs`
- Test: `tests/output-command.test.js`

**Interfaces:**
- Consumes: `readOutputInstance` (Task 4)
- Produces: `run(cmd, args, { input?, timeoutMs?, env?, spawn? }): Promise<string>` (resolves stdout; rejects `Error` whose message is the first stderr line, `command not found: <cmd>`, `timed out after Ns`, or `exited N with no output`)
- Produces: every output module exports `type: string`, `describe(conf): string`, `questions(prompt, current, deps): Promise<conf>`, `speak(sentence, conf, deps): Promise<void>`
- Produces: `parseCommandLine(line): string[]`
- Produces: `OUTPUT_TYPES` (`{ command }` now; Tasks 6–7 add `alexa`, `local`), `resolveOutputs(names, env): Array<{ name, speak: ((s) => Promise<void>) | null, reason? }>`

- [ ] **Step 1: Write the recorder fixture**

`tests/fixtures/record-speech.mjs` — stands in for a speaker; `node record-speech.mjs <file> [words…]`:

```js
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
```

- [ ] **Step 2: Write the failing tests**

`tests/output-command.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, RECORDER, scriptedPrompter } from './helpers.js';
import * as command from '../src/outputs/command.js';
import { run } from '../src/outputs/run.js';
import { OUTPUT_TYPES, resolveOutputs } from '../src/outputs/index.js';
import { writeOutputInstance } from '../src/config.js';

test('parseCommandLine splits on spaces and honours quotes', () => {
  assert.deepEqual(command.parseCommandLine('falar.sh -a {text}'), ['falar.sh', '-a', '{text}']);
  assert.deepEqual(command.parseCommandLine(`"C:\\Program Files\\x.exe" 'a b' ""`), ['C:\\Program Files\\x.exe', 'a b', '']);
  assert.throws(() => command.parseCommandLine('"open'), /unclosed quote/);
});

test('{text} is replaced in the arguments', async () => {
  const sb = sandbox();
  await command.speak('olá mundo', { type: 'command', argv: [process.execPath, RECORDER, sb.spoken, '{text}'] });
  assert.deepEqual(sb.spokenLines(), ['olá mundo']);
});

test('without {text} the sentence goes on stdin', async () => {
  const sb = sandbox();
  await command.speak('pelo stdin', { type: 'command', argv: [process.execPath, RECORDER, sb.spoken] });
  assert.deepEqual(sb.spokenLines(), ['pelo stdin']);
});

test('a failing command rejects with its first stderr line', async () => {
  const sb = sandbox();
  await assert.rejects(
    run(process.execPath, [RECORDER, sb.spoken, 'x'], { env: { ...process.env, STUB_FAIL: 'token missing' } }),
    { message: 'token missing' },
  );
});

test('a missing command rejects with a readable reason', async () => {
  await assert.rejects(command.speak('x', { type: 'command', argv: ['definitely-not-a-command-av'] }), /command not found/);
});

test('a hanging command is killed after the timeout', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 }), /timed out/);
});

test('questions parse the command line and reject an empty one', async () => {
  const conf = await command.questions(scriptedPrompter(['say {text}']));
  assert.deepEqual(conf, { type: 'command', argv: ['say', '{text}'] });
  await assert.rejects(command.questions(scriptedPrompter(['   '])), /a command is required/);
});

test('describe shows the command line', () => {
  assert.equal(command.describe({ argv: ['falar.sh', '-a', '{text}'] }), 'falar.sh -a {text}');
});

test('resolveOutputs: known instance speaks, missing one has no speak()', async () => {
  const sb = sandbox();
  writeOutputInstance('rec', { type: 'command', argv: [process.execPath, RECORDER, sb.spoken, '{text}'] }, sb.env);
  writeOutputInstance('weird', { type: 'nope' }, sb.env);
  const [rec, missing, weird] = resolveOutputs(['rec', 'ghost', 'weird'], sb.env);
  await rec.speak('frase');
  assert.deepEqual(sb.spokenLines(), ['frase']);
  assert.equal(missing.speak, null);
  assert.equal(weird.speak, null);
  assert.match(weird.reason, /unknown output type nope/);
  assert.ok(OUTPUT_TYPES.command);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/outputs/command.js'`.

- [ ] **Step 4: Implement**

`src/outputs/run.js`:

```js
// Runs a speaker process with a hard timeout. A hook that hangs is worse than
// one that fails, so every child gets killed eventually.
import { spawn as nodeSpawn } from 'node:child_process';

export function run(cmd, args, { input = '', timeoutMs = 20000, env, spawn = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
    // Windows refuses to spawn .cmd/.bat without a shell.
    const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], shell, env, windowsHide: true });
    } catch (e) {
      reject(new Error(e.message));
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish(reject, new Error(e.code === 'ENOENT' ? `command not found: ${cmd}` : e.message)));
    child.on('close', (code) => {
      if (code === 0) finish(resolve, stdout);
      else finish(reject, new Error(stderr.trim().split(/\r?\n/)[0] || `exited ${code} with no output`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
```

`src/outputs/command.js`:

```js
// Runs any command that makes noise. {text} in its arguments is replaced by the
// sentence; without {text}, the sentence goes on stdin. No shell is involved.
import { run } from './run.js';

export const type = 'command';

export function parseCommandLine(line) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (const ch of String(line)) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) out.push(cur);
      cur = '';
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (quote) throw new Error('unclosed quote in command');
  if (started) out.push(cur);
  return out;
}

export const describe = (conf) => (conf.argv ?? []).join(' ');

export async function questions(prompt, current = {}) {
  const line = await prompt.ask(
    'Command that speaks a sentence ({text} marks where the sentence goes; without it, the sentence is sent on stdin)',
    current.argv ? current.argv.join(' ') : '',
  );
  const argv = parseCommandLine(line);
  if (argv.length === 0) throw new Error('a command is required');
  return { type, argv };
}

export async function speak(sentence, conf, deps = {}) {
  if (!Array.isArray(conf.argv) || conf.argv.length === 0) throw new Error('command output has no argv');
  const [cmd, ...rest] = conf.argv;
  const placeholder = rest.some((a) => a.includes('{text}'));
  const args = rest.map((a) => a.replaceAll('{text}', sentence));
  await run(cmd, args, { input: placeholder ? '' : sentence, spawn: deps.spawn, timeoutMs: deps.timeoutMs });
}
```

`src/outputs/index.js`:

```js
import * as command from './command.js';
import { readOutputInstance } from '../config.js';

export const OUTPUT_TYPES = { command };

// Turns the active output names into speak() closures for the core. A name with
// no usable instance gets speak: null, which the core logs as "no such output".
export function resolveOutputs(names, env = process.env) {
  return names.map((name) => {
    let conf;
    try {
      conf = readOutputInstance(name, env);
    } catch (e) {
      return { name, speak: null, reason: e.message };
    }
    if (!conf) return { name, speak: null };
    const mod = Object.hasOwn(OUTPUT_TYPES, conf.type) ? OUTPUT_TYPES[conf.type] : null;
    if (!mod) return { name, speak: null, reason: `unknown output type ${conf.type}` };
    return { name, speak: (sentence) => mod.speak(sentence, conf) };
  });
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/outputs/ tests/fixtures/record-speech.mjs tests/output-command.test.js
git commit -m "feat(node): command output, process runner with timeout, output registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `alexa` output (Home Assistant API)

**Files:**
- Create: `src/outputs/alexa.js`
- Modify: `src/outputs/index.js` (register `alexa`)
- Test: `tests/output-alexa.test.js`

**Interfaces:**
- Consumes: output module contract (Task 5)
- Produces: `alexa.speak(sentence, conf, { fetch?, timeoutMs? })`, `alexa.listNotifyEntities(conf, deps): Promise<string[]>`, `alexa.questions(prompt, current, deps)`; conf shape `{ type: 'alexa', url, token, entity }`

- [ ] **Step 1: Write the failing tests**

`tests/output-alexa.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as alexa from '../src/outputs/alexa.js';
import { OUTPUT_TYPES } from '../src/outputs/index.js';
import { scriptedPrompter } from './helpers.js';

// A tiny fake Home Assistant. Records every request it receives.
async function fakeHA({ token = 'good', hang = false } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      if (hang) return;
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end(); return; }
      if (req.url === '/api/') { res.writeHead(200); res.end('{"message":"API running."}'); return; }
      if (req.url === '/api/states') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([
          { entity_id: 'light.sala' },
          { entity_id: 'notify.echo_speak' },
          { entity_id: 'notify.echo_announce' },
        ]));
        return;
      }
      if (req.url === '/api/services/notify/send_message') { res.writeHead(200); res.end('[]'); return; }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, close: () => { server.closeAllConnections(); server.close(); } };
}

test('speak posts the sentence to notify.send_message with the entity', async () => {
  const ha = await fakeHA();
  try {
    await alexa.speak('olá', { type: 'alexa', url: `${ha.url}/`, token: 'good', entity: 'notify.echo_announce' });
    const last = ha.requests.at(-1);
    assert.equal(last.method, 'POST');
    assert.equal(last.url, '/api/services/notify/send_message');
    assert.deepEqual(JSON.parse(last.body), { entity_id: 'notify.echo_announce', message: 'olá' });
  } finally { ha.close(); }
});

test('a rejected token gives a specific reason', async () => {
  const ha = await fakeHA();
  try {
    await assert.rejects(alexa.speak('x', { type: 'alexa', url: ha.url, token: 'bad', entity: 'notify.e' }), /rejected the token/);
  } finally { ha.close(); }
});

test('an unreachable Home Assistant gives a specific reason', async () => {
  await assert.rejects(
    alexa.speak('x', { type: 'alexa', url: 'http://127.0.0.1:1', token: 't', entity: 'notify.e' }),
    /cannot reach Home Assistant/,
  );
});

test('a hanging Home Assistant times out instead of hanging the hook', async () => {
  const ha = await fakeHA({ hang: true });
  try {
    await assert.rejects(
      alexa.speak('x', { type: 'alexa', url: ha.url, token: 'good', entity: 'notify.e' }, { timeoutMs: 200 }),
      /did not answer/,
    );
  } finally { ha.close(); }
});

test('incomplete config is refused before any request', async () => {
  await assert.rejects(alexa.speak('x', { type: 'alexa', url: 'http://h' }), /missing url, token or entity/);
});

test('questions test the token and offer notify entities, _announce first', async () => {
  const ha = await fakeHA();
  try {
    const prompt = scriptedPrompter([ha.url, 'good', '']);
    const conf = await alexa.questions(prompt, {});
    assert.deepEqual(conf, { type: 'alexa', url: ha.url, token: 'good', entity: 'notify.echo_announce' });
  } finally { ha.close(); }
});

test('questions fail clearly when no notify entity exists', async () => {
  const ha = await fakeHA();
  try {
    const prompt = scriptedPrompter([ha.url, 'good']);
    await assert.rejects(
      alexa.questions(prompt, {}, { fetch: async (u, init) => {
        const res = await fetch(u, init);
        if (u.endsWith('/api/states')) return new Response('[]', { status: 200 });
        return res;
      } }),
      /no notify\.\* entities/,
    );
  } finally { ha.close(); }
});

test('describe never shows the token', () => {
  const d = alexa.describe({ url: 'http://h:8123/', token: 'secret', entity: 'notify.e' });
  assert.equal(d, 'notify.e @ http://h:8123');
  assert.doesNotMatch(d, /secret/);
});

test('alexa is registered', () => assert.equal(OUTPUT_TYPES.alexa, alexa));
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/outputs/alexa.js'`.

- [ ] **Step 3: Implement**

`src/outputs/alexa.js`:

```js
// Makes an Echo speak through Home Assistant's notify.send_message service —
// the same call the old falar.sh made, without needing that script.
export const type = 'alexa';

const base = (url) => String(url ?? '').replace(/\/+$/, '');

export const describe = (conf) => `${conf.entity} @ ${base(conf.url)}`;

async function call(conf, path, init = {}, deps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 20000;
  let res;
  try {
    res = await doFetch(`${base(conf.url)}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${conf.token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new Error(`Home Assistant did not answer within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new Error(`cannot reach Home Assistant at ${base(conf.url)} (${e.cause?.code ?? e.message})`);
  }
  if (res.status === 401) throw new Error('Home Assistant rejected the token (HTTP 401)');
  if (!res.ok) throw new Error(`Home Assistant answered HTTP ${res.status}`);
  return res;
}

export async function speak(sentence, conf, deps = {}) {
  if (!conf.url || !conf.token || !conf.entity) throw new Error('alexa output is missing url, token or entity');
  await call(conf, '/api/services/notify/send_message', {
    method: 'POST',
    body: JSON.stringify({ entity_id: conf.entity, message: sentence }),
  }, deps);
}

export async function listNotifyEntities(conf, deps = {}) {
  const res = await call(conf, '/api/states', {}, deps);
  const states = await res.json();
  return (Array.isArray(states) ? states : [])
    .map((s) => s?.entity_id)
    .filter((id) => typeof id === 'string' && id.startsWith('notify.'))
    .sort();
}

export async function questions(prompt, current = {}, deps = {}) {
  const url = base(await prompt.ask('Home Assistant URL', current.url ?? 'http://localhost:8123'));
  const token = await prompt.ask('Long-lived access token (Home Assistant → your profile → Security)', current.token ?? '');
  const conf = { type, url, token, entity: '' };
  await call(conf, '/api/', {}, deps);
  const entities = await listNotifyEntities(conf, deps);
  if (entities.length === 0) {
    throw new Error('Home Assistant has no notify.* entities — is the Alexa Media Player integration set up?');
  }
  const ordered = [...entities.filter((e) => e.endsWith('_announce')), ...entities.filter((e) => !e.endsWith('_announce'))];
  const def = Math.max(0, ordered.indexOf(current.entity));
  const i = await prompt.choose('Which device should speak? (_announce plays a chime first)', ordered, def);
  conf.entity = ordered[i];
  return conf;
}
```

In `src/outputs/index.js`, register it:

```js
import * as alexa from './alexa.js';
import * as command from './command.js';
import { readOutputInstance } from '../config.js';

export const OUTPUT_TYPES = { alexa, command };
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/outputs/alexa.js src/outputs/index.js tests/output-alexa.test.js
git commit -m "feat(node): native alexa output through the Home Assistant API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `local` output (the computer's own voice)

**Files:**
- Create: `src/outputs/local.js`
- Modify: `src/outputs/index.js` (register `local`)
- Test: `tests/output-local.test.js`

**Interfaces:**
- Consumes: `run` (Task 5), `findOnPath` (Task 1)
- Produces: `detectBackend(platform, env, find): 'say' | 'sapi' | 'spd-say' | 'espeak-ng' | 'espeak' | null`, `commandFor(backend, sentence, voice): { cmd, args, input, env? }`, `defaultVoice(backend, deps): Promise<string>`; conf shape `{ type: 'local', backend, voice }`

- [ ] **Step 1: Write the failing tests**

`tests/output-local.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as local from '../src/outputs/local.js';
import { OUTPUT_TYPES } from '../src/outputs/index.js';
import { scriptedPrompter } from './helpers.js';

const finder = (present) => (cmd) => (present.includes(cmd) ? `/usr/bin/${cmd}` : null);

test('backend per OS', () => {
  assert.equal(local.detectBackend('darwin', {}, finder([])), 'say');
  assert.equal(local.detectBackend('win32', {}, finder([])), 'sapi');
  assert.equal(local.detectBackend('linux', {}, finder(['espeak', 'spd-say'])), 'spd-say');
  assert.equal(local.detectBackend('linux', {}, finder(['espeak', 'espeak-ng'])), 'espeak-ng');
  assert.equal(local.detectBackend('linux', {}, finder(['espeak'])), 'espeak');
  assert.equal(local.detectBackend('linux', {}, finder([])), null);
});

test('say passes the voice and the sentence as arguments', () => {
  assert.deepEqual(local.commandFor('say', 'olá', 'Luciana'), { cmd: 'say', args: ['-v', 'Luciana', 'olá'], input: '' });
  assert.deepEqual(local.commandFor('say', 'olá', ''), { cmd: 'say', args: ['olá'], input: '' });
});

test('sapi sends the sentence on stdin, never inside the script', () => {
  const c = local.commandFor('sapi', 'frase "com" aspas', 'Microsoft Maria');
  assert.equal(c.cmd, 'powershell.exe');
  assert.equal(c.input, 'frase "com" aspas');
  assert.ok(!c.args.join(' ').includes('aspas'));
  assert.equal(c.env.AV_VOICE, 'Microsoft Maria');
});

test('linux backends default to Portuguese', () => {
  assert.deepEqual(local.commandFor('spd-say', 'oi', ''), { cmd: 'spd-say', args: ['-w', '-l', 'pt', 'oi'], input: '' });
  assert.deepEqual(local.commandFor('espeak-ng', 'oi', ''), { cmd: 'espeak-ng', args: ['-v', 'pt-br', 'oi'], input: '' });
});

test('unknown backend is refused', () => {
  assert.throws(() => local.commandFor('beep', 'x'), /unknown local voice backend/);
});

test('defaultVoice picks the first pt_BR voice from `say -v ?`', async () => {
  const fakeSpawnOutput = 'Alex                en_US    # Hello\nLuciana             pt_BR    # Olá\n';
  const voice = await local.defaultVoice('say', { run: async () => fakeSpawnOutput });
  assert.equal(voice, 'Luciana');
});

test('defaultVoice picks the pt-BR SAPI voice', async () => {
  const voice = await local.defaultVoice('sapi', { run: async () => 'en-US|Microsoft Zira\r\npt-BR|Microsoft Maria\r\n' });
  assert.equal(voice, 'Microsoft Maria');
});

test('questions explain how to get a voice when none exists', async () => {
  await assert.rejects(
    local.questions(scriptedPrompter([]), {}, { platform: 'linux', env: {}, find: finder([]) }),
    /install espeak-ng/,
  );
});

test('questions keep the suggested voice on Enter', async () => {
  const conf = await local.questions(scriptedPrompter(['']), {}, { platform: 'linux', env: {}, find: finder(['espeak-ng']) });
  assert.deepEqual(conf, { type: 'local', backend: 'espeak-ng', voice: 'pt-br' });
});

test('local is registered', () => assert.equal(OUTPUT_TYPES.local, local));
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/outputs/local.js'`.

- [ ] **Step 3: Implement**

`src/outputs/local.js`:

```js
// The computer's own voice: `say` on macOS, SAPI through PowerShell on Windows,
// speech-dispatcher or eSpeak on Linux.
import { run as runProcess } from './run.js';
import { findOnPath } from '../platform.js';

export const type = 'local';

// The sentence arrives on stdin, never spliced into the script, so no quoting
// of user text is ever needed.
const SAPI_SPEAK = [
  '[Console]::InputEncoding = [Text.Encoding]::UTF8;',
  'Add-Type -AssemblyName System.Speech;',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
  'if ($env:AV_VOICE) { $s.SelectVoice($env:AV_VOICE) };',
  '$s.Speak([Console]::In.ReadToEnd())',
].join(' ');

const SAPI_VOICES = [
  'Add-Type -AssemblyName System.Speech;',
  '(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() |',
  "ForEach-Object { $_.VoiceInfo.Culture.Name + '|' + $_.VoiceInfo.Name }",
].join(' ');

export function detectBackend(platform = process.platform, env = process.env, find = findOnPath) {
  if (platform === 'darwin') return 'say';
  if (platform === 'win32') return 'sapi';
  for (const backend of ['spd-say', 'espeak-ng', 'espeak']) if (find(backend, env, platform)) return backend;
  return null;
}

export function commandFor(backend, sentence, voice) {
  switch (backend) {
    case 'say':
      return { cmd: 'say', args: voice ? ['-v', voice, sentence] : [sentence], input: '' };
    case 'sapi':
      return {
        cmd: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', SAPI_SPEAK],
        input: sentence,
        env: { ...process.env, AV_VOICE: voice ?? '' },
      };
    case 'spd-say':
      return { cmd: 'spd-say', args: ['-w', '-l', voice || 'pt', sentence], input: '' };
    case 'espeak-ng':
    case 'espeak':
      return { cmd: backend, args: ['-v', voice || 'pt-br', sentence], input: '' };
    default:
      throw new Error(`unknown local voice backend: ${backend}`);
  }
}

export async function defaultVoice(backend, deps = {}) {
  const run = deps.run ?? runProcess;
  try {
    if (backend === 'say') {
      const out = await run('say', ['-v', '?']);
      const line = out.split('\n').find((l) => /\bpt_BR\b/.test(l));
      return line ? line.trim().split(/\s{2,}/)[0] : '';
    }
    if (backend === 'sapi') {
      const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SAPI_VOICES]);
      const line = out.split(/\r?\n/).find((l) => l.startsWith('pt-BR|'));
      return line ? line.slice('pt-BR|'.length).trim() : '';
    }
  } catch {
    return '';
  }
  return backend === 'spd-say' ? 'pt' : 'pt-br';
}

export const describe = (conf) => `${conf.backend}${conf.voice ? ` (${conf.voice})` : ''}`;

export async function questions(prompt, current = {}, deps = {}) {
  const backend = detectBackend(deps.platform, deps.env, deps.find);
  if (!backend) {
    throw new Error('no local voice found — install espeak-ng (e.g. apt install espeak-ng) or speech-dispatcher');
  }
  const suggested = current.backend === backend && current.voice ? current.voice : await defaultVoice(backend, deps);
  const voice = await prompt.ask(`Voice for ${backend} (Enter keeps the suggestion)`, suggested);
  return { type, backend, voice };
}

export async function speak(sentence, conf, deps = {}) {
  const { cmd, args, input, env } = commandFor(conf.backend, sentence, conf.voice);
  await runProcess(cmd, args, { input, env, spawn: deps.spawn, timeoutMs: deps.timeoutMs ?? 60000 });
}
```

In `src/outputs/index.js`:

```js
import * as alexa from './alexa.js';
import * as command from './command.js';
import * as local from './local.js';
import { readOutputInstance } from '../config.js';

export const OUTPUT_TYPES = { alexa, local, command };
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Manual check on this machine (Linux/WSL)**

Run: `node -e "import('./src/outputs/local.js').then(m => console.log(m.detectBackend()))"`
Expected: prints a backend name or `null`. Either is fine; record which in the task report.

- [ ] **Step 6: Commit**

```bash
git add src/outputs/local.js src/outputs/index.js tests/output-local.test.js
git commit -m "feat(node): local voice output for macOS, Windows and Linux

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Core decision logic

**Files:**
- Create: `src/core/handle.js`, `src/core/context.js`
- Test: `tests/core.test.js`

**Interfaces:**
- Consumes: `cleanSpeech` (Task 2), phrases (Task 2), `createState` (Task 3), `loadConfig` (Task 4), `resolveOutputs` (Task 5), `log` (Task 1)
- Produces: `handle(event: object, ctx): Promise<void>` and `speakAll(agent, session, sentence, ctx): Promise<void>` where `ctx = { config: { minSeconds, cooldownSeconds, maxSpeechChars }, state, log(agent, session, message), outputs: Array<{ name, speak|null, reason? }> }`
- Produces: `createContext(env): ctx` (throws if config is corrupt)
- Canonical event shape: `{ type: 'turn_start'|'task_done'|'background_done'|'needs_input', agent, session_id, session_name?, project?, text? }`

- [ ] **Step 1: Write the failing tests**

`tests/core.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/core/handle.js'`.

- [ ] **Step 3: Implement**

`src/core/handle.js`:

```js
// The only component that remembers or decides anything. Adapters hand it a
// canonical event; it completes that event from state, applies the rules,
// builds the sentence and dispatches to every active output.
import { cleanSpeech } from './speech.js';
import {
  agentName, where as whereOf, durationPhrase, phraseTaskDone, phraseBackgroundDone, phraseNeedsInput,
} from './phrases.js';

const str = (v) => (typeof v === 'string' ? v : '');

export async function speakAll(agent, session, sentence, ctx) {
  ctx.state.cooldownStamp(agent, session);
  for (const out of ctx.outputs) {
    if (!out.speak) {
      ctx.log(agent, session, `no such output: ${out.name}${out.reason ? ` (${out.reason})` : ''}`);
      continue;
    }
    try {
      await out.speak(sentence);
      ctx.log(agent, session, `spoke via ${out.name}: ${sentence}`);
    } catch (e) {
      // "container down", "token missing" and "HTTP 401" must stay distinguishable
      // from each other, and from a hook that simply chose to stay quiet.
      const reason = String(e?.message ?? e).split(/\r?\n/)[0].slice(0, 120) || 'failed with no reason';
      ctx.log(agent, session, `FAILED via ${out.name} (${reason}): ${sentence}`);
    }
  }
}

export async function handle(event, ctx) {
  const e = event && typeof event === 'object' ? event : {};
  const type = str(e.type);
  const agent = str(e.agent);
  const session = str(e.session_id);
  if (!type || !agent || !session) {
    ctx.log(agent || '?', session || '?', 'ignored: incomplete event');
    return;
  }

  // session_name and project come straight from the agent (an AI-written title,
  // a directory name) — never speech-safe by construction, so cleaned here once.
  const clean = (t) => cleanSpeech(t, ctx.config.maxSpeechChars);
  const who = agentName(agent);
  const place = whereOf(session, clean(str(e.session_name)), clean(str(e.project)));
  const text = str(e.text);
  let sentence;

  switch (type) {
    case 'turn_start':
      ctx.state.turnStart(agent, session, text);
      ctx.log(agent, session, 'turn started');
      return;

    case 'task_done': {
      const elapsed = ctx.state.turnElapsed(agent, session);
      if (elapsed === null) {
        ctx.log(agent, session, 'ignored: task_done with no turn marker');
        return;
      }
      // The request came from turn_start; the stop hook never carries it.
      const asked = ctx.state.turnText(agent, session);
      ctx.state.turnClear(agent, session);
      if (elapsed < ctx.config.minSeconds) {
        ctx.log(agent, session, `silent (turn ${elapsed}s < ${ctx.config.minSeconds}s)`);
        return;
      }
      sentence = phraseTaskDone(who, place, durationPhrase(elapsed), clean(asked));
      break;
    }

    case 'background_done':
      if (!ctx.state.cooldownOk(agent, session, ctx.config.cooldownSeconds)) {
        ctx.log(agent, session, `silent (cooldown ${ctx.config.cooldownSeconds}s)`);
        return;
      }
      // Background events fire often; a sentence with no content is noise.
      if (!text) {
        ctx.log(agent, session, 'silent (background_done with no content)');
        return;
      }
      sentence = phraseBackgroundDone(who, place, clean(text));
      break;

    case 'needs_input':
      sentence = phraseNeedsInput(who, place, clean(text));
      break;

    default:
      ctx.log(agent, session, `ignored: unknown type ${type}`);
      return;
  }

  await speakAll(agent, session, sentence, ctx);
}
```

`src/core/context.js`:

```js
import { loadConfig } from '../config.js';
import { createState } from './state.js';
import { log } from './log.js';
import { resolveOutputs } from '../outputs/index.js';

export function createContext(env = process.env) {
  const config = loadConfig(env);
  return {
    config,
    state: createState(config.stateDir),
    log: (agent, session, message) => log(config.stateDir, agent, session, message),
    outputs: resolveOutputs(config.outputs, env),
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/handle.js src/core/context.js tests/core.test.js
git commit -m "feat(node): core decision logic, ported with parity tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Claude Code adapter

**Files:**
- Create: `src/adapters/common.js`, `src/adapters/claude-code.js`, `src/adapters/index.js`
- Test: `tests/adapter-claude-code.test.js`

**Interfaces:**
- Produces (every adapter module): `name: string`, `hooks: Array<{ event, sub, async?, timeout }>`, `notes: string[]`, `configFile(env?, home?): string`, `detect(env?, home?): boolean`, `hookReply(sub): string`, `translate(sub, payload, home?): event | null`
- Produces: `str(v)`, `projectOf(cwd, home)` in `common.js`; `sessionName(transcriptPath)` in `claude-code.js`; `ADAPTERS` (`{ 'claude-code' }`, Task 10 adds `codex`)

- [ ] **Step 1: Write the failing tests**

`tests/adapter-claude-code.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cc from '../src/adapters/claude-code.js';
import { projectOf } from '../src/adapters/common.js';
import { ADAPTERS } from '../src/adapters/index.js';

const home = join('/', 'home', 'u');
const payload = { session_id: '04c02385', cwd: join(home, 'softwares', 'home-assistant'), prompt: 'criar o compose', transcript_path: '/nao/existe.jsonl' };

test('start maps to turn_start carrying agent, session, project and prompt', () => {
  assert.deepEqual(cc.translate('start', payload, home), {
    type: 'turn_start', agent: 'claude-code', session_id: '04c02385',
    session_name: '', project: 'home-assistant', text: 'criar o compose',
  });
});

test('subcommand mapping', () => {
  assert.equal(cc.translate('stop', payload, home).type, 'task_done');
  assert.equal(cc.translate('stop', payload, home).text, '');
  assert.equal(cc.translate('task', payload, home).type, 'background_done');
  assert.equal(cc.translate('notification', { ...payload, message: 'permission needed' }, home).text, 'permission needed');
  assert.equal(cc.translate('notification', payload, home).type, 'needs_input');
  assert.equal(cc.translate('bogus', payload, home), null);
});

test('task text falls back agent_type → subagent_type → description → task_description', () => {
  const t = (p) => cc.translate('task', { session_id: 's', cwd: '/a/b', ...p }, home).text;
  assert.equal(t({ agent_type: 'reviewer', subagent_type: 'x', description: 'y', task_description: 'z' }), 'reviewer');
  assert.equal(t({ subagent_type: 'code-reviewer', description: 'y' }), 'code-reviewer');
  assert.equal(t({ description: 'reviewing the diff', task_description: 'z' }), 'reviewing the diff');
  assert.equal(t({ task_description: 'run the tests' }), 'run the tests');
  assert.equal(t({}), '');
});

test('home directory is not a project; trailing separators are ignored', () => {
  assert.equal(projectOf(home, home), '');
  assert.equal(projectOf(`${home}/`, home), '');
  assert.equal(projectOf('/a/proj/', home), 'proj');
  assert.equal(projectOf('C:\\Users\\u\\code\\proj', 'C:\\Users\\u'), 'proj');
  assert.equal(projectOf(undefined, home), '');
});

test('garbage payloads never throw', () => {
  assert.equal(cc.translate('start', null, home).session_id, '');
  assert.equal(cc.translate('start', 'lixo', home).text, '');
  assert.equal(cc.translate('start', { session_id: 42, prompt: {} }, home).session_id, '');
});

test('session name is the newest ai-title in the transcript', () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-tr-'));
  const tr = join(dir, 'fake.jsonl');
  writeFileSync(tr, [
    '{"type":"ai-title","aiTitle":"Older title"}',
    '{"type":"user","message":"x"}',
    '{"type":"ai-title","aiTitle":"Home-assistant repo"}',
    '',
  ].join('\n'));
  assert.equal(cc.sessionName(tr), 'Home assistant repo');
  assert.equal(cc.translate('start', { ...payload, transcript_path: tr }, home).session_name, 'Home assistant repo');
});

test('session name survives CRLF transcripts (Windows)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-tr-'));
  const tr = join(dir, 'crlf.jsonl');
  writeFileSync(tr, '{"type":"user"}\r\n{"type":"ai-title","aiTitle":"Titulo_windows"}\r\n');
  assert.equal(cc.sessionName(tr), 'Titulo windows');
});

test('missing or corrupt transcript leaves the name empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-tr-'));
  const tr = join(dir, 'bad.jsonl');
  writeFileSync(tr, '{"type":"ai-title", broken\n');
  assert.equal(cc.sessionName(tr), '');
  assert.equal(cc.sessionName('/nao/existe.jsonl'), '');
  assert.equal(cc.sessionName(''), '');
});

test('config file honours CLAUDE_CONFIG_DIR and detect() checks its directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-cc-'));
  assert.equal(cc.configFile({}, home), join(home, '.claude', 'settings.json'));
  assert.equal(cc.configFile({ CLAUDE_CONFIG_DIR: dir }, home), join(dir, 'settings.json'));
  assert.equal(cc.detect({ CLAUDE_CONFIG_DIR: join(dir, 'nope') }, home), false);
  mkdirSync(join(dir, 'yes'));
  assert.equal(cc.detect({ CLAUDE_CONFIG_DIR: join(dir, 'yes') }, home), true);
});

test('hooks match the README wiring and nothing is written back to Claude Code', () => {
  assert.deepEqual(cc.hooks.map((h) => `${h.event}:${h.sub}`), [
    'UserPromptSubmit:start', 'Stop:stop', 'SubagentStop:task', 'TaskCompleted:task', 'Notification:notification',
  ]);
  assert.equal(cc.hooks[0].async, undefined);
  assert.equal(cc.hookReply('stop'), '');
  assert.equal(ADAPTERS['claude-code'], cc);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/adapters/claude-code.js'`.

- [ ] **Step 3: Implement**

`src/adapters/common.js`:

```js
import { homedir } from 'node:os';

export const str = (v) => (typeof v === 'string' ? v : '');

// The last segment of cwd. The home directory is not a project — announcing
// "do projeto lucas-zaia" would be nonsense.
export function projectOf(cwd, home = homedir()) {
  const dir = str(cwd).replace(/[\\/]+$/, '');
  if (!dir || dir === String(home).replace(/[\\/]+$/, '')) return '';
  const parts = dir.split(/[\\/]/);
  return parts[parts.length - 1];
}
```

`src/adapters/claude-code.js`:

```js
// Translates Claude Code hook payloads into canonical events. Pure: it reads
// the payload, returns one event, and keeps no state. Everything it knows about
// Claude Code — hook names, field names, where the session title hides — is here.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { str, projectOf } from './common.js';

export const name = 'claude-code';

export const hooks = [
  { event: 'UserPromptSubmit', sub: 'start', timeout: 5 },
  { event: 'Stop', sub: 'stop', async: true, timeout: 20 },
  { event: 'SubagentStop', sub: 'task', async: true, timeout: 20 },
  { event: 'TaskCompleted', sub: 'task', async: true, timeout: 20 },
  { event: 'Notification', sub: 'notification', async: true, timeout: 20 },
];

export const notes = [];

export function configFile(env = process.env, home = homedir()) {
  return join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json');
}

export const detect = (env = process.env, home = homedir()) => existsSync(dirname(configFile(env, home)));

export const hookReply = () => '';

// Claude Code writes an AI-generated title into the transcript as
// {"type":"ai-title","aiTitle":"..."} and rewrites it as the topic shifts.
// Read from the end: the newest one wins.
export function sessionName(transcriptPath) {
  if (!transcriptPath) return '';
  let text;
  try { text = readFileSync(transcriptPath, 'utf8'); } catch { return ''; }
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"type":"ai-title"')) continue;
    try {
      return str(JSON.parse(lines[i]).aiTitle).replace(/[_-]+/g, ' ');
    } catch {
      return '';
    }
  }
  return '';
}

// SubagentStop / TaskCompleted rarely fill agent_type, so try each field in
// turn; the core decides what to do when all are empty.
const taskText = (p) => str(p.agent_type) || str(p.subagent_type) || str(p.description) || str(p.task_description);

const MAPPING = {
  start: ['turn_start', (p) => str(p.prompt)],
  stop: ['task_done', () => ''],
  task: ['background_done', taskText],
  notification: ['needs_input', (p) => str(p.message)],
};

export function translate(sub, payload, home = homedir()) {
  if (!Object.hasOwn(MAPPING, sub)) return null;
  const p = payload && typeof payload === 'object' ? payload : {};
  const [type, text] = MAPPING[sub];
  return {
    type,
    agent: name,
    session_id: str(p.session_id),
    session_name: sessionName(str(p.transcript_path)),
    project: projectOf(p.cwd, home),
    text: text(p),
  };
}
```

`src/adapters/index.js`:

```js
import * as claudeCode from './claude-code.js';

export const ADAPTERS = { 'claude-code': claudeCode };
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/ tests/adapter-claude-code.test.js
git commit -m "feat(node): Claude Code adapter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Codex adapter

Codex facts this task relies on (from the Codex hooks docs, learn.chatgpt.com/codex/hooks):
hooks live in `$CODEX_HOME/hooks.json` (default `~/.codex`) with the same `{"hooks": {Event: [{matcher?, hooks: [{type, command, timeout, async}]}]}}` shape as Claude Code; events used here are `UserPromptSubmit` (payload adds `turn_id`, `prompt`), `Stop` (adds `turn_id`, `last_assistant_message`; **expects JSON on stdout when it exits 0**) and `PermissionRequest` (adds `turn_id`, `tool_name`, `tool_input`); every payload has `session_id`, `cwd`, `transcript_path`, `hook_event_name`. Hooks are on by default, but Codex skips hooks the user has not trusted via `/hooks`.

**Files:**
- Create: `src/adapters/codex.js`
- Modify: `src/adapters/index.js`
- Test: `tests/adapter-codex.test.js`

**Interfaces:**
- Consumes: `str`, `projectOf` (Task 9)
- Produces: adapter module `codex` with the Task 9 adapter contract; `hookReply('stop') === '{}'`

- [ ] **Step 1: Write the failing tests**

`tests/adapter-codex.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import * as codex from '../src/adapters/codex.js';
import { ADAPTERS } from '../src/adapters/index.js';

const home = join('/', 'home', 'u');
const base = { session_id: 'thr-1', cwd: '/w/proj', transcript_path: null, hook_event_name: 'X', model: 'gpt' };

test('UserPromptSubmit → turn_start with the prompt', () => {
  assert.deepEqual(codex.translate('start', { ...base, turn_id: 't1', prompt: 'refatora o parser' }, home), {
    type: 'turn_start', agent: 'codex', session_id: 'thr-1', session_name: '', project: 'proj', text: 'refatora o parser',
  });
});

test('Stop → task_done', () => {
  assert.equal(codex.translate('stop', { ...base, last_assistant_message: 'done' }, home).type, 'task_done');
});

test('PermissionRequest → needs_input phrased so the core translates it', () => {
  assert.equal(codex.translate('permission', { ...base, tool_name: 'Bash' }, home).text, 'needs your permission to use Bash');
  assert.equal(codex.translate('permission', base, home).text, 'needs your permission');
  assert.equal(codex.translate('permission', base, home).type, 'needs_input');
});

test('unknown subcommand and garbage payloads', () => {
  assert.equal(codex.translate('nope', base, home), null);
  assert.equal(codex.translate('start', null, home).session_id, '');
});

test('Stop gets a JSON reply; others get nothing', () => {
  assert.equal(codex.hookReply('stop'), '{}');
  assert.equal(codex.hookReply('start'), '');
  assert.equal(codex.hookReply('permission'), '');
});

test('config file follows CODEX_HOME', () => {
  assert.equal(codex.configFile({}, home), join(home, '.codex', 'hooks.json'));
  assert.equal(codex.configFile({ CODEX_HOME: join('/', 'c') }, home), join('/', 'c', 'hooks.json'));
});

test('hooks and the trust note', () => {
  assert.deepEqual(codex.hooks.map((h) => `${h.event}:${h.sub}`), ['UserPromptSubmit:start', 'Stop:stop', 'PermissionRequest:permission']);
  assert.match(codex.notes.join(' '), /\/hooks/);
  assert.equal(ADAPTERS.codex, codex);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/adapters/codex.js'`.

- [ ] **Step 3: Implement**

`src/adapters/codex.js`:

```js
// Translates Codex CLI hook payloads into canonical events. Codex hooks share
// Claude Code's shape; the differences are the event names, no ai-title in the
// transcript (Codex calls its format unstable), and Stop wanting JSON back.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { str, projectOf } from './common.js';

export const name = 'codex';

export const hooks = [
  { event: 'UserPromptSubmit', sub: 'start', timeout: 5 },
  { event: 'Stop', sub: 'stop', async: true, timeout: 20 },
  { event: 'PermissionRequest', sub: 'permission', async: true, timeout: 20 },
];

export const notes = ['Codex skips hooks it has not trusted yet: open Codex and run /hooks to review and trust them.'];

export function configFile(env = process.env, home = homedir()) {
  return join(env.CODEX_HOME || join(home, '.codex'), 'hooks.json');
}

export const detect = (env = process.env, home = homedir()) => existsSync(dirname(configFile(env, home)));

// Codex treats non-JSON stdout from a Stop hook as invalid.
export const hookReply = (sub) => (sub === 'stop' ? '{}' : '');

// Worded like Claude Code's notice so the core's translation applies:
// "..., para usar o Bash."
const permissionText = (p) => (str(p.tool_name) ? `needs your permission to use ${str(p.tool_name)}` : 'needs your permission');

const MAPPING = {
  start: ['turn_start', (p) => str(p.prompt)],
  stop: ['task_done', () => ''],
  permission: ['needs_input', permissionText],
};

export function translate(sub, payload, home = homedir()) {
  if (!Object.hasOwn(MAPPING, sub)) return null;
  const p = payload && typeof payload === 'object' ? payload : {};
  const [type, text] = MAPPING[sub];
  return { type, agent: name, session_id: str(p.session_id), session_name: '', project: projectOf(p.cwd, home), text: text(p) };
}
```

`src/adapters/index.js`:

```js
import * as claudeCode from './claude-code.js';
import * as codex from './codex.js';

export const ADAPTERS = { 'claude-code': claudeCode, codex };
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex.js src/adapters/index.js tests/adapter-codex.test.js
git commit -m "feat(node): Codex CLI adapter (UserPromptSubmit, Stop, PermissionRequest)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Hook merging for agent config files

**Files:**
- Create: `src/adapters/hooks-json.js`
- Test: `tests/hooks-json.test.js`

**Interfaces:**
- Produces: `hookCommand(env): string` (`AV_HOOK_COMMAND` or `'agent-voice'`), `isOurs(command, agent): boolean`, `isLegacy(command): boolean`, `removeHooks(settings, agent, file?): { settings, removed }`, `mergeHooks(settings, agent, defs, command, file?): settings`, `hookStatus(settings, agent, defs, file?): 'connected' | 'not connected' | 'partially connected' | 'legacy'`, `connectFile(file, agent, defs, { command, now? }): { changed, backup }`, `disconnectFile(file, agent, { now? }): { changed, backup }`, `fileStatus(file, agent, defs): string`
- Hook entry written: `{ type: 'command', command: '<command> notify <agent> <sub>', async?: true, timeout }` in its own group `{ hooks: [entry] }`

- [ ] **Step 1: Write the failing tests**

`tests/hooks-json.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as h from '../src/adapters/hooks-json.js';
import { hooks as ccHooks } from '../src/adapters/claude-code.js';

const tmpFile = (content) => {
  const dir = mkdtempSync(join(tmpdir(), 'av-hooks-'));
  const file = join(dir, 'settings.json');
  if (content !== undefined) writeFileSync(file, content);
  return { dir, file };
};
const foreign = { type: 'command', command: 'notify-send done' };
const at = new Date(2026, 8, 25, 10, 0, 0);

test('isOurs recognises new and legacy commands, and nothing else', () => {
  assert.equal(h.isOurs('agent-voice notify claude-code stop', 'claude-code'), true);
  assert.equal(h.isOurs('node /x/agent-voice/bin/agent-voice.js notify claude-code stop', 'claude-code'), true);
  assert.equal(h.isOurs('/home/u/softwares/agent-voice/bin/notify claude-code stop', 'claude-code'), true);
  assert.equal(h.isOurs('agent-voice notify codex stop', 'claude-code'), false);
  assert.equal(h.isOurs('notify-send done', 'claude-code'), false);
  assert.equal(h.isOurs(undefined, 'claude-code'), false);
  assert.equal(h.isLegacy('/home/u/softwares/agent-voice/bin/notify claude-code stop'), true);
  assert.equal(h.isLegacy('agent-voice notify claude-code stop'), false);
});

test('missing file is created with our hooks', () => {
  const { file } = tmpFile();
  const r = h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  assert.deepEqual(r, { changed: true, backup: null });
  const s = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(s.hooks.Stop, [{ hooks: [{ type: 'command', command: 'agent-voice notify claude-code stop', async: true, timeout: 20 }] }]);
  assert.deepEqual(s.hooks.UserPromptSubmit, [{ hooks: [{ type: 'command', command: 'agent-voice notify claude-code start', timeout: 5 }] }]);
  assert.equal(h.hookStatus(s, 'claude-code', ccHooks), 'connected');
});

test('connect is idempotent: the second run changes nothing', () => {
  const { file } = tmpFile(JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [foreign] }] } }));
  h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  const first = readFileSync(file, 'utf8');
  const r = h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  assert.equal(r.changed, false);
  assert.equal(readFileSync(file, 'utf8'), first);
});

test('foreign hooks and other settings are preserved, and a backup is made', () => {
  const { dir, file } = tmpFile(JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [foreign] }] } }));
  const r = h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  const s = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.hooks.Stop[0], { hooks: [foreign] });
  assert.equal(s.hooks.Stop.length, 2);
  assert.equal(r.backup, `${file}.bak-20260925-100000`);
  assert.ok(existsSync(r.backup));
  assert.deepEqual(readdirSync(dir).sort(), ['settings.json', 'settings.json.bak-20260925-100000']);
});

test('legacy bash hooks are replaced, not doubled', () => {
  const legacy = { type: 'command', command: '/home/u/softwares/agent-voice/bin/notify claude-code stop', async: true, timeout: 20 };
  const { file } = tmpFile(JSON.stringify({ hooks: { Stop: [{ hooks: [legacy] }] } }));
  assert.equal(h.fileStatus(file, 'claude-code', ccHooks), 'legacy');
  h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  const s = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(s.hooks.Stop.length, 1);
  assert.equal(s.hooks.Stop[0].hooks[0].command, 'agent-voice notify claude-code stop');
});

test('a group mixing ours and foreign keeps the foreign one', () => {
  const mixed = { hooks: { Stop: [{ matcher: '', hooks: [foreign, { type: 'command', command: 'agent-voice notify claude-code stop' }] }] } };
  const { settings, removed } = h.removeHooks(mixed, 'claude-code');
  assert.equal(removed, 1);
  assert.deepEqual(settings.hooks.Stop, [{ matcher: '', hooks: [foreign] }]);
});

test('disconnect removes only ours and drops empty events', () => {
  const { file } = tmpFile(JSON.stringify({ hooks: { Stop: [{ hooks: [foreign] }] } }));
  h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  h.disconnectFile(file, 'claude-code', { now: at });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { hooks: { Stop: [{ hooks: [foreign] }] } });
});

test('disconnect on a file without our hooks does not rewrite it', () => {
  const original = '{"model":    "opus"}';
  const { file } = tmpFile(original);
  assert.deepEqual(h.disconnectFile(file, 'claude-code', { now: at }), { changed: false, backup: null });
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('disconnect with no hooks left removes the hooks key entirely', () => {
  const { file } = tmpFile();
  h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  h.disconnectFile(file, 'claude-code', { now: at });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {});
});

test('invalid JSON aborts and writes nothing', () => {
  const { dir, file } = tmpFile('{ "hooks": ');
  assert.throws(() => h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice' }), /invalid JSON.*nothing was written/);
  assert.equal(readFileSync(file, 'utf8'), '{ "hooks": ');
  assert.deepEqual(readdirSync(dir), ['settings.json']);
});

test('unexpected hooks shapes abort and write nothing', () => {
  for (const bad of ['{"hooks": []}', '{"hooks": {"Stop": {}}}', '[]', '"x"']) {
    const { file } = tmpFile(bad);
    assert.throws(() => h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice' }), /nothing was written/, bad);
    assert.equal(readFileSync(file, 'utf8'), bad);
  }
});

test('an empty file is treated as empty settings', () => {
  const { file } = tmpFile('');
  h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  assert.equal(h.fileStatus(file, 'claude-code', ccHooks), 'connected');
});

test('status: partial and not connected', () => {
  const partial = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'agent-voice notify claude-code stop' }] }] } };
  assert.equal(h.hookStatus(partial, 'claude-code', ccHooks), 'partially connected');
  assert.equal(h.hookStatus({}, 'claude-code', ccHooks), 'not connected');
  const { file } = tmpFile('{ broken');
  assert.match(h.fileStatus(file, 'claude-code', ccHooks), /^unreadable/);
});

test('hookCommand honours AV_HOOK_COMMAND', () => {
  assert.equal(h.hookCommand({}), 'agent-voice');
  assert.equal(h.hookCommand({ AV_HOOK_COMMAND: 'node /x/bin/agent-voice.js' }), 'node /x/bin/agent-voice.js');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/adapters/hooks-json.js'`.

- [ ] **Step 3: Implement**

`src/adapters/hooks-json.js`:

```js
// Merges agent-voice's hooks into an agent's JSON config (Claude Code's
// settings.json, Codex's hooks.json — same shape). Rules: never touch foreign
// hooks, never duplicate ours, back up before writing, and on anything
// unexpected abort without writing a byte.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const hookCommand = (env = process.env) => env.AV_HOOK_COMMAND || 'agent-voice';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const isLegacy = (command) => typeof command === 'string' && /bin[\\/]notify"?\s/.test(command);

export function isOurs(command, agent) {
  if (typeof command !== 'string') return false;
  if (!new RegExp(`\\bnotify"?\\s+${escapeRe(agent)}(\\s|$)`).test(command)) return false;
  return /agent-voice/.test(command) || isLegacy(command);
}

function eventsOf(settings, file = 'settings') {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`${file}: expected a JSON object — nothing was written`);
  }
  if (settings.hooks === undefined) return {};
  const { hooks } = settings;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    throw new Error(`${file}: "hooks" is not an object — nothing was written`);
  }
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw new Error(`${file}: hooks.${event} is not a list — nothing was written`);
  }
  return hooks;
}

export function removeHooks(settings, agent, file) {
  const hooks = eventsOf(settings, file);
  const next = {};
  let removed = 0;
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = [];
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) { kept.push(group); continue; }
      const ours = group.hooks.filter((x) => isOurs(x?.command, agent));
      if (ours.length === 0) { kept.push(group); continue; }
      removed += ours.length;
      const rest = group.hooks.filter((x) => !isOurs(x?.command, agent));
      if (rest.length) kept.push({ ...group, hooks: rest });
    }
    if (kept.length || groups.length === 0) next[event] = kept;
  }
  if (removed === 0) return { settings, removed };
  const out = { ...settings };
  if (Object.keys(next).length) out.hooks = next;
  else delete out.hooks;
  return { settings: out, removed };
}

export function mergeHooks(settings, agent, defs, command, file) {
  const { settings: base } = removeHooks(settings, agent, file);
  const hooks = { ...(base.hooks ?? {}) };
  for (const d of defs) {
    const entry = { type: 'command', command: `${command} notify ${agent} ${d.sub}`, ...(d.async ? { async: true } : {}), timeout: d.timeout };
    hooks[d.event] = [...(hooks[d.event] ?? []), { hooks: [entry] }];
  }
  return { ...base, hooks };
}

export function hookStatus(settings, agent, defs, file) {
  const hooks = eventsOf(settings, file);
  const ours = Object.values(hooks).flat()
    .flatMap((g) => (g && Array.isArray(g.hooks) ? g.hooks : []))
    .filter((x) => isOurs(x?.command, agent));
  if (ours.some((x) => isLegacy(x.command))) return 'legacy';
  const has = (d) => ((hooks[d.event] ?? [])
    .some((g) => g && Array.isArray(g.hooks) && g.hooks.some((x) => isOurs(x?.command, agent) && x.command.trimEnd().endsWith(` ${agent} ${d.sub}`))));
  const n = defs.filter(has).length;
  if (n === defs.length) return 'connected';
  return n === 0 ? 'not connected' : 'partially connected';
}

function readSettings(file) {
  if (!existsSync(file)) return { settings: {}, existed: false };
  const raw = readFileSync(file, 'utf8');
  if (raw.trim() === '') return { settings: {}, existed: true };
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file}: invalid JSON (${e.message}) — nothing was written`);
  }
  eventsOf(settings, file);
  return { settings, existed: true };
}

const pad2 = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;

function writeSettings(file, existed, before, next, now) {
  if (JSON.stringify(before) === JSON.stringify(next)) return { changed: false, backup: null };
  mkdirSync(dirname(file), { recursive: true });
  let backup = null;
  if (existed) {
    backup = `${file}.bak-${stamp(now)}`;
    copyFileSync(file, backup);
  }
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return { changed: true, backup };
}

export function connectFile(file, agent, defs, { command, now = new Date() } = {}) {
  const { settings, existed } = readSettings(file);
  return writeSettings(file, existed, settings, mergeHooks(settings, agent, defs, command, file), now);
}

export function disconnectFile(file, agent, { now = new Date() } = {}) {
  if (!existsSync(file)) return { changed: false, backup: null };
  const { settings, existed } = readSettings(file);
  return writeSettings(file, existed, settings, removeHooks(settings, agent, file).settings, now);
}

export function fileStatus(file, agent, defs) {
  try {
    return hookStatus(readSettings(file).settings, agent, defs, file);
  } catch (e) {
    return `unreadable (${e.message})`;
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/hooks-json.js tests/hooks-json.test.js
git commit -m "feat(node): idempotent hook merging with backups for agent config files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `notify` entry point and the `agent-voice` executable

**Files:**
- Create: `src/cli/notify.js`, `src/cli/main.js`, `src/cli/prompt.js`, `bin/agent-voice.js`
- Test: `tests/notify.test.js`, `tests/main.test.js`

**Interfaces:**
- Consumes: `ADAPTERS` (Tasks 9–10), `createContext` (Task 8), `handle` (Task 8), `log` (Task 1), `stateDir` (Task 1)
- Produces: `readStdin(stream?, timeoutMs?): Promise<string>`, `runNotify(args, { input, env, write }): Promise<0>`
- Produces: `main(argv, io): Promise<number>` with `io = { env, out(s), err(s), prompt? }`; a `COMMANDS` map inside `main.js` that later tasks extend; each command is `async (args, io) => exitCode`
- Produces: `createPrompter({ input?, output? })` → `{ ask(q, def), confirm(q, def), choose(q, options, def), close() }`

- [ ] **Step 1: Write the failing tests**

`tests/notify.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { sandbox, ROOT, RECORDER } from './helpers.js';
import { writeOutputInstance, saveConfig } from '../src/config.js';
import { createState } from '../src/core/state.js';
import { readStdin, runNotify } from '../src/cli/notify.js';

const BIN = join(ROOT, 'bin', 'agent-voice.js');
const notify = (sb, args, input, extraEnv = {}) =>
  spawnSync(process.execPath, [BIN, 'notify', ...args], { input, env: { ...sb.env, ...extraEnv }, encoding: 'utf8' });
const logOf = (sb) => readFileSync(join(sb.env.AV_STATE_DIR, 'events.log'), 'utf8');
const recorderOutput = (sb) => {
  writeOutputInstance('rec', { type: 'command', argv: [process.execPath, RECORDER, sb.spoken, '{text}'] }, sb.env);
  saveConfig({ outputs: ['rec'] }, sb.env);
};
const backdate = (sb, agent, session, s) =>
  writeFileSync(`${createState(sb.env.AV_STATE_DIR).path(agent, session)}.start`, String(Math.floor(Date.now() / 1000) - s));

test('end to end: a long Claude Code turn is spoken through a real output', () => {
  const sb = sandbox();
  recorderOutput(sb);
  assert.equal(notify(sb, ['claude-code', 'start'], JSON.stringify({ session_id: 'e1', cwd: '/a/proj', prompt: 'tarefa longa' })).status, 0);
  backdate(sb, 'claude-code', 'e1', 240);
  const r = notify(sb, ['claude-code', 'stop'], JSON.stringify({ session_id: 'e1', cwd: '/a/proj' }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(sb.spokenLines().at(-1), /^Claude Code terminou .*tarefa longa\.$/);
  assert.match(logOf(sb), /spoke via rec: Claude Code terminou/);
});

test('codex Stop prints {} for Codex and still exits 0', () => {
  const sb = sandbox();
  const r = notify(sb, ['codex', 'stop'], JSON.stringify({ session_id: 'x', cwd: '/a' }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{}');
});

test('unknown agent, garbage, no arguments: all exit 0 and log', () => {
  const sb = sandbox();
  assert.equal(notify(sb, ['nao-existe', 'start'], '{}').status, 0);
  assert.equal(notify(sb, ['claude-code', 'start'], 'lixo').status, 0);
  assert.equal(notify(sb, [], '').status, 0);
  const text = logOf(sb);
  assert.match(text, /no adapter for nao-existe/);
  assert.match(text, /ignored: incomplete event/);
  assert.match(text, /ignored: usage is notify <agent> <subcommand>/);
});

test('a failing output exits 0 and its reason reaches the log', () => {
  const sb = sandbox();
  recorderOutput(sb);
  notify(sb, ['claude-code', 'notification'], JSON.stringify({ session_id: 'f2', cwd: '/a', message: 'x' }), { STUB_FAIL: 'token missing' });
  assert.match(logOf(sb), /FAILED via rec \(token missing\)/);
});

test('an enabled output with no instance logs no such output', () => {
  const sb = sandbox();
  saveConfig({ outputs: ['ghost'] }, sb.env);
  notify(sb, ['claude-code', 'notification'], JSON.stringify({ session_id: 'g', cwd: '/a' }));
  assert.match(logOf(sb), /no such output: ghost/);
});

test('a corrupt config.json still exits 0 and logs why', () => {
  const sb = sandbox();
  mkdirSync(sb.env.AV_CONFIG_DIR, { recursive: true });
  writeFileSync(join(sb.env.AV_CONFIG_DIR, 'config.json'), '{ nope');
  const r = notify(sb, ['claude-code', 'start'], JSON.stringify({ session_id: 'c', cwd: '/a', prompt: 'x' }));
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.match(logOf(sb), /error: .*config\.json: invalid JSON/);
});

test('readStdin gives up on a stream that never ends', async () => {
  const stream = new PassThrough();
  stream.write('{"partial":');
  const started = Date.now();
  assert.equal(await readStdin(stream, 100), '{"partial":');
  assert.ok(Date.now() - started < 1000);
});

test('readStdin returns empty for a TTY', async () => {
  assert.equal(await readStdin({ isTTY: true }), '');
});

test('runNotify swallows everything, even a throwing writer', async () => {
  const sb = sandbox();
  const code = await runNotify(['codex', 'stop'], { input: '{}', env: sb.env, write: () => { throw new Error('EPIPE'); } });
  assert.equal(code, 0);
  assert.match(logOf(sb), /error: EPIPE/);
});
```

`tests/main.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { sandbox, ROOT, collector } from './helpers.js';
import { main } from '../src/cli/main.js';

test('help is printed with no command', async () => {
  const c = collector();
  assert.equal(await main([], { env: sandbox().env, out: c.out, err: c.out }), 0);
  assert.match(c.text(), /agent-voice setup/);
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/cli/notify.js'`.

- [ ] **Step 3: Implement**

`src/cli/notify.js`:

```js
// The hook entry point. Exits 0 in every scenario, on purpose: a hook that
// hangs or fails is worse than one that does not exist. The log is the only
// place a failure is reported.
import { ADAPTERS } from '../adapters/index.js';
import { createContext } from '../core/context.js';
import { handle } from '../core/handle.js';
import { log } from '../core/log.js';
import { stateDir } from '../platform.js';

// Bounded: an agent that leaves stdin open without writing must not hang us.
export function readStdin(stream = process.stdin, timeoutMs = 3000) {
  if (stream.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream.removeAllListeners?.('data');
      stream.destroy?.();
      resolve(data);
    };
    const timer = setTimeout(finish, timeoutMs);
    stream.setEncoding?.('utf8');
    stream.on('data', (chunk) => { data += chunk; });
    stream.on('end', finish);
    stream.on('error', finish);
  });
}

export async function runNotify(args, { input = '', env = process.env, write = (s) => process.stdout.write(s) } = {}) {
  const [agent = '', sub = ''] = args;
  const fallbackLog = (a, s, m) => log(stateDir(env), a, s, m);
  try {
    if (!agent || !sub) {
      fallbackLog(agent || '?', '-', 'ignored: usage is notify <agent> <subcommand>');
      return 0;
    }
    const adapter = Object.hasOwn(ADAPTERS, agent) ? ADAPTERS[agent] : null;
    if (!adapter) {
      fallbackLog(agent, '-', `no adapter for ${agent}`);
      return 0;
    }
    const reply = adapter.hookReply(sub);
    if (reply) write(reply);
    let payload = {};
    try { payload = JSON.parse(input); } catch { /* garbage in: the core logs the incomplete event */ }
    const event = adapter.translate(sub, payload);
    if (!event) return 0;
    await handle(event, createContext(env));
  } catch (e) {
    fallbackLog(agent || '?', '-', `error: ${String(e?.message ?? e).split(/\r?\n/)[0].slice(0, 200)}`);
  }
  return 0;
}
```

`src/cli/prompt.js`:

```js
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
```

`src/cli/main.js`:

```js
import { runNotify, readStdin } from './notify.js';
import { createPrompter } from './prompt.js';

const HELP = `Usage: agent-voice <command>

  setup                             guided setup: connect agents, add a speaker, test it
  connect <claude-code|codex>       add agent-voice's hooks to the agent (asks first; --yes skips)
  disconnect <claude-code|codex>    remove agent-voice's hooks from the agent
  output add <alexa|local|command> [name]
  output list | remove <name> | enable <name> | disable <name> | test [name]
  wrap [--name <label>] -- <command> [args...]
                                    announce when any command finishes
  status                            agents, outputs, settings and the latest log lines
  config get [key] | set <key> <value>
                                    keys: minSeconds, cooldownSeconds, maxSpeechChars
  test                              speak a test sentence on every active output
  notify <agent> <subcommand>       hook entry point (called by your agent, not by you)`;

export function defaultIO(env = process.env) {
  return {
    env,
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    prompt: null,
  };
}

// Each later task registers its command here: name → async (args, io) => exit code.
const COMMANDS = {};

export async function main(argv, io = defaultIO()) {
  const [cmd, ...rest] = argv;
  if (cmd === 'notify') return runNotify(rest, { input: await readStdin(), env: io.env });
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    io.out(HELP);
    return 0;
  }
  const run = Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : null;
  if (!run) {
    io.err(`agent-voice: unknown command "${cmd}". Run "agent-voice help".`);
    return 1;
  }
  let prompter = null;
  const withPrompt = { ...io, get prompt() { return io.prompt ?? (prompter ??= createPrompter()); } };
  try {
    return await run(rest, withPrompt);
  } catch (e) {
    io.err(`agent-voice: ${e.message}`);
    return 1;
  } finally {
    prompter?.close();
  }
}
```

`bin/agent-voice.js`:

```js
#!/usr/bin/env node
import { main } from '../src/cli/main.js';

process.exitCode = await main(process.argv.slice(2));
```

Then mark it executable in git (needed for npm's Unix launchers and for running from a clone):

```bash
chmod +x bin/agent-voice.js
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/ bin/agent-voice.js tests/notify.test.js tests/main.test.js
git update-index --chmod=+x bin/agent-voice.js
git commit -m "feat(node): notify hook entry point and the agent-voice executable

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: `wrap`

**Files:**
- Create: `src/cli/wrap.js`
- Modify: `src/cli/main.js` (register `wrap`)
- Test: `tests/wrap.test.js`

**Interfaces:**
- Consumes: `createContext`, `handle` (Task 8), `projectOf` (Task 9)
- Produces: `parseWrapArgs(args): { name, command: string[] }`, `runWrap(args, { env?, spawn?, cwd?, pid?, notify? }): Promise<number>` — `notify(event)` defaults to running the event through the core

- [ ] **Step 1: Write the failing tests**

`tests/wrap.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, ROOT } from './helpers.js';
import { parseWrapArgs, runWrap } from '../src/cli/wrap.js';

const recorder = () => {
  const events = [];
  return { events, notify: async (e) => { events.push(e); } };
};

test('argument parsing', () => {
  assert.deepEqual(parseWrapArgs(['--', 'npm', 'test']), { name: '', command: ['npm', 'test'] });
  assert.deepEqual(parseWrapArgs(['--name', 'build', '--', 'make']), { name: 'build', command: ['make'] });
  assert.throws(() => parseWrapArgs(['npm', 'test']), /unknown option npm/);
  assert.throws(() => parseWrapArgs(['--']), /usage/);
  assert.throws(() => parseWrapArgs([]), /usage/);
});

test('emits turn_start then task_done and returns the child exit code', async () => {
  const r = recorder();
  const code = await runWrap(['--', process.execPath, '-e', 'process.exit(3)'], { notify: r.notify, pid: 42, cwd: join('/', 'w', 'proj') });
  assert.equal(code, 3);
  assert.deepEqual(r.events.map((e) => e.type), ['turn_start', 'task_done']);
  assert.equal(r.events[0].session_id, 'wrap-42');
  assert.equal(r.events[0].agent, 'wrap');
  assert.equal(r.events[0].project, 'proj');
  assert.match(r.events[0].text, /process\.exit\(3\)/);
});

test('--name becomes the spoken session name', async () => {
  const r = recorder();
  await runWrap(['--name', 'o build', '--', process.execPath, '-e', ''], { notify: r.notify });
  assert.equal(r.events[0].session_name, 'o build');
});

test('a missing command returns 127 and still closes the turn', async () => {
  const r = recorder();
  const code = await runWrap(['--', 'definitely-not-a-command-av'], { notify: r.notify });
  assert.equal(code, 127);
  assert.deepEqual(r.events.map((e) => e.type), ['turn_start', 'task_done']);
});

test('through the executable: exit code passes through and the short turn is logged silent', () => {
  const sb = sandbox();
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'agent-voice.js'), 'wrap', '--', process.execPath, '-e', 'process.exit(5)'],
    { env: sb.env, encoding: 'utf8' });
  assert.equal(r.status, 5);
  const log = readFileSync(join(sb.env.AV_STATE_DIR, 'events.log'), 'utf8');
  assert.match(log, /wrap\s+wrap-\d+/);
  assert.match(log, /silent \(turn 0s < 30s\)/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/cli/wrap.js'`.

- [ ] **Step 3: Implement**

`src/cli/wrap.js`:

```js
// For agents with no hooks: run the command, marking the turn's start and end.
// The core applies the usual rules, so a short command stays silent.
import { spawn as nodeSpawn } from 'node:child_process';
import { constants } from 'node:os';
import { createContext } from '../core/context.js';
import { handle } from '../core/handle.js';
import { projectOf } from '../adapters/common.js';

const USAGE = 'usage: agent-voice wrap [--name <label>] -- <command> [args...]';

export function parseWrapArgs(args) {
  let name = '';
  let i = 0;
  while (i < args.length && args[i] !== '--') {
    if (args[i] === '--name') {
      name = args[i + 1] ?? '';
      i += 2;
      continue;
    }
    throw new Error(`wrap: unknown option ${args[i]} (${USAGE})`);
  }
  const command = args.slice(i + 1);
  if (i >= args.length || command.length === 0) throw new Error(USAGE);
  return { name, command };
}

export async function runWrap(args, { env = process.env, spawn = nodeSpawn, cwd = process.cwd(), pid = process.pid, notify } = {}) {
  const { name, command } = parseWrapArgs(args);
  const emit = notify ?? (async (event) => {
    try { await handle(event, createContext(env)); } catch { /* announcing must never break the wrapped command */ }
  });
  const base = { agent: 'wrap', session_id: `wrap-${pid}`, session_name: name, project: projectOf(cwd) };

  await emit({ ...base, type: 'turn_start', text: command.join(' ') });

  const code = await new Promise((resolve) => {
    let child;
    let settled = false;
    // Ctrl+C already reaches the child through the terminal; the parent just
    // must not die first. SIGTERM is forwarded.
    const onInt = () => {};
    const onTerm = () => { try { child?.kill('SIGTERM'); } catch { /* already gone */ } };
    const finish = (c) => {
      if (settled) return;
      settled = true;
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      resolve(c);
    };
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    try {
      child = spawn(command[0], command.slice(1), { stdio: 'inherit', shell: process.platform === 'win32', env });
    } catch (e) {
      process.stderr.write(`agent-voice wrap: ${e.message}\n`);
      finish(127);
      return;
    }
    child.on('error', (e) => {
      process.stderr.write(`agent-voice wrap: ${e.code === 'ENOENT' ? `command not found: ${command[0]}` : e.message}\n`);
      finish(127);
    });
    child.on('exit', (c, signal) => finish(c ?? 128 + (constants.signals[signal] ?? 0)));
  });

  await emit({ ...base, type: 'task_done', text: '' });
  return code;
}
```

In `src/cli/main.js`, import and register:

```js
import { runWrap } from './wrap.js';
```

```js
const COMMANDS = {
  wrap: (args, io) => runWrap(args, { env: io.env }),
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS. (On Windows the "missing command" case goes through `shell: true`; cmd.exe returns exit 1 rather than raising ENOENT. If the Windows CI job fails only on that test, change the assertion to `assert.ok(code !== 0)` and keep the event assertion — the behaviour that matters is that the turn is still closed.)

- [ ] **Step 5: Commit**

```bash
git add src/cli/wrap.js src/cli/main.js tests/wrap.test.js
git commit -m "feat(node): wrap any command to announce when it finishes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: `output`, `config` and `test` commands

**Files:**
- Create: `src/cli/output.js`, `src/cli/config.js`
- Modify: `src/cli/main.js` (register `output`, `config`, `test`)
- Test: `tests/cli-output.test.js`, `tests/cli-config.test.js`

**Interfaces:**
- Consumes: `OUTPUT_TYPES` (Tasks 5–7), config functions (Task 4), `TEST_SENTENCE` (Task 2)
- Produces: `enableOutput(name, env)`, `disableOutput(name, env)`, `nextFreeName(type, env)`, `addOutput(type, name, io): Promise<string>`, `testOutput(name, io): Promise<boolean>`, `runOutput(args, io): Promise<number>`, `runConfig(args, io): number`
- `io` for these: `{ env, out, prompt, deps? }` — `deps` is passed through to output modules (tests inject fakes)

- [ ] **Step 1: Write the failing tests**

`tests/cli-output.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, RECORDER, scriptedPrompter, collector } from './helpers.js';
import { runOutput, addOutput, testOutput, nextFreeName } from '../src/cli/output.js';
import { readStoredConfig, readOutputInstance, writeOutputInstance } from '../src/config.js';
import { TEST_SENTENCE } from '../src/core/phrases.js';

const recorderLine = (sb) => `"${process.execPath}" "${RECORDER}" "${sb.spoken}" {text}`;

test('output add command: asks, saves, enables, then speaks the test sentence', async () => {
  const sb = sandbox();
  const c = collector();
  const io = { env: sb.env, out: c.out, prompt: scriptedPrompter([recorderLine(sb)]) };
  assert.equal(await runOutput(['add', 'command'], io), 0);
  assert.deepEqual(readStoredConfig(sb.env).outputs, ['command']);
  assert.equal(readOutputInstance('command', sb.env).argv[1], RECORDER);
  assert.deepEqual(sb.spokenLines(), [TEST_SENTENCE]);
  assert.match(c.text(), /ok\s+command/);
});

test('a second instance of the same type gets a free name', async () => {
  const sb = sandbox();
  writeOutputInstance('command', { type: 'command', argv: ['x'] }, sb.env);
  assert.equal(nextFreeName('command', sb.env), 'command-2');
});

test('adding over an instance of another type is refused', async () => {
  const sb = sandbox();
  writeOutputInstance('sala', { type: 'alexa', url: 'u', token: 't', entity: 'e' }, sb.env);
  await assert.rejects(addOutput('command', 'sala', { env: sb.env, out: () => {}, prompt: scriptedPrompter([]) }), /already exists with type alexa/);
});

test('unknown type lists the available ones', async () => {
  const sb = sandbox();
  await assert.rejects(runOutput(['add', 'pigeon'], { env: sb.env, out: () => {}, prompt: scriptedPrompter([]) }), /available: alexa, local, command/);
});

test('list marks enabled outputs; disable/enable/remove update config', async () => {
  const sb = sandbox();
  const c = collector();
  const io = { env: sb.env, out: c.out, prompt: scriptedPrompter([recorderLine(sb)]) };
  await runOutput(['add', 'command', 'rec'], io);
  await runOutput(['list'], io);
  assert.match(c.text(), /\* rec\s+command/);
  await runOutput(['disable', 'rec'], io);
  assert.deepEqual(readStoredConfig(sb.env).outputs, []);
  await runOutput(['enable', 'rec'], io);
  assert.deepEqual(readStoredConfig(sb.env).outputs, ['rec']);
  await runOutput(['remove', 'rec'], io);
  assert.equal(readOutputInstance('rec', sb.env), null);
  assert.deepEqual(readStoredConfig(sb.env).outputs, []);
});

test('enable of an unknown output is refused', async () => {
  const sb = sandbox();
  await assert.rejects(runOutput(['enable', 'ghost'], { env: sb.env, out: () => {} }), /no output named "ghost"/);
});

test('list with nothing configured explains how to add one', async () => {
  const sb = sandbox();
  const c = collector();
  await runOutput(['list'], { env: sb.env, out: c.out });
  assert.match(c.text(), /agent-voice output add/);
});

test('test reports failures with the reason and exits 1', async () => {
  const sb = sandbox();
  const c = collector();
  writeOutputInstance('bad', { type: 'command', argv: ['definitely-not-a-command-av'] }, sb.env);
  assert.equal(await testOutput('bad', { env: sb.env, out: c.out }), false);
  assert.match(c.text(), /FAIL\s+bad: command not found/);
});

test('output test with nothing active is an error', async () => {
  const sb = sandbox();
  await assert.rejects(runOutput(['test'], { env: sb.env, out: () => {} }), /no active outputs/);
});
```

`tests/cli-config.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/cli/output.js'`.

- [ ] **Step 3: Implement**

`src/cli/output.js`:

```js
import { OUTPUT_TYPES } from '../outputs/index.js';
import {
  loadConfig, readStoredConfig, saveConfig, readOutputInstance, writeOutputInstance,
  removeOutputInstance, listOutputInstances, isValidOutputName,
} from '../config.js';
import { TEST_SENTENCE } from '../core/phrases.js';

const USAGE = 'usage: agent-voice output add <alexa|local|command> [name] | list | remove <name> | enable <name> | disable <name> | test [name]';

const storedOutputs = (env) => {
  const list = readStoredConfig(env).outputs;
  return Array.isArray(list) ? list : [];
};

export function enableOutput(name, env) {
  if (!readOutputInstance(name, env)) throw new Error(`no output named "${name}"`);
  const list = storedOutputs(env);
  if (!list.includes(name)) saveConfig({ outputs: [...list, name] }, env);
}

export function disableOutput(name, env) {
  saveConfig({ outputs: storedOutputs(env).filter((n) => n !== name) }, env);
}

export function nextFreeName(type, env) {
  let name = type;
  for (let i = 2; readOutputInstance(name, env); i++) name = `${type}-${i}`;
  return name;
}

const typeModule = (type) => {
  if (!Object.hasOwn(OUTPUT_TYPES, type ?? '')) {
    throw new Error(`unknown output type "${type}" (available: ${Object.keys(OUTPUT_TYPES).join(', ')})`);
  }
  return OUTPUT_TYPES[type];
};

export async function addOutput(type, name, { env, out, prompt, deps }) {
  const mod = typeModule(type);
  const finalName = name || nextFreeName(type, env);
  if (!isValidOutputName(finalName)) throw new Error(`invalid output name "${finalName}" (use a-z, 0-9 and -)`);
  const current = readOutputInstance(finalName, env) ?? {};
  if (current.type && current.type !== type) throw new Error(`output "${finalName}" already exists with type ${current.type}`);
  const conf = await mod.questions(prompt, current, deps);
  writeOutputInstance(finalName, conf, env);
  enableOutput(finalName, env);
  out(`Saved output "${finalName}" (${mod.describe(conf)}) and enabled it.`);
  return finalName;
}

export async function testOutput(name, { env, out, deps }) {
  const conf = readOutputInstance(name, env);
  if (!conf) throw new Error(`no output named "${name}"`);
  const mod = typeModule(conf.type);
  try {
    await mod.speak(TEST_SENTENCE, conf, deps);
    out(`ok    ${name}`);
    return true;
  } catch (e) {
    out(`FAIL  ${name}: ${e.message}`);
    return false;
  }
}

export async function testActive(io) {
  const names = loadConfig(io.env).outputs;
  if (names.length === 0) throw new Error('no active outputs — add one with: agent-voice output add <alexa|local|command>');
  let ok = true;
  for (const name of names) ok = (await testOutput(name, io)) && ok;
  return ok ? 0 : 1;
}

export async function runOutput(args, io) {
  const [sub, a, b] = args;
  const { env, out } = io;
  switch (sub) {
    case 'add': {
      const name = await addOutput(a, b, io);
      return (await testOutput(name, io)) ? 0 : 1;
    }
    case 'list': {
      const active = loadConfig(env).outputs;
      const all = listOutputInstances(env);
      if (all.length === 0) {
        out('No outputs yet. Add one with: agent-voice output add <alexa|local|command>');
        return 0;
      }
      for (const { name, conf, error } of all) {
        const mark = active.includes(name) ? '*' : ' ';
        const what = conf ? `${String(conf.type).padEnd(8)} ${Object.hasOwn(OUTPUT_TYPES, conf.type) ? OUTPUT_TYPES[conf.type].describe(conf) : '(unknown type)'}` : `broken   ${error}`;
        out(`${mark} ${name.padEnd(16)} ${what}`);
      }
      out('(* = enabled)');
      return 0;
    }
    case 'remove':
      if (!a) throw new Error(USAGE);
      removeOutputInstance(a, env);
      disableOutput(a, env);
      out(`Removed output "${a}".`);
      return 0;
    case 'enable':
      if (!a) throw new Error(USAGE);
      enableOutput(a, env);
      out(`Enabled "${a}".`);
      return 0;
    case 'disable':
      if (!a) throw new Error(USAGE);
      disableOutput(a, env);
      out(`Disabled "${a}".`);
      return 0;
    case 'test':
      return a ? ((await testOutput(a, io)) ? 0 : 1) : testActive(io);
    default:
      throw new Error(USAGE);
  }
}
```

`src/cli/config.js`:

```js
import { loadConfig, saveConfig, NUMERIC_KEYS } from '../config.js';

const USAGE = `usage: agent-voice config get [key] | set <key> <value>   (keys: ${Object.keys(NUMERIC_KEYS).join(', ')})`;

export function runConfig(args, { env, out }) {
  const [sub, key, value] = args;
  if (sub === 'get') {
    const cfg = loadConfig(env);
    if (!key) {
      for (const k of Object.keys(NUMERIC_KEYS)) out(`${k}=${cfg[k]}`);
      out(`outputs=${cfg.outputs.join(' ')}`);
      return 0;
    }
    if (key === 'outputs') out(cfg.outputs.join(' '));
    else if (Object.hasOwn(NUMERIC_KEYS, key)) out(String(cfg[key]));
    else throw new Error(`unknown key "${key}". ${USAGE}`);
    return 0;
  }
  if (sub === 'set') {
    if (!Object.hasOwn(NUMERIC_KEYS, key ?? '')) {
      throw new Error(`unknown key "${key}" (settable: ${Object.keys(NUMERIC_KEYS).join(', ')}; outputs are managed with "agent-voice output enable|disable")`);
    }
    if (!/^[0-9]+$/.test(value ?? '')) {
      throw new Error(`${key} must be a whole number of ${key === 'maxSpeechChars' ? 'characters' : 'seconds'}`);
    }
    saveConfig({ [key]: Number(value) }, env);
    out(`${key}=${value}`);
    const envName = NUMERIC_KEYS[key];
    if (env[envName] !== undefined) out(`Note: ${envName}=${env[envName]} overrides it in this environment.`);
    return 0;
  }
  throw new Error(USAGE);
}
```

In `src/cli/main.js`, import and register:

```js
import { runOutput, testActive } from './output.js';
import { runConfig } from './config.js';
```

```js
const COMMANDS = {
  wrap: (args, io) => runWrap(args, { env: io.env }),
  output: runOutput,
  config: async (args, io) => runConfig(args, io),
  test: async (args, io) => testActive(io),
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/output.js src/cli/config.js src/cli/main.js tests/cli-output.test.js tests/cli-config.test.js
git commit -m "feat(node): output, config and test commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: `connect`, `disconnect` and `status`

**Files:**
- Create: `src/cli/connect.js`, `src/cli/status.js`
- Modify: `src/cli/main.js` (register `connect`, `disconnect`, `status`)
- Test: `tests/cli-connect.test.js`, `tests/cli-status.test.js`

**Interfaces:**
- Consumes: `ADAPTERS` (Tasks 9–10), `connectFile`, `disconnectFile`, `fileStatus`, `hookCommand` (Task 11), `findOnPath` (Task 1), config (Task 4), `OUTPUT_TYPES` (Task 7)
- Produces: `connectAgent(adapter, { env, out, prompt, yes }): Promise<boolean>`, `runConnect(args, io)`, `runDisconnect(args, io)`, `runStatus(args, io)`, `adapterFor(name)`

- [ ] **Step 1: Write the failing tests**

`tests/cli-connect.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, scriptedPrompter, collector } from './helpers.js';
import { runConnect, runDisconnect } from '../src/cli/connect.js';

const settings = (sb) => JSON.parse(readFileSync(join(sb.env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8'));

test('connect shows the hooks, asks, and writes them', async () => {
  const sb = sandbox();
  const c = collector();
  const prompt = scriptedPrompter([true]);
  assert.equal(await runConnect(['claude-code'], { env: sb.env, out: c.out, prompt }), 0);
  assert.match(c.text(), /UserPromptSubmit\s+→ agent-voice notify claude-code start/);
  assert.equal(settings(sb).hooks.Stop[0].hooks[0].command, 'agent-voice notify claude-code stop');
});

test('declining leaves the file untouched', async () => {
  const sb = sandbox();
  const c = collector();
  await runConnect(['claude-code'], { env: sb.env, out: c.out, prompt: scriptedPrompter([false]) });
  assert.match(c.text(), /Nothing changed/);
  assert.throws(() => settings(sb), /ENOENT/);
});

test('--yes skips the question; AV_HOOK_COMMAND is used in the hooks', async () => {
  const sb = sandbox();
  const env = { ...sb.env, AV_HOOK_COMMAND: 'node /x/agent-voice/bin/agent-voice.js' };
  await runConnect(['claude-code', '--yes'], { env, out: () => {}, prompt: scriptedPrompter([]) });
  assert.equal(settings(sb).hooks.Stop[0].hooks[0].command, 'node /x/agent-voice/bin/agent-voice.js notify claude-code stop');
});

test('codex connect writes hooks.json and prints the trust note', async () => {
  const sb = sandbox();
  const c = collector();
  await runConnect(['codex', '--yes'], { env: sb.env, out: c.out, prompt: scriptedPrompter([]) });
  const hooks = JSON.parse(readFileSync(join(sb.env.CODEX_HOME, 'hooks.json'), 'utf8')).hooks;
  assert.equal(hooks.PermissionRequest[0].hooks[0].command, 'agent-voice notify codex permission');
  assert.match(c.text(), /run \/hooks/);
});

test('running connect twice reports already connected', async () => {
  const sb = sandbox();
  const c = collector();
  const io = { env: sb.env, out: c.out, prompt: scriptedPrompter([]) };
  await runConnect(['claude-code', '--yes'], io);
  await runConnect(['claude-code', '--yes'], io);
  assert.match(c.text(), /already connected; nothing changed/);
});

test('a broken settings.json is reported and left alone', async () => {
  const sb = sandbox();
  mkdirSync(sb.env.CLAUDE_CONFIG_DIR, { recursive: true });
  writeFileSync(join(sb.env.CLAUDE_CONFIG_DIR, 'settings.json'), '{ nope');
  await assert.rejects(runConnect(['claude-code', '--yes'], { env: sb.env, out: () => {}, prompt: scriptedPrompter([]) }), /invalid JSON/);
});

test('warns when agent-voice is not on PATH', async () => {
  const sb = sandbox();
  const c = collector();
  await runConnect(['claude-code', '--yes'], { env: { ...sb.env, PATH: '' }, out: c.out, prompt: scriptedPrompter([]) });
  assert.match(c.text(), /not on your PATH/);
});

test('disconnect removes the hooks; unknown agent is an error', async () => {
  const sb = sandbox();
  const io = { env: sb.env, out: () => {}, prompt: scriptedPrompter([]) };
  await runConnect(['claude-code', '--yes'], io);
  await runDisconnect(['claude-code'], io);
  assert.deepEqual(settings(sb), {});
  await assert.rejects(runConnect(['aider'], io), /unknown agent "aider" \(available: claude-code, codex\)/);
});
```

`tests/cli-status.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/cli/connect.js'`.

- [ ] **Step 3: Implement**

`src/cli/connect.js`:

```js
import { ADAPTERS } from '../adapters/index.js';
import { connectFile, disconnectFile, hookCommand } from '../adapters/hooks-json.js';
import { findOnPath } from '../platform.js';

export function adapterFor(name) {
  if (!Object.hasOwn(ADAPTERS, name ?? '')) {
    throw new Error(`unknown agent "${name}" (available: ${Object.keys(ADAPTERS).join(', ')})`);
  }
  return ADAPTERS[name];
}

export async function connectAgent(adapter, { env, out, prompt, yes = false }) {
  const file = adapter.configFile(env);
  const command = hookCommand(env);
  out(`${adapter.name}: these hooks will be added to ${file}`);
  for (const d of adapter.hooks) out(`  ${d.event.padEnd(18)} → ${command} notify ${adapter.name} ${d.sub}`);
  if (!yes && !(await prompt.confirm('Apply?', true))) {
    out('Nothing changed.');
    return false;
  }
  const { changed, backup } = connectFile(file, adapter.name, adapter.hooks, { command });
  out(changed ? `Connected ${adapter.name}.${backup ? ` Backup: ${backup}` : ''}` : `${adapter.name} was already connected; nothing changed.`);
  if (command === 'agent-voice' && !findOnPath('agent-voice', env)) {
    out('Warning: "agent-voice" is not on your PATH, so these hooks will not run. Install with "npm i -g @lucaszaia/agent-voice".');
  }
  for (const note of adapter.notes) out(`Note: ${note}`);
  return true;
}

export async function runConnect(args, { env, out, prompt }) {
  const adapter = adapterFor(args.find((a) => !a.startsWith('--')));
  await connectAgent(adapter, { env, out, prompt, yes: args.includes('--yes') });
  return 0;
}

export async function runDisconnect(args, { env, out }) {
  const adapter = adapterFor(args[0]);
  const file = adapter.configFile(env);
  const { changed, backup } = disconnectFile(file, adapter.name);
  out(changed ? `Removed agent-voice's hooks from ${file}. Backup: ${backup}` : `${adapter.name} had no agent-voice hooks; nothing changed.`);
  return 0;
}
```

`src/cli/status.js`:

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTERS } from '../adapters/index.js';
import { fileStatus } from '../adapters/hooks-json.js';
import { loadConfig, listOutputInstances, NUMERIC_KEYS } from '../config.js';
import { OUTPUT_TYPES } from '../outputs/index.js';

export async function runStatus(args, { env, out }) {
  const cfg = loadConfig(env);

  out('Agents');
  for (const a of Object.values(ADAPTERS)) {
    const state = a.detect(env) ? fileStatus(a.configFile(env), a.name, a.hooks) : 'not installed';
    const hint = state === 'legacy' ? ' (old bash hooks — run "agent-voice connect ' + a.name + '" to upgrade)' : '';
    out(`  ${a.name.padEnd(12)} ${state}${hint}`);
  }

  out('Outputs (* = enabled)');
  const instances = listOutputInstances(env);
  const known = new Set(instances.map((i) => i.name));
  for (const { name, conf, error } of instances) {
    const mark = cfg.outputs.includes(name) ? '*' : ' ';
    const what = conf && Object.hasOwn(OUTPUT_TYPES, conf.type)
      ? `${conf.type.padEnd(8)} ${OUTPUT_TYPES[conf.type].describe(conf)}`
      : `broken   ${error ?? `unknown type ${conf?.type}`}`;
    out(`  ${mark} ${name.padEnd(16)} ${what}`);
  }
  for (const name of cfg.outputs.filter((n) => !known.has(n))) {
    out(`  * ${name.padEnd(16)} (missing — enabled but not configured)`);
  }
  if (instances.length === 0 && cfg.outputs.length === 0) out('  none — add one with: agent-voice output add <alexa|local|command>');

  out('Settings');
  for (const k of Object.keys(NUMERIC_KEYS)) out(`  ${k}=${cfg[k]}`);

  const logFile = join(cfg.stateDir, 'events.log');
  out(`Log (${logFile})`);
  let lines = [];
  try { lines = readFileSync(logFile, 'utf8').trimEnd().split('\n').filter(Boolean); } catch { /* no log yet */ }
  if (lines.length === 0) out('  (empty)');
  for (const line of lines.slice(-10)) out(`  ${line}`);
  return 0;
}
```

In `src/cli/main.js`, import and register:

```js
import { runConnect, runDisconnect } from './connect.js';
import { runStatus } from './status.js';
```

```js
const COMMANDS = {
  wrap: (args, io) => runWrap(args, { env: io.env }),
  output: runOutput,
  config: async (args, io) => runConfig(args, io),
  test: async (args, io) => testActive(io),
  connect: runConnect,
  disconnect: runDisconnect,
  status: runStatus,
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/connect.js src/cli/status.js src/cli/main.js tests/cli-connect.test.js tests/cli-status.test.js
git commit -m "feat(node): connect, disconnect and status commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: `setup` wizard

**Files:**
- Create: `src/cli/setup.js`
- Modify: `src/cli/main.js` (register `setup`)
- Test: `tests/cli-setup.test.js`

**Interfaces:**
- Consumes: `ADAPTERS`, `fileStatus`, `connectAgent` (Task 15), `addOutput`, `testOutput`, `disableOutput` (Task 14), `removeOutputInstance`, `loadConfig`, `readOutputInstance` (Task 4), `OUTPUT_TYPES`
- Produces: `runSetup(args, io): Promise<number>`

- [ ] **Step 1: Write the failing tests**

`tests/cli-setup.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, RECORDER, scriptedPrompter, collector } from './helpers.js';
import { runSetup } from '../src/cli/setup.js';
import { readStoredConfig, readOutputInstance } from '../src/config.js';
import { TEST_SENTENCE } from '../src/core/phrases.js';

const COMMAND_INDEX = 2; // choices are listed as alexa, local, command
const recorderLine = (sb) => `"${process.execPath}" "${RECORDER}" "${sb.spoken}" {text}`;

test('fresh machine with Claude Code: connect, add a command output, hear it, done', async () => {
  const sb = sandbox();
  mkdirSync(sb.env.CLAUDE_CONFIG_DIR, { recursive: true });
  const c = collector();
  const prompt = scriptedPrompter([true, COMMAND_INDEX, recorderLine(sb), true]);
  assert.equal(await runSetup([], { env: sb.env, out: c.out, prompt }), 0);
  const hooks = JSON.parse(readFileSync(join(sb.env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8')).hooks;
  assert.ok(hooks.Stop);
  assert.deepEqual(readStoredConfig(sb.env).outputs, ['command']);
  assert.deepEqual(sb.spokenLines(), [TEST_SENTENCE]);
  assert.match(c.text(), /agent-voice status/);
});

test('"did not hear it" removes the output and asks again', async () => {
  const sb = sandbox();
  const prompt = scriptedPrompter([COMMAND_INDEX, recorderLine(sb), false, true, COMMAND_INDEX, recorderLine(sb), true]);
  await runSetup([], { env: sb.env, out: () => {}, prompt });
  assert.deepEqual(readStoredConfig(sb.env).outputs, ['command']);
  assert.equal(sb.spokenLines().length, 2);
});

test('a failing output setup can be abandoned without crashing', async () => {
  const sb = sandbox();
  const c = collector();
  const prompt = scriptedPrompter([COMMAND_INDEX, '   ', false]);
  assert.equal(await runSetup([], { env: sb.env, out: c.out, prompt }), 0);
  assert.match(c.text(), /Could not set up command: a command is required/);
});

test('a speaker that fails the test is removed', async () => {
  const sb = sandbox();
  const prompt = scriptedPrompter([COMMAND_INDEX, 'definitely-not-a-command-av {text}', false]);
  await runSetup([], { env: sb.env, out: () => {}, prompt });
  assert.equal(readOutputInstance('command', sb.env), null);
  assert.deepEqual(readStoredConfig(sb.env).outputs, []);
});

test('re-running with everything set up only asks whether to add another output', async () => {
  const sb = sandbox();
  mkdirSync(sb.env.CLAUDE_CONFIG_DIR, { recursive: true });
  await runSetup([], { env: sb.env, out: () => {}, prompt: scriptedPrompter([true, COMMAND_INDEX, recorderLine(sb), true]) });
  const c = collector();
  const prompt = scriptedPrompter([false]);
  await runSetup([], { env: sb.env, out: c.out, prompt });
  assert.equal(prompt.asked.length, 1);
  assert.match(c.text(), /claude-code: already connected/);
});

test('no agent installed points to wrap', async () => {
  const sb = sandbox();
  const c = collector();
  await runSetup([], { env: sb.env, out: c.out, prompt: scriptedPrompter([COMMAND_INDEX, recorderLine(sb), true]) });
  assert.match(c.text(), /agent-voice wrap --/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/cli/setup.js'`.

- [ ] **Step 3: Implement**

`src/cli/setup.js`:

```js
// The front door: connect the agents found on this machine, add one speaker,
// prove it speaks. Safe to re-run — it only offers what is still missing.
import { ADAPTERS } from '../adapters/index.js';
import { fileStatus } from '../adapters/hooks-json.js';
import { OUTPUT_TYPES } from '../outputs/index.js';
import { loadConfig, readOutputInstance, removeOutputInstance } from '../config.js';
import { connectAgent } from './connect.js';
import { addOutput, testOutput, disableOutput } from './output.js';

const LABELS = {
  alexa: 'alexa    an Echo, through Home Assistant',
  local: "local    this computer's own voice",
  command: 'command  any command that speaks a sentence',
};

export async function runSetup(args, io) {
  const { env, out, prompt } = io;
  out('agent-voice setup');
  out('');

  const found = Object.values(ADAPTERS).filter((a) => a.detect(env));
  if (found.length === 0) {
    out('No supported agent found (Claude Code, Codex). Any other CLI works through: agent-voice wrap -- <command>');
  }
  for (const adapter of found) {
    if (fileStatus(adapter.configFile(env), adapter.name, adapter.hooks) === 'connected') {
      out(`${adapter.name}: already connected.`);
      continue;
    }
    await connectAgent(adapter, { env, out, prompt, yes: false });
  }
  out('');

  const active = loadConfig(env).outputs.filter((n) => readOutputInstance(n, env));
  let wantOutput = active.length === 0 || await prompt.confirm(`Active outputs: ${active.join(', ')}. Add another?`, false);
  const types = Object.keys(OUTPUT_TYPES);

  while (wantOutput) {
    const i = await prompt.choose('How should agent-voice speak?', types.map((t) => LABELS[t] ?? t), 0);
    let name;
    try {
      name = await addOutput(types[i], undefined, io);
    } catch (e) {
      out(`Could not set up ${types[i]}: ${e.message}`);
      if (!(await prompt.confirm('Try again?', true))) break;
      continue;
    }
    out('Speaking a test sentence…');
    const spoke = await testOutput(name, io);
    if (spoke && await prompt.confirm('Did you hear it?', true)) {
      wantOutput = false;
    } else {
      removeOutputInstance(name, env);
      disableOutput(name, env);
      out(`Removed "${name}".`);
      if (!(await prompt.confirm('Try again?', true))) break;
    }
  }

  out('');
  out('Done. Check everything with: agent-voice status');
  return 0;
}
```

In `src/cli/main.js`, import and register:

```js
import { runSetup } from './setup.js';
```

```js
  setup: runSetup,
```

(added to the `COMMANDS` object).

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Manual smoke test on this machine**

Run, in a throwaway config so the real one is untouched:

```bash
AV_CONFIG_DIR=$(mktemp -d) AV_STATE_DIR=$(mktemp -d) CLAUDE_CONFIG_DIR=$(mktemp -d) CODEX_HOME=/nonexistent \
  node bin/agent-voice.js setup
```

Answer: `y` to connect Claude Code, choose `command`, enter `/home/lucas-zaia/softwares/home-assistant/falar.sh -a {text}`, confirm you heard the Echo.
Expected: the Echo speaks the test sentence; the summary points to `agent-voice status`. Record the outcome in the task report.

- [ ] **Step 6: Commit**

```bash
git add src/cli/setup.js src/cli/main.js tests/cli-setup.test.js
git commit -m "feat(node): guided setup wizard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Remove the bash implementation, docs, CI, packaging

**Files:**
- Delete: `bin/notify`, `lib/`, `adapters/claude-code.sh`, `adapters/CONTRACT.md`, `outputs/alexa.sh`, `config.sh`, `test/`
- Create: `docs/adapters.md`, `.github/workflows/test.yml`
- Modify: `README.md` (rewrite), `.gitignore` (drop bash fixture entries)

**Interfaces:**
- Consumes: everything above; no new code.

- [ ] **Step 1: Delete the bash implementation**

```bash
git rm -r bin/notify lib adapters/claude-code.sh adapters/CONTRACT.md outputs/alexa.sh config.sh test
```

In `.gitignore`, remove the lines `test/tmp/`, the comment block about fixtures, `/adapters/fail-adapter.sh` and `/outputs/failout.sh`. Keep `*.log`, `node_modules/`, `*.tgz`.

- [ ] **Step 2: Write `docs/adapters.md`**

```markdown
# Writing an adapter

An adapter teaches agent-voice about one agent. It is a module in
`src/adapters/<agent>.js`, registered in `src/adapters/index.js`. It **stores
nothing and decides nothing** — no thresholds, no cooldown, no sentences. The
core owns all of that, so every agent gets the same behaviour and the same fixes.

## The module

| Export | What it is |
|---|---|
| `name` | The agent id, e.g. `"codex"`. Used in hook commands, state paths and the log |
| `hooks` | `[{ event, sub, async?, timeout }]` — which agent events call `agent-voice notify <name> <sub>` |
| `notes` | Strings printed after `connect` (e.g. "trust the hooks in /hooks") |
| `configFile(env, home)` | Path of the agent's JSON config that holds hooks |
| `detect(env, home)` | Whether the agent is installed here |
| `hookReply(sub)` | What to print on stdout for the agent (usually `''`) |
| `translate(sub, payload, home)` | The agent's hook payload → one canonical event, or `null` |

`connect`/`disconnect` work for any agent whose config uses the
`{"hooks": {Event: [{hooks: [{type, command}]}]}}` shape; see
`src/adapters/hooks-json.js`.

## The canonical event

```json
{ "type": "task_done",
  "agent": "your-agent",
  "session_id": "stable-identity",
  "session_name": "Human readable, optional",
  "project": "last path segment, optional",
  "text": "what was asked, or the message, optional" }
```

| `type` | When |
|---|---|
| `turn_start` | The user submitted a request. Carry the request in `text` |
| `task_done` | The agent finished responding (`text` is ignored — the core uses the stored request) |
| `background_done` | Background work finished (a subagent, a queued task) |
| `needs_input` | The agent is blocked on a permission or a question |

`type`, `agent` and `session_id` are required; an event missing any of them is
dropped and logged as `ignored: incomplete event`. `session_id` must be stable
for the whole session. Never compute a duration — the core does.

## Agents with no hooks

Use `agent-voice wrap -- <command>`: it marks the start, runs the command, and
marks the end.

## Checklist

- [ ] `translate` returns `null` for unknown subcommands and never throws on garbage
- [ ] `agentName` in `src/core/phrases.js` has a spoken name for the agent
- [ ] A test file `tests/adapter-<agent>.test.js` mirroring `tests/adapter-codex.test.js`
- [ ] The adapter is listed in `src/adapters/index.js`
```

- [ ] **Step 3: Rewrite `README.md`**

Replace the whole file with:

````markdown
# agent-voice

**Make your coding agent talk to you.** When Claude Code or Codex finishes a
long task — or gets stuck waiting for your permission — a speaker says so out
loud:

> *"Claude Code terminou na sessão Home assistant repo, depois de cerca de 4
> minutos. Você tinha pedido: criar o docker compose."*

> *"Codex precisa de você na sessão azul, do projeto api, para usar o Bash."*

Works on macOS, Windows and Linux. Speaks through an Echo (via Home Assistant),
your computer's own voice, or any command you like.

## Install

Requires Node.js 20 or newer.

```bash
npm install -g @lucaszaia/agent-voice
agent-voice setup
```

`setup` finds your agents, adds its hooks to them (showing you exactly what it
adds, and backing up the file first), asks how you want it to speak, and says a
test sentence so you know it works.

## Why

You ask an agent for something that takes a while and stop watching. Then
either the work finishes and sits there, or — worse — it stopped thirty seconds
in at a permission prompt. A popup appears in the window you stopped looking
at. A voice does not. agent-voice follows two rules:

- **Say something specific**: which session, and what you had asked for.
- **Stay quiet most of the time**: short turns are never announced.

## When it speaks

| Situation | What happens |
|---|---|
| A turn finishes in under 30s | Silent |
| A turn finishes in over 30s | **Speaks**, with how long it took and what you asked |
| Background work finishes (a subagent, a task) | **Speaks**, at most once every 120s per session |
| Background work with nothing to report | Silent |
| The agent needs your permission or input | **Always speaks** |

Every decision, including every silence, goes to the log with its reason —
`agent-voice status` shows the latest lines.

## Commands

```
agent-voice setup                         guided setup
agent-voice connect <claude-code|codex>   add hooks to an agent (--yes to skip the question)
agent-voice disconnect <claude-code|codex>
agent-voice output add <alexa|local|command> [name]
agent-voice output list | remove | enable | disable | test [name]
agent-voice wrap [--name <label>] -- <command...>
agent-voice status
agent-voice config get [key] | set <key> <value>
agent-voice test
```

## Speakers

| Type | How | Needs |
|---|---|---|
| `alexa` | Home Assistant's `notify.send_message` on an Echo entity | Home Assistant URL, a long-lived token, and the Alexa Media Player integration |
| `local` | `say` (macOS), SAPI (Windows), `spd-say`/`espeak-ng` (Linux) | Nothing on macOS/Windows; `espeak-ng` or speech-dispatcher on Linux |
| `command` | Runs any command; `{text}` in it is replaced by the sentence, otherwise the sentence goes to stdin | The command |

You can have several, e.g. `alexa-sala` and `alexa-escritorio`; every enabled
output speaks.

## Agents

- **Claude Code** — hooks in `~/.claude/settings.json`.
- **Codex CLI** — hooks in `~/.codex/hooks.json`. Codex runs a hook only after
  you trust it: open Codex and run `/hooks` once after connecting.
- **Anything else** — `agent-voice wrap -- aider ...` announces when the
  command finishes (no "needs you" announcements in this mode).

Adding an agent: see [`docs/adapters.md`](docs/adapters.md).

## Tuning

Tune against your own log. If most of your turns sit below the threshold it
will feel broken — it will simply never speak.

```bash
agent-voice config set minSeconds 20
agent-voice config set cooldownSeconds 300
```

| Key | Default | Env override |
|---|---|---|
| `minSeconds` | 30 | `AV_MIN_SECONDS` |
| `cooldownSeconds` | 120 | `AV_COOLDOWN_SECONDS` |
| `maxSpeechChars` | 90 | `AV_MAX_SPEECH_CHARS` |

## Where things live

| | Config | State and `events.log` |
|---|---|---|
| Linux | `~/.config/agent-voice` | `~/.local/state/agent-voice` |
| macOS | `~/Library/Application Support/agent-voice` | `…/agent-voice/state` |
| Windows | `%APPDATA%\agent-voice` | `%LOCALAPPDATA%\agent-voice` |

## Troubleshooting

Run `agent-voice status` first — the reason is almost always in the log lines it prints.

- `silent (turn 21s < 30s)` → working as configured; lower `minSeconds`.
- `FAILED via <output> (…)` → the speaker failed; the parenthesis says why. Try `agent-voice output test <name>`.
- `no such output: <name>` → enabled but not configured; `agent-voice output add`.
- An agent shows `legacy` → it still has the old bash hooks; run `agent-voice connect <agent>`.
- Nothing in the log at all → the hooks are not firing. In Claude Code, open `/hooks` once to reload; in Codex, trust them in `/hooks`.

## Upgrading from the bash version

1. `npm install -g @lucaszaia/agent-voice`
2. `agent-voice setup` — for the same Echo as before, pick `command` and enter
   `~/softwares/home-assistant/falar.sh -a {text}`, or pick `alexa` to talk to
   Home Assistant directly.
3. `agent-voice connect claude-code` replaces the old `…/bin/notify` hooks.

Existing state in `~/.local/state/agent-voice` is reused as-is.

## Notes

- **It cannot break your agent.** The hook entry point exits 0 no matter what;
  failures go to the log and nowhere else.
- **Language.** Code and docs are English; the spoken sentences are Brazilian
  Portuguese and live in one file, `src/core/phrases.js`.
- **Concurrency.** State is keyed per agent and per session, so parallel
  sessions never mix up their turns, durations or cooldowns.

## License

MIT.
````

- [ ] **Step 4: Add CI**

`.github/workflows/test.yml`:

```yaml
name: test
on:
  push:
  pull_request:
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm test
```

- [ ] **Step 5: Verify the suite and the package contents**

Run: `npm test`
Expected: PASS, with no test referencing the deleted bash files.

Run: `npm pack --dry-run`
Expected: the file list contains `bin/agent-voice.js`, `src/**`, `docs/adapters.md`, `README.md`, `LICENSE`, `package.json` — and nothing from `tests/`, `docs/superpowers/` or `.superpowers/`.

Run: `grep -rn "bin/notify\|config.sh\|lib/core.sh" README.md docs/adapters.md src/`
Expected: only the intentional mention in README's "Upgrading from the bash version" section and the legacy-detection code in `src/adapters/hooks-json.js`/`src/cli/status.js`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove the bash implementation; README, adapter guide and CI for the Node CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Not in this plan (by design)

- Publishing to npm (`npm publish --access public`) — a user action after merge.
- Migrating the maintainer's live `~/.claude/settings.json` — done by running
  `agent-voice setup` after install (README "Upgrading" section), not by code.
