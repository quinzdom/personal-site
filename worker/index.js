// dcdnt.xyz Worker. Static files are served straight from the assets (wrangler.jsonc sends only
// /api/* here first), so the rest of the site works exactly as a plain static site.
//
// /api/admin/* is the photo page's admin mode (dcdnt.xyz/pictures#admin):
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

const COOKIE = 'pictures_admin';
const MAX_AGE = 60 * 60 * 24 * 30; // seconds: stay signed in for 30 days
const LABEL_MAX = 120;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(token, MAX_AGE) });
  }
  if (route === 'logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
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

async function signedIn(request, env) {
  const match = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return false;
  const [exp, mac] = match[1].split('.');
  if (!exp || !mac || !(Number(exp) > Date.now() / 1000)) return false;
  const expected = await signToken(env, exp);
  return sameSecret(match[1], expected);
}

async function signToken(env, exp) {
  const key = await crypto.subtle.importKey(
    'raw', await sha256(`pictures-admin-session:${env.ADMIN_PASSWORD}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(exp)));
  return `${exp}.${base64url(new Uint8Array(mac))}`;
}

function cookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/api/admin; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

// Compares two strings in constant time (hashing first makes the lengths equal).
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(x, y);
}

async function sha256(text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
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
