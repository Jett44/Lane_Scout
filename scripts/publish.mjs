/*
 * Rebuild and push, so copies already in people's hands update themselves.
 *
 *   node scripts/publish.mjs
 *
 * Pushing is the only step that reaches outside this machine. If git has no
 * credentials it stops and says so rather than hanging on a prompt — nothing
 * here can block an unattended batch run.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { ROOT, DATA_JSON, log } from "./lib.mjs";
import { build } from "./build.mjs";

const git = (...args) => spawnSync("git", args, {
  cwd: ROOT, encoding: "utf8", timeout: 120000, windowsHide: true,
  // never let a credential prompt stall a scheduled run
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" }
});

export function publish({ quiet = false } = {}) {
  const say = (m) => { if (!quiet) console.log(m); };

  if (!fs.existsSync(`${ROOT}/.git`)) {
    log("publish skipped — not a git repo yet (run: git init && git remote add origin ...)");
    return { pushed: false, reason: "no repo" };
  }

  const { count } = build();

  git("add", "-A");

  const status = git("status", "--porcelain");
  if (!status.stdout.trim()) {
    say("nothing changed since the last publish");
    return { pushed: false, reason: "no changes" };
  }

  const patch = (() => {
    try { return JSON.parse(fs.readFileSync(DATA_JSON, "utf8")).patch; } catch { return null; }
  })();

  const msg = `briefs: ${count} matchups${patch ? ` on patch ${patch}` : ""}`;
  const c = git("commit", "-m", msg);
  if (c.status !== 0 && !/nothing to commit/i.test(c.stdout + c.stderr)) {
    log(`publish failed at commit — ${(c.stderr || c.stdout).trim().slice(0, 200)}`);
    return { pushed: false, reason: "commit failed" };
  }

  const p = git("push", "origin", "HEAD:main");
  if (p.status !== 0) {
    const err = (p.stderr || p.stdout).trim().slice(0, 300);
    log(`publish failed at push — ${err}`);
    if (/could not read|Authentication|denied|terminal prompts disabled/i.test(err)) {
      log("  git has no stored credentials for this repo. Push once by hand to set them up.");
    }
    return { pushed: false, reason: "push failed", err };
  }

  log(`published ${count} matchups${patch ? ` (patch ${patch})` : ""}`);
  return { pushed: true, count };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const r = publish();
  process.exitCode = r.pushed ? 0 : 0; // a failed push is not a failed batch
}
