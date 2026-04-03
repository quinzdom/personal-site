import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coversDir = path.join(workspaceDir, 'images', 'covers');
const outputFile = path.join(workspaceDir, 'anime_data.js');
const sourceUrl = process.argv[2] || 'https://myanimelist.net/animelist/gitcom?status=2';
const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const EXCLUDED_ANIME_IDS = new Set([
  2759, // Evangelion: 1.0 You Are (Not) Alone
  3784, // Evangelion: 2.0 You Can (Not) Advance
  3785, // Evangelion: 3.0 You Can (Not) Redo
]);
const EXCLUDED_MEDIA_TYPES = new Set([
  'Movie',
]);
const GROUP_RULES = [
  {
    key: 'anohana',
    title: 'Anohana',
    englishTitle: 'Anohana: The Flower We Saw That Day',
    preferredCoverId: 9989,
    memberIds: [9989, 15039],
  },
  {
    key: 'code-geass',
    title: 'Code Geass',
    englishTitle: 'Code Geass: Lelouch of the Rebellion',
    preferredCoverId: 1575,
    memberIds: [15197, 1575, 2904],
  },
  {
    key: 'doraemon',
    title: 'Doraemon',
    englishTitle: 'Doraemon',
    preferredCoverId: 501,
    memberIds: [501, 2392, 2673, 5096, 6930],
  },
  {
    key: 'lupin-iii',
    title: 'Lupin III',
    englishTitle: 'Lupin III',
    preferredCoverId: 1412,
    memberIds: [1412, 1430, 18429],
  },
  {
    key: 'madoka-magica',
    title: 'Puella Magi Madoka Magica',
    englishTitle: 'Puella Magi Madoka Magica',
    preferredCoverId: 11981,
    memberIds: [11977, 11979, 11981],
  },
  {
    key: 'major',
    title: 'Major',
    englishTitle: 'Major',
    preferredCoverId: 627,
    memberIds: [5029, 627, 558, 1842, 3226, 5028, 7655, 11917],
  },
  {
    key: 'naruto',
    title: 'Naruto',
    englishTitle: 'Naruto',
    preferredCoverId: 20,
    memberIds: [20, 442, 13667],
  },
  {
    key: 'suzumiya-haruhi',
    title: 'The Melancholy of Haruhi Suzumiya',
    englishTitle: 'The Melancholy of Haruhi Suzumiya',
    preferredCoverId: 849,
    memberIds: [7311, 849, 4382],
  },
  {
    key: 'toradora',
    title: 'Toradora!',
    englishTitle: 'Toradora!',
    preferredCoverId: 4224,
    memberIds: [4224, 11553],
  },
];

function decodeHtmlEntities(value = '') {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function extractCompletedList(html) {
  const startMarker = 'data-items="';
  const endMarker = '" data-broadcasts=';
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);

  if (start === -1 || end === -1) {
    throw new Error('Could not find the completed anime list payload in the MyAnimeList page.');
  }

  const payload = html.slice(start + startMarker.length, end);
  return JSON.parse(decodeHtmlEntities(payload));
}

