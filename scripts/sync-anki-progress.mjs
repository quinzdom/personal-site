import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDayLogData } from './build-daylog-data.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(rootDir, 'data-source/daylog/entries.json');
const defaultCollectionPath = resolve(
  process.env.HOME || '',
  'Library/Application Support/Anki2/User 1/collection.anki2'
);
const defaultSnapshotPath = resolve(
  process.env.HOME || '',
  'Library/Application Support/Tracking Site/anki-latest.json'
);
const collectionPath = process.env.ANKI_COLLECTION_PATH || defaultCollectionPath;
const snapshotPath = process.env.TRACKING_SITE_ANKI_SNAPSHOT_PATH || defaultSnapshotPath;
const trackedPublishPaths = ['data-source/daylog/entries.json', 'daylog_data.js'];
const ankiDayStartHour = 4;

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLogicalAnkiDateWithOffset(date, offsetDays) {
  const shiftedTime = new Date(date.getTime() - ankiDayStartHour * 60 * 60 * 1000);
  shiftedTime.setDate(shiftedTime.getDate() + offsetDays);
  return formatLocalDate(shiftedTime);
}

function getDayRange(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  const startMs = new Date(year, month - 1, day, ankiDayStartHour).getTime();
  const endMs = new Date(year, month - 1, day + 1, ankiDayStartHour).getTime();
  return { startMs, endMs };
}

function parseArgs(argv) {
  let targetDate = '';
  let offsetDays = 0;
  let publish = false;

  argv.forEach((arg, index) => {
    if (arg === '--publish') {
      publish = true;
      return;
    }

    if (arg === '--date' && argv[index + 1]) {
      targetDate = argv[index + 1];
      return;
    }

    if (arg.startsWith('--date=')) {
      targetDate = arg.slice('--date='.length);
      return;
    }

    if (arg === '--offset-days' && argv[index + 1]) {
      offsetDays = Number(argv[index + 1] || 0);
      return;
    }

    if (arg.startsWith('--offset-days=')) {
      offsetDays = Number(arg.slice('--offset-days='.length) || 0);
    }
  });

  return { targetDate, offsetDays, publish };
}

function readEntries() {
  return JSON.parse(readFileSync(sourcePath, 'utf8'));
}

