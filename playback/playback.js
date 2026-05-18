#!/usr/bin/env node
/**
 * playback.js — Thin CLI entry. Reads a macro .txt, picks a runner, and
 * executes each event in order. Parsing and event-to-command translation
 * live in their own modules (./parser, ./selector, ./runners/*) and are
 * unit-tested independently.
 *
 * Usage:
 *   node playback.js <macro.txt> [--runner=actionbook] [--keep-open] [--quiet]
 *
 * Env:
 *   MACRO_SECRET_<seq>   Value to inject when step <seq> has value="[REDACTED]".
 */

const fs = require('fs');
const { execSync } = require('child_process');
const { parseFile } = require('./parser');

const RUNNERS = {
  actionbook: require('./runners/actionbook'),
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { runner: 'actionbook', keepOpen: false, verbose: true };
  const positional = [];
  for (const a of args) {
    if (a === '--quiet') flags.verbose = false;
    else if (a === '--keep-open') flags.keepOpen = true;
    else if (a.startsWith('--runner=')) flags.runner = a.slice('--runner='.length);
    else if (!a.startsWith('--')) positional.push(a);
  }
  return { file: positional[0], flags };
}

function main() {
  const { file, flags } = parseArgs(process.argv);

  if (!file) {
    console.error('Usage: node playback.js <macro.txt> [--runner=actionbook] [--keep-open] [--quiet]');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  const runner = RUNNERS[flags.runner];
  if (!runner) {
    console.error(`Unknown runner: ${flags.runner}. Available: ${Object.keys(RUNNERS).join(', ')}`);
    process.exit(1);
  }

  const steps = parseFile(fs.readFileSync(file, 'utf8'));
  console.log(`Loaded ${steps.length} steps from ${file} (runner: ${flags.runner})`);

  if (steps[0]?.type === 'navigate') {
    runner.openSession(steps.shift(), { verbose: flags.verbose });
  } else {
    console.warn('First event is not navigate — assuming an actionbook session is already open.');
  }

  for (const step of steps) {
    try {
      if (flags.verbose) {
        const tag = `[${String(step.seq).padStart(3, '0')}] ${step.type}`;
        const hint = step.fields.target ?? step.fields.url ?? '';
        console.log(tag, hint);
      }
      runner.runStep(step, { verbose: flags.verbose });
      execSync('sleep 0.3');
    } catch (err) {
      console.error(`  ✗ step ${step.seq} failed: ${err.message}`);
      console.error('  (browser left open for inspection; run `actionbook browser close` when done)');
      process.exit(1);
    }
  }

  console.log('\n✓ playback complete');
  if (!flags.keepOpen) {
    console.log('  (browser left open; run `actionbook browser close` to end the session)');
  }
}

main();
