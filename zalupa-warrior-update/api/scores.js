// Shared leaderboard for Zalupa Warrior.
//
//   GET  /api/scores?board=all|zen|riki|koska&limit=10&me=Name
//        Top players on a board, one row per name (their best run), plus where "me" stands.
//   POST /api/scores  { name, char, score, caught }
//        Saves a finished shift. Every run goes into a log; a player's best per board is ranked.
//
// Storage is Upstash Redis, spoken to over its REST API so no npm packages are needed.
// Connecting an "Upstash for Redis" database to the Vercel project sets KV_REST_API_URL and
// KV_REST_API_TOKEN. UPSTASH_REDIS_REST_URL/_TOKEN, or either pair behind a custom prefix, also works.

const CHARS = ['zen', 'riki', 'koska'];
const BOARDS = ['all', ...CHARS];
const K = {
  best: (board) => 'zw:best:' + board, // sorted set: player key -> best score
  run: (board) => 'zw:run:' + board,   // hash: player key -> JSON of that best run
  runs: 'zw:runs',                     // list: every run, newest first
  count: 'zw:runs:count',
  rate: (ip) => 'zw:rl:' + ip,
};
const RUNS_KEPT = 5000;
const RATE_LIMIT = 20; // saves per IP per minute
const NAME_MAX = 16;

function credentials() {
  const e = process.env;
  if (e.KV_REST_API_URL && e.KV_REST_API_TOKEN) return [e.KV_REST_API_URL, e.KV_REST_API_TOKEN];
  if (e.UPSTASH_REDIS_REST_URL && e.UPSTASH_REDIS_REST_TOKEN) return [e.UPSTASH_REDIS_REST_URL, e.UPSTASH_REDIS_REST_TOKEN];
  // Connected with a custom prefix, e.g. DB1_KV_REST_API_URL or DB1_UPSTASH_REDIS_REST_URL.
  for (const k of Object.keys(e)) {
    if (!/_REST(_API)?_URL$/.test(k)) continue;
    const token = e[k.slice(0, -3) + 'TOKEN'];
    if (e[k] && token) return [e[k], token];
  }
  return null;
}

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

// Runs commands in one round trip; returns their results in order.
async function redis(commands) {
  const creds = credentials();
  if (!creds) throw new HttpError(503, 'not_configured');
  const [url, token] = creds;
  const res = await fetch(url.replace(/\/+$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error('redis http ' + res.status);
  return (await res.json()).map((r) => {
    if (r.error) throw new Error('redis: ' + r.error);
    return r.result;
  });
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code }, err.status);
    console.error(err);
    return json({ error: 'storage_error' }, 502);
  }
}

// Letters, digits, spaces and punctuation from any language; control characters and runs of spaces go.
function cleanName(v) {
  if (typeof v !== 'string') return '';
  const s = v.normalize('NFC').replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, NAME_MAX).join('').trim();
}
const playerKey = (name) => name.toLowerCase();

const intIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Every bar is worth 10 or 50 points times a multiplier of at most 5, and driving Mällu off
// pays 500 × visit number. He shows up after 20 bars at the earliest, then at most every 20 more.
function plausible(score, caught) {
  if (score % 10 !== 0) return false;
  const visits = Math.floor(caught / 20);
  return score <= caught * 250 + 250 * visits * (visits + 1);
}

function parse(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}

function row(key, score, rank, meta) {
  const m = parse(meta) || {};
  return { rank, name: m.name || key, char: CHARS.includes(m.char) ? m.char : null, score, caught: m.caught ?? null, at: m.at ?? null };
}

async function readBoard(board, limit, meKey) {
  const zset = K.best(board);
  const cmds = [['ZREVRANGE', zset, 0, limit - 1, 'WITHSCORES'], ['ZCARD', zset]];
  if (meKey) cmds.push(['ZREVRANK', zset, meKey], ['ZSCORE', zset, meKey]);
  const [flat, players, meRank = null, meScore = null] = await redis(cmds);

  const keys = [], scores = [];
  for (let i = 0; i < flat.length; i += 2) { keys.push(flat[i]); scores.push(Number(flat[i + 1])); }
  const meOutside = meKey && meRank !== null && meRank >= keys.length;
  const metaKeys = meOutside ? [...keys, meKey] : keys;
  const metas = metaKeys.length ? (await redis([['HMGET', K.run(board), ...metaKeys]]))[0] : [];

  const entries = keys.map((k, i) => row(k, scores[i], i + 1, metas[i]));
  let me = null;
  if (meRank !== null) me = meOutside ? row(meKey, Number(meScore), meRank + 1, metas[metas.length - 1]) : entries[meRank];
  return { board, players, entries, me };
}

export function GET(request) {
  return guard(async () => {
    const q = new URL(request.url).searchParams;
    const board = BOARDS.includes(q.get('board')) ? q.get('board') : 'all';
    const limit = Math.min(50, Math.max(1, parseInt(q.get('limit'), 10) || 10));
    const me = cleanName(q.get('me') || '');
    return json(await readBoard(board, limit, me ? playerKey(me) : null));
  });
}

export function POST(request) {
  return guard(async () => {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const { char, score, caught } = body || {};
    const name = cleanName(body && body.name);
    if (!name) return json({ error: 'name_required' }, 400);
    if (!CHARS.includes(char)) return json({ error: 'bad_char' }, 400);
    if (!intIn(score, 1, 10_000_000) || !intIn(caught, 0, 100_000) || !plausible(score, caught)) {
      return json({ error: 'bad_score' }, 400);
    }

    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
    const [, hits] = await redis([['SET', K.rate(ip), 0, 'EX', 60, 'NX'], ['INCR', K.rate(ip)]]);
    if (hits > RATE_LIMIT) return json({ error: 'slow_down' }, 429, { 'Retry-After': '60' });

    const key = playerKey(name);
    const run = JSON.stringify({ name, char, score, caught, at: Date.now() });
    // ZADD GT CH answers 1 only when this run beats the player's stored best (or is their first).
    const [bestAll, bestChar] = await redis([
      ['ZADD', K.best('all'), 'GT', 'CH', score, key],
      ['ZADD', K.best(char), 'GT', 'CH', score, key],
      ['LPUSH', K.runs, run],
      ['LTRIM', K.runs, 0, RUNS_KEPT - 1],
      ['INCR', K.count],
    ]);
    const cmds = [];
    if (bestAll) cmds.push(['HSET', K.run('all'), key, run]);
    if (bestChar) cmds.push(['HSET', K.run(char), key, run]);
    cmds.push(['ZREVRANK', K.best('all'), key], ['ZREVRANK', K.best(char), key]);
    const out = await redis(cmds);
    const [rankAll, rankChar] = out.slice(-2);

    return json({ ok: true, name, newBest: bestAll === 1, newCharBest: bestChar === 1, rank: rankAll + 1, charRank: rankChar + 1 });
  });
}
