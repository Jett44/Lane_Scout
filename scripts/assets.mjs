/*
 * Build the name -> icon lookup that lets the app show Riot's own art for
 * items, runes, summoner spells and champions.
 *
 *   node scripts/assets.mjs           refresh from Data Dragon
 *
 * Runs at build time, not in the browser: the page ships a compact map and
 * loads only the images it actually needs. Costs no Claude tokens.
 *
 * Icons are served from Riot's CDN, so they need a connection. Everything
 * degrades to text when offline or when a name has no match — the icon is
 * never the only thing carrying meaning.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib.mjs";
import { currentPatch } from "./patch.mjs";

export const ASSETS_JSON = path.join(ROOT, "data", "assets.json");
const DD = "https://ddragon.leagueoflegends.com";

const getJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json();
};

export async function refreshAssets() {
  const v = await currentPatch();
  const base = `${DD}/cdn/${v}/data/en_US/`;

  const [items, spells, runes, champs] = await Promise.all([
    getJson(base + "item.json"),
    getJson(base + "summoner.json"),
    getJson(base + "runesReforged.json"),
    getJson(base + "champion.json")
  ]);

  const item = {};
  for (const it of Object.values(items.data)) {
    // several ids share a display name (upgrades, ornn variants) — first wins
    const k = it.name.toLowerCase();
    if (!item[k]) item[k] = it.image.full;
  }

  const spell = {};
  for (const s of Object.values(spells.data)) spell[s.name.toLowerCase()] = s.image.full;

  const rune = {};
  for (const tree of runes) {
    rune[tree.name.toLowerCase()] = tree.icon;
    for (const slot of tree.slots) {
      for (const r of slot.runes) rune[r.name.toLowerCase()] = r.icon;
    }
  }

  const champ = {};
  for (const c of Object.values(champs.data)) champ[c.name.toLowerCase()] = c.image.full;

  const out = { version: v, fetchedAt: Date.now(), item, spell, rune, champ };
  fs.mkdirSync(path.dirname(ASSETS_JSON), { recursive: true });
  fs.writeFileSync(ASSETS_JSON, JSON.stringify(out));

  const kb = (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0);
  console.log(`assets refreshed for patch ${v} — ${Object.keys(item).length} items, ${Object.keys(rune).length} runes, ${Object.keys(spell).length} spells, ${Object.keys(champ).length} champions (${kb} KB)`);
  return out;
}

export function readAssets() {
  try { return JSON.parse(fs.readFileSync(ASSETS_JSON, "utf8")); }
  catch { return null; }
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
/* A start field legitimately holds more than one item, and the model writes
   that either way: "Doran's Blade + Health Potion" or
   "Doran's Ring, Health Potion, Health Potion". Both are correct answers, so
   split on both rather than rejecting the comma form. */
const splitItems = (s) => String(s).split(/\s*[+,]\s*/).map((x) => x.trim()).filter(Boolean);

/* Stat shards are rune-page choices, not perks — Data Dragon does not list them. */
const SHARDS = new Set(["adaptiveforce", "attackspeed", "abilityhaste", "armor",
  "magicresist", "health", "healthscaling", "movespeed", "tenacity", "slowresist"]);

/* Quantities turn up on either side: "2x Health Potion" and "Health Potion x2". */
const stripQty = (s) => String(s)
  .replace(/^\s*\d+\s*[x×]?\s+/i, "")
  .replace(/\s*[x×]\s*\d+\s*$/i, "")
  .trim();

/*
 * Repair the harmless formatting differences before judging the content.
 *
 * The model is answering correctly but writing it differently from the schema:
 * both summoner spells in one string, "2x Health Potion", a starting set
 * written with pluses. Rejecting those wastes a whole generation — roughly six
 * thousand tokens — over punctuation. Fix what is unambiguous, then validate
 * what is left.
 */
export function normalizeBrief(brief) {
  if (!brief || typeof brief !== "object") return brief;

  const s = brief.summoners;
  if (s && Array.isArray(s.picks)) {
    s.picks = s.picks
      .flatMap((p) => String(p).split(/\s*[+/&]\s*|\s+and\s+/i))
      .map((p) => p.trim())
      .filter(Boolean);
  }

  const b = brief.build;
  if (b) {
    const fix = (slot) => { if (slot && slot.item) slot.item = stripQty(slot.item); };
    fix(b.start); fix(b.boots);
    for (const x of b.core || []) fix(x);
    for (const x of b.situational || []) fix(x);
  }

  return brief;
}

/*
 * Does this brief name anything that does not exist on the live patch?
 *
 * This is the backstop behind grounding the prompt in real data: the prompt
 * tells the model to use only what it was given, and this refuses to save it
 * if it wandered off anyway. It also catches a field holding prose instead of
 * an item, which the structural check cannot see.
 */
export function validateNames(brief) {
  const a = readAssets();
  if (!a) return [];              // no map to check against; don't block on it
  const bad = [];

  const items = new Set(Object.keys(a.item).map(norm));
  const runes = new Set(Object.keys(a.rune).map(norm));
  const spells = new Set(Object.keys(a.spell).map(norm));

  const b = brief.build || {};
  const itemFields = []
    .concat(b.start ? [b.start.item] : [])
    .concat(b.boots ? [b.boots.item] : [])
    .concat((b.core || []).map((x) => x.item))
    .concat((b.situational || []).map((x) => x.item));

  for (const raw of itemFields) {
    if (!raw) continue;
    /* Judge each named item, not the length of the whole field — a legitimate
       starting set like "Doran's Ring + Health Potion + Health Potion" is long
       but every part of it is real. Prose is a part that is both unrecognised
       and sentence-shaped. */
    for (const one of splitItems(raw).map(stripQty)) {
      if (items.has(norm(one))) continue;
      if (one.split(/\s+/).length > 4) bad.push(`item field is prose: "${one.slice(0, 50)}…"`);
      else bad.push(`no such item: "${one}"`);
    }
  }

  const r = brief.runes || {};
  for (const n of [r.keystone].concat(r.primary || [], r.secondary || [])) {
    if (n && !runes.has(norm(n))) bad.push(`no such rune: "${n}"`);
  }
  for (const n of r.shards || []) {
    if (n && !runes.has(norm(n)) && !SHARDS.has(norm(n))) bad.push(`no such shard: "${n}"`);
  }

  for (const n of (brief.summoners && brief.summoners.picks) || []) {
    if (n && !spells.has(norm(n))) bad.push(`no such summoner spell: "${n}"`);
  }

  return bad;
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
  refreshAssets().catch((e) => {
    console.error(`asset refresh failed: ${e.message}`);
    process.exitCode = 1;
  });
}
