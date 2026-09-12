/*
 * Patch tracking and targeted invalidation.
 *
 *   node scripts/patch.mjs              report only — what changed, what is stale
 *   node scripts/patch.mjs --apply      delete the stale briefs so batch regenerates them
 *
 * Costs no Claude tokens. Everything here is public Riot data.
 *
 * A patch does not invalidate the whole database. A brief goes stale only if
 * the patch touched a champion it is about, or an item it actually recommends.
 */
import fs from "node:fs";
import path from "node:path";
import { BRIEFS_DIR, ROOT, POOL, keyFor, log } from "./lib.mjs";

const DDRAGON = "https://ddragon.leagueoflegends.com";
const STATE = path.join(ROOT, "data", "patch-state.json");

const getJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
};

export async function currentPatch() {
  const versions = await getJson(`${DDRAGON}/api/versions.json`);
  return versions[0];
}

export function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); }
  catch { return { patch: null, checkedAt: 0 }; }
}

export function writeState(patch) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ patch, checkedAt: Date.now() }, null, 1));
}

/* What Riot actually changed between two patches. */
export async function changedSince(oldV, newV) {
  const [nc, oc, ni, oi] = await Promise.all([
    getJson(`${DDRAGON}/cdn/${newV}/data/en_US/championFull.json`),
    getJson(`${DDRAGON}/cdn/${oldV}/data/en_US/championFull.json`),
    getJson(`${DDRAGON}/cdn/${newV}/data/en_US/item.json`),
    getJson(`${DDRAGON}/cdn/${oldV}/data/en_US/item.json`)
  ]);

  const champions = [];
  for (const k of Object.keys(nc.data)) {
    if (JSON.stringify(nc.data[k]) !== JSON.stringify(oc.data[k])) champions.push(nc.data[k].name);
  }

  const items = [];
  for (const k of Object.keys(ni.data)) {
    if (JSON.stringify(ni.data[k]) !== JSON.stringify(oi.data[k])) {
      const name = ni.data[k].name || oi.data[k]?.name;
      if (name) items.push(name);
    }
  }

  return { champions, items: [...new Set(items)] };
}

/* Every item name a brief actually recommends. */
function itemsNamedIn(brief) {
  const b = brief?.build || {};
  const names = [];
  if (b.start?.item) names.push(b.start.item);
  if (b.boots?.item) names.push(b.boots.item);
  for (const x of b.core || []) if (x.item) names.push(x.item);
  for (const x of b.situational || []) if (x.item) names.push(x.item);
  return names;
}

export function findStale(changed, newPatch) {
  if (!fs.existsSync(BRIEFS_DIR)) return [];
  const champSet = new Set(changed.champions);
  const stale = [];

  for (const f of fs.readdirSync(BRIEFS_DIR).filter((x) => x.endsWith(".json"))) {
    const p = path.join(BRIEFS_DIR, f);
    let rec;
    try { rec = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
    if (rec.patch === newPatch) continue; // already current

    const reasons = [];
    if (champSet.has(rec.you)) reasons.push(`${rec.you} changed`);
    if (champSet.has(rec.them)) reasons.push(`${rec.them} changed`);

    for (const item of itemsNamedIn(rec.brief)) {
      // loose match: Riot's display names and the brief's phrasing can differ slightly
      const hit = changed.items.find(
        (ci) => ci.toLowerCase() === item.toLowerCase()
             || item.toLowerCase().includes(ci.toLowerCase())
      );
      if (hit) { reasons.push(`build names ${hit}`); break; }
    }

    if (reasons.length) stale.push({ file: p, you: rec.you, them: rec.them, reasons });
  }
  return stale;
}

/* ------------------------------------------------------------------ */

export async function run({ apply = false, quiet = false } = {}) {
  const state = readState();
  const live = await currentPatch();

  if (!state.patch) {
    writeState(live);
    if (!quiet) console.log(`patch baseline recorded: ${live} (nothing to invalidate on a first run)`);
    return { live, stale: [], firstRun: true };
  }

  if (state.patch === live) {
    if (!quiet) console.log(`patch ${live} — unchanged, nothing to do`);
    return { live, stale: [], firstRun: false };
  }

  const changed = await changedSince(state.patch, live);
  const stale = findStale(changed, live);

  if (!quiet) {
    console.log(`patch ${state.patch} -> ${live}`);
    console.log(`  champions changed : ${changed.champions.length}  (${changed.champions.join(", ") || "none"})`);
    console.log(`  items changed     : ${changed.items.length}  (${changed.items.slice(0, 8).join(", ") || "none"})`);
    const inPool = changed.champions.filter((c) => (POOL.Top || []).includes(c));
    console.log(`  of those, in your Top pool: ${inPool.join(", ") || "none"}`);
    console.log(`  briefs affected   : ${stale.length}`);
  }

  if (apply) {
    for (const s of stale) fs.unlinkSync(s.file);
    writeState(live);
    log(`patch ${state.patch} -> ${live}: invalidated ${stale.length} brief(s); they requeue automatically`);
  } else if (stale.length && !quiet) {
    console.log(`\n(report only — run with --apply to requeue these)`);
  }

  return { live, previous: state.patch, changed, stale, firstRun: false };
}


/* True when this file was run directly. process.argv[1] is undefined when the
   module is imported programmatically (node -e, a test harness), and calling
   .replace on it there throws before anything else can run. */
function isMain(url) {
  const entry = process.argv[1];
  if (!entry) return false;
  return url === new URL("file://" + entry.replace(/\\/g, "/")).href
      || url.endsWith(entry.replace(/\\/g, "/"));
}

if (isMain(import.meta.url)) {
  run({ apply: process.argv.includes("--apply") }).catch((e) => {
    console.error(`patch check failed: ${e.message}`);
    process.exit(1);
  });
}
