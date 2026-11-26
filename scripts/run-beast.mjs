#!/usr/bin/env node
/**
 * Run a generated XML file in a local BEAST X build, to check that it parses
 * and the chain starts. Usage: node scripts/run-beast.mjs <file.xml> [BEAST dir]
 * The BEAST directory defaults to $BEAST_HOME, then ../BEAST.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const [xml, beastArg] = process.argv.slice(2);
if (!xml) {
  console.error('Usage: node scripts/run-beast.mjs <file.xml> [BEAST dir]');
  process.exit(2);
}
const beast = resolve(beastArg ?? process.env.BEAST_HOME ?? '../BEAST');
const jar = join(beast, 'build', 'dist', 'beast.jar');
if (!existsSync(jar)) {
  console.error(`No BEAST build found at ${jar}`);
  process.exit(2);
}
const classpath = [jar, join(beast, 'lib', '*')].join(delimiter);
const result = spawnSync(
  'java',
  ['-Djava.library.path=/usr/local/lib', '-cp', classpath, 'dr.app.beast.BeastMain', '-overwrite', '-working', resolve(xml)],
  { cwd: mkdtempSync(join(tmpdir(), 'beautique-')), stdio: 'inherit' },
);
process.exit(result.status ?? 1);
