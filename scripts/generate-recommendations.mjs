import fs from 'node:fs/promises';
import path from 'node:path';

const workspaceDir = process.cwd();
const stateFile = path.join(workspaceDir, 'recommendations_state.json');
const outputFile = path.join(workspaceDir, 'recommendations.html');
const coversDir = path.join(workspaceDir, 'images', 'covers');

// Full pool of recommendations — never shown twice until all are exhausted
const BOOK_POOL = [
  {
    title: 'Spring Snow',
    author: 'Yukio Mishima',
    cover: 'https://images-na.ssl-images-amazon.com/images/S/compressed.photo.goodreads.com/books/1388342298i/9532.jpg',
    coverId: 'rec-spring-snow',
    why: 'The first volume of The Sea of Fertility tetralogy — Mishima\'s magnum opus. You\'ve read four of his novels and 仮面の告白 is an all-time favourite. An aristocratic love story set in Taisho-era Japan.',
  },
  {
    title: 'Demons',
    author: 'Fyodor Dostoevsky',
    cover: 'https://images-na.ssl-images-amazon.com/images/S/compressed.photo.goodreads.com/books/1327862316i/12278.jpg',
    coverId: 'rec-demons',
    why: 'Dostoevsky\'s most politically prophetic novel — revolutionary nihilism in a provincial town. Pairs naturally with The Captive Mind, another favourite.',
  },
  {
    title: 'The Rings of Saturn',
    author: 'W.G. Sebald',
    cover: 'https://images-na.ssl-images-amazon.com/images/S/compressed.photo.goodreads.com/books/1388272376i/24970.jpg',
    coverId: 'rec-rings-of-saturn',
    why: 'A walking memoir that dissolves into digressions on Conrad, silk, and destroyed landscapes. Somewhere between Proust and Fustel de Coulanges.',
  },
  {
    title: 'The Man Without Qualities',
    author: 'Robert Musil',
    cover: 'https://images-na.ssl-images-amazon.com/images/S/compressed.photo.goodreads.com/books/1388360456i/60569.jpg',
    coverId: 'rec-man-without-qualities',
    why: 'If Proust and Dostoevsky had a third sibling. Set in the twilight of the Austro-Hungarian Empire, endlessly digressive and ironic.',
  },
  {
    title: 'Autobiography of a Corpse',
    author: 'Sigizmund Krzhizhanovsky',
    cover: 'https://images-na.ssl-images-amazon.com/images/S/compressed.photo.goodreads.com/books/1360946037i/15796106.jpg',
    coverId: 'rec-autobiography-corpse',
    why: 'Soviet-era stories with the underground intensity of Dostoevsky filtered through absurdism. Short and very strange.',
  },
  {
    title: 'Native Realm',
    author: 'Czesław Miłosz',
    cover: 'https://images-na.ssl-images-amazon.com/images/S/compressed.photo.goodreads.com/books/1388183562i/289061.jpg',
    coverId: 'rec-native-realm',
    why: 'Miłosz\'s memoir — the natural follow-up to The Captive Mind. A life lived across pre-war Vilnius, Nazi occupation, and Communist Poland.',
  },
  {
    title: 'The Unnamable',
    author: 'Samuel Beckett',
    cover: 'https://images-na.ssl-images-amazon.com/images/S/compressed.photo.goodreads.com/books/1388338697i/110418.jpg',
    coverId: 'rec-unnamable',
    why: 'You read Waiting for Godot. This is Beckett\'s prose trilogy pushed to its limit — pure voice, no character, no plot. The endgame of European nihilism.',
  },
];

