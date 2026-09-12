import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BRIEFS_DIR = path.join(ROOT, "data", "briefs");
export const LOGS_DIR = path.join(ROOT, "logs");
export const DIST = path.join(ROOT, "dist", "lane-scout.html");
export const TEMPLATE = path.join(ROOT, "template", "app.html");
export const OFFLINE_JS = path.join(ROOT, "template", "offline.js");

export const CLAUDE_EXE = process.env.LANESCOUT_CLAUDE
  || "C:\\Users\\djnof\\.local\\bin\\claude.exe";

/* Where the shared file looks for fresher data. raw.githubusercontent serves
   Access-Control-Allow-Origin: *, so a file:// page can read it; the repo has
   to stay public for that to hold. */
export const REPO = "https://github.com/Jett44/Lane_Scout.git";
export const REMOTE_DATA = "https://raw.githubusercontent.com/Jett44/Lane_Scout/main/briefs.json";
export const DATA_JSON = path.join(ROOT, "briefs.json");

/* Champions that actually appear in the lane, ordered by how often you'll
   meet them. The batch job works down this order, so the matchups you're
   most likely to queue into get written first. */
export const POOL = {
  Top: [
    "Darius","Garen","Sett","Mordekaiser","Fiora","Aatrox","Camille","Jax",
    "K'Sante","Renekton","Irelia","Riven","Gwen","Illaoi","Malphite","Ornn",
    "Shen","Teemo","Yorick","Nasus","Volibear","Urgot","Gangplank","Jayce",
    "Gnar","Kled","Sion","Cho'Gath","Dr. Mundo","Tahm Kench","Maokai","Poppy",
    "Pantheon","Kennen","Rumble","Vladimir","Singed","Trundle","Olaf","Udyr",
    "Warwick","Wukong","Yasuo","Yone","Tryndamere","Kayle","Quinn","Vayne",
    "Zac","Galio","Ambessa","Heimerdinger","Akali","Sylas","Gragas","Rengar"
  ]
};

export const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";

export const keyFor = (you, them, lane) => `${slug(you)}__${slug(them)}__${slug(lane)}`;

/* Every ordered pair in the lane, most-likely-to-be-played first.
   Ordering rule: pairs are ranked by how far down the pool their FURTHEST
   champion sits, so the popular-vs-popular block is exhausted before the
   long tail is touched. */
export function targets(lane = "Top") {
  const pool = POOL[lane];
  if (!pool) throw new Error(`no champion pool defined for lane "${lane}"`);
  const out = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = 0; j < pool.length; j++) {
      if (i === j) continue;
      out.push({ you: pool[i], them: pool[j], lane, rank: Math.max(i, j) * 1000 + i });
    }
  }
  out.sort((a, b) => a.rank - b.rank);
  return out;
}

export const briefPath = (key) => path.join(BRIEFS_DIR, `${key}.json`);
export const haveBrief = (key) => fs.existsSync(briefPath(key));

export function pending(lane = "Top", limit = Infinity) {
  const out = [];
  for (const t of targets(lane)) {
    if (out.length >= limit) break;
    const key = keyFor(t.you, t.them, t.lane);
    if (!haveBrief(key)) out.push({ ...t, key });
  }
  return out;
}

export function stats(lane = "Top") {
  const all = targets(lane);
  let done = 0;
  for (const t of all) if (haveBrief(keyFor(t.you, t.them, t.lane))) done++;
  return { total: all.length, done, left: all.length - done };
}

export const SHAPE = {
  verdict: { difficulty: "string", line: "string" },
  thesis: "string",
  tell: {
    watch: "string",
    theirWindow: { when: "string", what: "string" },
    yourWindow: { when: "string", what: "string" }
  },
  powerCurve: [{ levels: "string", edge: "you | them | even", note: "string" }],
  build: {
    start: { item: "string", why: "string" },
    boots: { item: "string", why: "string" },
    core: [{ item: "string", why: "string" }],
    situational: [{ item: "string", when: "string" }]
  },
  runes: {
    keystone: "string", keystoneWhy: "string",
    primary: ["string"], secondary: ["string"], shards: ["string"]
  },
  summoners: { picks: ["string"], why: "string" },
  playing: [{ title: "string", detail: "string" }],
  patchCaveat: "string"
};

