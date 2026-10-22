// Local demo: fake Tautulli with made-up data on :8181, the real app on :8080.
// Open http://localhost:8181 and pick who to log in as (skips Plex login). Never deploy this.
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SECRET = 'demo-secret';
const users = [
  { user_id: 1, username: 'sietse', friendly_name: 'Sietse', is_admin: 1 },
  { user_id: 2, username: 'mila', friendly_name: 'Mila' },
  { user_id: 3, username: 'daan', friendly_name: 'Daan' },
  { user_id: 4, username: 'noor', friendly_name: 'Noor' },
  { user_id: 5, username: 'jesse', friendly_name: 'Jesse' },
  { user_id: 6, username: 'fleur', friendly_name: 'Fleur' },
  { user_id: 7, username: 'ghost', friendly_name: 'Ghost Account' },
];
const shows = ['Severance', 'The Bear', 'Shogun', 'Slow Horses', 'Andor', 'Taskmaster', 'The Last of Us', 'Succession', 'Fallout', 'Arcane', 'Ted Lasso', 'Dark', 'The Office', 'Breaking Bad', 'Better Call Saul', 'Stranger Things', 'Silo', 'Reacher', 'Bluey', 'Only Murders in the Building', 'The Boys', 'Blue Eye Samurai', 'Planet Earth III', 'House of the Dragon', 'Abbott Elementary', 'Fleabag', 'Mindhunter', 'Peaky Blinders'];
const movies = ['Dune: Part Two', 'Oppenheimer', 'Paddington 2', 'The Matrix', 'Arrival', 'Interstellar', 'Spirited Away', 'Mad Max: Fury Road', 'Knives Out', 'Parasite', 'The Grand Budapest Hotel', 'Blade Runner 2049', 'Top Gun: Maverick', 'Everything Everywhere All at Once', 'Inception', 'Hot Fuzz', 'Alien', 'Whiplash', 'The Iron Giant', 'Heat', 'Jaws', 'Ratatouille', 'Past Lives', 'Prisoners', 'Barbie', 'Gladiator', 'Coco', 'Arrival 2: Just Kidding'];
const platforms = ['Android TV', 'Chrome', 'iOS', 'Roku', 'Apple TV'];

