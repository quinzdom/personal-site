import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const workspaceDir = process.cwd();
const dataFile = path.join(workspaceDir, 'items_data.js');
const statsFile = path.join(workspaceDir, 'stats_data.js');
const DEFAULT_GOODREADS_CSV = path.join(workspaceDir, 'data-source', 'goodreads', 'goodreads_library_export.csv');
const DEFAULT_BOOKMETER_URL = 'https://bookmeter.com/users/1465681/books/read?display_type=list';
const READING_PAGES_PER_HOUR = 50;
const MOVIE_CONCURRENCY = 8;
const CALIFORNIA_MINIMUM_WAGE = 16.9;
const AVERAGE_HOURLY_WAGE = 37.32;

function loadItems(source) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.__items__ = items;`, context);
  return context.__items__;
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

function parseBookmeterPageCount(html) {
  const entries = [];
  const regex = /<li class="group__book">[\s\S]*?<a href="\/books\/(\d+)"><img[\s\S]*?<div class="detail__page">(\d+)<\/div>[\s\S]*?<\/li>/g;
  for (const match of html.matchAll(regex)) {
    entries.push([`bm-${match[1]}`, Number(match[2])]);
  }
  return entries;
}

function extractLastPage(html) {
  const pages = [...html.matchAll(/page=(\d+)/g)].map((match) => Number(match[1]));
  return pages.length ? Math.max(...pages) : 1;
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Codex stats builder)',
      accept: 'text/html,application/xhtml+xml,text/plain,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

function extractMovieRuntimeMinutes(html) {
  const patterns = [
    />\s*(\d+)&nbsp;mins?\s*&nbsp;/i,
    /(\d+)&nbsp;mins?/i,
    /(\d+)\s*mins?/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return Number(match[1]);
  }

  return null;
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(values[currentIndex], currentIndex);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, values.length) }, () => run());
  await Promise.all(runners);
  return results;
}

async function buildBookPageMaps() {
  const csvText = await fs.readFile(DEFAULT_GOODREADS_CSV, 'utf8');
  const rows = parseCsv(csvText);
  const goodreadsPages = new Map();

  for (const row of rows) {
    const id = `gr-${row['Book Id']}`;
    const pages = Number(row['Number of Pages'] || 0);
    if (pages > 0) goodreadsPages.set(id, pages);
  }

  const firstPage = await fetchText(DEFAULT_BOOKMETER_URL);
  const lastPage = extractLastPage(firstPage);
  const bookmeterPages = new Map(parseBookmeterPageCount(firstPage));

  for (let page = 2; page <= lastPage; page += 1) {
    const html = await fetchText(`${DEFAULT_BOOKMETER_URL}&page=${page}`);
    for (const [id, pages] of parseBookmeterPageCount(html)) {
      if (pages > 0) bookmeterPages.set(id, pages);
    }
  }

  return { goodreadsPages, bookmeterPages };
}

async function buildMovieRuntimeMap(movieItems) {
  const results = await mapWithConcurrency(movieItems, MOVIE_CONCURRENCY, async (item) => {
    const url = item.id.replace(/^lb-/, '');
    const html = await fetchText(url);
    const minutes = extractMovieRuntimeMinutes(html);
    return { id: item.id, minutes };
  });

  return new Map(results.filter((entry) => entry.minutes).map((entry) => [entry.id, entry.minutes]));
}

function serializeStats(stats) {
  return `const stats = ${JSON.stringify(stats, null, 2)};\n`;
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

async function main() {
  const dataSource = await fs.readFile(dataFile, 'utf8');
  const items = loadItems(dataSource);
  const bookItems = items.filter((item) => item.type === 'book');
  const movieItems = items.filter((item) => item.type === 'movie');

  const [{ goodreadsPages, bookmeterPages }, movieRuntimeMap] = await Promise.all([
    buildBookPageMaps(),
    buildMovieRuntimeMap(movieItems),
  ]);

  let totalBookPages = 0;
  let bookPageMatches = 0;

  for (const item of bookItems) {
    const pages = goodreadsPages.get(item.id) || bookmeterPages.get(item.id) || 0;
    if (pages > 0) {
      totalBookPages += pages;
      bookPageMatches += 1;
    }
  }

  let totalMovieMinutes = 0;
  for (const item of movieItems) {
    totalMovieMinutes += movieRuntimeMap.get(item.id) || 0;
  }

  const readingHours = Math.round(totalBookPages / READING_PAGES_PER_HOUR);
  const watchingHours = Math.round(totalMovieMinutes / 60);
  const totalHours = readingHours + watchingHours;
  const readingDays = roundToOneDecimal(readingHours / 24);
  const watchingDays = roundToOneDecimal(watchingHours / 24);
  const totalDays = roundToOneDecimal(totalHours / 24);
  const minimumWageValue = Math.round(totalHours * CALIFORNIA_MINIMUM_WAGE);
  const averageWageValue = Math.round(totalHours * AVERAGE_HOURLY_WAGE);

  const stats = {
    readingHours,
    watchingHours,
    totalHours,
    readingDays,
    watchingDays,
    totalDays,
    minimumWageHourly: CALIFORNIA_MINIMUM_WAGE,
    averageWageHourly: AVERAGE_HOURLY_WAGE,
    minimumWageValue,
    averageWageValue,
    readingHoursEstimated: true,
    readingPagesPerHour: READING_PAGES_PER_HOUR,
    wageSources: {
      minimumWage: 'California statewide minimum wage, effective 2026-01-01 (DIR)',
      averageWage: 'U.S. average hourly earnings, total private, Feb. 2026 (BLS)',
      averageWagePublished: '2026-03-06',
    },
    sourceCoverage: {
      booksMatched: bookPageMatches,
      booksTotal: bookItems.length,
      moviesMatched: movieRuntimeMap.size,
      moviesTotal: movieItems.length,
    },
  };

  await fs.writeFile(statsFile, serializeStats(stats));
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
