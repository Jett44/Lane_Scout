/*
 * Real match data, from OP.GG's MCP server.
 *
 *   node scripts/stats.mjs Sett Renekton top
 *
 * This is the difference between a brief that sounds right and one that is
 * backed by games actually played. Everything here is measured: win rates,
 * pick rates, sample sizes, the builds and runes people are really running on
 * the live patch.
 *
 * Endpoint is public and needs no key. It can be down or rate-limited, so
 * every caller must handle null — a brief without stats is still worth having,
 * it just carries less authority.
 */
const ENDPOINT = "https://mcp-api.op.gg/mcp";
const TIMEOUT_MS = 25000;

/* OP.GG wants UPPER_SNAKE_CASE with single underscores. Replacing each
   punctuation character individually gives "Dr. Mundo" -> DR__MUNDO, which
   returns nothing at all — so runs of non-alphanumerics collapse to one, and
   any leading or trailing underscore is trimmed. Affects Dr. Mundo and
   Nunu & Willump, which is ~220 matchups silently losing their stats. */
const upper = (s) =>
  String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

async function rpc(method, params) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      signal: ctl.signal
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const text = await r.text();
    // the server may answer as JSON or as a single SSE frame
    const m = text.match(/data:\s*(\{[\s\S]*?)\n\n/);
    return JSON.parse(m ? m[1] : text);
  } finally {
    clearTimeout(t);
  }
}

const pct = (x) => (typeof x === "number" ? Math.round(x * 1000) / 10 : null);

/* Stat shards come back as perk ids and are not in Data Dragon's rune tree,
   so they have to be named here. */
const SHARD_NAMES = {
  5001: "Health Scaling", 5002: "Armor", 5003: "Magic Resist",
  5005: "Attack Speed", 5007: "Ability Haste", 5008: "Adaptive Force",
  5010: "Move Speed", 5011: "Health", 5013: "Slow Resist"
};
const shardName = (v) => SHARD_NAMES[v] || SHARD_NAMES[Number(v)] || String(v);

/* Keep only what a brief can actually use, and keep it small — this goes into
   a prompt, so every field costs tokens. */
function compact(d, them) {
  if (!d) return null;

  const pos = d.summary?.positions?.[0];
  const stats = pos?.stats || d.summary?.average_stats || {};

  const build = (rows, n) => (rows || []).slice(0, n).map((r) => ({
    items: r.ids_names,
    winRate: pct(r.win / r.play),
    play: r.play,
    pickRate: pct(r.pick_rate)
  }));

  const head = (d.counters || []).find(
    (c) => String(c.champion_name).toLowerCase() === String(them).toLowerCase()
  );

  return {
    source: "op.gg",
    fetchedAt: Date.now(),
    overall: { winRate: pct(stats.win_rate), play: stats.play, tier: stats.tier_data?.tier ?? null },
    headToHead: head
      ? { play: head.play, wins: head.win, winRate: pct(head.win / head.play) }
      : null,
    laneAdvantage: d.lane_advantage_champion ?? null,
    soloKillAdvantage: d.lane_solo_kill_advantage_champion ?? null,
    playStyle: d.recommended_play_style ?? null,
    opponentTip: d.opponent_champion_tip ?? null,
    spells: (d.summoner_spells || []).slice(0, 3).map((s) => ({
      names: s.ids_names, winRate: pct(s.win / s.play), play: s.play, pickRate: pct(s.pick_rate)
    })),
    runes: (d.runes || []).slice(0, 2).map((r) => ({
      primaryTree: r.primary_page_name,
      primary: r.primary_rune_names,
      secondaryTree: r.secondary_page_name,
      secondary: r.secondary_rune_names,
      shards: (r.stat_mod_names || r.stat_mod_ids || []).map(shardName),
      winRate: pct(r.win / r.play), play: r.play, pickRate: pct(r.pick_rate)
    })),
    starter: build(d.starter_items, 2),
    boots: build(d.boots, 2),
    core: build(d.core_items, 3),
    lateOptions: build(d.last_items, 6),
    skillOrder: (d.skills || []).slice(0, 1).map((s) => ({
      order: s.order, winRate: pct(s.win / s.play), play: s.play
    }))
  };
}

/*
 * What master-tier players do differently.
 *
 * Tested across Sett, Darius, Fiora and Jax: core item builds are identical at
 * every rank, and challenger samples are 36-172 games — too thin to mean
 * anything. Master is the lowest tier with a usable sample (3-10k games), and
 * occasionally it genuinely disagrees: Darius at master runs Stormraider's
 * Surge where the all-tier aggregate runs Conqueror.
 *
 * So this captures only the keystone, only at master, and the caller only uses
 * it when it differs from the aggregate. No signal, no tokens spent.
 */
export async function highEloKeystone(champ, lane = "Top") {
  try {
    const res = await rpc("tools/call", {
      name: "lol_get_champion_analysis",
      arguments: {
        champion: upper(champ), position: String(lane).toLowerCase(),
        game_mode: "ranked", tier: "master"
      }
    });
    const repr = res?.result?.content?.map((c) => c.text).join("\n") || "";
    // this tool answers with a class-repr rather than JSON
    const m = repr.match(/Runes\(\d+,\d+,"([^"]+)",\[[\d,\s]*\],\[([^\]]*)\]/);
    const sample = repr.match(new RegExp(`Position\\("${String(lane).toUpperCase()}",Stats\\((\\d+)`));
    if (!m) return null;
    const names = m[2].split(",").map((s) => s.replace(/^"|"$/g, "").trim());
    return { keystone: names[0] || null, tree: m[1], play: sample ? +sample[1] : null };
  } catch { return null; }
}

