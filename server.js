import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildWrapped, buildLeaderboard, bandwidthByYear } from './stats.js';

const { TAUTULLI_URL, TAUTULLI_API_KEY, PORT = 8080, ADMIN_USERS = '', PLEX_URL, PLEX_TOKEN } = process.env;
if (!TAUTULLI_URL || !TAUTULLI_API_KEY) {
  console.error('TAUTULLI_URL and TAUTULLI_API_KEY are required');
  process.exit(1);
}
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET not set: everyone gets logged out on restart');
const CLIENT_ID = 'plex-re-view-' + crypto.createHash('sha256').update('client' + SECRET).digest('hex').slice(0, 16);
const PLEX_HEADERS = { Accept: 'application/json', 'X-Plex-Product': 'Plex Re-View', 'X-Plex-Client-Identifier': CLIENT_ID };
const INDEX = readFileSync(new URL('./public/index.html', import.meta.url));
const FILES = { // small static files: path -> [bytes, type]
  '/logo.svg': [readFileSync(new URL('./public/logo.svg', import.meta.url)), 'image/svg+xml'],
  '/favicon.png': [readFileSync(new URL('./public/favicon.png', import.meta.url)), 'image/png'],
};

const httpErr = (status, message) => Object.assign(new Error(message), { status });

