#!/usr/bin/env node
/**
 * Cross-platform env wrapper for npm scripts (Windows VM + Linux/macOS).
 *
 * Usage:
 *   node scripts/run-env.mjs ENV=qa COUNTRY=usa STORE=14401 -- tests/loanwalk tests/showcase
 *
 * Invokes the local Playwright CLI directly (no npx) so Windows Task Scheduler
 * does not depend on npm/npx being on PATH beyond `node`.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT_CLI = path.join(
  REPO_ROOT,
  'node_modules',
  '@playwright',
  'test',
  'cli.js'
);

const argv = process.argv.slice(2);
const env = { ...process.env };
const playwrightArgs = [];
let pastSep = false;

for (const arg of argv) {
  if (arg === '--') {
    pastSep = true;
    continue;
  }
  if (!pastSep && /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) {
    const eq = arg.indexOf('=');
    env[arg.slice(0, eq)] = arg.slice(eq + 1);
    continue;
  }
  playwrightArgs.push(arg);
}

if (playwrightArgs.length === 0) {
  console.error(
    'Usage: node scripts/run-env.mjs KEY=value … -- <playwright test args>'
  );
  process.exit(2);
}

if (!existsSync(PLAYWRIGHT_CLI)) {
  console.error(
    `Playwright CLI not found at:\n  ${PLAYWRIGHT_CLI}\nRun "npm install" from the repo root first.`
  );
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  [PLAYWRIGHT_CLI, 'test', ...playwrightArgs],
  {
    stdio: 'inherit',
    env,
    cwd: REPO_ROOT,
    // shell:false — node + local cli.js works the same on Windows and Linux
    windowsHide: true,
  }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
