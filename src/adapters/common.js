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