// --- signed cookies: name=value.expiry.hmac ---
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
function setCookie(req, res, name, value, ttl) {
  const v = `${value}.${Date.now() + ttl * 1000}`;
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${name}=${ttl ? `${v}.${sign(name + v)}` : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl}${secure}`);
}
function getCookie(req, name) {
  const raw = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '')?.[1];
  if (!raw) return null;
  const [value, exp, sig = ''] = raw.split('.');
  const good = sign(`${name}${value}.${exp}`);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  return Date.now() < Number(exp) ? value : null;
}
function auth(req) {
  const id = getCookie(req, 'rv');
  if (!id) throw httpErr(401, 'Not logged in');
  return id;
}

// --- upstreams ---
const tautulliUrl = (cmd, params = {}) =>
  `${TAUTULLI_URL.replace(/\/+$/, '')}/api/v2?${new URLSearchParams({ apikey: TAUTULLI_API_KEY, cmd, ...params })}`;

async function tautulli(cmd, params) {
  const j = await (await fetch(tautulliUrl(cmd, params))).json();
  if (j.response?.result !== 'success') throw new Error(`Tautulli ${cmd} failed: ${j.response?.message}`);
  return j.response.data;
}

async function plex(path, opts = {}) {
  const r = await fetch('https://plex.tv/api/v2' + path, { ...opts, headers: { ...PLEX_HEADERS, ...opts.headers } });
  if (!r.ok) throw httpErr(r.status === 404 ? 410 : 502, `Plex answered ${r.status}`);
  return r.json();
}

const cache = new Map();
function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.p;
  const p = fn();
  cache.set(key, { until: Date.now() + ms, p });
  p.catch(() => cache.delete(key));
  return p;
}

const users = () => cached('users', 5 * 60e3, () => tautulli('get_users'));
const findUser = async id => (await users()).find(u => String(u.user_id) === String(id));
// Tautulli flags the server owner; ADMIN_USERS (comma-separated Plex usernames) adds more admins.
const admins = ADMIN_USERS.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const isAdmin = u => Boolean(u && (Number(u.is_admin) || admins.includes(String(u.username).toLowerCase())));
async function requireAdmin(req) {
  if (!isAdmin(await findUser(auth(req)))) throw httpErr(403, 'Admins only. Nice try though.');
}
function parseYear(url) {
  const year = Number(url.searchParams.get('year'));
  if (!Number.isInteger(year) || year < 2000 || year > new Date().getFullYear()) throw httpErr(400, 'Bad year');
  return year;
}

// shortcut: loads the whole server's year into memory in one call; fine for home servers, page it if you have 100k+ plays/year.
const history = year => cached('h' + year, 10 * 60e3, async () =>
  (await tautulli('get_history', { after: `${year - 1}-12-31`, before: `${year + 1}-01-01`, length: 1e6, grouping: 1 })).data);

// Data streamed comes from Plex's own bandwidth statistics (needs Plex Pass + the owner's token); Tautulli doesn't record it.
// timespan=1 = monthly buckets, no date filter = everything Plex still has.
async function plexServer(path, headers = {}) {
  const r = await fetch(`${PLEX_URL.replace(/\/+$/, '')}${path}`, { headers: { Accept: 'application/json', 'X-Plex-Token': PLEX_TOKEN, ...headers } });
  if (!r.ok) throw httpErr(502, `Plex answered ${r.status} for ${path.split('?')[0]}`);
  return (await r.json()).MediaContainer || {};
}
const bandwidth = () => cached('bandwidth', 10 * 60e3, async () => {
  const mc = await plexServer('/statistics/bandwidth?timespan=1')
    .catch(() => { throw httpErr(502, "Plex refused the bandwidth statistics. They need Plex Pass and the server owner's token."); });
  return bandwidthByYear(mc.StatisticsBandwidth || []);
});

// How many movies/shows/episodes were added to the libraries this year (Plex type 1/2/4; size 0 = just count).
async function addedThisYear() {
  const year = new Date().getFullYear(), since = Math.floor(new Date(year, 0, 1) / 1000);
  const count = async type => (await plexServer(`/library/all?type=${type}&addedAt>>=${since}`, { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 })).totalSize ?? 0;
  const [movies, shows, episodes] = await Promise.all([count(1), count(2), count(4)]);
  return { year, movies, shows, episodes };
}

// All-time server records. Each part is optional: one failing (or Plex not configured) just leaves it out.
const records = () => cached('records', 30 * 60e3, async () => {
  const [longest, concurrent, added] = await Promise.allSettled([
    tautulli('get_history', { order_column: 'duration', order_dir: 'desc', length: 1, grouping: 0 }),
    tautulli('get_concurrent_streams_by_stream_type', { time_range: 3650 }),
    PLEX_URL && PLEX_TOKEN ? addedThisYear() : Promise.reject(new Error('Plex not configured')),
  ]);
  const top = longest.value?.data?.[0];
  const maxSeries = concurrent.value?.series?.find(s => /max/i.test(s.name))?.data || [];
  const peakAt = maxSeries.indexOf(Math.max(...maxSeries));
  return {
    totalPlays: longest.value?.recordsTotal ?? null,
    longest: top ? { name: top.friendly_name || top.user, title: top.full_title || top.title, seconds: Number(top.play_duration ?? top.duration) || 0, at: top.started || top.date } : null,
    peak: peakAt >= 0 && maxSeries[peakAt] > 0 ? { streams: maxSeries[peakAt], date: concurrent.value.categories[peakAt] } : null,
    added: added.value || null,
  };
});

// --- routes ---
const routes = {
  'POST /api/auth/pin': async (req, res) => {
    const pin = await plex('/pins?strong=true', { method: 'POST' });
    setCookie(req, res, 'rvpin', pin.id, 15 * 60); // ties the pin to this browser so nobody else can claim it
    return { code: pin.code, clientId: CLIENT_ID };
  },

  'POST /api/auth/check': async (req, res) => {
    const pinId = getCookie(req, 'rvpin');
    if (!pinId) throw httpErr(400, 'Login expired, try again.');
    const pin = await plex(`/pins/${pinId}`);
    if (!pin.authToken) return { pending: true };
    const account = await plex('/user', { headers: { 'X-Plex-Token': pin.authToken } });
    const user = await findUser(account.id);
    if (!user) throw httpErr(403, `Sorry ${account.username}, you're not on this server's guest list.`);
    setCookie(req, res, 'rv', user.user_id, 30 * 86400);
    return { ok: true };
  },

  'POST /api/logout': async (req, res) => { setCookie(req, res, 'rv', '', 0); return { ok: true }; },

  'GET /api/me': async req => {
    const user = await findUser(auth(req));
    if (!user) throw httpErr(401, 'Not logged in');
    const y = new Date().getFullYear();
    return {
      id: String(user.user_id),
      isAdmin: isAdmin(user),
      name: user.friendly_name || user.username,
      thumb: user.user_thumb || user.thumb,
      server: await cached('server', 3600e3, () => tautulli('get_server_friendly_name')),
      years: [0, 1, 2, 3, 4].map(i => y - i),
    };
  },

  'GET /api/wrapped': async (req, res, url) => {
    const self = auth(req), target = url.searchParams.get('user') || self;
    if (target !== self) await requireAdmin(req);
    const year = parseYear(url);
    const user = await findUser(target);
    if (!user) throw httpErr(404, 'No such user');
    const all = await users();
    // For the running year, compare with the same stretch of last year (1 Jan up to today's date), not a full year.
    const now = new Date(), samePeriod = year === now.getFullYear();
    const cutoff = new Date(year - 1, now.getMonth(), now.getDate() + 1) / 1000;
    const lastRows = (await history(year - 1)).filter(r => !samePeriod || (r.started || r.date) < cutoff);
    const last = buildWrapped(lastRows, target, year - 1);
    return {
      ...buildWrapped(await history(year), target, year, all),
      user: { name: user.friendly_name || user.username, thumb: user.user_thumb || user.thumb },
      previous: last.plays ? { year: year - 1, samePeriod, totalSeconds: last.totalSeconds, plays: last.plays, topShow: last.shows.top[0]?.title, topMovie: last.movies.top[0]?.title } : null,
    };
  },

  'GET /api/leaderboard': async (req, res, url) => {
    auth(req);
    const year = parseYear(url);
    return buildLeaderboard(await history(year), year, await users());
  },

  'GET /api/admin': async (req, res, url) => {
    await requireAdmin(req);
    const year = parseYear(url), all = await users();
    const lb = buildLeaderboard(await history(year), year, all);
    const seen = new Set(lb.viewers.map(v => v.id));
    for (const u of all) {
      if (!seen.has(String(u.user_id))) lb.viewers.push({ id: String(u.user_id), name: u.friendly_name || u.username, thumb: u.user_thumb || u.thumb, seconds: 0, plays: 0 });
    }
    return { ...lb, totalUsers: all.length };
  },

  'GET /api/data': async req => {
    auth(req);
    const [bw, rec] = await Promise.allSettled([
      PLEX_URL && PLEX_TOKEN ? bandwidth() : Promise.reject(new Error("Streamed data isn't set up yet. The admin needs to add PLEX_URL and PLEX_TOKEN.")),
      records(),
    ]);
    return { bandwidth: bw.value || null, bandwidthError: bw.reason?.message, records: rec.value || null };
  },

  'POST /api/admin/refresh': async req => { await requireAdmin(req); cache.clear(); return { ok: true }; },

  // Proxies posters so the Tautulli API key never reaches the browser.
  'GET /api/img': async (req, res, url) => {
    auth(req);
    const src = url.searchParams.get('src') || '';
    if (!/^\/library\/[\w/.-]+$/.test(src)) throw httpErr(400, 'Bad image');
    const r = await fetch(tautulliUrl('pms_image_proxy', { img: src, width: 400 }));
    if (!r.ok) throw httpErr(404, 'No image');
    res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' });
    res.end(Buffer.from(await r.arrayBuffer()));
  },
};

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(INDEX);
    }
    const file = req.method === 'GET' && FILES[url.pathname];
    if (file) {
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'public, max-age=86400' });
      return res.end(file[0]);
    }
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) throw httpErr(404, 'Not found');
    const out = await route(req, res, url);
    if (out !== undefined) send(res, 200, out);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Something broke. Check the server logs.' });
  }
}).listen(PORT, () => console.log(`Plex Re-View listening on :${PORT}`));
