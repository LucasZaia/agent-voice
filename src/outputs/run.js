// Runs a speaker process with a hard timeout. A hook that hangs is worse than
// one that fails, so every child gets killed eventually.
import { spawn as nodeSpawn } from 'node:child_process';
import { spawnCommand, spawnErrorMessage } from '../spawn-command.js';

export function run(cmd, args, { input = '', timeoutMs = 20000, env, spawn = nodeSpawn, platform = process.platform } = {}) {
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
    child.on('error', (e) => finish(reject, startError(e)));
    child.on('close', (code) => {
      if (code === 0) finish(resolve, stdout);
      else finish(reject, new Error(stderr.trim().split(/\r?\n/)[0] || `exited ${code} with no output`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
