// The computer's own voice: `say` on macOS, SAPI through PowerShell on Windows,
// speech-dispatcher or eSpeak on Linux.
import { run as runProcess, SPEAK_TIMEOUT_MS } from './run.js';
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
  const run = deps.run ?? runProcess;
  await run(cmd, args, { input, env, spawn: deps.spawn, timeoutMs: deps.timeoutMs ?? SPEAK_TIMEOUT_MS });
}
