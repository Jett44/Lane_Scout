/*
 * Write a single matchup from the command line, the same way the app's
 * "Write this matchup" button does.
 *
 *   node scripts/write-one.mjs Mel "Miss Fortune" Bot
 */
import { generateOne } from "./generate.mjs";
import { readState } from "./patch.mjs";

const [you, them, lane = "Top"] = process.argv.slice(2);
if (!you || !them) { console.error('usage: node scripts/write-one.mjs <you> "<them>" [lane]'); process.exit(1); }

const r = await generateOne(you, them, lane, readState().patch);
if (!r.ok) { console.error(`not written: ${r.error}`); process.exitCode = 1; }
else {
  const b = r.record.brief, s = r.record.stats;
  console.log(`${you} into ${them} (${lane}) — ${r.cached ? "already written" : r.tokens + " tokens"}`);
  if (s?.headToHead) console.log(`measured: ${s.headToHead.winRate}% over ${s.headToHead.play} games | lane advantage: ${s.laneAdvantage}`);
  console.log(`\n${b.verdict.difficulty}. ${b.verdict.line}`);
  console.log(`\nSTART  ${b.build.start.item}`);
  console.log(`BOOTS  ${b.build.boots.item}`);
  b.build.core.forEach((x, i) => console.log(`0${i + 1}     ${x.item} — ${x.why}`));
  (b.build.situational || []).forEach((x) => console.log(`IF     ${x.item} — ${x.when}`));
  console.log(`\nRUNES  ${b.runes.keystone} | ${b.runes.primary.join(", ")} | ${b.runes.secondary.join(", ")}`);
  console.log(`SPELLS ${b.summoners.picks.join(" + ")}`);
  console.log(`\nWATCH  ${b.tell.watch}`);
  b.playing.forEach((n, i) => console.log(`${i + 1}. ${n.title} — ${n.detail}`));
}