function writeEntries(entries) {
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

function normalizeAnkiStats(stats) {
  if (!stats || typeof stats !== 'object') {
    return null;
  }

  const reviewCount = Number(stats.reviewCount || 0);
  const distinctCards = Number(stats.distinctCards || 0);
  const minutes = Number(stats.minutes || 0);

  if (!reviewCount || reviewCount < 0) {
    return null;
  }

  return {
    reviewCount,
    distinctCards: Math.max(0, distinctCards),
    minutes: Math.max(0, minutes),
  };
}

function hasSameAnkiStats(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;

  return (
    Number(left.reviewCount || 0) === Number(right.reviewCount || 0) &&
    Number(left.distinctCards || 0) === Number(right.distinctCards || 0) &&
    Number(left.minutes || 0) === Number(right.minutes || 0)
  );
}

function isStatsRegression(currentStats, nextStats) {
  if (!currentStats || !nextStats) {
    return false;
  }

  return (
    Number(nextStats.reviewCount || 0) < Number(currentStats.reviewCount || 0) ||
    Number(nextStats.distinctCards || 0) < Number(currentStats.distinctCards || 0) ||
    Number(nextStats.minutes || 0) < Number(currentStats.minutes || 0)
  );
}

function readSnapshotStats(targetDate) {
  if (!existsSync(snapshotPath)) {
    return null;
  }

  try {
    const payload = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    if (String(payload.date || '') !== targetDate) {
      return null;
    }

    const normalizedStats = normalizeAnkiStats(payload.anki);
    if (!normalizedStats) {
      return null;
    }

    return {
      source: 'Anki snapshot',
      stats: normalizedStats,
    };
  } catch (error) {
    console.warn(`Could not read Anki snapshot at ${snapshotPath}: ${error.message}`);
    return null;
  }
}

function queryDailyAnkiStatsFromDatabase(databasePath, startMs, endMs) {
  const sql = `
    select
      count(*) as review_count,
      count(distinct cid) as distinct_card_count,
      coalesce(sum(time), 0) as total_millis
    from revlog
    where id >= ${startMs}
      and id < ${endMs};
  `;

  const output = execFileSync('sqlite3', ['-csv', '-noheader', databasePath, sql], {
    encoding: 'utf8',
  }).trim();

  const [reviewCountRaw = '0', distinctCardsRaw = '0', totalMillisRaw = '0'] = output.split(',');
  const reviewCount = Number(reviewCountRaw || 0);
  const distinctCards = Number(distinctCardsRaw || 0);
  const totalMillis = Number(totalMillisRaw || 0);
  const minutes = reviewCount > 0 ? Math.max(1, Math.round(totalMillis / 60000)) : 0;

  return normalizeAnkiStats({
    reviewCount,
    distinctCards,
    minutes,
  });
}

function queryDailyAnkiStats(targetDate, startMs, endMs) {
  const snapshotStats = readSnapshotStats(targetDate);
  if (snapshotStats) {
    return snapshotStats;
  }

  if (!existsSync(collectionPath)) {
    return null;
  }

  try {
    const liveStats = queryDailyAnkiStatsFromDatabase(collectionPath, startMs, endMs);
    if (!liveStats) {
      return null;
    }

    return {
      source: 'live collection',
      stats: liveStats,
    };
  } catch (error) {
    console.warn(`Could not read live Anki collection at ${collectionPath}: ${error.message}`);
    return null;
  }
}

function updateEntry(entries, targetDate, nextAnki) {
  const normalizedAnki = normalizeAnkiStats(nextAnki);
  if (!normalizedAnki) {
    return false;
  }

  const index = entries.findIndex((entry) => entry.date === targetDate);
  if (index === -1) {
    entries.unshift({
      date: targetDate,
      notes: [],
      anki: normalizedAnki,
    });
    return true;
  }

  const currentEntry = entries[index];
  const currentAnki = normalizeAnkiStats(currentEntry.anki);

  if (hasSameAnkiStats(currentAnki, normalizedAnki)) {
    return false;
  }

  if (isStatsRegression(currentAnki, normalizedAnki)) {
    console.warn(`Skipped Anki update for ${targetDate} because the new stats are lower than the current saved stats.`);
    return false;
  }

  entries[index] = {
    ...currentEntry,
    notes: Array.isArray(currentEntry.notes) ? currentEntry.notes : [],
    anki: normalizedAnki,
  };
  return true;
}

function hasPublishableChanges() {
  const output = execFileSync('git', ['status', '--porcelain', '--', ...trackedPublishPaths], {
    cwd: rootDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  }).trim();

  return output.length > 0;
}

function publishChanges(targetDate) {
  if (!hasPublishableChanges()) {
    console.log(`No publishable daylog changes for ${targetDate}.`);
    return false;
  }

  const gitEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };

  execFileSync('git', ['add', '--', ...trackedPublishPaths], {
    cwd: rootDir,
    env: gitEnv,
    stdio: 'inherit',
  });

  try {
    execFileSync('git', ['diff', '--cached', '--quiet', '--', ...trackedPublishPaths], {
      cwd: rootDir,
      env: gitEnv,
      stdio: 'ignore',
    });
    console.log(`No staged daylog changes to commit for ${targetDate}.`);
    return false;
  } catch {}

  execFileSync('git', ['commit', '-m', `Update Anki log for ${targetDate}`], {
    cwd: rootDir,
    env: gitEnv,
    stdio: 'inherit',
  });

  execFileSync('git', ['push', 'origin', 'main'], {
    cwd: rootDir,
    env: gitEnv,
    stdio: 'inherit',
  });

  console.log(`Published Anki log update for ${targetDate}.`);
  return true;
}

const { targetDate: rawTargetDate, offsetDays, publish } = parseArgs(process.argv.slice(2));
const now = new Date();
const targetDate = rawTargetDate || getLogicalAnkiDateWithOffset(now, offsetDays);
const { startMs, endMs } = getDayRange(targetDate);
const result = queryDailyAnkiStats(targetDate, startMs, endMs);

if (!result) {
  buildDayLogData();
  console.log(`Skipped Anki sync for ${targetDate}: no reliable Anki stats source was available.`);
  process.exit(0);
}

const entries = readEntries();
const changed = updateEntry(entries, targetDate, result.stats);

if (changed) {
  entries.sort((left, right) => right.date.localeCompare(left.date));
  writeEntries(entries);
}

buildDayLogData();
console.log(
  `Synced Anki for ${targetDate} from ${result.source}: ${result.stats.reviewCount} reviews, ${result.stats.distinctCards} cards, ${result.stats.minutes}m`
);

if (publish) {
  publishChanges(targetDate);
}
