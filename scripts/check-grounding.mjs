/*
 * Regenerate one matchup and check the prose against the live ability text.
 *
 *   node scripts/check-grounding.mjs Sett Renekton
 *
 * The point is narrow: does the brief still invent mechanics? A brief may not
 * describe a single-target ability as hitting an area, and a cooldown it
 * quotes has to be one the game actually uses.
 */
import fs from "node:fs";
import { briefPath, keyFor } from "./lib.mjs";
import { generateOne } from "./generate.mjs";
import { abilitiesOf } from "./abilities.mjs";

const [you, them, lane = "Top"] = process.argv.slice(2);
if (!you || !them) {
  console.error("usage: node scripts/check-grounding.mjs <you> <them> [lane]");
  process.exit(1);
}

const key = keyFor(you, them, lane);
if (fs.existsSync(briefPath(key))) fs.unlinkSync(briefPath(key));

const r = await generateOne(you, them, lane, "16.18.1");
if (!r.ok) {
  console.error(`generation failed: ${r.error}`);
  process.exit(1);
}

const b = r.record.brief;
const prose = [b.thesis, b.verdict.line, b.tell.theirWindow.what, b.tell.yourWindow.what]
  .concat(b.playing.map((p) => p.detail))
  .join(" ");

console.log(`\n${you} into ${them} — ${r.tokens} tokens\n`);

/* 1. area-of-effect claims about single-target abilities */
const AOE = /\b(cone|in an arc|area of effect|aoe|all enemies|multiple targets|everyone around)\b/i;
const areaWords = prose.match(AOE) || [];
const theirKit = abilitiesOf(them);
const trulyAoe = (theirKit?.spells || [])
  .filter((s) => /around him|all targets|area|nearby|enemies in/i.test(s.description))
  .map((s) => s.key + " (" + s.name + ")");

console.log(`area-language used in prose : ${areaWords.length ? areaWords.join(", ") : "none"}`);
console.log(`abilities that really are AoE: ${trulyAoe.join(", ") || "none"}`);

/* 2. cooldown numbers quoted must exist in the real per-rank arrays */
const real = new Set();
for (const side of [abilitiesOf(you), theirKit]) {
  for (const s of side?.spells || []) for (const n of s.cooldown || []) real.add(String(n));
}
/* Only figures actually presented as cooldowns. Stun and shield durations are
   also written in seconds and come from the same grounded text — counting
   those made this report cry wolf on numbers that were correct. */
const quoted = [...prose.matchAll(
  /(?:cooldown|on cd|comes back up|back up in|off cooldown)[^.]{0,40}?(\d+(?:\.\d+)?)(?:\s*(?:-|to|–)\s*(\d+(?:\.\d+)?))?\s*s\b|(\d+(?:\.\d+)?)(?:\s*(?:-|to|–)\s*(\d+(?:\.\d+)?))?\s*s(?:ec(?:ond)?s?)?\s+cooldown/gi
)].flatMap((m) => [m[1], m[2], m[3], m[4]].filter(Boolean));
const unmatched = [...new Set(quoted)].filter((n) => !real.has(n));

console.log(`cooldown figures quoted     : ${[...new Set(quoted)].join(", ") || "none"}`);
console.log(`not a real cooldown value   : ${unmatched.join(", ") || "none"}`);
console.log(`  (real values: ${[...real].sort((a, c) => a - c).join(", ")})`);

console.log(`\nTHESIS\n${b.thesis}`);
console.log(`\nTHEIR WINDOW [${b.tell.theirWindow.when}]\n${b.tell.theirWindow.what}`);
console.log("");