function parseMalDate(value) {
  if (!value) return '';

  const [monthRaw, dayRaw, yearRaw] = value.split('-');
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);
  const twoDigitYear = Number.parseInt(yearRaw, 10);

  if (!month || !day || Number.isNaN(twoDigitYear)) {
    return '';
  }

  const year = twoDigitYear >= 70 ? 1900 + twoDigitYear : 2000 + twoDigitYear;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isoDateFromUnix(seconds) {
  if (!seconds) return '';
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function firstStudio(item) {
  if (!Array.isArray(item.anime_studios) || item.anime_studios.length === 0) {
    return '';
  }

  return decodeHtmlEntities(item.anime_studios[0].name || '');
}

function normaliseItem(item, sourceIndex) {
  const title = decodeHtmlEntities(item.title_localized || item.anime_title || item.anime_title_eng || '').trim();
  const englishTitle = decodeHtmlEntities(item.anime_title_eng || '').trim();
  const completionDate = parseMalDate(item.finish_date_string);
  const updatedDate = isoDateFromUnix(item.updated_at);
  const coverFile = `images/covers/mal-anime-${item.anime_id}.jpg`;

  return {
    id: `mal-${item.anime_id}`,
    mal_id: item.anime_id,
    title,
    english_title: englishTitle && englishTitle !== title ? englishTitle : '',
    cover: coverFile,
    mal_url: `https://myanimelist.net${item.anime_url}`,
    type: item.anime_media_type_string || '',
    episodes: item.anime_num_episodes || 0,
    score: item.score || 0,
    studio: firstStudio(item),
    premiered: item.anime_season?.year ? `${item.anime_season.season} ${item.anime_season.year}` : '',
    date_completed: completionDate,
    updated_date: updatedDate,
    source_index: sourceIndex,
    image_url: item.anime_image_path || '',
    entry_count: 1,
    member_ids: [item.anime_id],
    member_urls: [`https://myanimelist.net${item.anime_url}`],
    member_episodes: [item.anime_num_episodes || 0],
    member_titles: [englishTitle || title],
    member_types: [item.anime_media_type_string || ''],
  };
}

function earliestPremiered(items) {
  const premiered = items
    .map(item => item.premiered)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  return premiered[0] || '';
}

function latestDate(items, key) {
  const values = items.map(item => item[key]).filter(Boolean).sort((left, right) => right.localeCompare(left));
  return values[0] || '';
}

function groupItems(items) {
  const byId = new Map(items.map(item => [item.mal_id, item]));
  const consumedIds = new Set();
  const grouped = [];

  for (const rule of GROUP_RULES) {
    const members = rule.memberIds
      .map(id => byId.get(id))
      .filter(Boolean)
      .sort((left, right) => left.source_index - right.source_index);

    if (members.length <= 1) {
      continue;
    }

    const preferred = members.find(item => item.mal_id === rule.preferredCoverId) || members[0];
    const scoreValues = members.map(item => item.score).filter(Boolean);
    const averageScore = scoreValues.length
      ? Number((scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length).toFixed(1))
      : 0;
    const memberTypes = [...new Set(members.map(item => item.type).filter(Boolean))];
    const displayType = members.some(item => item.type !== 'Movie') ? 'Series' : 'Movie';

    grouped.push({
      id: `mal-group-${rule.key}`,
      mal_id: preferred.mal_id,
      title: rule.title,
      english_title: rule.englishTitle,
      cover: preferred.cover,
      mal_url: preferred.mal_url,
      type: displayType,
      episodes: members.reduce((sum, item) => sum + (item.episodes || 0), 0),
      score: averageScore,
      studio: preferred.studio,
      premiered: earliestPremiered(members),
      date_completed: latestDate(members, 'date_completed'),
      updated_date: latestDate(members, 'updated_date'),
      source_index: Math.min(...members.map(item => item.source_index)),
      image_url: preferred.image_url,
      entry_count: members.length,
      member_ids: members.map(item => item.mal_id),
      member_urls: members.map(item => item.mal_url),
      member_episodes: members.map(item => item.episodes || 0),
      member_titles: members.map(item => item.english_title || item.title),
      member_types: memberTypes,
    });

    members.forEach(item => consumedIds.add(item.mal_id));
  }

  const singles = items.filter(item => !consumedIds.has(item.mal_id));
  return [...grouped, ...singles].sort((left, right) => left.source_index - right.source_index);
}

async function downloadCover(item) {
  if (!item.image_url) return false;

  const targetPath = path.join(workspaceDir, item.cover);

  try {
    const stat = await fs.stat(targetPath);
    if (stat.size > 0) {
      return false;
    }
  } catch {
    // File does not exist yet.
  }

  const response = await fetch(item.image_url, {
    headers: {
      'user-agent': userAgent,
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      referer: 'https://myanimelist.net/',
    },
  });

  if (!response.ok) {
    throw new Error(`Cover download failed for ${item.title}: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(targetPath, buffer);
  return true;
}

async function pruneStaleCovers(items) {
  const expectedFiles = new Set(items.map(item => path.basename(item.cover)));
  const existingFiles = await fs.readdir(coversDir);

  await Promise.all(
    existingFiles
      .filter(file => file.startsWith('mal-anime-') && !expectedFiles.has(file))
      .map(file => fs.unlink(path.join(coversDir, file))),
  );
}

function serialiseData(items) {
  const safeItems = items.map(({ image_url, ...item }) => item);
  return `const animeItems = ${JSON.stringify(safeItems, null, 2)};\n`;
}

async function main() {
  await fs.mkdir(coversDir, { recursive: true });

  const response = await fetch(sourceUrl, {
    headers: {
      'user-agent': userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch MyAnimeList page: ${response.status}`);
  }

  const html = await response.text();
  const rawItems = extractCompletedList(html);
  const filteredRawItems = rawItems.filter(
    item => !EXCLUDED_ANIME_IDS.has(item.anime_id) && !EXCLUDED_MEDIA_TYPES.has(item.anime_media_type_string),
  );
  const items = groupItems(filteredRawItems.map(normaliseItem));

  let downloaded = 0;

  for (const item of items) {
    const didDownload = await downloadCover(item);
    if (didDownload) {
      downloaded += 1;
    }
  }

  await pruneStaleCovers(items);

  await fs.writeFile(outputFile, serialiseData(items), 'utf8');

  const withDates = items.filter(item => item.date_completed).length;
  console.log(
    JSON.stringify(
      {
        sourceUrl,
        imported: items.length,
        withCompletionDates: withDates,
        withoutCompletionDates: items.length - withDates,
        downloaded,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
