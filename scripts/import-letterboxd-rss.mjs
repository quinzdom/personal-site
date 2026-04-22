import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const workspaceDir = process.cwd();
const dataFile = path.join(workspaceDir, 'items_data.js');
const coversDir = path.join(workspaceDir, 'images', 'covers');
const watchedCsvFile = path.join(workspaceDir, 'data-source', 'letterboxd', 'watched.csv');
const diaryCsvFile = path.join(workspaceDir, 'data-source', 'letterboxd', 'diary.csv');
const ratingsCsvFile = path.join(workspaceDir, 'data-source', 'letterboxd', 'ratings.csv');
const likedFilmsCsvFile = path.join(workspaceDir, 'data-source', 'letterboxd', 'likes', 'films.csv');
const DEFAULT_RSS_URL = 'https://letterboxd.com/quinzdom/rss/';
const BOXD_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MONTHS = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

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

function decodeEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildKey(title, year) {
  return `${normalizeText(title)}|||${String(year || '').trim()}`;
}

function getTag(block, tagName) {
  const escapedName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escapedName}[^>]*>([\\s\\S]*?)<\\/${escapedName}>`, 'i'));
  return match ? decodeEntities(match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()) : '';
}

function getRawTag(block, tagName) {
  const escapedName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escapedName}[^>]*>([\\s\\S]*?)<\\/${escapedName}>`, 'i'));
  return match ? decodeEntities(match[1]) : '';
}

function extractPosterUrl(source) {
  const match = source.match(/<img[^>]+src="([^"]+)"/i);
  return match ? decodeEntities(match[1]) : '';
}

function extractFilmIdFromPoster(url) {
  const match = String(url || '').match(/\/film-poster\/(?:\d+\/)*(\d+)-/);
  return match ? match[1] : '';
}

