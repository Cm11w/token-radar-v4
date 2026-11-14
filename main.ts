// radar-4 entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores the board with the risk-adjusted model in
// lib/model.ts, and writes the gate's shape: board.json, the dashboard's
// data.js, the dashboard/ and screenshots/ copies, and dossier.json from the
// vendored make.fun library. Runs with no network and writes identical bytes
// on every run: the same snapshot in, the same files out.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { farmPlan, riskNarrative } from './lib/farm.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DOSSIER_TEXT_BYTES = 65_536;
const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** `--flag value` / `--flag=value` from argv, else the fallback. */
function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`radar-4: ${message}\n`);
  process.exit(1);
}

function main(): void {
  const inputArg = flag('input', '/input');
  const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(snapshotPath)) {
    fail(`no snapshot at ${snapshotPath} (pass --input <snapshot.json|directory>)`);
  }
  const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const { board, radar } = buildRadar(snapshot, farmPlan, riskNarrative);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(outDir, 'data.js'), dataScript(radar));

  const copied = copyTree(join(ROOT, 'dashboard'), join(outDir, 'dashboard'));
  if (copied === 0) fail('dashboard/ holds no files to hand in');
  const shots = copyTree(join(ROOT, 'screenshots'), join(outDir, 'screenshots'));
  if (shots < 3) fail(`screenshots/ holds ${shots} images: hand in 3 or 4`);
  for (const name of readdirSync(join(ROOT, 'screenshots'))) {
    if (name.startsWith('.')) continue;
    if (!SCREENSHOT_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }

  // The dossier is written last: the scorer rebuilds it from this output and
  // compares the bytes, so it must be written from the finished directory.
  writeFileSync(
    join(outDir, 'dossier.json'),
    buildDossier(outDir, {
      text_max_bytes: DOSSIER_TEXT_BYTES,
      screenshots: { max: 4, max_bytes: 524_288 },
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }),
  );

  const risky = board.filter((r) => r.confidence_band === 'Low').length;
  process.stdout.write(
    `radar-4: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows (${radar.early_size} early), ${risky} low-confidence\n` +
      `radar-4: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, dashboard/ (${copied} files), screenshots/ (${shots}) and ${join(outDir, 'dossier.json')}\n`,
  );
}

/** Copy a directory's regular files into `to`, skipping dot-names. Returns the count. */
function copyTree(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  let n = 0;
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    n++;
  }
  return n;
}

main();
