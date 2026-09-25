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
    child.on('error', (e) => {
      const isNotFound = e.code === 'ENOENT' || e.code === 'EACCES' || e.code === 'EISDIR';
      finish(reject, new Error(isNotFound ? `command not found: ${cmd}` : e.message));
    });
    child.on('close', (code) => {
      if (code === 0) finish(resolve, stdout);
      else finish(reject, new Error(stderr.trim().split(/\r?\n/)[0] || `exited ${code} with no output`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
