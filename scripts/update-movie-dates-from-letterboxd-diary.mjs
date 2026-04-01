import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const workspaceDir = process.cwd();
const dataFile = path.join(workspaceDir, 'items_data.js');
const defaultCsvPath = path.join(workspaceDir, 'data-source', 'letterboxd', 'diary.csv');

function loadItems(source) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.__items__ = items;`, context);
  return context.__items__;
}

function escapeString(value) {
  return JSON.stringify(value);
}

function serializeItems(items) {
  const rows = items.map((item) => {
    return `{title:${escapeString(item.title)},author:${escapeString(item.author)},type:${escapeString(item.type)},date_read:${escapeString(item.date_read)},rating:${item.rating},cover:${escapeString(item.cover)},id:${escapeString(item.id)},ya:${item.ya}}`;
  });

  return `const items = [\n${rows.join(',\n')}\n];\n`;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  const [headerLine, ...rowLines] = lines;
  const headers = parseCsvLine(headerLine);

  return rowLines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function normalizeDate(value) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeTitle(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildKey(title, year) {
  return `${normalizeTitle(title)}|||${String(year).trim()}`;
}

async function main() {
  const csvPath = process.argv[2] || defaultCsvPath;

  const [dataSource, csvSource] = await Promise.all([
    fs.readFile(dataFile, 'utf8'),
    fs.readFile(csvPath, 'utf8'),
  ]);

  const items = loadItems(dataSource);
  const rows = parseCsv(csvSource);
  const byKey = new Map();

  for (const row of rows) {
    const watchedDate = normalizeDate(row['Watched Date'] || '');
    if (!watchedDate) continue;
    const key = buildKey(row['Name'] || '', row['Year'] || '');
    const previous = byKey.get(key);
    if (!previous || watchedDate > previous) {
      byKey.set(key, watchedDate);
    }
  }

  let updated = 0;
  let matched = 0;
  const unmatched = [];

  for (const item of items) {
    if (item.type !== 'movie') continue;

    const key = buildKey(item.title, item.author);
    const nextDate = byKey.get(key) || '';

    if (nextDate) {
      matched += 1;
    } else {
      unmatched.push({ title: item.title, year: item.author, id: item.id });
    }

    if (item.date_read !== nextDate) {
      item.date_read = nextDate;
      updated += 1;
    }
  }

  await fs.writeFile(dataFile, serializeItems(items));

  console.log(JSON.stringify({
    diaryRows: rows.length,
    matchedMovies: matched,
    unmatchedMovies: unmatched.length,
    updated,
    unmatchedSample: unmatched.slice(0, 20),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
