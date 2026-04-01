import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const workspaceDir = process.cwd();
const dataFile = path.join(workspaceDir, 'items_data.js');
const coversDir = path.join(workspaceDir, 'images', 'covers');
const DEFAULT_URL = 'https://bookmeter.com/users/1465681/books/read?display_type=list';
const LIST_ITEM_REGEX = /<li class="group__book">[\s\S]*?<div class="thumbnail__cover"><a href="\/books\/(\d+)"><img alt="([\s\S]*?)" class="cover__image" src="([^"]*)" \/><\/a>[\s\S]*?<div class="detail__date">([^<]+)<\/div><div class="detail__title"><a href="\/books\/\d+">([\s\S]*?)<\/a><\/div><ul class="detail__authors">([\s\S]*?)<\/ul>[\s\S]*?<\/dl><\/div><\/li>/g;

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

function normalizeText(value) {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugifyId(id) {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function normalizeDate(value) {
  const match = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function extractLastPage(html) {
  const pages = [...html.matchAll(/page=(\d+)/g)].map((match) => Number(match[1]));
  return pages.length ? Math.max(...pages) : 1;
}

function extractBaseListUrl(rawUrl) {
  const url = new URL(rawUrl || DEFAULT_URL);
  url.searchParams.set('display_type', 'list');
  url.searchParams.delete('page');
  return url.toString();
}

function parseListPage(html) {
  const entries = [];

  for (const match of html.matchAll(LIST_ITEM_REGEX)) {
    const authors = [...match[6].matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)]
      .map((authorMatch) => decodeHtml(authorMatch[1]))
      .filter(Boolean);

    entries.push({
      id: `bm-${match[1]}`,
      bookmeterId: match[1],
      title: decodeHtml(match[5]),
      author: authors.join(', '),
      date_read: normalizeDate(match[4]),
      coverUrl: match[3],
    });
  }

  return entries;
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Codex Bookmeter importer)',
      accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Codex Bookmeter importer)',
      accept: 'image/*,*/*;q=0.8',
      referer: 'https://bookmeter.com/',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destination, bytes);
}

async function enrichEntry(entry) {
  const html = await fetchText(`https://bookmeter.com/books/${entry.bookmeterId}`);
  const ogTitle = (html.match(/<meta property="og:title" content="([^"]+)"/i) || [])[1] || '';
  const fullTitle = decodeHtml(
    (ogTitle.match(/^『(.+?)』｜/) || [])[1]
    || entry.title
  );
  const ogImage = (html.match(/<meta property="og:image" content="([^"]+)"/i) || [])[1] || '';

  return {
    ...entry,
    title: fullTitle,
    coverUrl: ogImage || entry.coverUrl,
  };
}

async function main() {
  const rawUrl = process.argv[2] || DEFAULT_URL;
  const listUrl = extractBaseListUrl(rawUrl);
  const source = await fs.readFile(dataFile, 'utf8');
  const items = loadItems(source);

  const firstPageHtml = await fetchText(listUrl);
  const lastPage = extractLastPage(firstPageHtml);
  const parsedEntries = parseListPage(firstPageHtml);

  for (let page = 2; page <= lastPage; page += 1) {
    const pageHtml = await fetchText(`${listUrl}&page=${page}`);
    parsedEntries.push(...parseListPage(pageHtml));
  }

  const uniqueEntries = parsedEntries.filter((entry, index, collection) => {
    return collection.findIndex((candidate) => candidate.id === entry.id) === index;
  });

  const existingIds = new Set(items.map((item) => item.id));
  const existingPairs = new Set(
    items
      .filter((item) => item.type === 'book')
      .map((item) => `${normalizeText(item.title)}|||${normalizeText(item.author)}`)
  );

  const missingEntries = uniqueEntries.filter((entry) => {
    if (existingIds.has(entry.id)) return false;
    return !existingPairs.has(`${normalizeText(entry.title)}|||${normalizeText(entry.author)}`);
  });

  const enrichedEntries = [];
  for (const entry of missingEntries) {
    enrichedEntries.push(await enrichEntry(entry));
  }

  await fs.mkdir(coversDir, { recursive: true });

  for (const entry of enrichedEntries) {
    const filename = `${slugifyId(entry.id)}.jpg`;
    const absoluteCoverPath = path.join(coversDir, filename);
    await downloadFile(entry.coverUrl, absoluteCoverPath);

    items.push({
      title: entry.title,
      author: entry.author,
      type: 'book',
      date_read: entry.date_read,
      rating: 0,
      cover: path.posix.join('images', 'covers', filename),
      id: entry.id,
      ya: false,
    });
  }

  await fs.writeFile(dataFile, serializeItems(items));

  console.log(JSON.stringify({
    fetched: uniqueEntries.length,
    added: enrichedEntries.length,
    skippedExisting: uniqueEntries.length - enrichedEntries.length,
    lastImported: enrichedEntries[0]?.title || null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
