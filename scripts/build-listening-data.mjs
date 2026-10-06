#!/usr/bin/env node
// Build listening_data.js from a Spotify Extended Streaming History export.
//
//   node scripts/build-listening-data.mjs ~/Downloads/my_spotify_data
//
// Pass the unzipped export folder (the one holding Streaming_History_Audio_*.json).
// The raw export is not kept in the repo: every row carries the IP address it was
// streamed from, so only these aggregates are published.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'listening_data.js');

const PLAY_MS = 30_000; // a "play" is 30 seconds or more, Spotify's own threshold
const CAP_MS = 4 * 3_600_000; // a few video-podcast rows log 9-15 hours for one episode
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Side B starts with the first stream from Japan after this date.
const SPLIT_SEARCH_FROM = Date.parse('2021-06-01T00:00:00Z');
// Spotify became the everyday player in April 2016; Side A per-day averages start here.
const REGULAR_FROM = '2016-04-01';
const COUNTRY_TZ = {
  JP: 'Asia/Tokyo', US: 'America/Los_Angeles', CA: 'America/Vancouver', MY: 'Asia/Kuala_Lumpur',
  SG: 'Asia/Singapore', GB: 'Europe/London', NP: 'Asia/Kathmandu', TH: 'Asia/Bangkok',
  DE: 'Europe/Berlin', FR: 'Europe/Paris', HK: 'Asia/Hong_Kong', GR: 'Europe/Athens',
  RO: 'Europe/Bucharest', KR: 'Asia/Seoul', IN: 'Asia/Kolkata', TR: 'Europe/Istanbul',
};

// ---------------------------------------------------------------- load
const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/build-listening-data.mjs <unzipped Spotify export folder>');
  process.exit(1);
}

function findExportFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findExportFiles(full));
    else if (/^Streaming_History_(Audio|Video)_.*\.json$/.test(entry.name)) found.push(full);
  }
  return found.sort();
}

const files = findExportFiles(path.resolve(src));
if (!files.length) {
  console.error(`No Streaming_History_*.json files under ${src}`);
  process.exit(1);
}

let rowsRaw = 0;
const seen = new Set();
const rows = [];
let otherRows = 0;
let cappedStreams = 0;
let cappedMs = 0;
let cappedMax = 0;
let offlineRetimed = 0;
for (const file of files) {
  const video = /Streaming_History_Video_/.test(path.basename(file));
  for (const r of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    rowsRaw += 1;
    const key = [r.ts, r.ms_played, r.spotify_track_uri ?? '', r.spotify_episode_uri ?? ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    let kind = null;
    if (r.spotify_episode_uri) kind = 'podcast';
    else if (r.spotify_track_uri && !video) kind = 'music';
    if (!kind) { otherRows += 1; continue; }
    let ms = r.ms_played || 0;
    if (ms > CAP_MS) { cappedStreams += 1; cappedMs += ms - CAP_MS; cappedMax = Math.max(cappedMax, ms); ms = CAP_MS; }
    // `ts` is when Spotify logged the stream's end. Offline plays are only logged once the
    // phone syncs, so a flight's worth of songs can share one `ts`; for those rows
    // `offline_timestamp` (seconds or milliseconds) holds the real start of each play.
    const loggedEnd = Date.parse(r.ts);
    let end = loggedEnd;
    let offline = false;
    if (r.offline === true && typeof r.offline_timestamp === 'number' && r.offline_timestamp > 0) {
      const start = r.offline_timestamp > 1e11 ? r.offline_timestamp : r.offline_timestamp * 1000;
      if (start <= loggedEnd + HOUR && start >= loggedEnd - 30 * DAY) {
        end = Math.min(start + (r.ms_played || 0), loggedEnd + HOUR);
        offline = true;
        offlineRetimed += 1;
      }
    }
    rows.push({
      ts: end,
      offline,
      ms,
      rawMs: r.ms_played || 0,
      kind,
      video,
      cc: r.conn_country,
      track: r.master_metadata_track_name,
      artist: r.master_metadata_album_artist_name,
      album: r.master_metadata_album_album_name,
      show: r.episode_show_name,
      episodeUri: r.spotify_episode_uri,
      reasonStart: r.reason_start,
      reasonEnd: r.reason_end,
      shuffle: r.shuffle === true,
    });
  }
}
const rowsDedup = seen.size;
rows.sort((a, b) => a.ts - b.ts);

// ---------------------------------------------------------------- local time
const formatters = new Map();
const offsets = new Map();
function offsetMs(tz, utcMs) {
  const hourStart = Math.floor(utcMs / HOUR) * HOUR;
  const key = `${tz}|${hourStart}`;
  let off = offsets.get(key);
  if (off === undefined) {
    let fmt = formatters.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
      });
      formatters.set(tz, fmt);
    }
    const p = Object.fromEntries(fmt.formatToParts(new Date(hourStart)).map((x) => [x.type, x.value]));
    off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - hourStart;
    offsets.set(key, off);
  }
  return off;
}

