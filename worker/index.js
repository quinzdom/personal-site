// dcdnt.xyz Worker. Static files are served straight from the assets; wrangler.jsonc sends only
// these here first:
//   /          the photos (pictures.html): the photo page is the home page. It and /everything
//              are served without any photo taken off in admin mode since the last build (in their
//              search data, plain gallery and link preview)
//   /?filter=…, /index.html, /index, /tracker/: the tracker's old addresses, redirected to /tracker
//   /tracker   the tracker, "consume" (index.html, which keeps its name because the weekly
//              Bookmeter Action and its scripts update it)
//   /pictures  the photo page's old address: redirects to / (a #admin or #photo stays on)
//   /sitemap.xml  every public page, and every photo for image search (from pictures.json)
//   /api/*     below
//
// Clicks on the photos (counted in the PictureClicks Durable Object, never the owner's):
//   POST /api/click  {id}  -> counts a click on photo id: once per network address (an IPv6 /64),
//                             photo and day; not
//                             while signed in to admin mode (the page itself never sends them
//                             from a browser that has ever signed in)
//   GET  /api/top          -> {top: [id, ...]}: the most-clicked photos, most first (the page
//                             doesn't use it now: it shows the photos newest first)
//   GET  /api/admin/clicks -> {clicks: [{id, n, last}], total}: every count, signed in only
// No IP address is stored: a visitor is a hash of the day and the address, keyed with a secret,
// kept for the day to stop repeat counting, then deleted.
//
// /api/admin/* is the photo page's admin mode (dcdnt.xyz/#admin):
//   POST /api/admin/login     {password}            -> signs in with a 30-day HttpOnly cookie
//   POST /api/admin/logout                          -> signs out
//   GET  /api/admin/me                              -> {admin: true|false}
//   GET  /api/admin/pictures                        -> {sha, data}: pictures.json fresh from GitHub
//   PUT  /api/admin/pictures  {base, photos:[{id, label}]}
//        -> commits the new order, captions and removals as pictures.json on main; Cloudflare
//           redeploys the site from that commit in about a minute.
// Secrets (Cloudflare dashboard > Workers > personal-site > Settings > Variables and Secrets):
//   ADMIN_PASSWORD  the password for admin mode
//   GITHUB_TOKEN    a fine-grained GitHub token for this repo with Contents: read and write
// Admin mode stays off until ADMIN_PASSWORD is set.

import { DurableObject } from 'cloudflare:workers';

const COOKIE = 'pictures_admin';
const MAX_AGE = 60 * 60 * 24 * 30; // seconds: stay signed in for 30 days
const LABEL_MAX = 120;
const TOP = 6; // how many of the most-clicked photos go at the top of the page

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Links to the tracker from before it moved: its views in the query (?filter=movie&view=grid),
    // its own file, and the address with a slash.
    if (url.pathname === '/' && TRACKER_PARAMS.some(k => url.searchParams.has(k))) return moved(url, '/tracker');
    if (['/index.html', '/index', '/tracker/'].includes(url.pathname)) return moved(url, '/tracker');
    if (url.pathname === '/') return photoPage(request, env, '/pictures');
    if (url.pathname === '/everything') return photoPage(request, env, '/everything');
    if (url.pathname === '/tracker') return asset(request, env, '/');
    if (url.pathname === '/pictures') return moved(url, '/');
    if (url.pathname === '/sitemap.xml') return sitemap(env, url);
    if (url.pathname === '/api/click' || url.pathname === '/api/top') {
      try {
        return url.pathname === '/api/top' ? await top(env, url) : await click(request, env, url);
      } catch (err) {
        console.error('clicks error', err && err.stack || err);
        return url.pathname === '/api/top' ? json({ top: [] }) : new Response(null, { status: 204 });
      }
    }
    if (url.pathname.startsWith('/api/admin/')) {
      try {
        return await admin(request, env, url);
      } catch (err) {
        console.error('admin error', err && err.stack || err);
        return json({ error: 'Something went wrong on the server. Nothing was saved.' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function admin(request, env, url) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: 'Admin mode isn’t set up yet: add the ADMIN_PASSWORD secret to the Worker.' }, 503);
  }
  const route = url.pathname.slice('/api/admin/'.length);
  const method = request.method;
  // Only the site's own pages may change anything (the cookie is also SameSite=Strict).
  if (method !== 'GET' && request.headers.get('Origin') !== url.origin) {
    return json({ error: 'Forbidden.' }, 403);
  }

  if (route === 'me' && method === 'GET') {
    return json({ admin: await signedIn(request, env) });
  }
  if (route === 'login' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const password = typeof body.password === 'string' ? body.password : '';
    if (!(await sameSecret(password, env.ADMIN_PASSWORD))) {
      await new Promise(r => setTimeout(r, 1000)); // slows down guessing
      return json({ error: 'Wrong password.' }, 401);
    }
    const token = await signToken(env, Math.floor(Date.now() / 1000) + MAX_AGE);
    const res = json({ ok: true });
    res.headers.append('Set-Cookie', cookie(token, MAX_AGE));
    res.headers.append('Set-Cookie', OLD_COOKIE_GONE);
    return res;
  }
  if (route === 'logout' && method === 'POST') {
    const res = json({ ok: true });
    res.headers.append('Set-Cookie', cookie('', 0));
    res.headers.append('Set-Cookie', OLD_COOKIE_GONE);
    return res;
  }
  if (route === 'clicks' && method === 'GET') {
    if (!(await signedIn(request, env))) return json({ error: 'Your admin session ended. Sign in again.' }, 401);
    const ids = await photoIds(env, url.origin);
    const clicks = (await counter(env).all()).filter(c => ids.has(c.id)); // only photos still on the page
    return json({ clicks, total: clicks.reduce((sum, c) => sum + c.n, 0) });
  }
  if (route === 'pictures') {
    if (!(await signedIn(request, env))) return json({ error: 'Your admin session ended. Sign in again.' }, 401);
    if (!env.GITHUB_TOKEN) {
      return json({ error: 'Saving isn’t set up yet: add the GITHUB_TOKEN secret to the Worker.' }, 503);
    }
    if (method === 'GET') {
      const { sha, data } = await readPictures(env);
      return json({ sha, data }, 200, { 'Cache-Control': 'no-store' });
    }
    if (method === 'PUT') return savePictures(request, env);
  }
  return json({ error: 'Not found.' }, 404);
}

