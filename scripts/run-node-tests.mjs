import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

async function findTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findTestFiles(path);
    return entry.isFile() && entry.name.endsWith('.test.mjs') ? [path] : [];
  }));
  return nested.flat();
}

const requestedDirectory = process.argv[2];
if (!requestedDirectory) throw new Error('usage: run-node-tests TEST_DIRECTORY');

const testFiles = (await findTestFiles(resolve(process.cwd(), requestedDirectory))).sort();
if (!testFiles.length) throw new Error(`No *.test.mjs files found under ${requestedDirectory}`);

const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', ...testFiles],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