let lastTz = null;
for (const r of rows) {
  r.tz = COUNTRY_TZ[r.cc] || null; // ZZ and unknown countries take their neighbours' zone
  if (r.tz) lastTz = r.tz;
  else r.tz = lastTz;
}
let nextTz = null;
for (let i = rows.length - 1; i >= 0; i -= 1) {
  if (rows[i].tz) nextTz = rows[i].tz;
  else rows[i].tz = nextTz || 'UTC';
}

const iso = (localMs) => new Date(localMs).toISOString().slice(0, 10);
for (const r of rows) {
  r.startUtc = r.ts - r.ms;
  r.endLocal = r.ts + offsetMs(r.tz, r.ts);
  r.startLocal = r.startUtc + offsetMs(r.tz, r.startUtc);
  r.date = iso(r.endLocal);
  r.year = +r.date.slice(0, 4);
  r.ym = r.date.slice(0, 7);
  r.h = r.ms / HOUR;
  r.isPlay = r.kind === 'music' && r.rawMs >= PLAY_MS;
  if (r.kind === 'music' && r.track && r.artist) {
    r.tkey = `${r.track.toLowerCase().trim()}␟${r.artist.toLowerCase().trim()}`;
    r.akey = r.album ? `${r.album.toLowerCase().trim()}␟${r.artist.toLowerCase().trim()}` : null;
  }
}

// ---------------------------------------------------------------- helpers
const round = (x, d = 1) => Number(x.toFixed(d));
const sum = (list, f) => list.reduce((acc, x) => acc + f(x), 0);
function groupBy(list, keyFn) {
  const map = new Map();
  for (const x of list) {
    const k = keyFn(x);
    if (k === undefined || k === null) continue;
    let arr = map.get(k);
    if (!arr) { arr = []; map.set(k, arr); }
    arr.push(x);
  }
  return map;
}
const hoursOf = (list) => sum(list, (x) => x.h);
function topBy(map, scoreFn, n, tieFn) {
  return [...map.entries()]
    .map(([k, v]) => ({ k, v, s: scoreFn(v, k), t: tieFn ? tieFn(v, k) : 0 }))
    .sort((a, b) => b.s - a.s || b.t - a.t || String(a.k).localeCompare(String(b.k)))
    .slice(0, n);
}
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

const music = rows.filter((r) => r.kind === 'music');
const pods = rows.filter((r) => r.kind === 'podcast');
const plays = music.filter((r) => r.isPlay);
const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
const firstDate = rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date);
const lastDate = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);

const moveRow = rows.find((r) => r.cc === 'JP' && !r.offline && r.ts >= SPLIT_SEARCH_FROM);
const moveUtc = moveRow ? moveRow.ts : Infinity;
for (const r of rows) r.era = r.ts < moveUtc ? 'US' : 'JP';

// ---------------------------------------------------------------- totals
const out = {};
out.meta = {
  rows_raw: rowsRaw,
  rows_dedup: rowsDedup,
  dupes: rowsRaw - rowsDedup,
  first: firstDate,
  last: lastDate,
  move_date: moveRow ? moveRow.date : null,
  play_ms: PLAY_MS,
  capped_streams: cappedStreams,
  capped_hours_removed: round(cappedMs / HOUR),
  capped_max_hours: round(cappedMax / HOUR),
  audiobook_or_other_rows: otherRows,
  offline_retimed: offlineRetimed,
  offline_hours: round(hoursOf(rows.filter((r) => r.offline))),
  built: new Date().toLocaleDateString('en-CA'),
};