const MOVIE_POOL = [
  {
    title: 'Yi Yi',
    author: 'Edward Yang, 2000',
    cover: 'https://a.ltrbxd.com/resized/film-poster/5/1/7/8/3/51783-yi-yi-0-1000-0-1500-crop.jpg',
    coverId: 'rec-yi-yi',
    why: 'The Taiwanese equivalent of Kore-eda\'s family films you love. A three-hour portrait of a Taipei family. Often called one of the greatest films ever made.',
  },
  {
    title: 'Taste of Cherry',
    author: 'Abbas Kiarostami, 1997',
    cover: 'https://a.ltrbxd.com/resized/film-poster/5/1/7/5/1/51751-taste-of-cherry-0-1000-0-1500-crop.jpg',
    coverId: 'rec-taste-of-cherry',
    why: 'You watched Close-Up. This is Kiarostami\'s Palme d\'Or winner — a man drives through the hills outside Tehran looking for someone to bury him.',
  },
  {
    title: 'Satantango',
    author: 'Béla Tarr, 1994',
    cover: 'https://a.ltrbxd.com/resized/film-poster/4/8/1/7/4817-satantango-0-1000-0-1500-crop.jpg',
    coverId: 'rec-satantango',
    why: 'An Elephant Sitting Still was made under Tarr\'s direct influence. This is the source — seven hours of Hungarian rural despair, rain, and long takes.',
  },
  {
    title: 'The Conformist',
    author: 'Bernardo Bertolucci, 1970',
    cover: 'https://a.ltrbxd.com/resized/film-poster/5/1/3/8/2/51382-the-conformist-0-1000-0-1500-crop.jpg',
    coverId: 'rec-conformist',
    why: 'Pairs with The Captive Mind and your interest in fascism as psychology. A man joins Mussolini\'s secret police to suppress his own nature. Visually stunning.',
  },
  {
    title: 'Céline and Julie Go Boating',
    author: 'Jacques Rivette, 1974',
    cover: 'https://a.ltrbxd.com/resized/film-poster/5/1/0/7/4/51074-celine-and-julie-go-boating-0-1000-0-1500-crop.jpg',
    coverId: 'rec-celine-julie',
    why: 'You\'ve watched a lot of French cinema — Rohmer, Malle, Bresson, Godard. This Rivette masterpiece is the great gap. Playful and mysterious.',
  },
  {
    title: 'Syndromes and a Century',
    author: 'Apichatpong Weerasethakul, 2006',
    cover: 'https://a.ltrbxd.com/resized/film-poster/4/6/5/6/4656-syndromes-and-a-century-0-1000-0-1500-crop.jpg',
    coverId: 'rec-syndromes',
    why: 'If Perfect Days and the contemplative end of your taste had an Asian counterpart. Thai hospital life, memory, and light.',
  },
  {
    title: 'Vengeance Is Mine',
    author: 'Shohei Imamura, 1979',
    cover: 'https://a.ltrbxd.com/resized/film-poster/4/9/2/4/4924-vengeance-is-mine-0-1000-0-1500-crop.jpg',
    coverId: 'rec-vengeance',
    why: 'Given Love Exposure (5 stars) and your appetite for dark Japanese cinema that goes somewhere real. A serial killer case reconstructed coldly.',
  },
  {
    title: 'Cleo from 5 to 7',
    author: 'Agnès Varda, 1962',
    cover: 'https://a.ltrbxd.com/resized/film-poster/5/1/0/0/6/51006-cleo-from-5-to-7-0-1000-0-1500-crop.jpg',
    coverId: 'rec-cleo',
    why: 'A French singer wanders Paris for two hours waiting for a cancer diagnosis. Real time, real streets. Varda at her most alive.',
  },
  {
    title: 'Sansho the Bailiff',
    author: 'Kenji Mizoguchi, 1954',
    cover: 'https://a.ltrbxd.com/resized/film-poster/5/1/2/7/1/51271-sansho-the-bailiff-0-1000-0-1500-crop.jpg',
    coverId: 'rec-sansho',
    why: 'You\'ve watched Ugetsu and Woman in the Dunes. Sansho is Mizoguchi\'s peak — a medieval family torn apart by feudal cruelty. One of the most devastating films ever made.',
  },
];

