/*
 * Real ability mechanics, from Community Dragon.
 *
 *   node scripts/abilities.mjs Renekton     print what the model will be given
 *   node scripts/abilities.mjs --refresh    rebuild the local cache
 *
 * Why this exists: the build numbers in a brief are measured, but the tactical
 * prose beside them was written from training data and nothing checked it. A
 * spot-check of one brief found two errors — an ability described as hitting
 * "in a cone" when it is a single-target attack modifier, and a cooldown given
 * as "9-14s early" when it is actually 16s at rank 1.
 *
 * Community Dragon publishes the live game files with descriptions already
 * resolved to plain prose (Data Dragon leaves {{ template }} holes), plus real
 * per-rank cooldowns. Free, no key, updated daily, every champion.
 *
 * Trimmed to roughly 1.2 KB per champion, so grounding both sides of a matchup
 * costs a few hundred tokens and removes the most common class of error.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib.mjs";

const CD = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1";
export const ABILITIES_JSON = path.join(ROOT, "data", "abilities.json");

const getJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json();
};

const clean = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/* Cooldowns come as a six-slot array; ranks beyond maxLevel are padding. */
const ranks = (arr, max) => {
  if (!Array.isArray(arr)) return null;
  const out = arr.slice(0, max || 5).filter((n) => typeof n === "number");
  return out.length ? [...new Set(out)].length === 1 ? [out[0]] : out : null;
};

function trim(c) {
  return {
    name: c.name,
    title: c.title,
    attackType: c.tacticalInfo?.attackType ?? null,
    damageType: (c.tacticalInfo?.damageType || "").replace(/^k/, "").toLowerCase() || null,
    passive: { name: c.passive?.name, description: clean(c.passive?.description) },
    spells: (c.spells || []).map((s) => ({
      key: String(s.spellKey || "").toUpperCase(),
      name: s.name,
      cooldown: ranks(s.cooldownCoefficients, s.maxLevel),
      range: Array.isArray(s.range) ? s.range[0] : null,
      description: clean(s.description)
    }))
  };
}

export async function refreshAbilities() {
  const summary = await getJson(`${CD}/champion-summary.json`);
  const list = summary.filter((c) => c.id > 0);

  const out = { fetchedAt: Date.now(), champions: {} };
  let done = 0;

  /* a few at a time — this is a free community CDN, don't hammer it */
  for (let i = 0; i < list.length; i += 6) {
    const chunk = list.slice(i, i + 6);
    const got = await Promise.all(chunk.map(async (c) => {
      try { return trim(await getJson(`${CD}/champions/${c.id}.json`)); }
      catch { return null; }
    }));
    for (const g of got) if (g && g.name) out.champions[g.name.toLowerCase()] = g;
    done += chunk.length;
    if (done % 60 === 0) process.stdout.write(`  ${done}/${list.length}\r`);
  }

  fs.mkdirSync(path.dirname(ABILITIES_JSON), { recursive: true });
  fs.writeFileSync(ABILITIES_JSON, JSON.stringify(out));
  const kb = (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0);
  console.log(`abilities cached: ${Object.keys(out.champions).length} champions (${kb} KB)`);
  return out;
}

export function readAbilities() {
  try { return JSON.parse(fs.readFileSync(ABILITIES_JSON, "utf8")); }
  catch { return null; }
}

export function abilitiesOf(name) {
  const a = readAbilities();
  if (!a) return null;
  return a.champions[String(name).toLowerCase()] || null;
}

const fmt = (c, who) => {
  if (!c) return "";
  const L = [`${who} — ${c.name}${c.title ? `, ${c.title}` : ""} (${c.attackType || "?"}, ${c.damageType || "?"} damage)`];
  L.push(`  Passive — ${c.passive.name}: ${c.passive.description}`);
  for (const s of c.spells) {
    const cd = s.cooldown ? ` [cooldown ${s.cooldown.join("/")}s${s.range ? `, range ${s.range}` : ""}]` : "";
    L.push(`  ${s.key} — ${s.name}${cd}: ${s.description}`);
  }
  return L.join("\n");
};

/* The block that goes into the prompt. */
export function abilitiesForPrompt(you, them) {
  const a = abilitiesOf(you), b = abilitiesOf(them);
  if (!a && !b) return "";
  return [
    "ABILITY MECHANICS — from the live game files. These descriptions and cooldowns are fact.",
    fmt(a, "YOU"),
    fmt(b, "THEM"),
    "",
    "RULES: every claim you make about what an ability does — what it hits, whether it stuns or slows, how it is targeted, how long it is on cooldown — must match the text above. Do not describe an ability as hitting a cone, an area, or multiple targets unless the description says so. Quote real cooldown numbers rather than estimating ranges."
  ].filter(Boolean).join("\n");
}

function isMain(url) {
  const entry = process.argv[1];
  if (!entry) return false;
  return url === new URL("file://" + entry.replace(/\\/g, "/")).href
      || url.endsWith(entry.replace(/\\/g, "/"));
}

if (isMain(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg || arg === "--refresh") {
    await refreshAbilities();
  } else {
    if (!readAbilities()) await refreshAbilities();
    console.log(abilitiesForPrompt(arg, process.argv[3] || arg));
  }
}
