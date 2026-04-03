import fs from 'node:fs/promises';
import path from 'node:path';

const workspaceDir = process.cwd();
const sourceFile = path.join(workspaceDir, 'data-source', 'manga', 'list.json');
const outputFile = path.join(workspaceDir, 'manga_data.js');
const coverDir = path.join(workspaceDir, 'images', 'covers');
const REQUEST_HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; Codex manga builder)',
  accept: 'text/html,application/xhtml+xml,*/*',
};

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function normalizeWhitespace(value) {
  return decodeHtml(String(value || '').replace(/\s+/g, ' ')).trim();
}

function extractYear(value) {
  const match = String(value || '').match(/(1[0-9]{3}|20[0-9]{2}|2100)/);
  return match ? Number(match[1]) : null;
}

async function fetchText(url) {
  const attempts = 4;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url, {
      headers: REQUEST_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });

    if (response.ok) {
      return response.text();
    }

    if (attempt === attempts - 1) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }

  throw new Error(`Unable to fetch ${url}`);
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': REQUEST_HEADERS['user-agent'],
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function extractMeta(html, property) {
  const match = html.match(new RegExp(`<meta\\s+property="${property}"\\s+content="([^"]+)"`, 'i'));
  return normalizeWhitespace(match ? match[1] : '');
}

function extractCanonical(html) {
  const match = html.match(/<link rel="canonical" href="([^"]+)"/i);
  return normalizeWhitespace(match ? match[1] : '');
}

function extractField(html, label) {
  const match = html.match(new RegExp(`<span class="dark_text">${label}:<\\/span>\\s*([^<\\n]+)`, 'i'));
  return normalizeWhitespace(match ? match[1] : '');
}

function extractAuthors(html) {
  const section = html.match(/<span class="dark_text">Authors:<\/span>([\s\S]*?)<\/div>/i);
  if (!section) return '';

  const names = [...section[1].matchAll(/<a [^>]*>([^<]+)<\/a>/gi)]
    .map((match) => normalizeWhitespace(match[1]))
    .filter(Boolean);

  return [...new Set(names)].join(', ');
}

function serialize(items) {
  return `const mangaItems = ${JSON.stringify(items, null, 2)};\n`;
}

function formatCoverPath(malId) {
  return `images/covers/mal-manga-${malId}.jpg`;
}

async function buildEntry(source, index) {
  const pageUrl = `https://myanimelist.net/manga/${source.mal_id}`;
  const html = await fetchText(pageUrl);
  const title = extractMeta(html, 'og:title') || source.title;
  const englishTitle = extractField(html, 'English');
  const coverUrl = extractMeta(html, 'og:image');
  const canonicalUrl = extractCanonical(html) || pageUrl;
  const author = extractAuthors(html);
  const published = extractField(html, 'Published');
  const publishedYear = extractYear(published);
  const type = extractField(html, 'Type') || 'Manga';
  const totalVolumes = Number(extractField(html, 'Volumes')) || null;
  const totalChapters = Number(extractField(html, 'Chapters')) || null;
  const localCoverPath = formatCoverPath(source.mal_id);
  const coverBuffer = coverUrl ? await fetchBuffer(coverUrl) : null;

  if (coverBuffer) {
    await fs.writeFile(path.join(workspaceDir, localCoverPath), coverBuffer);
  }

  return {
    id: `mal-manga-${source.mal_id}`,
    mal_id: source.mal_id,
    title,
    english_title: englishTitle,
    author,
    cover: localCoverPath,
    mal_url: canonicalUrl,
    type,
    score: Number(source.score || 0),
    chapters_read: Number(source.chapters_read || 0) || null,
    volumes_read: Number(source.volumes_read || 0) || null,
    total_chapters: totalChapters,
    total_volumes: totalVolumes,
    published: published,
    published_year: publishedYear,
    date_completed: '',
    source_index: index,
  };
}

async function main() {
  await fs.mkdir(coverDir, { recursive: true });
  const source = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  const items = [];

  for (let index = 0; index < source.length; index += 1) {
    items.push(await buildEntry(source[index], index));
  }

  await fs.writeFile(outputFile, serialize(items));

  console.log(JSON.stringify({
    manga: items.length,
    covers: items.filter((item) => item.cover).length,
    output: path.relative(workspaceDir, outputFile),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
