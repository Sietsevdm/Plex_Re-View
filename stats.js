// Turns a year of raw Tautulli history rows into one user's "Re-View".
const secs = r => Number(r.play_duration ?? r.duration) || 0;
const when = r => new Date((r.started || r.date) * 1000);
const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayNum = k => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const sum = rows => rows.reduce((s, r) => s + secs(r), 0);

const grand = r => ({ key: r.grandparent_rating_key || r.grandparent_title, title: r.grandparent_title, thumb: r.grandparent_thumb });
const movie = r => ({ key: r.rating_key || r.title, title: r.title, thumb: r.thumb, year: r.year });

function top(rows, keyFn, n = 5) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k?.key) continue;
    const e = m.get(k.key) || { ...k, seconds: 0, plays: 0, viewers: new Set() };
    e.seconds += secs(r);
    e.plays++;
    e.viewers.add(String(r.user_id));
    m.set(k.key, e);
  }
  return [...m.values()].sort((a, b) => b.seconds - a.seconds).slice(0, n).map(e => ({ ...e, viewers: e.viewers.size }));
}

const inYear = (rows, year) => rows.filter(r => when(r).getFullYear() === year);
const isTranscode = r => r.transcode_decision === 'transcode';

// The other viewer whose watch time overlaps most with yours: per shared title, the smaller of
// both people's share of their own watch time, summed (1 = identical taste, 0 = nothing in common).
function tasteTwin(rows, userId, byId) {
  const profiles = new Map();
  for (const r of rows) {
    if (r.media_type !== 'episode' && r.media_type !== 'movie') continue;
    const k = r.media_type === 'movie' ? movie(r) : grand(r);
    if (!k.key) continue;
    const id = String(r.user_id);
    const p = profiles.get(id) || { total: 0, titles: new Map(), name: r.friendly_name || r.user };
    const t = p.titles.get(k.key) || { title: k.title, seconds: 0 };
    t.seconds += secs(r);
    p.total += secs(r);
    p.titles.set(k.key, t);
    profiles.set(id, p);
  }
  const me = profiles.get(String(userId));
  if (!me?.total) return null;
  let best = null;
  for (const [id, p] of profiles) {
    if (id === String(userId) || !p.total) continue;
    let score = 0;
    const shared = [];
    for (const [key, t] of me.titles) {
      const o = p.titles.get(key);
      if (!o) continue;
      score += Math.min(t.seconds / me.total, o.seconds / p.total);
      shared.push(t);
    }
    if (score > 0 && (!best || score > best.score)) best = { id, score, shared, name: p.name };
  }
  if (!best) return null;
  const u = byId.get(best.id) || {};
  return {
    name: u.friendly_name || u.username || best.name,
    thumb: u.user_thumb || u.thumb,
    match: Math.round(best.score * 100),
    shared: best.shared.sort((a, b) => b.seconds - a.seconds).slice(0, 3).map(t => t.title),
  };
}

export function buildLeaderboard(allRows, year, users = []) {
  const rows = inYear(allRows, year);
  const byId = new Map(users.map(u => [String(u.user_id), u]));
  const months = Array(12).fill(0);
  for (const r of rows) months[when(r).getMonth()] += secs(r);
  const viewers = top(rows, r => ({ key: String(r.user_id) }), Infinity).map(v => {
    const mine = rows.filter(r => String(r.user_id) === v.key);
    const u = byId.get(v.key) || {};
    return {
      id: v.key,
      name: u.friendly_name || u.username || mine[0].friendly_name || mine[0].user,
      thumb: u.user_thumb || u.thumb,
      seconds: v.seconds,
      plays: v.plays,
      topShow: top(mine.filter(r => r.media_type === 'episode'), grand, 1)[0]?.title,
      topMovie: top(mine.filter(r => r.media_type === 'movie'), movie, 1)[0]?.title,
      transcodes: mine.filter(isTranscode).length,
    };
  });
  return {
    year,
    seconds: sum(rows),
    plays: rows.length,
    months,
    viewers,
    shows: top(rows.filter(r => r.media_type === 'episode'), grand, 25),
    movies: top(rows.filter(r => r.media_type === 'movie'), movie, 25),
    platforms: top(rows, r => ({ key: r.platform, title: r.platform }), 5),
  };
}

