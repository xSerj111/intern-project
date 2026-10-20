// k6 load profile over the 6 key endpoints (contracts/perf-tooling.md).
// Run through run-k6.sh (pinned grafana/k6 image); env: MODE, FLOW, REPORT,
// CORE_URL, AUTH_URL, PERF_PASSWORD (see run-k6.sh for the rest).
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import { buildPng } from './lib/png.js';
import { buildReport, formatReport, metaFromEnv } from './lib/report.js';

const MODE = __ENV.MODE || 'measure';
const FLOW = __ENV.FLOW || 'current';
const REPORT = __ENV.REPORT || 'baseline';
const CORE_URL = __ENV.CORE_URL || 'http://localhost:3001';
const AUTH_URL = __ENV.AUTH_URL || 'http://localhost:3002';
// Shared password of the perf seed users (default = PERF_PASSWORD in seed/perf.ts).
const PERF_PASSWORD = __ENV.PERF_PASSWORD || 'PerfPassword123!';
const PERF_EMAIL_DOMAIN = __ENV.PERF_EMAIL_DOMAIN || 'innogram.dev';
const USER_POOL = Number(__ENV.PERF_USERS || 200);

const VUS = 20;
const RAMP_SEC = 30;
const HOLD_SEC = 120;
const WARMUP_SEC = 15;
const IMAGE_EVERY = 5;

if (MODE !== 'measure') {
  throw new Error(
    `MODE=${MODE} is not supported yet (only measure; gate comes with T129)`,
  );
}
if (FLOW !== 'legacy' && FLOW !== 'current') {
  throw new Error(`FLOW must be legacy or current, got ${FLOW}`);
}
if (!/^[\w.-]+$/.test(REPORT)) {
  throw new Error(`REPORT must match [\\w.-]+, got ${REPORT}`);
}

export const options = {
  setupTimeout: '300s',
  scenarios: {
    key_endpoints: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: `${RAMP_SEC}s`, target: VUS },
        { duration: `${HOLD_SEC}s`, target: VUS },
      ],
      gracefulRampDown: '10s',
    },
  },
};

const KEYS = [
  'feed',
  'profile',
  'comments',
  'profile_search',
  'chat_list',
  'post_create_image',
];
const metrics = {};
for (const key of KEYS) {
  metrics[key] = {
    duration: new Trend(`${key}_duration`, true),
    queries: new Trend(`${key}_db_queries`),
    errors: new Rate(`${key}_errors`),
    samples: new Counter(`${key}_samples`),
  };
}

const png = buildPng();

const perfEmail = (n) =>
  `perf${String(n).padStart(4, '0')}@${PERF_EMAIL_DOMAIN}`;

export function setup() {
  const tokens = [];
  const headers = { 'Content-Type': 'application/json' };
  for (let from = 1; from <= USER_POOL; from += 20) {
    const reqs = [];
    for (let n = from; n < from + 20 && n <= USER_POOL; n++) {
      reqs.push({
        method: 'POST',
        url: `${AUTH_URL}/auth/login`,
        body: JSON.stringify({ email: perfEmail(n), password: PERF_PASSWORD }),
        params: { headers, tags: { name: 'setup-login' } },
      });
    }
    for (const res of http.batch(reqs)) {
      if (res.status !== 200) {
        throw new Error(
          `login failed (${res.status}): ${res.body} - is the perf seed loaded?`,
        );
      }
      tokens.push(res.json('accessToken'));
    }
  }
  return { tokens, startedAt: Date.now() };
}

function header(res, name) {
  const lower = name.toLowerCase();
  for (const k of Object.keys(res.headers)) {
    if (k.toLowerCase() === lower) return res.headers[k];
  }
  return undefined;
}

const isOk = (res) => res.status >= 200 && res.status < 300;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function record(key, phase, ok, durationMs, queries) {
  if (phase === 'warmup') return;
  const m = metrics[key];
  m.duration.add(durationMs);
  m.errors.add(!ok);
  m.samples.add(1);
  if (queries !== null) m.queries.add(queries);
}

