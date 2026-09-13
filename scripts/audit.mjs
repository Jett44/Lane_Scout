/*
 * Check the briefs against Riot's live data.
 *
 *   node scripts/audit.mjs
 *
 * The briefs are written by a language model from training data, not from any
 * statistical source. This cannot check whether the ADVICE is good — nothing
 * here can. What it can check is whether the things a brief names actually
 * exist in the current patch, which is where a model is most likely to be
 * confidently wrong.
 */
import fs from "node:fs";
import path from "node:path";
import { BRIEFS_DIR } from "./lib.mjs";
import { currentPatch } from "./patch.mjs";

const DD = "https://ddragon.leagueoflegends.com";
const getJson = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${r.status} for ${u}`);
  return r.json();
};

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/* "Doran's Shield + Health Potion" is two items in one field */
const splitItems = (s) => String(s).split(/\s*[+,]\s*/).map((x) => x.trim()).filter(Boolean);

const v = await currentPatch();
const base = `${DD}/cdn/${v}/data/en_US/`;
const [items, spells, runesRaw] = await Promise.all([
  getJson(base + "item.json"),
  getJson(base + "summoner.json"),
  getJson(base + "runesReforged.json")
]);

const realItems = new Set(Object.values(items.data).map((i) => norm(i.name)));
const realSpells = new Set(Object.values(spells.data).map((s) => norm(s.name)));
const realRunes = new Set();
for (const t of runesRaw) {
  realRunes.add(norm(t.name));
  for (const sl of t.slots) for (const r of sl.runes) realRunes.add(norm(r.name));
}

/* stat shards are rune-page choices, not perks — Data Dragon does not list them */
const SHARDS = new Set(["adaptiveforce", "attackspeed", "abilityhaste", "armor",
  "magicresist", "health", "healthscaling", "movespeed", "tenacity"]);

const files = fs.existsSync(BRIEFS_DIR)
  ? fs.readdirSync(BRIEFS_DIR).filter((f) => f.endsWith(".json")) : [];

let checked = 0;
const bad = { item: new Map(), rune: new Map(), spell: new Map() };
const note = (kind, name, where) => {
  if (!bad[kind].has(name)) bad[kind].set(name, []);
  bad[kind].get(name).push(where);
};

const malformed = [];

for (const f of files) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(path.join(BRIEFS_DIR, f), "utf8")); } catch { malformed.push(f); continue; }
  /* A record must be the wrapper, not a bare brief — anything else means
     something wrote this file that was not the generator. */
  if (!rec || !rec.you || !rec.them || !rec.brief) { malformed.push(f); continue; }
  const b = rec.brief, where = `${rec.you} into ${rec.them}`;
  const bd = b.build || {};

  const itemFields = []
    .concat(bd.start ? [bd.start.item] : [])
    .concat(bd.boots ? [bd.boots.item] : [])
    .concat((bd.core || []).map((x) => x.item))
    .concat((bd.situational || []).map((x) => x.item));

  for (const raw of itemFields) {
    for (const one of splitItems(raw)) {
      checked++;
      if (!realItems.has(norm(one))) note("item", one, where);
    }
  }

  const r = b.runes || {};
  for (const n of [r.keystone].concat(r.primary || [], r.secondary || [])) {
    if (!n) continue;
    checked++;
    if (!realRunes.has(norm(n))) note("rune", n, where);
  }
  for (const n of r.shards || []) {
    checked++;
    if (!realRunes.has(norm(n)) && !SHARDS.has(norm(n))) note("rune", n, where);
  }

  for (const n of (b.summoners && b.summoners.picks) || []) {
    checked++;
    if (!realSpells.has(norm(n))) note("spell", n, where);
  }
}

const totalBad = bad.item.size + bad.rune.size + bad.spell.size;
const badRefs = [...bad.item.values(), ...bad.rune.values(), ...bad.spell.values()]
  .reduce((a, v2) => a + v2.length, 0);

if (malformed.length) {
  console.log(`\n${malformed.length} file(s) are not valid brief records and were skipped:`);
  for (const f of malformed) console.log(`  ${f}`);
}

console.log(`\nAudited ${files.length - malformed.length} briefs against live patch ${v}`);
console.log(`${checked} named things checked — ${checked - badRefs} exist, ${badRefs} do not (${(100 * badRefs / Math.max(1, checked)).toFixed(1)}%)\n`);

for (const kind of ["item", "rune", "spell"]) {
  if (!bad[kind].size) continue;
  console.log(`${kind.toUpperCase()} — not in patch ${v}:`);
  for (const [name, wheres] of bad[kind]) {
    console.log(`  "${name}"  (${wheres.length}x: ${wheres.slice(0, 3).join("; ")}${wheres.length > 3 ? ", …" : ""})`);
  }
  console.log("");
}

if (!totalBad) console.log("Every item, rune and summoner spell named exists in the live patch.\n");

console.log("What this does NOT check: whether any of the advice is correct.");
console.log("Nothing here can. The briefs are model output, not measured data.\n");
