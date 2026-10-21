// Gate-mode thresholds (FR-032; data-model §6, contracts/perf-tooling.md).
// Per-endpoint keys match the `endpoint` tag set on every request.

export const ENDPOINT_KEYS = [
  'feed',
  'profile',
  'comments',
  'profile_search',
  'chat_list',
  'post_create_image',
];

const LATENCY_P95_MS = 300;
const POST_CREATE_IMAGE_P95_MS = 1000;
const MAX_ERROR_RATE = 0.01;

const rule = (threshold) => ({ threshold, abortOnFail: false });

export const thresholds = {};
for (const key of [
  'feed',
  'profile',
  'comments',
  'profile_search',
  'chat_list',
]) {
  thresholds[`http_req_duration{endpoint:${key}}`] = [
    rule(`p(95)<${LATENCY_P95_MS}`),
  ];
}
// Custom Trend: sign + upload + confirm + create (whole round trip).
thresholds.post_create_image_duration = [
  rule(`p(95)<${POST_CREATE_IMAGE_P95_MS}`),
];
for (const key of ENDPOINT_KEYS) {
  thresholds[`http_req_failed{endpoint:${key}}`] = [
    rule(`rate<${MAX_ERROR_RATE}`),
  ];
}

/**
 * Names of the failed thresholds in `endpoint:metric` form, from the data
 * passed to handleSummary (`metrics[name].thresholds[expr].ok`).
 * @returns {string[]}
 */
export function failedThresholds(data) {
  const failed = [];
  for (const [name, metric] of Object.entries(data.metrics || {})) {
    for (const [expr, result] of Object.entries(metric.thresholds || {})) {
      if (result.ok) continue;
      const tagged = /^(\w+)\{endpoint:(\w+)\}$/.exec(name);
      const label = tagged
        ? `${tagged[2]}:${tagged[1]}`
        : name.replace(/_duration$/, ':duration');
      failed.push(`${label} (${expr})`);
    }
  }
  return failed;
}