export function buildPrompt(you, them, lane) {
  return [
    "You are a high-elo League of Legends coach writing a champ-select scouting brief.",
    "",
    `MATCHUP: the player is ${you}. The enemy laner is ${them}. Lane: ${lane}.`,
    "",
    `Write the brief for the player PLAYING ${you} INTO ${them}. Never write it from the enemy's point of view.`,
    "",
    "Requirements:",
    "- Be mechanically precise. Name abilities by key and name, e.g. \"W (Path Maker)\". Reference the real tells: resource bars, charge counts, passive stacks, empowered autos, dash cooldowns.",
    "- Use concrete level ranges and timings. Never say only \"early game\" or \"late game\".",
    "- Every line must change what the player actually does. No filler, and nothing generic enough to fit a different matchup.",
    "- Item and rune names may have drifted since your training data. Give the standard build you know, and keep patchCaveat honest about that.",
    "- If the matchup is genuinely even or favoured for the player, say so. Do not manufacture difficulty.",
    "",
    "Return ONLY a JSON object — no prose, no code fence, no commentary before or after — in exactly this shape:",
    JSON.stringify(SHAPE, null, 1),
    "",
    "Field rules:",
    `- verdict.difficulty: 2-3 words from the ${you} player's side (e.g. "Hard early", "Skill matchup", "Favoured", "Free lane").`,
    "- verdict.line: one sentence naming when you lose and when you win.",
    "- thesis: 2-4 sentences giving the single structural fact that defines this matchup.",
    "- tell.watch: the ONE thing to track on screen all lane (a resource bar, a cooldown, a stack count, a wave state). Under 6 words.",
    "- tell.theirWindow and tell.yourWindow: \"when\" is a short condition under 8 words; \"what\" is one or two sentences of what to do about it.",
    "- powerCurve: 3 to 5 segments covering levels 1 through 18 in order with no gaps. \"levels\" formatted like \"3-5\". \"edge\" is exactly \"you\", \"them\" or \"even\". \"note\" is at most 8 words.",
    "- build.core: 3 to 4 items in build order. build.situational: 2 to 4 items, where \"when\" is the condition written as a lowercase clause that reads correctly after the word IF.",
    "- runes.primary: the 3 non-keystone runes of the primary tree. runes.secondary: exactly 2. runes.shards: exactly 3.",
    "- playing: 5 to 7 notes. \"title\" is an imperative under 6 words. \"detail\" is 1-2 sentences."
  ].join("\n");
}

/* Structural check only — we cannot verify that the advice is correct, but we
   can refuse to store something the renderer would show as a page of blanks. */
export function validate(b) {
  const bad = [];
  const need = (cond, msg) => { if (!cond) bad.push(msg); };
  need(b && typeof b === "object", "not an object");
  if (!b || typeof b !== "object") return bad;
  need(b.verdict && b.verdict.difficulty && b.verdict.line, "verdict incomplete");
  need(typeof b.thesis === "string" && b.thesis.length > 60, "thesis missing or too short");
  need(b.tell && b.tell.watch && b.tell.theirWindow?.what && b.tell.yourWindow?.what, "tell incomplete");
  need(Array.isArray(b.powerCurve) && b.powerCurve.length >= 3, "powerCurve needs 3+ segments");
  need(b.build?.start?.item && b.build?.boots?.item, "build start/boots missing");
  need(Array.isArray(b.build?.core) && b.build.core.length >= 3, "build.core needs 3+ items");
  need(b.runes?.keystone && Array.isArray(b.runes?.primary), "runes incomplete");
  need(Array.isArray(b.summoners?.picks) && b.summoners.picks.length >= 1, "summoners missing");
  need(Array.isArray(b.playing) && b.playing.length >= 5, "playing needs 5+ notes");
  return bad;
}

export function log(line) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const stamp = new Date().toISOString();
  const file = path.join(LOGS_DIR, `batch-${stamp.slice(0, 10)}.log`);
  fs.appendFileSync(file, `${stamp}  ${line}\n`);
  console.log(line);
}
