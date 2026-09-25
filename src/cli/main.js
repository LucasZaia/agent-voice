import { runNotify, readStdin } from './notify.js';
import { createPrompter } from './prompt.js';
import { runWrap } from './wrap.js';
import { runOutput, testActive } from './output.js';
import { runConfig } from './config.js';
import { runConnect, runDisconnect } from './connect.js';
import { runStatus } from './status.js';
import { runSetup } from './setup.js';

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
const COMMANDS = {
  setup: runSetup,
  wrap: (args, io) => runWrap(args, { env: io.env }),
  output: runOutput,
  config: async (args, io) => runConfig(args, io),
  test: async (args, io) => testActive(io),
  connect: runConnect,
  disconnect: runDisconnect,
  status: runStatus,
};

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
