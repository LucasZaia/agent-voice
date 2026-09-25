// Starts a program with an argument array and never through a shell, on every
// OS. The spoken sentence ends up in these arguments, and it is user text: a
// shell would let "fix auth & deploy" run `deploy`.
//
// Windows needs two things done by hand. Bare names are resolved through PATH
// and PATHEXT here, so a missing command is known before anything runs. And
// .cmd/.bat files cannot be started without cmd.exe, so they get an explicit
// `cmd.exe /d /s /c "<line>"` in which every argument is quoted for the C
// runtime and then caret-escaped twice (the cross-spawn technique): once for
// cmd.exe itself, once more because the batch file re-reads its arguments
// (%* or %1) as part of its own command line.
import { spawn as nodeSpawn } from 'node:child_process';
import { findOnPath, envValue } from './platform.js';

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

export function quoteCmdArg(arg) {
  // A line break would end cmd.exe's command line; it cannot be passed anyway.
  let s = String(arg).replace(/[\r\n]+/g, ' ');
  // C runtime rules: backslashes before a quote double and the quote is
  // escaped; trailing backslashes double so the closing quote stays a quote.
  s = s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${s}"`.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

// → { file, args, options } to hand to spawn, or null when Windows has no
// such command.
export function spawnPlan(cmd, args, { env = process.env, platform = process.platform, exists } = {}) {
  if (platform !== 'win32') return { file: cmd, args, options: {} };
  const file = findOnPath(cmd, env, platform, exists);
  if (!file) return null;
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args, options: {} };
  // Windows paths cannot contain ", so quoting the batch file's path is enough.
  const line = [`"${file}"`, ...args.map(quoteCmdArg)].join(' ');
  return {
    file: envValue(env, 'COMSPEC', platform) || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    options: { windowsVerbatimArguments: true },
  };
}

// One wording for "could not start it", shared by outputs and wrap. POSIX
// reports EACCES for a missing command when some PATH entry is unreadable,
// so a bare name that is not on PATH is "not found" whatever the code says.
export function spawnErrorMessage(e, cmd, env = process.env, platform = process.platform) {
  const bareMissing = !/[\\/]/.test(cmd) && !findOnPath(cmd, env, platform);
  if (e.code === 'ENOENT' || (e.code === 'EACCES' && bareMissing)) return `command not found: ${cmd}`;
  if (e.code === 'EACCES' || e.code === 'EISDIR') return `not found or not executable: ${cmd}`;
  return e.message;
}

// Like child_process.spawn(cmd, args, options) minus the shell. Throws an
// ENOENT error, without spawning, when Windows cannot find the command.
export function spawnCommand(cmd, args, options = {}, { spawn = nodeSpawn, platform = process.platform, exists } = {}) {
  const plan = spawnPlan(cmd, args, { env: options.env ?? process.env, platform, exists });
  if (!plan) throw Object.assign(new Error(`command not found: ${cmd}`), { code: 'ENOENT' });
  return spawn(plan.file, plan.args, { ...options, ...plan.options, shell: false });
}
