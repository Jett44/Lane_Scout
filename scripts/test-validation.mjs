/*
 * Cases the generator actually produced, and what should happen to each.
 *
 *   node scripts/test-validation.mjs
 *
 * Every case here is real output from a batch run. The rule being tested is
 * that a formatting difference gets repaired while wrong content gets
 * rejected — a rejection throws away ~6k tokens, so rejecting a correct brief
 * over punctuation is expensive, and accepting a dead rune is worse.
 */
import { normalizeBrief, validateNames } from "./assets.mjs";

const brief = (over = {}) => ({
  build: {
    start: { item: "Doran's Blade" },
    boots: { item: "Plated Steelcaps" },
    core: [], situational: []
  },
  runes: { keystone: "Conqueror", primary: [], secondary: [], shards: [] },
  summoners: { picks: ["Flash", "Ignite"] },
  ...over
});

const cases = [
  {
    name: "starting set written with pluses",
    expect: "accept",
    brief: brief({ build: { start: { item: "Doran's Ring + Health Potion + Health Potion" },
      boots: { item: "Sorcerer's Shoes" }, core: [], situational: [] } })
  },
  {
    name: "starting set written with commas",
    expect: "accept",
    brief: brief({ build: { start: { item: "Doran's Ring, Health Potion, Health Potion" },
      boots: { item: "Plated Steelcaps" }, core: [], situational: [] } })
  },
  {
    name: "both summoner spells in one entry",
    expect: "accept",
    brief: brief({ summoners: { picks: ["Flash + Ghost"] } })
  },
  {
    name: "quantity prefix on an item",
    expect: "accept",
    brief: brief({ build: { start: { item: "2x Health Potion" },
      boots: { item: "Plated Steelcaps" }, core: [], situational: [] } })
  },
  {
    name: "prose in the item slot",
    expect: "reject",
    brief: brief({ build: { start: { item: "she is snowballing and out-dueling you even with sustained damage" },
      boots: { item: "Plated Steelcaps" }, core: [], situational: [] } })
  },
  {
    name: "rune removed patches ago",
    expect: "reject",
    brief: brief({ runes: { keystone: "Conqueror", primary: ["Legend: Tenacity"], secondary: [], shards: [] } })
  },
  {
    name: "item that never existed",
    expect: "reject",
    brief: brief({ build: { start: { item: "Bloodthirster of Eternal Night" },
      boots: { item: "Plated Steelcaps" }, core: [], situational: [] } })
  }
];

let pass = 0, fail = 0;
for (const c of cases) {
  normalizeBrief(c.brief);
  const errs = validateNames(c.brief);
  const got = errs.length ? "reject" : "accept";
  const ok = got === c.expect;
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${c.name.padEnd(36)} expected ${c.expect}, got ${got}`);
  if (errs.length) console.log(`          ${errs.join("; ")}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
