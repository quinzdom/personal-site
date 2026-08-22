import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGoalsData } from './build-goals-data.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const goalsPath = resolve(rootDir, 'data-source/goals/goals.json');
const daylogPath = resolve(rootDir, 'data-source/daylog/entries.json');
const defaultCollectionPath = resolve(
  process.env.HOME || '',
  'Library/Application Support/Anki2/User 1/collection.anki2'
);
const ankiDayStartHour = 4;
const deckSeparator = '\x1f';

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Anki rolls the day over at 4 AM, so a review at 02:00 belongs to the day before.
function toLogicalDate(epochMillis) {
  return formatLocalDate(new Date(epochMillis - ankiDayStartHour * 60 * 60 * 1000));
}

function parseArgs(argv) {
  const options = {
    goalId: '',
    deck: '',
    collectionPath: process.env.ANKI_COLLECTION_PATH || defaultCollectionPath,
    minReviews: 1,
    fromDaylog: false,
    listDecks: false,
    dryRun: false,
  };

  argv.forEach((arg, index) => {
    const next = argv[index + 1];
    const valueOf = (flag) => (arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : (arg === flag ? next : ''));

    const goal = valueOf('--goal');
    if (goal) options.goalId = goal;

    const deck = valueOf('--deck');
    if (deck) options.deck = deck;

    const collection = valueOf('--collection');
    if (collection) options.collectionPath = collection;

    const minReviews = valueOf('--min-reviews');
    if (minReviews) options.minReviews = Math.max(1, Number(minReviews) || 1);

    if (arg === '--from-daylog') options.fromDaylog = true;
    if (arg === '--list-decks') options.listDecks = true;
    if (arg === '--dry-run') options.dryRun = true;
  });

  return options;
}

// node:sqlite landed in Node 22.5. Older runtimes fall back to the sqlite3 CLI,
// which is what scripts/sync-anki-progress.mjs already relies on.
function loadSqlite() {
  try {
    return process.getBuiltinModule ? process.getBuiltinModule('node:sqlite') : null;
  } catch {
    return null;
  }
}