// ---- saving -----------------------------------------------------------------------------------

async function savePictures(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.photos)) return json({ error: 'Bad request.' }, 400);
  const { sha, data } = await readPictures(env);
  if (body.base !== sha) {
    return json({
      error: 'The page changed since you opened admin mode (published from the Mac, or saved in another tab). ' +
             'Reload the page and make your changes again.',
    }, 409);
  }
  // Admin mode can reorder, recaption and remove photos, never invent new ones: every id must
  // already be on the page. Adding photos stays with the Photo Manager on the Mac.
  const known = new Map((data.photos || []).map(p => [p.id, p]));
  const seen = new Set();
  const photos = [];
  for (const item of body.photos) {
    const id = item && typeof item.id === 'string' ? item.id : '';
    if (!known.has(id) || seen.has(id)) return json({ error: `Unknown or repeated photo: ${id}` }, 400);
    seen.add(id);
    photos.push({ ...known.get(id), label: cleanLabel(item.label) });
  }
  const removed = [...known.keys()].filter(id => !seen.has(id));
  const next = { ...data, photos };
  const message = removed.length
    ? `Pictures: arranged on the site (${photos.length} photos, removed ${removed.join(', ')})`
    : `Pictures: arranged on the site (${photos.length} photos)`;
  const res = await github(env, 'contents/pictures.json', {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: toBase64(JSON.stringify(next, null, 1) + '\n'),
      sha,
      branch: branch(env),
    }),
  });
  if (res.status === 409 || res.status === 422) {
    return json({ error: 'The page changed while saving. Reload the page and make your changes again.' }, 409);
  }
  if (!res.ok) {
    console.error('GitHub save failed', res.status, await res.text());
    return json({ error: `GitHub refused the save (${res.status}). Check the GITHUB_TOKEN secret.` }, 502);
  }
  const saved = await res.json();
  return json({ ok: true, sha: saved.content.sha, commit: saved.commit.sha, data: next });
}

async function readPictures(env) {
  const res = await github(env, `contents/pictures.json?ref=${encodeURIComponent(branch(env))}`);
  if (!res.ok) {
    console.error('GitHub read failed', res.status, await res.text());
    throw new Error(`GitHub read failed: ${res.status}`);
  }
  const meta = await res.json();
  return { sha: meta.sha, data: JSON.parse(fromBase64(meta.content)) };
}

