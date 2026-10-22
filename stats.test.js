import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWrapped, buildLeaderboard, bandwidthByYear } from './stats.js';

const t = s => Date.parse(s) / 1000; // no "Z" = local time, like the server
const rows = [
  { user_id: 1, started: t('2025-03-01T22:00'), duration: 3600, media_type: 'episode', grandparent_title: 'Show A', grandparent_rating_key: 10, full_title: 'Show A - Ep1', platform: 'Roku', transcode_decision: 'transcode' },
  { user_id: 1, started: t('2025-03-02T23:00'), duration: 3600, media_type: 'episode', grandparent_title: 'Show A', grandparent_rating_key: 10, platform: 'Roku' },
  { user_id: 1, started: t('2025-03-03T20:00'), play_duration: 7200, duration: 9000, media_type: 'movie', title: 'Movie B', rating_key: 20, percent_complete: 30, platform: 'Chrome' },
  { user_id: 1, started: t('2024-12-31T20:00'), duration: 99999, media_type: 'movie', title: 'Last year' },
  { user_id: 2, started: t('2025-05-05T10:00'), duration: 100, media_type: 'track', grandparent_title: 'Artist' },
];

test('builds a user year', () => {
  const w = buildWrapped(rows, '1', 2025);
  assert.equal(w.totalSeconds, 14400);
  assert.equal(w.plays, 3);
  assert.equal(w.shows.top[0].title, 'Show A');
  assert.equal(w.shows.top[0].plays, 2);
  assert.equal(w.movies.seconds, 7200); // play_duration wins over duration
  assert.equal(w.streak, 3);
  assert.equal(w.streakEnd, '2025-03-03');
  assert.equal(w.binge.day, '2025-03-03');
  assert.equal(w.binge.top.title, 'Movie B');
  assert.equal(w.abandoned, 1);
  assert.equal(w.hours[22], 3600);
  assert.deepEqual(w.platforms.map(p => p.seconds), [7200, 7200]);
  assert.equal(w.first.title, 'Show A - Ep1');
  assert.deepEqual(w.server, { rank: 1, users: 2, seconds: 14500 });
});

test('empty year', () => {
  const w = buildWrapped(rows, '3', 2025);
  assert.equal(w.plays, 0);
  assert.equal(w.binge, undefined);
  assert.equal(w.server.rank, 0);
});

test('leaderboard', () => {
  const lb = buildLeaderboard(rows, 2025, [{ user_id: 1, friendly_name: 'Ann' }, { user_id: 2, username: 'bob' }]);
  assert.deepEqual(lb.viewers.map(v => [v.name, v.seconds, v.topShow]), [['Ann', 14400, 'Show A'], ['bob', 100, undefined]]);
  assert.equal(lb.shows[0].viewers, 1);
  assert.equal(lb.movies[0].title, 'Movie B');
  assert.equal(lb.plays, 4);
  assert.equal(lb.months[2], 14400);
});

test('bandwidth per year', () => {
  const b = bandwidthByYear([
    { at: t('2024-11-01T00:00'), bytes: 100, lan: true },
    { at: t('2025-01-01T00:00'), bytes: 300, lan: false },
    { at: t('2025-06-01T00:00'), bytes: 200, lan: true },
  ]);
  assert.deepEqual(b.years, [{ year: 2025, bytes: 300 }]); // local (lan) traffic doesn't count
  assert.equal(b.bytes, 300);
  assert.equal(b.since, t('2025-01-01T00:00'));
  assert.deepEqual(bandwidthByYear([]), { years: [], bytes: 0, since: null });
});

test('taste twin and transcodes', () => {
  const twinRows = [
    ...rows,
    { user_id: 2, started: t('2025-04-01T20:00'), duration: 1800, media_type: 'episode', grandparent_title: 'Show A', grandparent_rating_key: 10 },
    { user_id: 3, started: t('2025-04-01T20:00'), duration: 9000, media_type: 'episode', grandparent_title: 'Other', grandparent_rating_key: 99, friendly_name: 'Cy' },
  ];
  const w = buildWrapped(twinRows, '1', 2025, [{ user_id: 2, friendly_name: 'Bo' }]);
  assert.equal(w.transcodes, 1);
  assert.equal(w.twin.name, 'Bo');
  assert.deepEqual(w.twin.shared, ['Show A']);
  assert.equal(w.twin.match, 50); // Show A is half of user 1's time and all of user 2's (tracks don't count)
  assert.equal(buildWrapped(rows, '2', 2025).twin, null); // user 2 only played a track: nothing to compare
  assert.equal(buildLeaderboard(twinRows, 2025).viewers.find(v => v.id === '1').transcodes, 1);
});

test('show posters come from the show, not the season', () => {
  const ep = { user_id: 1, started: t('2025-02-01T20:00'), duration: 60, media_type: 'episode', grandparent_title: 'S', grandparent_rating_key: 4321, thumb: '/library/metadata/999/thumb/1' };
  assert.equal(buildWrapped([ep], '1', 2025).shows.top[0].thumb, '/library/metadata/4321/thumb'); // real Tautulli: no grandparent_thumb
  assert.equal(buildWrapped([{ ...ep, grandparent_thumb: '/x/thumb' }], '1', 2025).shows.top[0].thumb, '/x/thumb');
  assert.equal(buildWrapped([{ ...ep, grandparent_rating_key: undefined }], '1', 2025).shows.top[0].thumb, '/library/metadata/999/thumb/1');
});
