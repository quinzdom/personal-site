import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const workspaceDir = process.cwd();
const importerScript = path.join(workspaceDir, 'scripts', 'import-bookmeter-read-list.mjs');
const htmlFiles = [
  path.join(workspaceDir, 'index.html'),
  path.join(workspaceDir, 'index-grouped-by-month.html'),
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

function parseImporterResult(output) {
  const start = output.lastIndexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Bookmeter importer did not print a JSON summary.');
  }

  return JSON.parse(output.slice(start, end + 1));
}

function todayStamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function nextSuffix(suffix) {
  if (!suffix) return 'a';
  const code = suffix.charCodeAt(0);
  return code >= 97 && code < 122 ? String.fromCharCode(code + 1) : 'a';
}

function nextCacheVersion(existingVersions) {
  const today = todayStamp();
  const latest = existingVersions
    .sort((left, right) => left.date.localeCompare(right.date) || left.suffix.localeCompare(right.suffix))
    .at(-1);

  if (!latest || latest.date < today) {
    return `${today}a`;
  }

  return `${latest.date}${nextSuffix(latest.suffix)}`;
}

async function bumpItemsCacheKeys() {
  const versionMatches = [];

  for (const file of htmlFiles) {
    const source = await fs.readFile(file, 'utf8');
    for (const match of source.matchAll(/items_data\.js\?v=(\d{8})([a-z]?)/g)) {
      versionMatches.push({ date: match[1], suffix: match[2] || '' });
    }
  }

  const version = nextCacheVersion(versionMatches);

  for (const file of htmlFiles) {
    const source = await fs.readFile(file, 'utf8');
    const updated = source.replace(/items_data\.js\?v=\d{8}[a-z]?/g, `items_data.js?v=${version}`);
    if (updated !== source) {
      await fs.writeFile(file, updated);
    }
  }

  return version;
}

async function main() {
  const importerArgs = [importerScript, ...process.argv.slice(2)];
  const { stdout } = await run(process.execPath, importerArgs);
  const result = parseImporterResult(stdout);

  if (result.added > 0) {
    const version = await bumpItemsCacheKeys();
    console.log(`Bumped items_data.js cache key to ${version}.`);
  } else {
    console.log('No new Bookmeter entries; left cache keys unchanged.');
  }

  await run(process.execPath, ['--check', path.join(workspaceDir, 'items_data.js')]);
  console.log('Fast Bookmeter update complete. Stats and display metadata were intentionally not rebuilt.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