const artistPlays = groupBy(plays, (r) => r.artist);
const countryHours = groupBy(rows.filter((r) => r.cc && r.cc !== 'ZZ'), (r) => r.cc);
out.totals = {
  hours_all: round(hoursOf(rows)),
  hours_music: round(hoursOf(music)),
  hours_podcast: round(hoursOf(pods)),
  streams_all: rows.length,
  plays_music: plays.length,
  artists: new Set(music.map((r) => r.artist).filter(Boolean)).size,
  artists_5plays: [...artistPlays.values()].filter((v) => v.length >= 5).length,
  tracks: new Set(music.map((r) => r.tkey).filter(Boolean)).size,
  shows: new Set(pods.map((r) => r.show).filter(Boolean)).size,
  episodes: new Set(pods.map((r) => r.episodeUri).filter(Boolean)).size,
  countries: countryHours.size,
  days_active: new Set(rows.map((r) => r.date)).size,
  span_days: daysBetween(firstDate, lastDate) + 1,
};
out.countries = [...countryHours.entries()]
  .map(([cc, list]) => ({ cc, hours: round(hoursOf(list)) }))
  .sort((a, b) => b.hours - a.hours);

// ---------------------------------------------------------------- monthly
const months = [];
for (let y = +firstDate.slice(0, 4), mo = +firstDate.slice(5, 7); ; ) {
  const key = `${y}-${String(mo).padStart(2, '0')}`;
  months.push(key);
  if (key === lastDate.slice(0, 7)) break;
  mo += 1;
  if (mo > 12) { mo = 1; y += 1; }
}
const musicByMonth = groupBy(music, (r) => r.ym);
const podsByMonth = groupBy(pods, (r) => r.ym);
out.monthly = months.map((m) => ({
  m,
  music: round(hoursOf(musicByMonth.get(m) || []), 2),
  podcast: round(hoursOf(podsByMonth.get(m) || []), 2),
}));

// ---------------------------------------------------------------- listening clock
function clock(list) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const r of list) {
    let t = r.startLocal;
    let rem = r.ms;
    while (rem > 0) {
      const next = (Math.floor(t / HOUR) + 1) * HOUR;
      const chunk = Math.min(rem, next - t);
      const d = new Date(t);
      grid[(d.getUTCDay() + 6) % 7][d.getUTCHours()] += chunk / HOUR;
      rem -= chunk;
      t = next;
    }
  }
  return grid;
}
const gridTotal = (g) => g.reduce((a, row) => a + row.reduce((b, v) => b + v, 0), 0);
const hourProfile = (g) => {
  const tot = gridTotal(g) || 1;
  return Array.from({ length: 24 }, (_, h) => g.reduce((a, row) => a + row[h], 0) / tot);
};

// ---------------------------------------------------------------- per year
const firstPlayYear = new Map();
for (const [artist, list] of artistPlays) firstPlayYear.set(artist, Math.min(...list.map((r) => r.year)));
const trackInfo = new Map();
for (const r of plays) if (!trackInfo.has(r.tkey)) trackInfo.set(r.tkey, { track: r.track, artist: r.artist });
const trackHours = groupBy(music, (r) => r.tkey);

out.yearly = years.map((y) => {
  const my = music.filter((r) => r.year === y);
  const py = pods.filter((r) => r.year === y);
  const pl = my.filter((r) => r.isPlay);
  let days = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY;
  if (y === +firstDate.slice(0, 4)) days = daysBetween(firstDate, `${y}-12-31`) + 1;
  if (y === +lastDate.slice(0, 4)) days = daysBetween(`${y}-01-01`, lastDate) + 1;
  const hm = hoursOf(my);
  const hp = hoursOf(py);
  const topArtists = topBy(groupBy(my, (r) => r.artist), hoursOf, 5);
  const topTracks = topBy(groupBy(pl, (r) => r.tkey), (v) => v.length, 3, hoursOf);
  const topShows = topBy(groupBy(py, (r) => r.show), hoursOf, 3);
  const prof = hourProfile(clock(rows.filter((r) => r.year === y)));
  return {
    year: y,
    days_in_data: days,
    hours_music: round(hm),
    hours_podcast: round(hp),
    plays: pl.length,
    artists: new Set(pl.map((r) => r.artist)).size,
    new_artists: new Set(pl.filter((r) => firstPlayYear.get(r.artist) === y).map((r) => r.artist)).size,
    new_artist_share: round(hoursOf(my.filter((r) => firstPlayYear.get(r.artist) === y)) / (hm || 1), 4),
    top_artists: topArtists.map((x) => ({ name: x.k, hours: round(x.s) })),
    top_tracks: topTracks.map((x) => ({ ...trackInfo.get(x.k), plays: x.s })),
    top_shows: topShows.map((x) => ({ name: x.k, hours: round(x.s) })),
    skip_rate: my.length ? round(my.filter((r) => r.reasonEnd === 'fwdbtn').length / my.length, 4) : null,
    shuffle_share: round(hoursOf(my.filter((r) => r.shuffle)) / (hm || 1), 4),
    hours_per_day: round((hm + hp) / days, 2),
    podcast_share: round(hp / ((hm + hp) || 1), 4),
    night_share: round(prof.slice(0, 5).reduce((a, b) => a + b, 0), 4),
  };
});
out.years = years;