function extractFilmIdFromHtml(html) {
  const dataMatch = html.match(/data-film-id="(\d+)"/i);
  if (dataMatch) return dataMatch[1];

  const posterMatch = html.match(/https:\/\/a\.ltrbxd\.com\/[^"'\s<]*?\/film-poster\/(?:\d+\/)*(\d+)-[^"'\s<]*/i);
  return posterMatch ? posterMatch[1] : '';
}

function extractPosterUrlFromHtml(html, filmId) {
  if (filmId) {
    const escapedFilmId = filmId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactMatch = html.match(new RegExp(`https://a\\.ltrbxd\\.com/[^"'\\s<]*?/${escapedFilmId}-[^"'\\s<]*`, 'i'));
    if (exactMatch) return exactMatch[0];
  }

  const genericMatch = html.match(/https:\/\/a\.ltrbxd\.com\/[^"'\s<]*?-0-\d+-0-\d+-crop[^"'\s<]*/i);
  return genericMatch ? genericMatch[0] : '';
}

function canonicalFilmLink(link) {
  return String(link || '').replace(/^https:\/\/letterboxd\.com\/[^/]+\/film\//, 'https://letterboxd.com/film/');
}

function extractBoxdUriFromHtml(html) {
  const match = html.match(/https:\/\/boxd\.it\/([A-Za-z0-9]+)/);
  return match ? `https://boxd.it/${match[1]}` : '';
}

function encodeBoxdNumber(value) {
  let current = BigInt(value);
  let encoded = '';

  do {
    encoded = BOXD_ALPHABET[Number(current % 62n)] + encoded;
    current /= 62n;
  } while (current > 0n);

  return encoded;
}

function filmUriFromFilmId(filmId) {
  return `https://boxd.it/${encodeBoxdNumber(BigInt(filmId) * 10n)}`;
}

function diaryUriFromGuid(guid) {
  const match = String(guid || '').match(/^letterboxd-watch-(\d+)$/);
  return match ? `https://boxd.it/${encodeBoxdNumber(BigInt(match[1]) * 10n + 1n)}` : '';
}

function dateFromPubDate(pubDate) {
  const match = String(pubDate || '').match(/^[A-Za-z]{3},\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!match || !MONTHS[match[2]]) return '';
  return `${match[3]}-${MONTHS[match[2]]}-${match[1].padStart(2, '0')}`;
}

function parseRssItems(source) {
  return [...source.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map((match) => {
      const block = match[1];
      const description = getRawTag(block, 'description');
      const posterUrl = extractPosterUrl(description);

      return {
        title: getTag(block, 'letterboxd:filmTitle'),
        year: getTag(block, 'letterboxd:filmYear'),
        link: getTag(block, 'link'),
        guid: getTag(block, 'guid'),
        pubDate: getTag(block, 'pubDate'),
        loggedDate: dateFromPubDate(getTag(block, 'pubDate')),
        watchedDate: getTag(block, 'letterboxd:watchedDate'),
        rewatch: getTag(block, 'letterboxd:rewatch'),
        rating: Number(getTag(block, 'letterboxd:memberRating') || 0),
        liked: getTag(block, 'letterboxd:memberLike') === 'Yes',
        posterUrl,
        filmId: extractFilmIdFromPoster(posterUrl),
      };
    })
    .filter((item) => item.title && item.year && item.watchedDate);
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Codex Letterboxd RSS importer)',
      accept: options.accept || 'text/html,application/xhtml+xml,application/xml,text/xml,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

async function enrichEntry(entry) {
  let filmId = entry.filmId;
  let posterUrl = entry.posterUrl;
  let filmUri = filmId ? filmUriFromFilmId(filmId) : '';

  if (!filmId || !posterUrl) {
    const html = await fetchText(entry.link, {
      accept: 'text/html,application/xhtml+xml',
      timeoutMs: 15000,
    });

    filmId ||= extractFilmIdFromHtml(html);
    posterUrl ||= extractPosterUrlFromHtml(html, filmId);
  }

  if (!filmId && !filmUri) {
    const canonicalLink = canonicalFilmLink(entry.link);
    if (canonicalLink && canonicalLink !== entry.link) {
      const html = await fetchText(canonicalLink, {
        accept: 'text/html,application/xhtml+xml',
        timeoutMs: 15000,
      });
      filmId ||= extractFilmIdFromHtml(html);
      posterUrl ||= extractPosterUrlFromHtml(html, filmId);
      filmUri ||= extractBoxdUriFromHtml(html);
    }
  }

  filmUri ||= filmId ? filmUriFromFilmId(filmId) : '';

  if (!filmUri) {
    throw new Error(`Unable to resolve Letterboxd URI for ${entry.title} (${entry.year})`);
  }

  return {
    ...entry,
    filmId,
    posterUrl,
    filmUri,
    diaryUri: diaryUriFromGuid(entry.guid) || filmUri,
  };
}

function slugifyId(id) {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Codex Letterboxd RSS importer)',
      accept: 'image/*,*/*;q=0.8',
      referer: 'https://letterboxd.com/',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destination, bytes);
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
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

function csvValue(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(headers, row) {
  return headers.map((header) => csvValue(row[header])).join(',');
}

async function appendMissingCsvRows(file, headers, rows, keyForRow) {
  if (!rows.length) return 0;

  const source = await fs.readFile(file, 'utf8');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const existingRows = parseCsv(source);
  const existingKeys = new Set(existingRows.map(keyForRow));
  const missingRows = rows.filter((row) => !existingKeys.has(keyForRow(row)));

  if (!missingRows.length) return 0;

  const prefix = source.endsWith('\n') ? '' : newline;
  const addition = missingRows.map((row) => csvLine(headers, row)).join(newline);
  await fs.appendFile(file, `${prefix}${addition}${newline}`);
  return missingRows.length;
}

async function main() {
  const rssUrl = process.argv[2] || DEFAULT_RSS_URL;
  const [rssSource, itemsSource] = await Promise.all([
    fetchText(rssUrl, { accept: 'application/rss+xml,application/xml,text/xml,*/*' }),
    fs.readFile(dataFile, 'utf8'),
  ]);

  const rssEntries = parseRssItems(rssSource);
  const enrichedEntries = [];

  for (const entry of rssEntries) {
    enrichedEntries.push(await enrichEntry(entry));
  }

  const items = loadItems(itemsSource);
  const existingIds = new Set(items.map((item) => item.id));
  const existingMoviesByKey = new Map(
    items
      .filter((item) => item.type === 'movie')
      .map((item) => [buildKey(item.title, item.author), item])
  );

  let updatedMovies = 0;
  const newMovies = [];

  for (const entry of enrichedEntries) {
    const id = `lb-${entry.filmUri}`;
    const existing = items.find((item) => item.id === id) || existingMoviesByKey.get(buildKey(entry.title, entry.year));

    if (existing) {
      let changed = false;
      if (entry.watchedDate && (!existing.date_read || entry.watchedDate > existing.date_read)) {
        existing.date_read = entry.watchedDate;
        changed = true;
      }
      if (entry.rating > 0 && existing.rating !== entry.rating) {
        existing.rating = entry.rating;
        changed = true;
      }
      if (changed) updatedMovies += 1;
      continue;
    }

    if (existingIds.has(id)) continue;

    const filename = `${slugifyId(id)}.jpg`;
    const coverPath = path.join(coversDir, filename);
    if (entry.posterUrl) {
      await fs.mkdir(coversDir, { recursive: true });
      await downloadFile(entry.posterUrl, coverPath);
    }

    newMovies.push({
      title: entry.title,
      author: entry.year,
      type: 'movie',
      date_read: entry.watchedDate,
      rating: entry.rating || 0,
      cover: path.posix.join('images', 'covers', filename),
      id,
      ya: false,
    });
    existingIds.add(id);
  }

  if (newMovies.length) {
    const firstMovieIndex = items.findIndex((item) => item.type === 'movie');
    items.splice(firstMovieIndex === -1 ? items.length : firstMovieIndex, 0, ...newMovies);
  }

  if (newMovies.length || updatedMovies > 0) {
    await fs.writeFile(dataFile, serializeItems(items));
  }

  const chronologicalEntries = [...enrichedEntries].sort((left, right) => {
    return `${left.loggedDate || left.watchedDate}|${left.title}`.localeCompare(`${right.loggedDate || right.watchedDate}|${right.title}`);
  });

  const watchedRows = chronologicalEntries.map((entry) => ({
    Date: entry.loggedDate || entry.watchedDate,
    Name: entry.title,
    Year: entry.year,
    'Letterboxd URI': entry.filmUri,
  }));
  const diaryRows = chronologicalEntries.map((entry) => ({
    Date: entry.loggedDate || entry.watchedDate,
    Name: entry.title,
    Year: entry.year,
    'Letterboxd URI': entry.diaryUri,
    Rating: entry.rating || '',
    Rewatch: entry.rewatch === 'Yes' ? 'Yes' : '',
    Tags: '',
    'Watched Date': entry.watchedDate,
  }));
  const ratingRows = chronologicalEntries
    .filter((entry) => entry.rating > 0)
    .map((entry) => ({
      Date: entry.loggedDate || entry.watchedDate,
      Name: entry.title,
      Year: entry.year,
      'Letterboxd URI': entry.filmUri,
      Rating: entry.rating,
    }));
  const likedRows = chronologicalEntries
    .filter((entry) => entry.liked)
    .map((entry) => ({
      Date: entry.loggedDate || entry.watchedDate,
      Name: entry.title,
      Year: entry.year,
      'Letterboxd URI': entry.filmUri,
    }));

  const [watchedCsvRows, diaryCsvRows, ratingCsvRows, likedCsvRows] = await Promise.all([
    appendMissingCsvRows(watchedCsvFile, ['Date', 'Name', 'Year', 'Letterboxd URI'], watchedRows, (row) => row['Letterboxd URI']),
    appendMissingCsvRows(diaryCsvFile, ['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Tags', 'Watched Date'], diaryRows, (row) => `${buildKey(row.Name, row.Year)}|||${row['Watched Date']}`),
    appendMissingCsvRows(ratingsCsvFile, ['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating'], ratingRows, (row) => row['Letterboxd URI']),
    appendMissingCsvRows(likedFilmsCsvFile, ['Date', 'Name', 'Year', 'Letterboxd URI'], likedRows, (row) => row['Letterboxd URI']),
  ]);

  console.log(JSON.stringify({
    rssItems: rssEntries.length,
    addedMovies: newMovies.length,
    updatedMovies,
    watchedCsvRows,
    diaryCsvRows,
    ratingCsvRows,
    likedCsvRows,
    addedTitles: newMovies.map((item) => item.title),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
