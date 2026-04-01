import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const workspaceDir = process.cwd();
const dataFile = path.join(workspaceDir, 'items_data.js');
const YA_START_YEAR = 2006;
const YA_END_YEAR = 2012;

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

function parseDateParts(date) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildMonthSpan(yearEntries) {
  const months = [...new Set(yearEntries.map((entry) => parseDateParts(entry.item.date_read)?.month).filter(Boolean))].sort((a, b) => a - b);
  const count = yearEntries.length;

  if (months.length === 0) {
    return Array.from({ length: 12 }, (_, index) => index + 1);
  }

  if (months.length === 1) {
    return count > 6 ? Array.from({ length: 12 }, (_, index) => index + 1) : months;
  }

  const first = months[0];
  const last = months[months.length - 1];
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function assignMonth(monthSpan, position, total) {
  if (total <= 1) return monthSpan[monthSpan.length - 1];
  const index = Math.min(
    monthSpan.length - 1,
    Math.floor((position * monthSpan.length) / total)
  );
  return monthSpan[index];
}

function assignDays(entries, year, month) {
  const totalDays = daysInMonth(year, month);
  const bucket = entries.filter((entry) => entry.nextMonth === month);

  bucket.forEach((entry, index) => {
    const day = Math.max(
      1,
      Math.min(
        totalDays,
        Math.round(((index + 1) * (totalDays + 1)) / (bucket.length + 1))
      )
    );
    entry.nextDate = formatDate(year, month, day);
  });
}

function sortEntries(entries) {
  entries.sort((left, right) => {
    if (left.item.date_read !== right.item.date_read) {
      return left.item.date_read.localeCompare(right.item.date_read);
    }
    return left.index - right.index;
  });
}

function summarizeMonths(entries) {
  const monthCounts = new Map();
  for (const entry of entries) {
    const month = entry.item.date_read.slice(0, 7);
    monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
  }
  return [...monthCounts.entries()];
}

async function main() {
  const source = await fs.readFile(dataFile, 'utf8');
  const items = loadItems(source);

  const allGoodreadsBooks = items
    .map((item, index) => ({ item, index }))
    .filter((entry) => entry.item.type === 'book' && entry.item.id.startsWith('gr-') && entry.item.date_read);

  const yaBooks = allGoodreadsBooks.filter((entry) => entry.item.ya);
  const regularBooks = allGoodreadsBooks.filter((entry) => !entry.item.ya);

  const byYear = new Map();
  for (const entry of regularBooks) {
    const parsed = parseDateParts(entry.item.date_read);
    if (!parsed) continue;
    const bucket = byYear.get(parsed.year) || [];
    bucket.push(entry);
    byYear.set(parsed.year, bucket);
  }

  let updated = 0;
  const yearSummaries = [];

  for (const [year, entries] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    sortEntries(entries);

    const monthSpan = buildMonthSpan(entries);

    entries.forEach((entry, index) => {
      entry.nextMonth = assignMonth(monthSpan, index, entries.length);
    });

    for (const month of monthSpan) {
      assignDays(entries, year, month);
    }

    for (const entry of entries) {
      if (entry.item.date_read !== entry.nextDate) {
        entry.item.date_read = entry.nextDate;
        updated += 1;
      }
    }

    yearSummaries.push({
      year,
      group: 'regular',
      count: entries.length,
      span: `${String(monthSpan[0]).padStart(2, '0')}..${String(monthSpan[monthSpan.length - 1]).padStart(2, '0')}`,
      months: summarizeMonths(entries),
    });
  }

  if (yaBooks.length) {
    sortEntries(yaBooks);
    const yaYears = Array.from({ length: YA_END_YEAR - YA_START_YEAR + 1 }, (_, index) => YA_START_YEAR + index);

    yaBooks.forEach((entry, index) => {
      const yearIndex = Math.min(
        yaYears.length - 1,
        Math.floor((index * yaYears.length) / yaBooks.length)
      );
      entry.nextYear = yaYears[yearIndex];
    });

    for (const year of yaYears) {
      const bucket = yaBooks.filter((entry) => entry.nextYear === year);
      const monthSpan = Array.from({ length: 12 }, (_, index) => index + 1);

      bucket.forEach((entry, index) => {
        entry.nextMonth = assignMonth(monthSpan, index, bucket.length);
      });

      for (const month of monthSpan) {
        assignDays(bucket, year, month);
      }

      for (const entry of bucket) {
        if (entry.item.date_read !== entry.nextDate) {
          entry.item.date_read = entry.nextDate;
          updated += 1;
        }
      }

      yearSummaries.push({
        year,
        group: 'ya',
        count: bucket.length,
        span: '01..12',
        months: summarizeMonths(bucket),
      });
    }
  }

  await fs.writeFile(dataFile, serializeItems(items));

  console.log(JSON.stringify({
    updated,
    years: yearSummaries,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