function queryCount(res) {
  const raw = header(res, 'X-Db-Query-Count');
  return raw === undefined ? null : Number(raw);
}

/** One tagged request; records the per-endpoint metrics unless in warm-up. */
function call(key, phase, name, method, url, token, body, extraHeaders) {
  const params = {
    headers: { Authorization: `Bearer ${token}`, ...(extraHeaders || {}) },
    tags: { endpoint: key, phase, name },
  };
  const res =
    method === 'GET' ? http.get(url, params) : http.post(url, body, params);
  return res;
}

function simple(key, phase, name, url, token) {
  const res = call(key, phase, name, 'GET', url, token);
  record(key, phase, isOk(res), res.timings.duration, queryCount(res));
  return res;
}

// post_create_image: the whole round trip is one sample; queries are summed.
function createPostWithImage(phase, token) {
  const start = Date.now();
  let queries = null;
  const add = (res) => {
    const q = queryCount(res);
    if (q !== null) queries = (queries || 0) + q;
  };
  let ok = false;

  // FLOW=current (B5 upload flow) is filled in by T130; until then both flows
  // use the legacy multipart upload through core.
  const upload = call(
    'post_create_image',
    phase,
    'POST /assets/upload',
    'POST',
    `${CORE_URL}/assets/upload`,
    token,
    { file: http.file(png, 'perf.png', 'image/png') },
  );
  add(upload);
  if (isOk(upload)) {
    const create = call(
      'post_create_image',
      phase,
      'POST /posts',
      'POST',
      `${CORE_URL}/posts`,
      token,
      JSON.stringify({
        content: `perf post ${__VU}-${__ITER}`,
        assetIds: [upload.json('id')],
      }),
      { 'Content-Type': 'application/json' },
    );
    add(create);
    ok = isOk(create);
  }
  record('post_create_image', phase, ok, Date.now() - start, queries);
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const phase =
    Date.now() - data.startedAt < WARMUP_SEC * 1000 ? 'warmup' : 'measure';

  // legacy: offset paging; current: cursor paging (first page = no cursor)
  const feedQuery = FLOW === 'legacy' ? 'page=1&limit=20' : 'limit=20';
  const feed = simple(
    'feed',
    phase,
    'GET /posts/feed',
    `${CORE_URL}/posts/feed?${feedQuery}`,
    token,
  );
  const items = isOk(feed) ? feed.json('items') || [] : [];

  // feed authors are users the viewer follows
  const withAuthor = items.filter((p) => p.author);
  let prefix = null;
  if (withAuthor.length > 0) {
    const author = pick(withAuthor).author;
    simple(
      'profile',
      phase,
      'GET /profiles/by-user/:userId',
      `${CORE_URL}/profiles/by-user/${author.userId}`,
      token,
    );
    prefix = String(author.username || '').slice(
      0,
      2 + Math.floor(Math.random() * 2),
    );
  }
  if (items.length > 0) {
    simple(
      'comments',
      phase,
      'GET /comments/post/:postId',
      `${CORE_URL}/comments/post/${pick(items).id}`,
      token,
    );
  }

  if (!prefix || prefix.length < 2) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    prefix =
      alphabet[Math.floor(Math.random() * 26)] +
      alphabet[Math.floor(Math.random() * 26)];
  }
  simple(
    'profile_search',
    phase,
    'GET /profiles/search',
    `${CORE_URL}/profiles/search?q=${encodeURIComponent(prefix)}`,
    token,
  );

  simple('chat_list', phase, 'GET /chats', `${CORE_URL}/chats?limit=20`, token);

  if (__ITER % IMAGE_EVERY === IMAGE_EVERY - 1) {
    createPostWithImage(phase, token);
  }
}

export function handleSummary(data) {
  const meta = metaFromEnv(__ENV, {
    vus: VUS,
    rampSec: RAMP_SEC,
    holdSec: HOLD_SEC,
    warmupSec: WARMUP_SEC,
  });
  const report = buildReport(data, meta);
  return {
    [`reports/${REPORT}.json`]: JSON.stringify(report, null, 2),
    stdout: formatReport(report),
  };
}