function queryRows(databasePath, sql) {
  const sqlite = loadSqlite();

  if (!sqlite) {
    const output = execFileSync('sqlite3', ['-json', databasePath, sql], { encoding: 'utf8' }).trim();
    return output ? JSON.parse(output) : [];
  }

  const db = new sqlite.DatabaseSync(databasePath, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

function readDeckNames(collectionPath) {
  try {
    return queryRows(collectionPath, 'select id, name from decks;').map((row) => ({
      id: Number(row.id),
      name: String(row.name || '').split(deckSeparator).join('::'),
    }));
  } catch {
    // Collections older than Anki 2.1.28 keep decks as JSON on the col table.
    const rows = queryRows(collectionPath, 'select decks from col;');
    const raw = rows.length ? rows[0].decks : '';
    if (!raw) return [];

    return Object.values(JSON.parse(raw)).map((deck) => ({
      id: Number(deck.id),
      name: String(deck.name || ''),
    }));
  }
}

function findDeckIds(decks, deckName) {
  const target = deckName.trim();
  const matches = decks.filter((deck) => deck.name === target || deck.name.startsWith(`${target}::`));
  return matches.map((deck) => deck.id);
}

function readReviewDaysFromCollection(collectionPath, deckName, minReviews) {
  if (!existsSync(collectionPath)) {
    throw new Error(`No Anki collection at ${collectionPath}. Pass --collection <path> if it lives elsewhere.`);
  }

  const decks = readDeckNames(collectionPath);
  const deckIds = findDeckIds(decks, deckName);

  if (!deckIds.length) {
    throw new Error(
      `No deck named "${deckName}". Run with --list-decks to see the exact names in your collection.`
    );
  }

  // odid is set while a card sits in a filtered deck, so fall back to it for the home deck.
  // ease = 0 marks manual reschedules rather than answered cards, so those do not count.
  const rows = queryRows(
    collectionPath,
    `select r.id as id
       from revlog r
       join cards c on c.id = r.cid
      where coalesce(nullif(c.odid, 0), c.did) in (${deckIds.join(',')})
        and r.ease > 0;`
  );

  const perDay = new Map();
  rows.forEach((row) => {
    const date = toLogicalDate(Number(row.id));
    perDay.set(date, (perDay.get(date) || 0) + 1);
  });

  return {
    deckIds,
    days: [...perDay.entries()]
      .filter(([, count]) => count >= minReviews)
      .map(([date]) => date)
      .sort(),
    firstReviewDay: [...perDay.keys()].sort()[0] || '',
  };
}

function readReviewDaysFromDaylog(minReviews) {
  const entries = JSON.parse(readFileSync(daylogPath, 'utf8'));
  const days = entries
    .filter((entry) => entry.anki && Number(entry.anki.reviewCount || 0) >= minReviews)
    .map((entry) => String(entry.date))
    .sort();

  return { days, firstReviewDay: days[0] || '' };
}

function readGoals() {
  return JSON.parse(readFileSync(goalsPath, 'utf8'));
}

function writeGoals(goals) {
  mkdirSync(dirname(goalsPath), { recursive: true });
  writeFileSync(goalsPath, `${JSON.stringify(goals, null, 2)}\n`, 'utf8');
}

function importDays(goalId, days, firstReviewDay, { complete, dryRun }) {
  const goals = readGoals();
  const goal = goals.find((entry) => String(entry.id || '').trim() === goalId);

  if (!goal) {
    throw new Error(`No goal with id "${goalId}" in ${goalsPath}`);
  }

  const existing = new Set(Array.isArray(goal.done) ? goal.done : []);
  const added = days.filter((date) => !existing.has(date));
  const merged = [...new Set([...existing, ...days])].sort();

  const nextStartDate = firstReviewDay && firstReviewDay < goal.startDate ? firstReviewDay : goal.startDate;
  // A complete source (the Anki revlog) proves a day with no reviews was a miss.
  // A sparse source (the daylog) does not, so continuous tracking stays where it was.
  const nextTrackedFrom = complete ? nextStartDate : (goal.trackedFrom || goal.startDate);

  if (dryRun) {
    console.log(`Would add ${added.length} day(s) to "${goalId}".`);
    console.log(`  startDate:   ${goal.startDate} -> ${nextStartDate}`);
    console.log(`  trackedFrom: ${goal.trackedFrom || goal.startDate} -> ${nextTrackedFrom}`);
    if (added.length) {
      console.log(`  days: ${added.join(', ')}`);
    }
    return;
  }

  goal.done = merged;
  goal.startDate = nextStartDate;
  goal.trackedFrom = nextTrackedFrom;
  writeGoals(goals);
  buildGoalsData();

  console.log(`Added ${added.length} day(s) to "${goalId}" (${merged.length} total).`);
  console.log(`  startDate:   ${nextStartDate}`);
  console.log(`  trackedFrom: ${nextTrackedFrom}`);
}

try {
  const options = parseArgs(process.argv.slice(2));

  if (options.listDecks) {
    readDeckNames(options.collectionPath)
      .map((deck) => deck.name)
      .sort()
      .forEach((name) => console.log(name));
    process.exit(0);
  }

  if (!options.goalId) {
    throw new Error('Pass --goal <id>, for example: --goal kanji-writing');
  }

  if (options.fromDaylog) {
    const { days, firstReviewDay } = readReviewDaysFromDaylog(options.minReviews);
    console.log(`Found ${days.length} day(s) with Anki reviews in the daily log.`);
    importDays(options.goalId, days, firstReviewDay, { complete: false, dryRun: options.dryRun });
  } else {
    if (!options.deck) {
      throw new Error('Pass --deck "<name>", for example: --deck "漢字書き取り"');
    }

    const { days, firstReviewDay } = readReviewDaysFromCollection(
      options.collectionPath,
      options.deck,
      options.minReviews
    );
    console.log(`Found ${days.length} day(s) with reviews in "${options.deck}".`);
    importDays(options.goalId, days, firstReviewDay, { complete: true, dryRun: options.dryRun });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
