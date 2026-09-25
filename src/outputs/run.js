// Runs a speaker process with a hard timeout. A hook that hangs is worse than
// one that fails, so every child gets killed eventually.
import { spawn as nodeSpawn } from 'node:child_process';
import { spawnCommand, spawnErrorMessage } from '../spawn-command.js';

// Every output gets at most this long. Hooks run outputs one after another and
// agents kill a hook at its timeout (60s for the async hooks), so three slow
// outputs still leave time to log why they failed.
export const SPEAK_TIMEOUT_MS = 15000;

export function run(cmd, args, { input = '', timeoutMs = SPEAK_TIMEOUT_MS, env, spawn = nodeSpawn, platform = process.platform } = {}) {
  return new Promise((resolve, reject) => {
    const startError = (e) => new Error(spawnErrorMessage(e, cmd, env ?? process.env, platform));
    let child;
    try {
      child = spawnCommand(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true }, { spawn, platform });
    } catch (e) {
      reject(startError(e));
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    let grace = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish(reject, startError(e)));
    // Done when the speaker exits, not when its pipes close: one that leaves
    // audio playing in the background (`sh -c "play x &"`) hands the pipes to
    // that player. Output still in flight gets a moment to arrive.
    const done = (code, signal) => {
      child.stdout.destroy();
      child.stderr.destroy();
      if (code === 0) finish(resolve, stdout);
      else finish(reject, new Error(stderr.trim().split(/\r?\n/)[0] || `exited ${code ?? signal} with no output`));
    };
    child.on('exit', (code, signal) => { grace = setTimeout(() => done(code, signal), 200); });
    child.on('close', done);
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
