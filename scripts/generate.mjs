/*
 * Generating one brief. Shared by the nightly batch and the local server, so
 * an on-demand lookup and a scheduled run produce identical records.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import {
  CLAUDE_EXE, BRIEFS_DIR, briefPath, keyFor, buildPrompt, validate,
  VARIANTS_DIR, variantKey, variantPath
} from "./lib.mjs";

/* Anything here means the account is out of room or not usable right now.
   Callers should stop rather than retry — hammering it cannot succeed. */
export const FATAL = /not logged in|please run \/login|usage limit|rate limit|quota|exceeded|insufficient|unauthor|forbidden|credit balance/i;

export function extractJson(text) {
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

export function askClaude(prompt, timeoutMs = 240000) {
  const r = spawnSync(CLAUDE_EXE, ["-p", prompt, "--output-format", "json"], {
    encoding: "utf8", timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true
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
  if (!brief) return { fatal: false, err: "no JSON in reply", raw: String(resultText) };

  return {
    brief,
    raw: String(resultText),
    stopReason: env?.stop_reason ?? null,
    tokens: (env?.usage?.input_tokens ?? 0) + (env?.usage?.output_tokens ?? 0)
  };
}


/* One generation at a time per matchup, so a double-click or two open tabs
   cannot spend twice on the same thing. */
const inFlight = new Map();

export function generateOne(you, them, lane, patch, { timeoutMs, context } = {}) {
  const ctx = (context || "").trim();
  const isVariant = !!ctx;

  /* A situational rewrite is stored apart from the canonical brief, so one
     person's game never becomes the matchup everyone else downloads. */
  const key = isVariant ? variantKey(you, them, lane, ctx) : keyFor(you, them, lane);
  const file = isVariant ? variantPath(key) : briefPath(key);
  const dir = isVariant ? VARIANTS_DIR : BRIEFS_DIR;

  if (inFlight.has(key)) return inFlight.get(key);

  const work = (() => {
    if (fs.existsSync(file)) {
      try {
        return { ok: true, cached: true, variant: isVariant, record: JSON.parse(fs.readFileSync(file, "utf8")) };
      } catch { /* unreadable — fall through and regenerate */ }
    }

    const res = askClaude(buildPrompt(you, them, lane, ctx), timeoutMs);
    if (res.fatal) return { ok: false, fatal: true, error: res.err };
    if (res.err)  return { ok: false, error: res.err };

    const bad = validate(res.brief);
    if (bad.length) return { ok: false, error: `rejected: ${bad.join("; ")}` };

    const record = {
      you, them, lane,
      brief: res.brief,
      generatedAt: Date.now(),
      patch: patch ?? null,
      generator: isVariant ? "variant" : "on-demand",
      ...(isVariant ? { context: ctx } : {})
    };

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record, null, 1));

    return { ok: true, record, variant: isVariant, tokens: res.tokens };
  })();

  // spawnSync is blocking, so `work` is already resolved; the map only guards
  // re-entry from a second request that arrives while this one is running
  inFlight.set(key, work);
  setTimeout(() => inFlight.delete(key), 0);
  return work;
}
