import { homedir } from 'node:os';

export const str = (v) => (typeof v === 'string' ? v : '');

// The last segment of cwd. The home directory is not a project — announcing
// "do projeto lucas-zaia" would be nonsense.
// Windows paths compare case-insensitively and with either separator.
export function projectOf(cwd, home = homedir(), platform = process.platform) {
  const dir = str(cwd).replace(/[\\/]+$/, '');
  const norm = (p) => (platform === 'win32' ? p.replace(/[\\/]+/g, '\\').replace(/\\$/, '').toLowerCase() : p.replace(/\/+$/, ''));
  if (!dir || norm(dir) === norm(String(home))) return '';
  const parts = dir.split(/[\\/]/);
  return parts[parts.length - 1];
}
