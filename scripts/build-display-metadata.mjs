import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const workspaceDir = process.cwd();
const itemsFile = path.join(workspaceDir, 'items_data.js');
const goodreadsCsvFile = path.join(workspaceDir, 'data-source', 'goodreads', 'goodreads_library_export.csv');
const outputFile = path.join(workspaceDir, 'display_metadata.js');
const LETTERBOXD_CONCURRENCY = 3;
const GOOGLE_BOOKS_CONCURRENCY = 3;

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

function serializeMetadata(metadata) {
  return `const displayMetadata = ${JSON.stringify(metadata, null, 2)};\n`;
}

function extractYear(value) {
  const match = String(value || '').match(/\b(1[0-9]{3}|20[0-9]{2}|2100)\b/);
  return match ? match[1] : '';
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function fetchText(url, options = {}) {
  const retries = options.retries ?? 4;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
      headers: {
        'user-agent': options.userAgent || 'Mozilla/5.0 (compatible; Codex display metadata builder)',
        accept: options.accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      },
    });

    if (response.ok) {
      return response.text();
    }

    if (response.status !== 429 || attempt === retries - 1) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }

  throw new Error(`Unable to fetch ${url}`);
}

async function fetchJson(url) {
  const text = await fetchText(url, {
    accept: 'application/json,text/plain,*/*',
    timeoutMs: 15000,
  });
  return JSON.parse(text);
}

async function mapLimit(values, concurrency, iteratee) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await iteratee(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function extractMovieUrl(item) {
  return item.id.replace(/^lb-/, '');
}

function extractLetterboxdDirector(html) {
  const twitterMatch = html.match(/<meta name="twitter:data1" content="([^"]+)"/i);
  if (twitterMatch) {
    return normalizeWhitespace(twitterMatch[1]);
  }

  const sectionMatch = html.match(/<div class="cast-list text-sluglist">([\s\S]*?)<\/div>/i);
  const source = sectionMatch ? sectionMatch[1] : html;
  const matches = [...source.matchAll(/\/director\/[^"]+"><span class="prettify">([^<]+)<\/span><\/a>/gi)];
  const names = [...new Set(matches.map((match) => normalizeWhitespace(match[1])).filter(Boolean))];
  return names.join(', ');
}

function buildGoodreadsYearMap(rows) {
  return new Map(rows.map((row) => {
    const preferredYear = extractYear(row['Original Publication Year']) || extractYear(row['Year Published']);
    return [`gr-${row['Book Id']}`, preferredYear];
  }));
}

async function lookupGoogleBooksYear(item) {
  const queryParts = [];
  if (item.title) queryParts.push(`intitle:${item.title}`);
  if (item.author) queryParts.push(`inauthor:${item.author}`);
  const query = queryParts.join(' ');
  if (!query) return '';

  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5`;
  const payload = await fetchJson(url);
  const volumes = payload.items || [];

  for (const volume of volumes) {
    const title = normalizeWhitespace(volume.volumeInfo?.title);
    const authors = (volume.volumeInfo?.authors || []).map(normalizeWhitespace).join(', ');
    const publishedYear = extractYear(volume.volumeInfo?.publishedDate);
    if (!publishedYear) continue;

    const titleMatches = title && (title.includes(normalizeWhitespace(item.title)) || normalizeWhitespace(item.title).includes(title));
    const authorMatches = !item.author || !authors || authors.includes(normalizeWhitespace(item.author));
    if (titleMatches || authorMatches) {
      return publishedYear;
    }
  }

  return extractYear(volumes[0]?.volumeInfo?.publishedDate);
}

async function main() {
  const [itemsSource, goodreadsCsvSource] = await Promise.all([
    fs.readFile(itemsFile, 'utf8'),
    fs.readFile(goodreadsCsvFile, 'utf8'),
  ]);

  const items = loadItems(itemsSource);
  const books = items.filter((item) => item.type === 'book');
  const movies = items.filter((item) => item.type === 'movie');
  const goodreadsRows = parseCsv(goodreadsCsvSource);
  const goodreadsYearMap = buildGoodreadsYearMap(goodreadsRows);
  const bookPublicationYears = {};

  for (const item of books) {
    if (item.id.startsWith('gr-')) {
      const year = goodreadsYearMap.get(item.id) || '';
      if (year) bookPublicationYears[item.id] = year;
    }
  }

  const unresolvedBooks = books.filter((item) => !bookPublicationYears[item.id]);
  const bookYearLookups = await mapLimit(unresolvedBooks, GOOGLE_BOOKS_CONCURRENCY, async (item) => {
    try {
      const year = await lookupGoogleBooksYear(item);
      return { id: item.id, year };
    } catch {
      return { id: item.id, year: '' };
    }
  });

  for (const result of bookYearLookups) {
    if (result.year) {
      bookPublicationYears[result.id] = result.year;
    }
  }

  const movieDirectorResults = await mapLimit(movies, LETTERBOXD_CONCURRENCY, async (item) => {
    try {
      const html = await fetchText(extractMovieUrl(item), {
        timeoutMs: 15000,
        accept: 'text/html,application/xhtml+xml',
      });
      return { id: item.id, director: extractLetterboxdDirector(html) };
    } catch {
      return { id: item.id, director: '' };
    }
  });

  const movieDirectors = Object.fromEntries(
    movieDirectorResults
      .filter((result) => result.director)
      .map((result) => [result.id, result.director])
      .sort((left, right) => left[0].localeCompare(right[0]))
  );

  const metadata = {
    movieDirectors,
    bookPublicationYears: Object.fromEntries(
      Object.entries(bookPublicationYears).sort((left, right) => left[0].localeCompare(right[0]))
    ),
  };

  await fs.writeFile(outputFile, serializeMetadata(metadata));

  console.log(JSON.stringify({
    movieDirectors: Object.keys(metadata.movieDirectors).length,
    movieDirectorMisses: movies.length - Object.keys(metadata.movieDirectors).length,
    bookYears: Object.keys(metadata.bookPublicationYears).length,
    bookYearMisses: books.length - Object.keys(metadata.bookPublicationYears).length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
