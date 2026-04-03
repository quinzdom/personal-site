import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const workspaceDir = process.cwd();
const sourceFile = path.join(workspaceDir, 'data-source', 'tv', 'shows.json');
const outputFile = path.join(workspaceDir, 'tv_data.js');
const coversDir = path.join(workspaceDir, 'images', 'covers');
const execFileAsync = promisify(execFile);

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

async function fetchJson(url) {
  const { stdout } = await execFileAsync('curl', [
    '-fsSL',
    '--max-time', '20',
    '-H', 'user-agent: Mozilla/5.0 (compatible; Codex TV builder)',
    '-H', 'accept: application/json',
    url,
  ]);
  return JSON.parse(stdout);
}

async function downloadFile(url, destination) {
  await execFileAsync('curl', [
    '-fsSL',
    '--max-time', '30',
    '-H', 'user-agent: Mozilla/5.0 (compatible; Codex TV builder)',
    '-H', 'accept: image/*,*/*',
    '-o', destination,
    url,
  ]);
}

function pickEpisodes(show) {
  const episodes = show._embedded?.episodes || [];
  const regularEpisodes = episodes.filter((episode) => episode.type === 'regular');
  return regularEpisodes.length ? regularEpisodes : episodes;
}

function getCoverExtension(url) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return ext && ext.length <= 5 ? ext : '.jpg';
  } catch {
    return '.jpg';
  }
}

function serializeTvItems(tvItems) {
  return `const tvItems = ${JSON.stringify(tvItems, null, 2)};\n`;
}

async function main() {
  const source = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  await fs.mkdir(coversDir, { recursive: true });

  const seen = new Set();
  const tvItems = [];

  for (const [index, entry] of source.entries()) {
    const query = entry.query || entry.title;
    if (!query) continue;

    const show = await fetchJson(
      `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(query)}&embed=episodes`
    );

    if (seen.has(show.id)) continue;
    seen.add(show.id);

    const episodes = pickEpisodes(show);
    const fallbackRuntime = Number(show.averageRuntime || show.runtime || 0);
    const totalMinutes = episodes.reduce(
      (sum, episode) => sum + Number(episode.runtime || fallbackRuntime || 0),
      0
    );

    let cover = '';
    const coverUrl = show.image?.original || show.image?.medium || '';
    if (coverUrl) {
      const extension = getCoverExtension(coverUrl);
      const filename = `tv-${show.id}${extension}`;
      await downloadFile(coverUrl, path.join(coversDir, filename));
      cover = `images/covers/${filename}`;
    }

    tvItems.push({
      id: `tvmaze-${show.id}`,
      tvmaze_id: show.id,
      title: entry.title || show.name,
      cover,
      tvmaze_url: show.url,
      format: show.type || 'Scripted',
      language: show.language || '',
      network: show.network?.name || show.webChannel?.name || '',
      episodes: episodes.length,
      runtime_minutes: fallbackRuntime,
      total_minutes: totalMinutes,
      hours: roundToOneDecimal(totalMinutes / 60),
      premiered: show.premiered || '',
      ended: show.ended || '',
      date_completed: entry.date_completed || '',
      source_index: index,
    });
  }

  await fs.writeFile(outputFile, serializeTvItems(tvItems));
  console.log(JSON.stringify({ tvShows: tvItems.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
