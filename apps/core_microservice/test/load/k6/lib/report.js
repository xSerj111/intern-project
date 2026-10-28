// Turns k6 summary data into the report JSON of contracts/perf-tooling.md
// ("Report JSON"). Pure functions, no k6 imports, so it also runs under node.

export const ENDPOINTS = [
  { key: 'feed', method: 'GET', route: '/posts/feed' },
  { key: 'profile', method: 'GET', route: '/profiles/by-user/:userId' },
  { key: 'comments', method: 'GET', route: '/comments/post/:postId' },
  { key: 'profile_search', method: 'GET', route: '/profiles/search' },
  { key: 'chat_list', method: 'GET', route: '/chats' },
  // route is filled in per flow (legacy: /assets/upload + /posts, current: /uploads + /posts)
  { key: 'post_create_image', method: 'POST', route: '/posts' },
];

const POST_ROUTE_BY_FLOW = {
  legacy: '/assets/upload + /posts',
  current: '/uploads + /posts',
};

const round = (n, digits = 2) =>
  typeof n === 'number' && Number.isFinite(n)
    ? Math.round(n * 10 ** digits) / 10 ** digits
    : null;

const values = (data, name) => {
  const m = data.metrics && data.metrics[name];
  return m ? m.values || m : null;
};

/**
 * Meta from the env vars the wrapper (run-k6.sh) sets.
 * @param {Record<string, string|undefined>} env  k6's `__ENV`
 * @param {{vus:number, rampSec:number, holdSec:number, warmupSec:number}} load
 */
export function metaFromEnv(env, load) {
  return {
    name: env.REPORT || 'baseline',
    gitRevision: env.GIT_REVISION || 'unknown',
    seed: { profile: 'perf', version: Number(env.SEED_VERSION || 1) },
    loadProfile: { ...load, flow: env.FLOW || 'current' },
    environment: {
      cpu: env.ENV_CPU || 'unknown',
      memGb: Number(env.ENV_MEM_GB) || null,
      os: env.ENV_OS || 'unknown',
      node: env.ENV_NODE || 'unknown',
      notes: env.ENV_NOTES || '',
    },
  };
}

/**
 * Per-endpoint custom metrics (declared in key-endpoints.js):
 * `<key>_duration` (Trend ms), `<key>_db_queries` (Trend), `<key>_errors` (Rate),
 * `<key>_samples` (Counter). Warm-up requests are never recorded in them.
 * For post_create_image, `_db_queries` is already the sum over the sub-requests
 * of one iteration, so avg/max are per created post.
 */
export function buildReport(data, meta) {
  const flow = meta.loadProfile.flow;
  const endpoints = ENDPOINTS.map((e) => {
    const dur = values(data, `${e.key}_duration`);
    const q = values(data, `${e.key}_db_queries`);
    const err = values(data, `${e.key}_errors`);
    const samples = values(data, `${e.key}_samples`);
    return {
      key: e.key,
      method: e.method,
      route:
        e.key === 'post_create_image'
          ? POST_ROUTE_BY_FLOW[flow] || e.route
          : e.route,
      p50Ms: round(dur && dur.med),
      p95Ms: round(dur && dur['p(95)']),
      errorRate: err ? round(err.rate, 4) : 0,
      queriesPerRequest: { avg: round(q && q.avg), max: round(q && q.max) },
      samples: samples ? samples.count : 0,
    };
  });
  return {
    name: meta.name,
    createdAt: new Date().toISOString(),
    gitRevision: meta.gitRevision,
    seed: meta.seed,
    loadProfile: meta.loadProfile,
    environment: meta.environment,
    endpoints,
  };
}

/** Plain-text table for stdout. */
export function formatReport(report) {
  const rows = report.endpoints.map((e) =>
    [
      e.key.padEnd(18),
      String(e.p50Ms).padStart(9),
      String(e.p95Ms).padStart(9),
      `${round(e.errorRate * 100, 2)}%`.padStart(8),
      String(e.queriesPerRequest.avg).padStart(9),
      String(e.samples).padStart(8),
    ].join(' '),
  );
  const head = [
    'endpoint'.padEnd(18),
    'p50 ms'.padStart(9),
    'p95 ms'.padStart(9),
    'errors'.padStart(8),
    'q/req'.padStart(9),
    'samples'.padStart(8),
  ].join(' ');
  return `\n${report.name} (flow=${report.loadProfile.flow}, rev ${report.gitRevision})\n${head}\n${rows.join('\n')}\n`;
}