// ---------------------------------------------------------------- top artists, songs, albums
const byArtist = groupBy(music, (r) => r.artist);
function yearSeries(list) {
  const by = groupBy(list, (r) => r.year);
  return years.map((y) => round(hoursOf(by.get(y) || [])));
}
function peakYear(list) {
  const by = groupBy(list, (r) => r.year);
  let best = null;
  let bestH = -1;
  for (const y of years) {
    const h = hoursOf(by.get(y) || []);
    if (h > bestH) { bestH = h; best = y; }
  }
  return best;
}
out.top_artists = topBy(byArtist, hoursOf, 15).map(({ k, v, s }) => {
  const pl = artistPlays.get(k) || [];
  const series = yearSeries(v);
  return {
    name: k,
    hours: round(s),
    plays: pl.length,
    tracks: new Set(pl.map((r) => r.tkey)).size,
    first: v[0].date,
    last: v[v.length - 1].date,
    years_active: years.filter((y) => hoursOf(v.filter((r) => r.year === y)) >= 1).length,
    peak_year: peakYear(v),
    by_year: series,
  };
});

const playsByTrack = groupBy(plays, (r) => r.tkey);
const trackRank = topBy(playsByTrack, (v) => v.length, Infinity, (v, k) => hoursOf(trackHours.get(k) || []));
out.top_tracks = trackRank.slice(0, 15).map(({ k, v }) => ({
  track: trackInfo.get(k).track,
  artist: trackInfo.get(k).artist,
  album: topBy(groupBy(v, (r) => r.album), (list) => list.length, 1)[0]?.k ?? null,
  plays: v.length,
  hours: round(hoursOf(trackHours.get(k) || [])),
  first: v[0].date,
  last: v[v.length - 1].date,
  peak_year: [...groupBy(v, (r) => r.year).entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0][0],
}));

const byAlbum = groupBy(music, (r) => r.akey);
out.top_albums = topBy(byAlbum, hoursOf, 10).map(({ k, v, s }) => ({
  album: v[0].album,
  artist: v[0].artist,
  hours: round(s),
  tracks: new Set(v.filter((r) => r.isPlay).map((r) => r.tkey)).size,
  first: v[0].date,
}));

// ---------------------------------------------------------------- podcasts
const byShow = groupBy(pods, (r) => r.show);
out.top_shows = topBy(byShow, hoursOf, 12).map(({ k, v, s }) => ({
  name: k,
  hours: round(s),
  episodes: new Set(v.map((r) => r.episodeUri)).size,
  first: v[0].date,
  last: v[v.length - 1].date,
  peak_year: peakYear(v),
  video_hours: round(hoursOf(v.filter((r) => r.video))),
  by_year: yearSeries(v),
}));
out.podcast_video_hours = round(hoursOf(pods.filter((r) => r.video)));

// ---------------------------------------------------------------- the two sides
out.clock = {};
out.eras = {};
for (const era of ['US', 'JP']) {
  const all = rows.filter((r) => r.era === era);
  if (!all.length) continue;
  const em = all.filter((r) => r.kind === 'music');
  const ep = all.filter((r) => r.kind === 'podcast');
  const grid = clock(all);
  const prof = hourProfile(grid);
  const tot = gridTotal(grid) || 1;
  const weekendShare = grid.slice(5).reduce((a, row) => a + row.reduce((b, v) => b + v, 0), 0) / tot;
  const first = all[0].date;
  const last = all.reduce((m, r) => (r.date > m ? r.date : m), first);
  const from = era === 'US' && last >= REGULAR_FROM ? REGULAR_FROM : first;
  const regular = all.filter((r) => r.date >= from);
  const regularDays = daysBetween(from, last) + 1;
  out.clock[`${era}_all`] = {
    grid: grid.map((row) => row.map((v) => round(v, 2))),
    hours: round(tot),
    night_share: round(prof.slice(0, 5).reduce((a, b) => a + b, 0), 4),
    weekend_share: round(weekendShare, 4),
    peak_hour: prof.indexOf(Math.max(...prof)),
  };
  out.eras[era] = {
    first,
    last,
    hours_music: round(hoursOf(em)),
    hours_podcast: round(hoursOf(ep)),
    podcast_share: round(hoursOf(ep) / (hoursOf(all) || 1), 4),
    top_artists: topBy(groupBy(em, (r) => r.artist), hoursOf, 5).map((x) => ({ name: x.k, hours: round(x.s) })),
    top_shows: topBy(groupBy(ep, (r) => r.show), hoursOf, 5).map((x) => ({ name: x.k, hours: round(x.s) })),
    artists: new Set(em.filter((r) => r.isPlay).map((r) => r.artist)).size,
    regular_from: from,
    hours_per_day_regular: round(hoursOf(regular) / regularDays, 3),
    weeks_regular: round(regularDays / 7),
    night_share: out.clock[`${era}_all`].night_share,
    weekend_share: out.clock[`${era}_all`].weekend_share,
  };
}