async function loadState() {
  try {
    const raw = await fs.readFile(stateFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { usedBooks: [], usedMovies: [], archive: [] };
  }
}

async function saveState(state) {
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    headers: {
      'user-agent': 'Mozilla/5.0',
      accept: 'text/html,application/xhtml+xml,text/plain,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    headers: {
      'user-agent': 'Mozilla/5.0',
      accept: 'application/json,text/plain,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

function pickNext(pool, usedIds, count) {
  const available = pool.filter(item => !usedIds.includes(item.coverId));
  // If pool exhausted, reset
  const source = available.length >= count ? available : pool;
  const picks = [];
  const remaining = [...source];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const idx = Math.floor(Math.random() * remaining.length);
    picks.push(remaining.splice(idx, 1)[0]);
  }
  return picks;
}

async function findGoogleBooksCover(item) {
  const query = `intitle:${item.title} inauthor:${item.author}`;
  const payload = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}`);
  const candidates = (payload.items || [])
    .map((entry) => entry.volumeInfo || {})
    .filter((entry) => entry.imageLinks?.thumbnail || entry.imageLinks?.smallThumbnail)
    .sort((left, right) => {
      const leftScore =
        (normalizeText(left.title) === normalizeText(item.title) ? 5 : 0) +
        ((left.authors || []).some((author) => normalizeText(author) === normalizeText(item.author)) ? 3 : 0);
      const rightScore =
        (normalizeText(right.title) === normalizeText(item.title) ? 5 : 0) +
        ((right.authors || []).some((author) => normalizeText(author) === normalizeText(item.author)) ? 3 : 0);
      return rightScore - leftScore;
    });

  const imageUrl = candidates[0]?.imageLinks?.thumbnail || candidates[0]?.imageLinks?.smallThumbnail || '';
  return imageUrl.replace(/^http:\/\//, 'https://');
}

function parseYear(value) {
  const match = String(value || '').match(/(\d{4})$/);
  return match ? match[1] : '';
}

function extractTmdbPosterUrl(html) {
  const match = html.match(/https:\/\/image\.tmdb\.org\/t\/p\/w500[^"'\\s<)]+/);
  return match ? match[0] : '';
}

async function findTmdbPoster(item) {
  const year = parseYear(item.author);
  const searchHtml = await fetchText(`https://www.themoviedb.org/search/movie?query=${encodeURIComponent(item.title)}`);
  const ids = [...new Set([...searchHtml.matchAll(/\/movie\/(\d+)/g)].map((match) => match[1]))].slice(0, 8);
  let fallbackPoster = '';

  for (const id of ids) {
    const html = await fetchText(`https://www.themoviedb.org/movie/${id}?language=en-US`);
    const posterUrl = extractTmdbPosterUrl(html);
    if (!posterUrl) continue;
    if (!fallbackPoster) fallbackPoster = posterUrl;
    if (!year || html.includes(`(${year})`) || html.includes(`${year}`)) {
      return posterUrl;
    }
  }

  return fallbackPoster;
}

async function resolveCoverUrl(item, type) {
  if (type === 'book') {
    try {
      const googleCover = await findGoogleBooksCover(item);
      if (googleCover) return googleCover;
    } catch {
      // Fall back to the configured source URL below.
    }
  }

  if (type === 'movie') {
    try {
      const tmdbPoster = await findTmdbPoster(item);
      if (tmdbPoster) return tmdbPoster;
    } catch {
      // Fall back to the configured source URL below.
    }
  }

  return item.cover;
}

async function downloadCover(item, type) {
  const filename = `${item.coverId}.jpg`;
  const dest = path.join(coversDir, filename);
  try {
    await fs.access(dest);
    return path.posix.join('images', 'covers', filename);
  } catch {
    // file doesn't exist, download it
  }

  const url = await resolveCoverUrl(item, type);
  if (!url) return null;

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        'user-agent': 'Mozilla/5.0',
        accept: 'image/*,*/*;q=0.8',
      },
    });
    if (res.ok && String(res.headers.get('content-type') || '').startsWith('image/')) {
      const bytes = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(dest, bytes);
      return path.posix.join('images', 'covers', filename);
    }
  } catch {
    // ignore, will use placeholder
  }
  return null;
}

async function downloadAll(items, type) {
  const covers = [];
  for (const item of items) {
    covers.push(await downloadCover(item, type));
  }
  return covers;
}

function renderItem(item, coverPath) {
  const imgHtml = coverPath
    ? `<img src="${coverPath}" alt="${item.title.replace(/"/g, '&quot;')}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="no-cover" style="display:none">${item.title}</div>`
    : `<div class="no-cover">${item.title}</div>`;
  return `
    <article class="rec-card">
      <div class="item" title="${item.title.replace(/"/g, '&quot;')} — ${item.author.replace(/"/g, '&quot;')}">
        ${imgHtml}
      </div>
      <div class="rec-copy">
        <div class="rec-kicker">AI Recommendation</div>
        <h2 class="rec-title">${item.title}</h2>
        <div class="rec-author">${item.author}</div>
        <div class="rec-why-label">Why It Fits</div>
        <p class="rec-why">${item.why}</p>
      </div>
    </article>`;
}

