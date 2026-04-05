import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const homeDir = process.env.HOME;

if (!homeDir) {
  throw new Error('HOME is not set.');
}

const label = 'com.yuta.tracking-site.anki-sync';
const launchAgentsDir = resolve(homeDir, 'Library/LaunchAgents');
const logsDir = resolve(homeDir, 'Library/Logs');
const appSupportDir = resolve(homeDir, 'Library/Application Support/Tracking Site');
const ankiAddonsDir = resolve(homeDir, 'Library/Application Support/Anki2/addons21');
const ankiAddonDir = resolve(ankiAddonsDir, 'tracking_site_sync');
const addonTemplatePath = resolve(rootDir, 'anki-addon/tracking_site_sync/__init__.py.template');
const plistPath = resolve(launchAgentsDir, `${label}.plist`);
const logPath = resolve(logsDir, `${label}.log`);
const snapshotPath = process.env.TRACKING_SITE_ANKI_SNAPSHOT_PATH || resolve(appSupportDir, 'anki-latest.json');
const userId = execFileSync('id', ['-u'], { encoding: 'utf8' }).trim();
const nodePath = execFileSync('which', ['node'], { encoding: 'utf8' }).trim();

function installAnkiExporterAddon() {
  const template = readFileSync(addonTemplatePath, 'utf8');
  const snapshotLiteral = JSON.stringify(snapshotPath);
  const addonCode = template.replace('__SNAPSHOT_PATH__', snapshotLiteral);

  mkdirSync(ankiAddonDir, { recursive: true });
  writeFileSync(resolve(ankiAddonDir, '__init__.py'), addonCode, 'utf8');
}

function seedSnapshotFromLog() {
  if (existsSync(snapshotPath) || !existsSync(logPath)) {
    return false;
  }

  const lines = readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();

  for (const line of lines) {
    const match = line.match(
      /Synced Anki for (\d{4}-\d{2}-\d{2})(?: from [^:]+)?: (\d+) reviews, (\d+) cards, (\d+)m/
    );

    if (!match) {
      continue;
    }

    const [, date, reviewCount, distinctCards, minutes] = match;
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(
      snapshotPath,
      `${JSON.stringify(
        {
          date,
          anki: {
            reviewCount: Number(reviewCount),
            distinctCards: Number(distinctCards),
            minutes: Number(minutes),
          },
          source: 'launch-log-seed',
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    return true;
  }

  return false;
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${resolve(rootDir, 'scripts/sync-anki-progress.mjs')}</string>
    <string>--publish</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>3600</integer>
  <key>WorkingDirectory</key>
  <string>${rootDir}</string>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;

mkdirSync(launchAgentsDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });
mkdirSync(appSupportDir, { recursive: true });

installAnkiExporterAddon();
seedSnapshotFromLog();
writeFileSync(plistPath, plist, 'utf8');

try {
  execFileSync('launchctl', ['bootout', `gui/${userId}`, plistPath], { stdio: 'ignore' });
} catch {}

execFileSync('launchctl', ['bootstrap', `gui/${userId}`, plistPath], { stdio: 'inherit' });
execFileSync('launchctl', ['kickstart', '-k', `gui/${userId}/${label}`], { stdio: 'inherit' });

console.log(`Installed ${label} at ${plistPath}`);
console.log(`Installed Anki exporter add-on at ${ankiAddonDir}`);
console.log(`Tracking snapshot path: ${snapshotPath}`);
console.log('If Anki is already open, restart it once so the exporter add-on starts writing fresh snapshots.');
