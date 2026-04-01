import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const workspaceDir = process.cwd();
const dataFile = path.join(workspaceDir, 'items_data.js');
const coversDir = path.join(workspaceDir, 'images', 'covers');
const CONCURRENCY = 6;

function loadItems(source) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.__items__ = items;`, context);
  return context.__items__;
}

function escapeString(value) {
  return JSON.stringify(value);
}

function slugifyId(id) {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function inferExtension(url, contentType) {
  const pathname = new URL(url).pathname;
  const ext = path.extname(pathname).toLowerCase();
  if (ext) return ext;

  if (contentType?.includes('jpeg')) return '.jpg';
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('webp')) return '.webp';
  if (contentType?.includes('gif')) return '.gif';
  if (contentType?.includes('svg')) return '.svg';
  if (contentType?.includes('avif')) return '.avif';

  return '.jpg';
}

function serializeItems(items) {
  const rows = items.map((item) => {
    return `{title:${escapeString(item.title)},author:${escapeString(item.author)},type:${escapeString(item.type)},date_read:${escapeString(item.date_read)},rating:${item.rating},cover:${escapeString(item.cover)},id:${escapeString(item.id)},ya:${item.ya}}`;
  });

  return `const items = [\n${rows.join(',\n')}\n];\n`;
}

function extractBoxdCode(id) {
  const match = id.match(/boxd\.it\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

function extractPosterUrl(html) {
  const patterns = [
    /<meta property="og:image" content="([^"]+)"/i,
    /<meta property='og:image' content='([^']+)'/i,
    /<meta property="og:image:secure_url" content="([^"]+)"/i,
    /<meta name="twitter:image" content="([^"]+)"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }

  return null;
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Codex cover filler)',
      accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Codex cover filler)',
      accept: 'image/*,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const extension = inferExtension(url, contentType);
  const finalPath = targetPath.endsWith(extension) ? targetPath : `${targetPath}${extension}`;
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(finalPath, bytes);
  return finalPath;
}

async function processItem(item) {
  const code = extractBoxdCode(item.id);
  if (!code) {
    return { ok: false, reason: 'missing-boxd-code' };
  }

  const pageHtml = await fetchText(`https://boxd.it/${code}`);
  const posterUrl = extractPosterUrl(pageHtml);
  if (!posterUrl) {
    return { ok: false, reason: 'missing-poster-url' };
  }

  const basePath = path.join(coversDir, `${slugifyId(item.id)}`);
  const finalPath = await downloadFile(posterUrl, basePath);
  item.cover = path.posix.join('images', 'covers', path.basename(finalPath));
  return { ok: true, posterUrl, finalPath };
}

async function mapLimit(values, limit, iteratee) {
  const results = new Array(values.length);
  let index = 0;

  async function worker() {
    while (index < values.length) {
      const current = index;
      index += 1;
      results[current] = await iteratee(values[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, values.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function main() {
  await fs.mkdir(coversDir, { recursive: true });

  const source = await fs.readFile(dataFile, 'utf8');
  const items = loadItems(source);
  const blanks = items.filter((item) => item.type === 'movie' && !item.cover);

  const results = await mapLimit(blanks, CONCURRENCY, async (item) => {
    try {
      return { id: item.id, title: item.title, ...(await processItem(item)) };
    } catch (error) {
      return { id: item.id, title: item.title, ok: false, reason: String(error) };
    }
  });

  await fs.writeFile(dataFile, serializeItems(items));

  const summary = {
    totalBlankMovies: blanks.length,
    downloaded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    failures: results.filter((result) => !result.ok).slice(0, 20),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
