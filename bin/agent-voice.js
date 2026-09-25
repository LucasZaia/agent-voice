#!/usr/bin/env node
import { main } from '../src/cli/main.js';
import { guardNotifyProcess } from '../src/cli/notify.js';

const argv = process.argv.slice(2);
if (argv[0] === 'notify') guardNotifyProcess(argv.slice(1));
process.exitCode = await main(argv);
