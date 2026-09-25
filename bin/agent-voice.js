#!/usr/bin/env node
import { main } from '../src/cli/main.js';
import { guardNotifyProcess } from '../src/cli/notify.js';

const argv = process.argv.slice(2);
if (argv[0] === 'notify') guardNotifyProcess(argv.slice(1));
// `agent-voice status | head`: the reader went away, so there is nobody left to talk to.
else process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
process.exitCode = await main(argv);
