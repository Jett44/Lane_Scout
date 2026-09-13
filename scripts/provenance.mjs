/*
 * Where does each part of a brief actually come from?
 *
 *   node scripts/provenance.mjs sett__renekton__top
 *
 * Two very different things sit side by side in one page, and the layout does
 * nothing to distinguish them: numbers measured from real games, and tactical
 * reasoning written by a language model with no source at all. This prints the
 * split so it is not a matter of trust.
 */
import fs from "node:fs";
import path from "node:path";
import { BRIEFS_DIR } from "./lib.mjs";

const key = process.argv[2] || "sett__renekton__top";
const file = path.join(BRIEFS_DIR, `${key}.json`);
if (!fs.existsSync(file)) {
  console.error(`no such brief: ${key}`);
  process.exit(1);
}

const rec = JSON.parse(fs.readFileSync(file, "utf8"));
const b = rec.brief;
const s = rec.stats;

const line = (w) => "-".repeat(w);

console.log(`\n${rec.you} into ${rec.them} (${rec.lane})`);
console.log(line(64));

console.log(`\nMEASURED — from OP.GG, real games on patch ${rec.patch}`);
console.log(line(64));
if (s) {
  console.log(`  head-to-head win rate   ${s.headToHead ? s.headToHead.winRate + "% over " + s.headToHead.play + " games" : "n/a"}`);
  console.log(`  lane advantage          ${s.laneAdvantage ?? "n/a"}`);
  console.log(`  solo-kill advantage     ${s.soloKillAdvantage ?? "n/a"}`);
  console.log(`  starting items          ${(s.starter[0]?.items || []).join(" + ")}  (${s.starter[0]?.winRate}%)`);
  console.log(`  boots                   ${(s.boots[0]?.items || []).join("")}  (${s.boots[0]?.winRate}%)`);
  console.log(`  core build              ${(s.core[0]?.items || []).join(" > ")}  (${s.core[0]?.winRate}%)`);
  console.log(`  runes                   ${(s.runes[0]?.primary || []).join(", ")}  (${s.runes[0]?.winRate}%)`);
  console.log(`  summoner spells         ${(s.spells[0]?.names || []).join(" + ")}  (${s.spells[0]?.winRate}%)`);
  console.log(`  skill order             ${(s.skillOrder[0]?.order || []).join("")}  (${s.skillOrder[0]?.winRate}%)`);
  console.log(`  OP.GG's own tip         "${(s.opponentTip || "").slice(0, 90)}"`);
} else {
  console.log("  (none — this brief was written without live data)");
}

console.log(`\nMODEL-WRITTEN — no source, generated from training data`);
console.log(line(64));
console.log(`  verdict.line            "${b.verdict.line.slice(0, 88)}…"`);
console.log(`  thesis                  ${b.thesis.split(/\s+/).length} words of tactical reasoning`);
console.log(`  tell.watch              "${b.tell.watch}"`);
console.log(`  tell.theirWindow.what   ${b.tell.theirWindow.what.split(/\s+/).length} words`);
console.log(`  tell.yourWindow.what    ${b.tell.yourWindow.what.split(/\s+/).length} words`);
console.log(`  powerCurve              ${b.powerCurve.length} segments, each an unverified claim`);
console.log(`  every item's "why"      ${[b.build.start, b.build.boots, ...(b.build.core||[])].length} justifications`);
console.log(`  playing notes           ${b.playing.length} notes, ${b.playing.reduce((a, n) => a + n.detail.split(/\s+/).length, 0)} words`);

const words = (x) => String(x || "").split(/\s+/).length;
const modelWords = words(b.thesis) + words(b.verdict.line)
  + words(b.tell.theirWindow.what) + words(b.tell.yourWindow.what)
  + b.playing.reduce((a, n) => a + words(n.title) + words(n.detail), 0)
  + [b.build.start, b.build.boots, ...(b.build.core || []), ...(b.build.situational || [])]
      .reduce((a, x) => a + words(x.why || x.when), 0);

console.log(`\n${line(64)}`);
console.log(`Roughly ${modelWords} words of prose in this brief have no source.`);
console.log(`The numbers beside them are measured. The layout does not say which is which.`);

/* Mechanical claims are the sharp edge: they read as fact and nothing checks
   them. Surface the sentences that assert how an ability behaves. */
const mech = [];
const check = (t) => {
  for (const sent of String(t).split(/(?<=[.!?])\s+/)) {
    if (/\b(passive|ability|cooldown|stun|slow|shield|heal|dash|scales?|resets?|cleanses?|immune)\b/i.test(sent)) mech.push(sent.trim());
  }
};
check(b.thesis); check(b.tell.theirWindow.what); check(b.tell.yourWindow.what);
for (const n of b.playing) check(n.detail);

console.log(`\nMECHANICAL CLAIMS — asserted as fact, verified by nothing:`);
console.log(line(64));
for (const m of mech.slice(0, 6)) console.log(`  • ${m.slice(0, 110)}`);
if (mech.length > 6) console.log(`  … and ${mech.length - 6} more`);
console.log("");
