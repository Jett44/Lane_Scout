/*
 * Bake every written brief into one self-contained HTML file, and emit the
 * briefs.json that already-distributed copies pull updates from.
 *
 *   node scripts/build.mjs
 *
 * Outputs:
 *   dist/lane-scout.html  the file you send people
 *   briefs.json           pushed to the repo; older copies fetch this on launch
 */
import fs from "node:fs";
import path from "node:path";
import {
  BRIEFS_DIR, TEMPLATE, OFFLINE_JS, DIST, DATA_JSON, REMOTE_DATA, keyFor, stats
} from "./lib.mjs";
import { readState } from "./patch.mjs";

const CUT = "/* ---------------- scout ---------------- */";

function collect() {
  const files = fs.existsSync(BRIEFS_DIR)
    ? fs.readdirSync(BRIEFS_DIR).filter((f) => f.endsWith(".json"))
    : [];

  const map = {};
  let newest = 0;
  for (const f of files) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(BRIEFS_DIR, f), "utf8"));
      if (!rec.you || !rec.them || !rec.brief) continue;
      map[keyFor(rec.you, rec.them, rec.lane || "Top")] = rec;
      if (rec.generatedAt > newest) newest = rec.generatedAt;
    } catch {
      console.warn(`  skipped unreadable ${f}`);
    }
  }
  return { map, newest };
}

export function build() {
  const template = fs.readFileSync(TEMPLATE, "utf8");
  const offline = fs.readFileSync(OFFLINE_JS, "utf8");

  const at = template.indexOf(CUT);
  if (at === -1) {
    throw new Error(`template/app.html no longer contains the marker "${CUT}" — build cannot splice the offline runtime in.`);
  }

  const { map, newest } = collect();
  const patch = readState().patch || null;

  /* builtAt is the freshness clock every distributed copy compares against.
     It must move whenever the data does, so derive it from the newest brief
     rather than from wall-clock time — a rebuild with no new briefs should
     not make old copies think they are behind. */
  const builtAt = newest || 0;
  /* `target` travels with the data so a copy that has no local API can still
     show how far along the whole project is, not just its own count. */
  const meta = {
    patch, builtAt,
    count: Object.keys(map).length,
    target: stats("Top").total
  };

  // the update payload older copies fetch
  fs.writeFileSync(DATA_JSON, JSON.stringify({ version: 1, ...meta, briefs: map }));

  // `</` inside any string would otherwise close the surrounding <script>
  const esc = (o) => JSON.stringify(o).replace(/<\//g, "<\\/");

  const out =
    template.slice(0, at) +
    "/* ---------------- baked matchup data ---------------- */\n" +
    `var BRIEFS = ${esc(map)};\n` +
    `var META = ${esc(meta)};\n` +
    `var REMOTE_URL = ${JSON.stringify(REMOTE_DATA)};\n\n` +
    offline +
    "\n</script>\n";

  fs.mkdirSync(path.dirname(DIST), { recursive: true });
  fs.writeFileSync(DIST, out, "utf8");

  const mb = (Buffer.byteLength(out, "utf8") / 1048576).toFixed(2);
  console.log(`built ${DIST} — ${meta.count} matchups, ${mb} MB, patch ${patch ?? "unknown"}`);
  console.log(`wrote ${DATA_JSON} — update payload for copies already out there`);
  return { count: meta.count, bytes: Buffer.byteLength(out, "utf8") };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) build();