// ---------------------------------------------------------------- records
const dayTrack = topBy(groupBy(plays, (r) => `${r.date}|${r.tkey}`), (v) => v.length, 400);
out.repeat_days = [];
const seenTracks = new Set();
for (const { k, v } of dayTrack) {
  const tkey = k.slice(11);
  if (seenTracks.has(tkey)) continue;
  seenTracks.add(tkey);
  out.repeat_days.push({ date: k.slice(0, 10), track: v[0].track, artist: v[0].artist, plays: v.length });
  if (out.repeat_days.length >= 5) break;
}

const musicMonth = new Map([...musicByMonth.entries()].map(([m, list]) => [m, hoursOf(list)]));
const artistMonth = topBy(groupBy(music, (r) => `${r.ym}|${r.artist}`), hoursOf, 2000);
out.binges = [];
const seenArtists = new Set();
for (const { k, s } of artistMonth) {
  const [ym, artist] = [k.slice(0, 7), k.slice(8)];
  if (seenArtists.has(artist)) continue;
  seenArtists.add(artist);
  out.binges.push({ artist, month: ym, hours: round(s), share: round(s / (musicMonth.get(ym) || 1), 4) });
  if (out.binges.length >= 6) break;
}

const byDate = groupBy(rows, (r) => r.date);
const bigDay = topBy(byDate, hoursOf, 1)[0];
out.biggest_day = {
  date: bigDay.k,
  hours: round(bigDay.s),
  music_hours: round(hoursOf(bigDay.v.filter((r) => r.kind === 'music'))),
  podcast_hours: round(hoursOf(bigDay.v.filter((r) => r.kind === 'podcast'))),
  top: Object.fromEntries(topBy(groupBy(bigDay.v, (r) => (r.kind === 'music' ? `a|${r.artist}` : `s|${r.show}`)), hoursOf, 3)
    .map((x) => [x.k, round(x.s)])),
};

const dates = [...byDate.keys()].sort();
let best = 1;
let cur = 1;
let bestEnd = dates[0];
for (let i = 1; i < dates.length; i += 1) {
  cur = daysBetween(dates[i - 1], dates[i]) === 1 ? cur + 1 : 1;
  if (cur > best) { best = cur; bestEnd = dates[i]; }
}
out.streak = {
  days: best,
  start: new Date(Date.parse(bestEnd) - (best - 1) * DAY).toISOString().slice(0, 10),
  end: bestEnd,
};

const cut = new Date(Date.parse(lastDate) - 730 * DAY).toISOString().slice(0, 10);
out.lost = trackRank
  .filter(({ v }) => v[v.length - 1].date < cut)
  .slice(0, 12)
  .map(({ k, v }) => ({
    track: trackInfo.get(k).track,
    artist: trackInfo.get(k).artist,
    plays: v.length,
    last: v[v.length - 1].date,
  }));

const firstJp = music.find((r) => r.ts >= moveUtc && !r.offline);
out.firsts = {
  first_track: { date: music[0].date, track: music[0].track, artist: music[0].artist },
  first_track_japan: firstJp ? { date: firstJp.date, track: firstJp.track, artist: firstJp.artist } : null,
  latest_track: { date: music[music.length - 1].date, track: music[music.length - 1].track, artist: music[music.length - 1].artist },
};

fs.writeFileSync(OUT, `const listening = ${JSON.stringify(out, null, 1)};\n`);
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${out.totals.streams_all} streams, ${out.totals.hours_all} hours, ${out.meta.first} to ${out.meta.last}`);