function github(env, path, init = {}) {
  const api = env.GITHUB_API || 'https://api.github.com';
  return fetch(`${api}/repos/${env.GITHUB_REPO}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dcdnt-pictures-admin',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

const branch = env => env.GITHUB_BRANCH || 'main';

function cleanLabel(label) {
  return (typeof label === 'string' ? label : '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LABEL_MAX);
}

// ---- sessions ---------------------------------------------------------------------------------
// The cookie is "<expiry>.<HMAC of expiry>", keyed by the password itself, so changing the
// password signs every browser out.

// Any one valid cookie will do: a browser can send two (an old one from before the password
// changed, at another path).
async function signedIn(request, env) {
  const values = [...(request.headers.get('Cookie') || '').matchAll(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`, 'g'))];
  for (const [, value] of values) {
    const [exp, mac] = value.split('.');
    if (!exp || !mac || !(Number(exp) > Date.now() / 1000)) continue;
    if (await sameSecret(value, await signToken(env, exp))) return true;
  }
  return false;
}

async function signToken(env, exp) {
  const key = await crypto.subtle.importKey(
    'raw', await sha256(`pictures-admin-session:${env.ADMIN_PASSWORD}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(exp)));
  return `${exp}.${base64url(new Uint8Array(mac))}`;
}

// Path=/api, so the click counter can tell the owner's clicks too (cookies from before this
// change have Path=/api/admin and still work for admin mode).
function cookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/api; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
// Cookies set before the click counter had Path=/api/admin. They're cleared on every sign-in and
// sign-out.
const OLD_COOKIE_GONE = `${COOKIE}=; Path=/api/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

// Compares two strings in constant time (hashing first makes the lengths equal).
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(x, y);
}

async function sha256(text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

// ---- pages ------------------------------------------------------------------------------------

const TRACKER_PARAMS = ['filter', 'view', 'layout', 'language', 'favorites', 'q'];
const moved = (url, path) => Response.redirect(new URL(path + url.search, url).toString(), 301);

// The photo pages as built on the Mac list every photo in their search data, plain gallery and
// link preview. A photo taken off in admin mode since (pictures.json is newer) is left out of
// them here, so search engines don't keep finding it.
async function photoPage(request, env, path) {
  const res = await asset(request, env, path);
  if (request.method !== 'GET' || !res.ok || !(res.headers.get('Content-Type') || '').includes('text/html')) return res;
  const photos = await photoList(env, new URL(request.url).origin);
  if (!photos.length) return res;
  const ids = new Set(photos.map(p => p.id));
  const idOf = u => (String(u).match(/images\/ricoh\/([a-z0-9_-]+)\.jpg/) || [])[1];
  const count = text => text.replace(/^\d+ photographs/, `${photos.length} photographs`);
  let previewGone = false;
  return new HTMLRewriter()
    .on('figure[data-id]', { element(el) { if (!ids.has(el.getAttribute('data-id'))) el.remove(); } })
    .on('noscript', new WholeText(text => text.replace(/<figure data-id="([a-z0-9_-]+)">[\s\S]*?<\/figure>/g, (f, id) => (ids.has(id) ? f : ''))))
    .on('script[type="application/ld+json"]', new WholeText(text => {
      const data = JSON.parse(text);
      for (const node of data['@graph'] || []) {
        if (Array.isArray(node.image)) node.image = node.image.filter(im => ids.has(idOf(im.contentUrl)));
        if (typeof node.description === 'string') node.description = count(node.description);
      }
      return JSON.stringify(data).replace(/</g, '\\u003c');
    }))
    .on('meta[name="description"], meta[property="og:description"]', { element(el) { el.setAttribute('content', count(el.getAttribute('content') || '')); } })
    .on('meta[property="og:image"]', { element(el) {
      if (ids.has(idOf(el.getAttribute('content')))) return;
      previewGone = true;
      el.setAttribute('content', `${SITE}/images/ricoh/${photos[0].id}.jpg`);
    } })
    .on('meta[property^="og:image:"]', { element(el) { if (previewGone) el.remove(); } })
    .transform(res);
}

// Hands a text handler the element's whole text at once (HTMLRewriter gives it in chunks).
class WholeText {
  constructor(fix) { this.fix = fix; this.buf = ''; }
  text(t) {
    this.buf += t.text;
    if (!t.lastInTextNode) return t.remove();
    let out = this.buf;
    try { out = this.fix(this.buf); } catch (err) { console.error('rewrite', err); }
    t.replace(out, { html: true });
    this.buf = '';
  }
}

// Serves the asset at `path` for this request (GET or HEAD), as if it had been asked for.
function asset(request, env, path) {
  const url = new URL(request.url);
  url.pathname = path;
  return env.ASSETS.fetch(new Request(url.toString(), request));
}

// The public pages, by the address each answers at without a redirect. The private ones (the daily
// log, /log, goals) stay out, as they stay noindex.
const SITE = 'https://dcdnt.xyz';
const PAGES = ['/', '/everything', '/tracker', '/stats', '/listening', '/anime', '/manga', '/tv', '/recommendations',
  '/reading-list', '/index-grouped-by-month', '/roadtrip/'];

async function sitemap(env, url) {
  const res = await env.ASSETS.fetch(new Request(`${url.origin}/pictures.json`));
  const photos = res.ok ? (await res.json()).photos || [] : [];
  const images = photos.map(p => `<image:image><image:loc>${SITE}/images/ricoh/${p.id}.jpg</image:loc></image:image>`).join('');
  const urls = PAGES.map(path => `<url><loc>${SITE}${path}</loc>${path === '/' ? images : ''}</url>`).join('\n');
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
    `${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

// ---- clicks -----------------------------------------------------------------------------------

const counter = env => env.CLICKS.get(env.CLICKS.idFromName('pictures'));

let known = { at: 0, photos: [], ids: new Set() }; // the photos on the page, from pictures.json each minute
async function photoList(env, origin) {
  if (Date.now() - known.at > 60_000) {
    const res = await env.ASSETS.fetch(new Request(`${origin}/pictures.json`));
    const photos = res.ok ? (await res.json()).photos || [] : [];
    known = { at: Date.now(), photos, ids: new Set(photos.map(p => p.id)) };
  }
  return known.photos;
}
async function photoIds(env, origin) {
  await photoList(env, origin);
  return known.ids;
}

// The first half (/64) of an IPv6 address: one home or phone, however its second half changes.
function ipv6Prefix(ip) {
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const a = head ? head.split(':') : [], b = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':');
}

async function click(request, env, url) {
  const done = new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ error: 'Not found.' }, 404);
  if (request.headers.get('Origin') !== url.origin) return done; // only the site's own page counts
  const ua = request.headers.get('User-Agent') || '';
  if (!ua || /bot|crawl|spider|slurp|preview|headless|lighthouse/i.test(ua)) return done;
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === 'string' ? body.id : '';
  if (!/^[a-z0-9_-]{1,80}$/.test(id) || !(await photoIds(env, url.origin)).has(id)) return done;
  if (env.ADMIN_PASSWORD && (await signedIn(request, env))) return done; // the owner's clicks don't count
  const day = Math.floor(Date.now() / 86_400_000);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  // A visitor is their network address, not what their browser says it is (any script can change
  // that), so one address counts at most once per photo per day.
  const where = ip.includes(':') ? ipv6Prefix(ip) : ip;
  const visitor = base64url(new Uint8Array(await sha256(`clicks:${env.ADMIN_PASSWORD || ''}:${day}:${where}`))).slice(0, 22);
  await counter(env).click(id, visitor, day);
  return done;
}

// Kept here for 30 seconds, so a busy page doesn't ask the counter on every visit; browsers
// don't keep it (a list they kept from before the first clicks would hide them).
let topCache = { at: 0, ids: [] };
async function top(env, url) {
  if (Date.now() - topCache.at > 30_000) {
    const ids = await photoIds(env, url.origin); // only photos still on the page
    topCache = { at: Date.now(), ids: (await counter(env).top(TOP + 100)).filter(id => ids.has(id)).slice(0, TOP) };
  }
  return json({ top: topCache.ids });
}

// One instance ("pictures") holds every count, in its own SQLite database.
export class PictureClicks extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS clicks (id TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, last INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS seen (key TEXT PRIMARY KEY, day INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS seen_day ON seen(day)`);
    this.day = null;
  }

  // Counts a click unless this visitor already clicked this photo today. True if it counted.
  // Only today's visitors are kept (yesterday's can't match: the day is in the key), and they're
  // cleared once a day, by an index, so a click reads a couple of rows, not the whole table.
  click(id, visitor, day) {
    if (this.day !== day) {
      this.sql.exec('DELETE FROM seen WHERE day < ?', day);
      this.day = day;
    }
    const key = `${day}:${visitor}:${id}`;
    if (this.sql.exec('SELECT 1 FROM seen WHERE key = ?', key).toArray().length) return false;
    this.sql.exec('INSERT INTO seen (key, day) VALUES (?, ?)', key, day);
    this.sql.exec(
      'INSERT INTO clicks (id, n, last) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET n = n + 1, last = excluded.last',
      id, Date.now());
    return true;
  }

  top(k) {
    return this.sql.exec('SELECT id FROM clicks ORDER BY n DESC, last DESC LIMIT ?', k).toArray().map(r => r.id);
  }

  all() {
    return this.sql.exec('SELECT id, n, last FROM clicks ORDER BY n DESC, last DESC').toArray();
  }
}

// ---- helpers ----------------------------------------------------------------------------------

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}

function base64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