export async function matchupStats(you, them, lane = "Top") {
  try {
    const res = await rpc("tools/call", {
      name: "lol_get_lane_matchup_guide",
      arguments: {
        my_champion: upper(you),
        opponent_champion: upper(them),
        position: String(lane).toLowerCase()
      }
    });
    const txt = res?.result?.content?.map((c) => c.text).join("\n");
    if (!txt) return null;
    let parsed;
    try { parsed = JSON.parse(txt); } catch { return null; }
    const out = compact(parsed.data, them);

    /* Attach the master-tier keystone only when it differs from what the
       aggregate already recommends — otherwise it is noise in the prompt. */
    if (out) {
      const he = await highEloKeystone(you, lane);
      const aggregate = out.runes?.[0]?.primary?.[0] || null;
      if (he && he.keystone && aggregate && he.keystone !== aggregate) out.highElo = he;
    }
    return out;
  } catch {
    return null; // never let a stats outage block generation
  }
}

/* Render the stats as the factual block a brief must be written from. */
export function statsForPrompt(s, you, them) {
  if (!s) return "";
  const L = [];
  L.push("LIVE MATCH DATA — measured on the current patch, from OP.GG. Treat every number here as fact and build the brief around it.");
  if (s.overall.winRate != null) L.push(`- ${you} in this lane overall: ${s.overall.winRate}% win rate across ${s.overall.play?.toLocaleString()} games.`);
  if (s.headToHead) L.push(`- ${you} vs ${them} head to head: ${s.headToHead.winRate}% win rate over ${s.headToHead.play} games.`);
  if (s.laneAdvantage) L.push(`- Lane advantage: ${s.laneAdvantage}. Solo-kill advantage: ${s.soloKillAdvantage}. Overall shape: ${s.playStyle}.`);
  if (s.opponentTip) L.push(`- OP.GG's own tip for this matchup: "${s.opponentTip}"`);

  const fmt = (rows) => rows.map((r) => `${r.items.join(" > ")} (${r.winRate}% over ${r.play} games, ${r.pickRate}% pick)`).join(" | ");
  if (s.spells.length) L.push(`- Summoner spells actually run: ${s.spells.map((x) => `${x.names.join("+")} (${x.winRate}%, ${x.pickRate}% pick)`).join(" | ")}`);
  if (s.starter.length) L.push(`- Starting items: ${fmt(s.starter)}`);
  if (s.boots.length) L.push(`- Boots: ${fmt(s.boots)}`);
  if (s.core.length) L.push(`- Core build paths: ${fmt(s.core)}`);
  if (s.lateOptions.length) L.push(`- Common later items: ${s.lateOptions.map((r) => r.items.join("")).join(", ")}`);
  if (s.runes.length) {
    for (const r of s.runes) {
      L.push(`- Rune page (${r.winRate}%, ${r.pickRate}% pick): ${r.primaryTree} — ${r.primary.join(", ")}; ${r.secondaryTree} — ${r.secondary.join(", ")}; shards — ${(r.shards || []).join(", ")}`);
    }
  }
  if (s.skillOrder.length) L.push(`- Skill order: ${s.skillOrder[0].order?.join("")} (${s.skillOrder[0].winRate}%)`);

  /* Only present when master players genuinely disagree with the aggregate. */
  if (s.highElo && s.highElo.keystone) {
    L.push(`- High-elo divergence: master-tier ${you} players run ${s.highElo.keystone} (${s.highElo.tree}) rather than the keystone above, across ${s.highElo.play?.toLocaleString()} games. Mention this as an alternative and say briefly who it suits.`);
  }

  L.push("");
  L.push("RULES FOR USING THIS DATA:");
  L.push("- The build, boots, starting items, runes and summoner spells in your brief MUST come from the lists above. Do not substitute items or runes you remember from elsewhere; if it is not listed above, it does not exist on this patch.");
  L.push("- Quote the real numbers in your prose where they matter (win rate, sample size, pick rate).");
  L.push("- If the data says the opponent has lane advantage, do not claim the player is favoured. Match the verdict to the measured win rate.");
  L.push("- Your own contribution is the WHY: the mechanics, the timings, the trade patterns that explain these numbers. That part is your judgement and should be precise.");
  return L.join("\n");
}

function isMain(url) {
  const entry = process.argv[1];
  if (!entry) return false;
  return url === new URL("file://" + entry.replace(/\\/g, "/")).href
      || url.endsWith(entry.replace(/\\/g, "/"));
}

if (isMain(import.meta.url)) {
  const [you, them, lane] = process.argv.slice(2);
  if (!you || !them) {
    console.error("usage: node scripts/stats.mjs <you> <them> [lane]");
    process.exit(1);
  }
  const s = await matchupStats(you, them, lane || "Top");
  if (!s) { console.error("no stats returned"); process.exit(1); }
  console.log(statsForPrompt(s, you, them));
}
