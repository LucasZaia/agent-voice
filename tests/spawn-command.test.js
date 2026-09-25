import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnPlan, spawnCommand, quoteCmdArg } from '../src/spawn-command.js';

// A pretend Windows machine: which files exist is injected, so this runs on any OS.
const WIN_ENV = {
  Path: 'C:\\tools;"C:\\Program Files\\nodejs"',
  PATHEXT: '.COM;.EXE;.BAT;.CMD',
  ComSpec: 'C:\\Windows\\system32\\cmd.exe',
};
const FILES = new Set([
  'C:\\tools\\speak.cmd',
  'C:\\tools\\speak', // npm ships an extensionless sh script next to every .cmd shim
  'C:\\Program Files\\nodejs\\node.exe',
  'C:\\Program Files\\nodejs\\npm.cmd',
  'D:\\bin\\say it.bat',
]);
const exists = (p) => FILES.has(p);
const win = (cmd, args) => spawnPlan(cmd, args, { env: WIN_ENV, platform: 'win32', exists });

// cmd.exe's parsing phase that matters for injection: "..." toggles quoting,
// outside quotes ^ makes the next character literal (an escaped " does not
// toggle), and an unescaped & | < > outside quotes starts another command.
function cmdParse(line) {
  let out = '';
  let quoted = false;
  const bare = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { quoted = !quoted; out += c; continue; }
    if (!quoted && c === '^') { i++; out += line[i] ?? ''; continue; }
    if (!quoted && '&|<>'.includes(c)) bare.push(c);
    out += c;
  }
  return { out, bare };
}

// How a C runtime program (node.exe behind an npm shim) splits its command line.
function argvOf(line) {
  const args = [];
  let cur = '';
  let quoted = false;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') {
      let n = 0;
      while (line[i] === '\\') { n++; i++; }
      if (line[i] === '"') {
        cur += '\\'.repeat(Math.floor(n / 2));
        if (n % 2) cur += '"'; else quoted = !quoted;
      } else {
        cur += '\\'.repeat(n);
        i--;
      }
      has = true;
      continue;
    }
    if (c === '"') { quoted = !quoted; has = true; continue; }
    if (!quoted && (c === ' ' || c === '\t')) {
      if (has) args.push(cur);
      cur = '';
      has = false;
      continue;
    }
    cur += c;
    has = true;
  }
  if (has) args.push(cur);
  return args;
}

test('other platforms spawn the command as given, never through a shell', () => {
  for (const platform of ['linux', 'darwin']) {
    assert.deepEqual(spawnPlan('say', ['a & b'], { platform }), { file: 'say', args: ['a & b'], options: {} });
  }
});

test('windows: a bare name is resolved through PATH and PATHEXT; an .exe gets its args untouched', () => {
  assert.deepEqual(win('node', ['-e', 'x & y']), { file: 'C:\\Program Files\\nodejs\\node.exe', args: ['-e', 'x & y'], options: {} });
  assert.equal(win('node.exe', []).file, 'C:\\Program Files\\nodejs\\node.exe');
});

test('windows: the extensionless sh script next to a .cmd shim is not picked', () => {
  assert.equal(win('speak', ['x']).args[3].startsWith('""C:\\tools\\speak.cmd" '), true);
});

test('windows: a missing command is known before spawning', () => {
  assert.equal(win('definitely-not-a-command-av', []), null);
  assert.equal(win('C:\\nope\\speak.cmd', []), null);
});

test('windows: a batch file runs through cmd.exe /d /s /c with a quoted path and verbatim args', () => {
  const plan = win('D:\\bin\\say it.bat', ['oi']);
  assert.equal(plan.file, 'C:\\Windows\\system32\\cmd.exe');
  assert.deepEqual(plan.args, ['/d', '/s', '/c', '""D:\\bin\\say it.bat" ^^^"oi^^^""']);
  assert.deepEqual(plan.options, { windowsVerbatimArguments: true });
});

test('windows: sentence text cannot inject commands into cmd.exe or into the batch file', () => {
  const sentences = [
    'fix auth & deploy',
    'a " & calc',
    'say "hi" | more > out.txt',
    '50% %PATH% !x! ^caret',
    '(parens) <in> a, b; c* d?',
    'trailing backslash\\',
    'back\\"slash quote',
    '',
  ];
  for (const s of sentences) {
    const args = ['-a', s, 'fixed'];
    const plan = win('npm', args);
    const raw = plan.args[3];
    assert.doesNotMatch(raw, /%[A-Za-z0-9_]+%/, `percent expansion possible: ${s}`);
    // /s strips the outer quotes; this is what cmd.exe parses.
    const first = cmdParse(raw.slice(1, -1));
    assert.deepEqual(first.bare, [], `cmd.exe would split: ${s}`);
    const prefix = '"C:\\Program Files\\nodejs\\npm.cmd" ';
    assert.ok(first.out.startsWith(prefix));
    // The shim re-reads its arguments (%*) as part of its own command line.
    const second = cmdParse(first.out.slice(prefix.length));
    assert.deepEqual(second.bare, [], `the batch file would split: ${s}`);
    assert.deepEqual(argvOf(second.out), args, `arguments changed: ${s}`);
  }
});

test('windows: line breaks cannot end the cmd.exe command line early', () => {
  assert.doesNotMatch(quoteCmdArg('a\r\nb & c'), /[\r\n]/);
});

test('spawnCommand never uses a shell and reports a missing command as ENOENT without spawning', () => {
  const calls = [];
  const spawn = (file, args, options) => { calls.push({ file, args, options }); return {}; };
  spawnCommand('speak', ['a & b'], { env: WIN_ENV, stdio: 'pipe' }, { spawn, platform: 'win32', exists });
  assert.equal(calls[0].file, 'C:\\Windows\\system32\\cmd.exe');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsVerbatimArguments, true);
  assert.equal(calls[0].options.stdio, 'pipe');
  assert.throws(
    () => spawnCommand('nope-av', [], { env: WIN_ENV }, { spawn, platform: 'win32', exists }),
    (e) => e.code === 'ENOENT' && /command not found: nope-av/.test(e.message),
  );
  assert.equal(calls.length, 1);
  spawnCommand('say', ['x'], {}, { spawn, platform: 'linux' });
  assert.equal(calls[1].options.shell, false);
});
