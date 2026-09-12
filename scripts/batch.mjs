/*
 * Generate the next N missing matchup briefs, then rebuild the shareable file.
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
import { spawnSync } from "node:child_process";
import {
  CLAUDE_EXE, BRIEFS_DIR, briefPath, pending, stats,
  buildPrompt, validate, log
} from "./lib.mjs";
import { build } from "./build.mjs";
import { publish } from "./publish.mjs";
import { run as patchCheck } from "./patch.mjs";

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  return process.argv.includes(`--${name}`) ? true : dflt;
};

const N = parseInt(arg("n", "25"), 10);
const LANE = arg("lane", "Top");
const DRY = !!arg("dry", false);
const TIMEOUT_MS = parseInt(arg("timeout", "240000"), 10);

/* Anything here means the account is out of room or not usable right now.
   Stop the whole run — hammering it cannot succeed and only burns time. */
const FATAL = /not logged in|please run \/login|usage limit|rate limit|quota|exceeded|insufficient|unauthor|forbidden|credit balance/i;

function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.search(/[{[]/);
  if (start === -1) return null;
  // walk to the matching close so trailing prose cannot break the parse
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(body.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function askClaude(prompt) {
  const r = spawnSync(CLAUDE_EXE, ["-p", prompt, "--output-format", "json"], {
    encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, windowsHide: true
  });
  if (r.error) return { fatal: false, err: `spawn failed: ${r.error.message}` };

  const raw = (r.stdout || "") + (r.stderr || "");
  let env = null;
  try { env = JSON.parse(r.stdout); } catch { /* not the envelope we expected */ }

  const resultText = env?.result ?? raw;
  if (FATAL.test(String(resultText))) {
    return { fatal: true, err: String(resultText).slice(0, 200).replace(/\s+/g, " ") };
  }
  if (env?.is_error) {
    return { fatal: false, err: String(resultText).slice(0, 200).replace(/\s+/g, " ") };
  }

  const brief = extractJson(resultText);
  if (!brief) return { fatal: false, err: "no JSON in reply" };

  return {
    brief,
    tokens: (env?.usage?.input_tokens ?? 0) + (env?.usage?.output_tokens ?? 0)
  };
}

/* ------------------------------------------------------------------ */

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
    const res = askClaude(buildPrompt(t.you, t.them, t.lane));

    if (res.fatal) { stopped = res.err; break; }

    if (res.err) {
      failed++;
      log(`  FAIL  ${t.you} into ${t.them} — ${res.err}`);
      if (failed >= 5 && wrote === 0) { stopped = "5 failures with nothing written"; break; }
      continue;
    }

    const bad = validate(res.brief);
    if (bad.length) {
      failed++;
      log(`  REJECT ${t.you} into ${t.them} — ${bad.join("; ")}`);
      continue;
    }

    fs.writeFileSync(briefPath(t.key), JSON.stringify({
      you: t.you, them: t.them, lane: t.lane,
      brief: res.brief,
      generatedAt: Date.now(),
      patch: livePatch,
      generator: "batch"
    }, null, 1));

    wrote++;
    tokens += res.tokens || 0;
    log(`  ok    ${t.you} into ${t.them}`);
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
