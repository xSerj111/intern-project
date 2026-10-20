/**
 * Compares two k6 reports written by `run-k6.sh` (test/load/reports/<name>.json).
 *
 * Usage:
 *   ts-node compare-reports.ts <a> <b>                  before/after Markdown table
 *   ts-node compare-reports.ts --repeatability <a> <b>  exit 1 if any p95 differs by > 20%
 *
 * <a>/<b> are report names resolved under test/load/reports/, or file paths.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPORTS_DIR = join(__dirname, 'reports');
const MIN_P95_GAIN = 0.3; // SC-002
const MAX_REPEATABILITY_DRIFT = 0.2;

interface EndpointStats {
  key: string;
  method: string;
  route: string;
  p50Ms: number | null;
  p95Ms: number | null;
  errorRate: number;
  queriesPerRequest: { avg: number | null; max: number | null };
  samples: number;
}

interface Report {
  name: string;
  gitRevision?: string;
  loadProfile?: { flow?: string };
  endpoints: EndpointStats[];
}

function loadReport(arg: string): Report {
  const candidates = [
    arg,
    join(REPORTS_DIR, arg),
    join(REPORTS_DIR, `${arg}.json`),
  ];
  const path = candidates.find((p) => existsSync(p) && p.endsWith('.json'));
  if (!path) {
    throw new Error(
      `report not found: ${arg} (looked for ${candidates.join(', ')})`,
    );
  }
  const report = JSON.parse(readFileSync(path, 'utf8')) as Report;
  if (!Array.isArray(report.endpoints)) {
    throw new Error(`${path} is not a perf report (no endpoints[])`);
  }
  return report;
}

const num = (n: number | null | undefined): string =>
  n === null || n === undefined ? 'n/a' : String(Math.round(n * 10) / 10);
const pct = (n: number): string =>
  `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
const label = (r: Report): string =>
  `${r.name} (${r.loadProfile?.flow ?? '?'}, ${r.gitRevision ?? '?'})`;

/** Relative change from a to b, or null when a is missing or zero. */
function delta(a: number | null, b: number | null): number | null {
  if (a === null || b === null || a === 0) return null;
  return (b - a) / a;
}

function compare(a: Report, b: Report): void {
  console.log(`Before: ${label(a)}  After: ${label(b)}\n`);
  console.log(
    '| endpoint | p50 before→after | p95 before→after (Δ%) | errors | queries/req before→after | flag |',
  );
  console.log('|---|---|---|---|---|---|');
  for (const ea of a.endpoints) {
    const eb = b.endpoints.find((e) => e.key === ea.key);
    if (!eb) {
      console.log(
        `| ${ea.key} | n/a | n/a | n/a | n/a | missing in ${b.name} |`,
      );
      continue;
    }
    const d95 = delta(ea.p95Ms, eb.p95Ms);
    const qa = ea.queriesPerRequest.avg;
    const qb = eb.queriesPerRequest.avg;
    const fewerQueries = qa !== null && qb !== null && qb < qa;
    const gain = d95 === null ? 0 : -d95;
    const flag = gain >= MIN_P95_GAIN || fewerQueries ? '' : 'no gain (SC-002)';
    console.log(
      `| ${ea.key} | ${num(ea.p50Ms)}→${num(eb.p50Ms)} ms | ${num(ea.p95Ms)}→${num(eb.p95Ms)} ms (${d95 === null ? 'n/a' : pct(d95)}) | ${(ea.errorRate * 100).toFixed(2)}%→${(eb.errorRate * 100).toFixed(2)}% | ${num(qa)}→${num(qb)} | ${flag} |`,
    );
  }
  for (const eb of b.endpoints) {
    if (!a.endpoints.some((e) => e.key === eb.key)) {
      console.log(
        `| ${eb.key} | n/a | n/a | n/a | n/a | missing in ${a.name} |`,
      );
    }
  }
}

function repeatability(a: Report, b: Report): number {
  console.log(
    `Repeatability: ${label(a)} vs ${label(b)} (limit ±${MAX_REPEATABILITY_DRIFT * 100}% p95)\n`,
  );
  const failed: string[] = [];
  for (const ea of a.endpoints) {
    const eb = b.endpoints.find((e) => e.key === ea.key);
    const d = eb ? delta(ea.p95Ms, eb.p95Ms) : null;
    if (!eb || d === null) {
      console.log(
        `${ea.key}: p95 ${num(ea.p95Ms)}→${num(eb?.p95Ms)} ms, not comparable`,
      );
      failed.push(ea.key);
      continue;
    }
    const bad = Math.abs(d) > MAX_REPEATABILITY_DRIFT;
    console.log(
      `${ea.key}: p95 ${num(ea.p95Ms)}→${num(eb.p95Ms)} ms (${pct(d)}) ${bad ? 'FAIL' : 'ok'}`,
    );
    if (bad) failed.push(ea.key);
  }
  if (failed.length > 0) {
    console.error(`\nNot repeatable: ${failed.join(', ')}`);
    return 1;
  }
  console.log('\nRepeatable: every p95 within the limit');
  return 0;
}

function main(): number {
  const args = process.argv.slice(2);
  const repeat = args.includes('--repeatability');
  const names = args.filter((x) => x !== '--repeatability');
  if (names.length !== 2) {
    console.error('usage: compare-reports.ts [--repeatability] <a> <b>');
    return 2;
  }
  const [a, b] = names.map(loadReport);
  if (repeat) return repeatability(a, b);
  compare(a, b);
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 2;
}