let seed = 42;
const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
const any = a => a[Math.floor(rnd() ** 1.8 * a.length)]; // skewed so there are clear favourites
const titles = [...shows, ...movies];
const thumb = t => `/library/metadata/${titles.indexOf(t)}/thumb`;
const xml = t => t.replace(/[&<>]/g, c => `&#${c.charCodeAt(0)};`);
// A made-up poster: colour from the title, title text wrapped over a few lines.
function poster(t) {
  const hue = [...t].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 360;
  const lines = t.split(' ').reduce((ls, w) => (ls.at(-1) + ' ' + w).length > 12 && ls.at(-1) ? [...ls, w] : [...ls.slice(0, -1), (ls.at(-1) + ' ' + w).trim()], ['']);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,45%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},60%,15%)"/></linearGradient></defs>
    <rect width="200" height="300" fill="url(#g)"/><circle cx="150" cy="80" r="60" fill="rgba(255,255,255,.12)"/>
    ${lines.map((l, i) => `<text x="16" y="${190 + i * 30}" font-family="Arial Black,Arial" font-weight="900" font-size="24" fill="#fff">${xml(l)}</text>`).join('')}
    <text x="16" y="285" font-family="Arial" font-size="11" fill="rgba(255,255,255,.6)">DEMO POSTER</text></svg>`;
}
const rows = [];
for (const year of [2025, 2026]) {
  for (let i = 0; i < 2500; i++) {
    const u = users[Math.floor(rnd() ** 1.5 * 6)]; // Ghost Account never watches
    const date = new Date(year, Math.floor(rnd() * (year === 2026 ? 10 : 12)), 1 + Math.floor(rnd() * 28), Math.floor(rnd() * 24), Math.floor(rnd() * 60));
    const platform = any(platforms);
    const base = { user_id: u.user_id, friendly_name: u.friendly_name, started: Math.floor(date / 1000), platform,
      transcode_decision: rnd() < ({ Roku: .6, Chrome: .35 }[platform] ?? .1) ? 'transcode' : 'direct play' };
    const r = rnd();
    if (r < .62) {
      const s = any(shows);
      rows.push({ ...base, media_type: 'episode', duration: 1500 + Math.floor(rnd() * 2400), grandparent_title: s, grandparent_rating_key: s, grandparent_thumb: thumb(s), full_title: `${s} - S0${1 + Math.floor(rnd() * 4)}E0${1 + Math.floor(rnd() * 9)}` });
    } else {
      const m = any(movies);
      rows.push({ ...base, media_type: 'movie', duration: 5400 + Math.floor(rnd() * 3600), title: m, full_title: m, rating_key: m, thumb: thumb(m), year: 2000 + Math.floor(rnd() * 25), percent_complete: rnd() < .08 ? 25 : 100 });
    }
  }
}

const data = { get_users: users, get_server_friendly_name: 'Couchflix (demo)' };

// Fake Plex /statistics/bandwidth: monthly local + remote buckets since March 2022, growing over time.
const bandwidth = [];
for (let d = new Date(2022, 2, 1), n = 0; d <= new Date(2026, 9, 1); d.setMonth(d.getMonth() + 1), n++) {
  const at = Math.floor(d / 1000);
  bandwidth.push({ accountID: 1, deviceID: 1, timespan: 1, at, lan: true, bytes: Math.round((200 + rnd() * 600) * 1e9) });
  bandwidth.push({ accountID: 2, deviceID: 2, timespan: 1, at, lan: false, bytes: Math.round((80 + n * 25 + rnd() * 400) * 1e9) });
}
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/login') {
    // cookies ignore ports, so a cookie set here is sent to the app on :8080 too
    const v = `${Number(url.searchParams.get('user'))}.${Date.now() + 864e5}`;
    res.writeHead(302, { 'Set-Cookie': `rv=${v}.${sign('rv' + v)}; Path=/; HttpOnly; SameSite=Lax`, Location: 'http://localhost:8080/' });
    return res.end();
  }
  if (url.pathname === '/library/all') { // "added this year" counts: movies, shows, episodes
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ MediaContainer: { size: 0, totalSize: { 1: 143, 2: 12, 4: 486 }[url.searchParams.get('type')] ?? 0 } }));
  }
  if (url.pathname === '/statistics/bandwidth') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ MediaContainer: { size: bandwidth.length, StatisticsBandwidth: bandwidth } }));
  }
  if (url.pathname === '/api/v2') {
    const cmd = url.searchParams.get('cmd');
    if (cmd === 'pms_image_proxy') {
      const t = titles[Number(/metadata\/(\d+)/.exec(url.searchParams.get('img'))?.[1])];
      if (!t) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end(poster(t));
    }
    const q = url.searchParams;
    let out = data[cmd];
    if (cmd === 'get_history') {
      const sorted = q.get('order_column') === 'duration' ? [...rows].sort((a, b) => b.duration - a.duration) : rows;
      out = { recordsTotal: rows.length, data: sorted.slice(0, Number(q.get('length')) || rows.length) };
    }
    if (cmd === 'get_concurrent_streams_by_stream_type') {
      const days = Array.from({ length: 365 }, (_, i) => new Date(Date.now() - (364 - i) * 864e5).toISOString().slice(0, 10));
      out = { categories: days, series: [{ name: 'Direct Play', data: days.map(() => 1) }, { name: 'Max. Concurrent Streams', data: days.map((_, i) => 1 + (i * 7919 % 5) + (i === 200 ? 4 : 0)) }] };
    }
    return res.end(JSON.stringify({ response: { result: 'success', data: out } }));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<body style="background:#05060d;color:#eee;font:18px system-ui;padding:40px"><h1>Plex Re-View demo</h1><p>Log in as:</p>
    ${users.map(u => `<p><a style="color:#22e3ff" href="/login?user=${u.user_id}">${u.friendly_name}</a>${u.is_admin ? ' (admin)' : ''}</p>`).join('')}</body>`);
}).listen(8181, () => console.log('Demo login page: http://localhost:8181'));

spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
  stdio: 'inherit',
  env: { ...process.env, TAUTULLI_URL: 'http://localhost:8181', TAUTULLI_API_KEY: 'demo', PLEX_URL: 'http://localhost:8181', PLEX_TOKEN: 'demo', SESSION_SECRET: SECRET, PORT: '8080' },
});
