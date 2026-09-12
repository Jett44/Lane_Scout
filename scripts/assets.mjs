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

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  refreshAssets().catch((e) => {
    console.error(`asset refresh failed: ${e.message}`);
    process.exitCode = 1;
  });
}
