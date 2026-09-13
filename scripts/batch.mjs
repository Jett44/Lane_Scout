/*
 * Generate the next N missing matchup briefs, then rebuild and publish.
 *
 *   node scripts/batch.mjs --n=25            # normal run
 *   node scripts/batch.mjs --n=3 --dry       # show what it would do, spend nothing
 *   node scripts/batch.mjs --status          # coverage only
 *
 * Safe to kill at any point. Each brief is written the moment it validates,
 * so a run that dies halfway keeps everything it finished and the next run
 * picks up from exactly there. Nothing is ever generated twice.
 */
import fs from "node:fs";
import { BRIEFS_DIR, pending, stats, log } from "./lib.mjs";
import { generateOne } from "./generate.mjs";
import { build } from "./build.mjs";
import { publish } from "./publish.mjs";
import { run as patchCheck } from "./patch.mjs";
import { refreshAssets, readAssets } from "./assets.mjs";

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  return process.argv.includes(`--${name}`) ? true : dflt;
};

const N = parseInt(arg("n", "25"), 10);
const LANE = arg("lane", "Top");
const DRY = !!arg("dry", false);
const TIMEOUT_MS = parseInt(arg("timeout", "240000"), 10);

async function main() {
  const s = stats(LANE);

  if (arg("status", false)) {
    console.log(`${LANE}: ${s.done} / ${s.total} briefs written (${s.left} left, ${(100 * s.done / s.total).toFixed(1)}% covered)`);
    return 0;
  }

  fs.mkdirSync(BRIEFS_DIR, { recursive: true });

  /* Free, no tokens: if Riot shipped a patch since the last run, drop the
     briefs it actually affects so they requeue ahead of never-written ones.
     A network failure here must never block generation. */
  let livePatch = null;
  try {
    const p = await patchCheck({ apply: !DRY, quiet: true });
    livePatch = p.live;
    if (p.stale?.length) log(`patch ${p.previous} -> ${p.live}: requeued ${p.stale.length} stale brief(s)`);

    /* New patch means new and renamed items — refresh the icon map too, or
       anything Riot added this patch renders without art. */
    if (!DRY && (p.firstRun || p.previous !== p.live || !readAssets())) {
      try { await refreshAssets(); } catch (e) { log(`asset refresh skipped — ${e.message}`); }
    }
  } catch (e) {
    log(`patch check skipped — ${e.message}`);
  }

  const queue = pending(LANE, N);
  log(`run start — lane=${LANE} patch=${livePatch ?? "unknown"} requested=${N} queued=${queue.length} coverage=${s.done}/${s.total}`);

  if (!queue.length) {
    log(`nothing left to write for ${LANE}. Coverage complete.`);
    build();
    return 0;
  }

  if (DRY) {
    for (const t of queue) console.log(`  would write  ${t.you} into ${t.them}`);
    console.log(`\n(dry run — nothing spent, nothing written)`);
    return 0;
  }

  let wrote = 0, failed = 0, tokens = 0, stopped = null;

  for (const t of queue) {
    const res = await generateOne(t.you, t.them, t.lane, livePatch, { timeoutMs: TIMEOUT_MS });

    if (res.fatal) { stopped = res.error; break; }

    if (!res.ok) {
      failed++;
      log(`  FAIL  ${t.you} into ${t.them} — ${res.error}`);
      if (failed >= 5 && wrote === 0) { stopped = "5 failures with nothing written"; break; }
      continue;
    }

    wrote++;
    tokens += res.tokens || 0;
    log(`  ok    ${t.you} into ${t.them}`);

    /* Rebuild as we go. A long run used to leave the app serving the previous
       build for its whole duration, which looks exactly like nothing is
       happening. Writing the file is local and cheap; the git push still waits
       for the end so a run makes one commit, not thirty. */
    try { build(); } catch (e) { log(`  rebuild skipped — ${e.message}`); }
  }

  const after = stats(LANE);
  if (stopped) log(`run stopped early — ${stopped}`);
  log(`run end — wrote=${wrote} failed=${failed} tokens~${tokens} coverage=${after.done}/${after.total} (${(100 * after.done / after.total).toFixed(1)}%)`);

  if (wrote > 0) {
    /* Rebuild and push, so copies already in people's hands update themselves
       on their next launch. A failed push never fails the run — the briefs are
       already safely on disk. */
    publish({ quiet: true });
  }

  /* Running out of quota is the expected end of a run, not a failure —
     the next window picks up where this one stopped. */
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => { log(`run aborted — ${e.stack || e.message}`); process.exitCode = 1; })
  .finally(() => {
    /* fetch() keeps sockets alive for a few seconds after the last request.
       Don't make a scheduled job sit around waiting for them, and don't call
       process.exit() while they are mid-close — that trips a libuv assertion
       on Windows and reports a crash for an otherwise clean run. */
    setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
  });