export function buildWrapped(allRows, userId, year, users = []) {
  const rows = inYear(allRows, year);
  const mine = rows.filter(r => String(r.user_id) === String(userId));

  const perUser = new Map();
  for (const r of rows) perUser.set(String(r.user_id), (perUser.get(String(r.user_id)) || 0) + secs(r));
  const ranking = [...perUser.entries()].sort((a, b) => b[1] - a[1]);

  const hours = Array(24).fill(0), weekdays = Array(7).fill(0), months = Array(12).fill(0);
  const days = new Map();
  for (const r of mine) {
    const d = when(r), s = secs(r);
    hours[d.getHours()] += s;
    weekdays[d.getDay()] += s;
    months[d.getMonth()] += s;
    days.set(dayKey(d), (days.get(dayKey(d)) || 0) + s);
  }

  let streak = 0, run = 0, prev = null, streakEnd = null;
  for (const k of [...days.keys()].sort()) {
    const n = dayNum(k);
    run = prev !== null && n - prev === 1 ? run + 1 : 1;
    if (run > streak) { streak = run; streakEnd = k; }
    prev = n;
  }

  const [bingeDay, bingeSeconds] = [...days.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const bingeRows = mine.filter(r => dayKey(when(r)) === bingeDay);
  const episodes = mine.filter(r => r.media_type === 'episode');
  const movies = mine.filter(r => r.media_type === 'movie');
  const sorted = [...mine].sort((a, b) => when(a) - when(b));
  const label = r => r && { title: r.full_title || r.title, at: r.started || r.date };

  return {
    year,
    totalSeconds: sum(mine),
    plays: mine.length,
    shows: { plays: episodes.length, seconds: sum(episodes), count: new Set(episodes.map(r => grand(r).key)).size, top: top(episodes, grand) },
    movies: { plays: movies.length, seconds: sum(movies), top: top(movies, movie) },
    hours, weekdays, months,
    activeDays: days.size,
    streak, streakEnd,
    binge: bingeDay && { day: bingeDay, seconds: bingeSeconds, top: top(bingeRows, r => r.media_type === 'movie' ? movie(r) : grand(r), 1)[0] },
    platforms: top(mine, r => ({ key: r.platform, title: r.platform }), 3),
    abandoned: movies.filter(r => Number(r.percent_complete) < 50).length,
    transcodes: mine.filter(isTranscode).length,
    twin: tasteTwin(rows, userId, new Map(users.map(u => [String(u.user_id), u]))),
    first: label(sorted[0]),
    last: label(sorted.at(-1)),
    server: { rank: ranking.findIndex(([id]) => id === String(userId)) + 1, users: ranking.length, seconds: sum(rows) },
  };
}

// Plex bandwidth buckets ({ at: unix seconds, bytes, lan }) -> remote-only totals per year, newest year first.
// Local network (lan) traffic is ignored on purpose: only data that actually left the house counts.
export function bandwidthByYear(stats) {
  stats = stats.filter(s => !s.lan);
  const years = new Map();
  for (const s of stats) {
    const year = new Date(s.at * 1000).getFullYear();
    const e = years.get(year) || { year, bytes: 0 };
    e.bytes += Number(s.bytes) || 0;
    years.set(year, e);
  }
  const list = [...years.values()].sort((a, b) => b.year - a.year);
  return {
    years: list,
    bytes: list.reduce((t, y) => t + y.bytes, 0),
    since: stats.length ? Math.min(...stats.map(s => s.at)) : null,
  };
}
