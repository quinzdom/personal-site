import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const workspaceDir = process.cwd();
const dataFile = path.join(workspaceDir, 'items_data.js');
const coversDir = path.join(workspaceDir, 'images', 'covers');

function loadItems(source) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.__items__ = items;`, context);
  return context.__items__;
}

function escapeString(value) {
  return JSON.stringify(value);
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

  return '.img';
}

function slugifyId(id) {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function serializeItems(items) {
  const rows = items.map((item) => {
    return `{title:${escapeString(item.title)},author:${escapeString(item.author)},type:${escapeString(item.type)},date_read:${escapeString(item.date_read)},rating:${item.rating},cover:${escapeString(item.cover)},id:${escapeString(item.id)},ya:${item.ya}}`;
  });

  return `const items = [\n${rows.join(',\n')}\n];\n`;
}

async function downloadCover(item) {
  if (!item.cover || !/^https?:\/\//.test(item.cover)) {
    return { item, changed: false, skipped: true };
  }

  const response = await fetch(item.cover, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Codex cover downloader)',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const extension = inferExtension(item.cover, contentType);
  const filename = `${slugifyId(item.id)}${extension}`;
  const relativePath = path.posix.join('images', 'covers', filename);
  const absolutePath = path.join(coversDir, filename);

  await fs.access(absolutePath).catch(async () => {
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(absolutePath, Buffer.from(arrayBuffer));
  });

  item.cover = relativePath;
  return { item, changed: true, skipped: false };
}

async function main() {
  await fs.mkdir(coversDir, { recursive: true });

  const source = await fs.readFile(dataFile, 'utf8');
  const items = loadItems(source);

  let downloaded = 0;
  let skipped = 0;
  const failures = [];

  for (const item of items) {
    try {
      const result = await downloadCover(item);
      if (result.skipped) {
        skipped += 1;
      } else if (result.changed) {
        downloaded += 1;
      }
    } catch (error) {
      failures.push({ id: item.id, title: item.title, url: item.cover, error: String(error) });
    }
  }

  await fs.writeFile(dataFile, serializeItems(items));

  console.log(JSON.stringify({
    downloaded,
    skipped,
    failures,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