function renderArchiveWeek(entry) {
  const allItems = [...entry.books, ...entry.movies];
  const coversHtml = allItems.map(item => {
    const imgHtml = item.coverPath
      ? `<img src="${item.coverPath}" alt="${item.title.replace(/"/g, '&quot;')}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="no-cover" style="display:none">${item.title}</div>`
      : `<div class="no-cover">${item.title}</div>`;
    return `
      <div class="archive-item" title="${item.title.replace(/"/g, '&quot;')} — ${item.author.replace(/"/g, '&quot;')}">
        ${imgHtml}
      </div>`;
  }).join('\n');

  return `
    <div class="archive-week">
      <div class="archive-date">${entry.date}</div>
      <div class="archive-covers">${coversHtml}</div>
    </div>`;
}

async function generateHtml(books, movies, bookCovers, movieCovers, archive) {
  const today = new Date().toISOString().slice(0, 10);

  const booksHtml = books.map((b, i) => renderItem(b, bookCovers[i])).join('\n');
  const moviesHtml = movies.map((m, i) => renderItem(m, movieCovers[i])).join('\n');
  const archiveHtml = archive.length > 0
    ? archive.map(entry => renderArchiveWeek(entry)).join('\n')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>recommendations</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #14181c;
      color: #99aabb;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
    }
    header {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 24px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 14px;
    }
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: #556677;
      text-decoration: none;
      font-size: 0.52rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      transition: color 0.2s;
    }
    .back-link:hover {
      color: #99aabb;
    }
    .back-link svg {
      width: 12px;
      height: 12px;
      stroke: currentColor;
      transition: transform 0.2s;
    }
    .back-link:hover svg {
      transform: translateX(-2px);
    }
    header h1 {
      color: #fff;
      font-size: 1.6rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      line-height: 1;
    }
    .header-rule {
      width: 40px;
      height: 1px;
      background: linear-gradient(90deg, transparent, #465462, transparent);
    }
    header p {
      font-size: 0.55rem;
      color: #5a6a7a;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      max-width: 50ch;
      line-height: 1.6;
    }
    .section-label {
      max-width: 1200px;
      margin: 0 auto;
      padding: 16px 24px 10px;
      color: #667787;
      font-size: 0.5rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .section-label::after {
      content: '';
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg, rgba(82, 99, 115, 0.7), rgba(82, 99, 115, 0));
    }
    .recommendation-list {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px 10px;
      display: flex;
      flex-direction: column;
    }
    .rec-card {
      display: grid;
      grid-template-columns: 105px minmax(0, 1fr);
      gap: 18px;
      align-items: start;
      padding: 10px 0;
    }
    .rec-card + .rec-card {
      margin-top: 10px;
      padding-top: 20px;
      border-top: 1px solid rgba(64, 76, 89, 0.58);
    }
    .item {
      position: relative;
      width: 105px;
      aspect-ratio: 2/3;
      border-radius: 4px;
      overflow: hidden;
      background: #1f2830;
      cursor: default;
    }
    .item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      transition: opacity 0.2s ease;
    }
    .rec-card:hover .item img {
      opacity: 0.9;
    }
    .rec-copy {
      min-width: 0;
      padding-top: 2px;
    }
    .rec-kicker {
      color: #667787;
      font-size: 0.48rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .rec-title {
      margin-top: 5px;
      color: #fff;
      font-size: 0.9rem;
      font-weight: 600;
      line-height: 1.15;
    }
    .rec-author {
      color: #99aabb;
      font-size: 0.66rem;
      margin-top: 5px;
      letter-spacing: 0.01em;
    }
    .rec-why-label {
      margin-top: 11px;
      color: #667787;
      font-size: 0.48rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .rec-why {
      margin-top: 6px;
      color: #c6d0da;
      font-size: 0.72rem;
      line-height: 1.65;
      max-width: 64ch;
    }
    .no-cover {
      display: flex;
      align-items: end;
      justify-content: start;
      width: 100%;
      height: 100%;
      background: #2a2420;
      padding: 12px;
      font-size: 0.85rem;
      font-weight: 600;
      color: #d4c4b0;
      line-height: 1.25;
      text-align: left;
      border: 1px solid #3d332a;
    }
    .archive-section {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px 10px;
    }
    .archive-week {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 10px 0;
    }
    .archive-week + .archive-week {
      border-top: 1px solid rgba(64, 76, 89, 0.3);
    }
    .archive-date {
      color: #556677;
      font-size: 0.52rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      white-space: nowrap;
      min-width: 72px;
    }
    .archive-covers {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .archive-item {
      position: relative;
      width: 48px;
      aspect-ratio: 2/3;
      border-radius: 3px;
      overflow: hidden;
      background: #1f2830;
    }
    .archive-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .archive-item .no-cover {
      font-size: 0.4rem;
      padding: 4px;
    }
    .footer-note {
      max-width: 1200px;
      margin: 22px auto 0;
      padding: 0 24px 48px;
      font-size: 0.55rem;
      color: #445566;
      letter-spacing: 0.08em;
      text-align: center;
    }
    @media (max-width: 600px) {
      header {
        padding: 24px 16px 18px;
      }
      header h1 {
        font-size: 1.35rem;
      }
      .recommendation-list {
        padding: 0 16px 8px;
      }
      .rec-card {
        grid-template-columns: 85px minmax(0, 1fr);
        gap: 12px;
      }
      .item {
        width: 85px;
      }
      .section-label { padding: 16px 16px 8px; }
      .rec-card + .rec-card {
        margin-top: 14px;
        padding-top: 14px;
      }
      .rec-title {
        font-size: 0.84rem;
      }
      .rec-author,
      .rec-why {
        font-size: 0.66rem;
      }
    }
  </style>
</head>
<body>
  <header>
    <a href="index.html" class="back-link">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
      Back to Consume
    </a>
    <h1>Recommendations</h1>
    <div class="header-rule"></div>
    <p>AI-generated picks from your reading and viewing history</p>
  </header>

  <div class="section-label">Books</div>
  <div class="recommendation-list">
    ${booksHtml}
  </div>

  <div class="section-label">Movies</div>
  <div class="recommendation-list">
    ${moviesHtml}
  </div>

  ${archiveHtml ? `<div class="section-label" style="margin-top:16px">Past Weeks</div>
  <div class="archive-section">
    ${archiveHtml}
  </div>` : ''}

  <p class="footer-note">Recommendations generated by AI from your library and watch history.</p>
</body>
</html>`;
}

async function main() {
  const state = await loadState();
  if (!state.archive) state.archive = [];

  const books = pickNext(BOOK_POOL, state.usedBooks, 3);
  const movies = pickNext(MOVIE_POOL, state.usedMovies, 3);

  await fs.mkdir(coversDir, { recursive: true });

  const bookCovers = await downloadAll(books, 'book');
  const movieCovers = await downloadAll(movies, 'movie');

  const html = await generateHtml(books, movies, bookCovers, movieCovers, state.archive);
  await fs.writeFile(outputFile, html);

  // Save this week to archive
  const today = new Date().toISOString().slice(0, 10);
  state.archive.unshift({
    date: today,
    books: books.map((b, i) => ({ title: b.title, author: b.author, coverPath: bookCovers[i] })),
    movies: movies.map((m, i) => ({ title: m.title, author: m.author, coverPath: movieCovers[i] })),
  });

  // Update state
  state.usedBooks = [...new Set([...state.usedBooks, ...books.map(b => b.coverId)])];
  state.usedMovies = [...new Set([...state.usedMovies, ...movies.map(m => m.coverId)])];
  // Reset if all used
  if (state.usedBooks.length >= BOOK_POOL.length) state.usedBooks = [];
  if (state.usedMovies.length >= MOVIE_POOL.length) state.usedMovies = [];
  await saveState(state);

  console.log(JSON.stringify({ books: books.map(b => b.title), movies: movies.map(m => m.title) }, null, 2));
}

main().catch(err => { console.error(err); process.exitCode = 1; });
