/*
 * Which lanes have real match data for a pairing?
 *
 *   node scripts/check-lanes.mjs Mel "Miss Fortune"
 *
 * Free — only OP.GG calls, no Claude tokens.
 */
import { matchupStats, isHollow } from "./stats.mjs";

const [you, them] = process.argv.slice(2);
if (!you || !them) { console.error('usage: node scripts/check-lanes.mjs <you> "<them>"'); process.exit(1); }

for (const lane of ["Top", "Jungle", "Mid", "Bot", "Support"]) {
  const s = await matchupStats(you, them, lane, { skipHighElo: true });
  if (isHollow(s)) { console.log(`${lane.padEnd(8)} no data`); continue; }
  const h = s.headToHead ? `${s.headToHead.winRate}% over ${s.headToHead.play} games` : "no head-to-head";
  console.log(`${lane.padEnd(8)} ${String(s.overall.play ?? "?").padStart(7)} games of ${you} here | vs ${them}: ${h} | core: ${(s.core[0]?.items || []).join(" > ")}`);
}
