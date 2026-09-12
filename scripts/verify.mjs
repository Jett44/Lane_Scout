/*
 * Sanity-check the built file before you send it to anyone.
 *
 *   node scripts/verify.mjs
 *
 * Catches the things that would make the shareable file silently useless:
 * a broken splice, unparseable baked data, or a leftover call into the
 * claude.ai runtime that only exists inside an Artifact.
 */
import fs from "node:fs";
import { DIST } from "./lib.mjs";

const fail = [];
const ok = [];
const check = (cond, good, bad) => (cond ? ok : fail).push(cond ? good : bad);

if (!fs.existsSync(DIST)) {
  console.error(`no build at ${DIST} — run: node scripts/build.mjs`);
  process.exit(1);
}
const html = fs.readFileSync(DIST, "utf8");

const open = (html.match(/<script>/g) || []).length;
const close = (html.match(/<\/script>/g) || []).length;
check(open === close && open === 1, `script tags balanced (${open})`, `script tags unbalanced: ${open} open / ${close} close`);

check(/<title>/.test(html), "has a <title>", "missing <title>");
check(html.includes("function render("), "renderer present", "renderer missing — template splice cut too early");
check(html.includes("function scout()"), "offline scout present", "offline scout missing — offline.js was not appended");

const live = (html.match(/claude\.use\(/g) || []).length;
check(live === 0, "no live-capability calls", `${live} claude.use() call(s) left — these do nothing outside an Artifact`);

const m = html.match(/var BRIEFS = (\{[\s\S]*?\});\n/);
check(!!m, "BRIEFS block found", "BRIEFS block not found");

let count = 0;
if (m) {
  try {
    const data = JSON.parse(m[1].replace(/<\\\//g, "</"));
    count = Object.keys(data).length;
    check(count > 0, `${count} matchups baked in`, "BRIEFS is empty");

    let broken = 0;
    for (const k of Object.keys(data)) {
      const r = data[k];
      if (!r.you || !r.them || !r.brief?.thesis || !Array.isArray(r.brief?.playing)) broken++;
    }
    check(broken === 0, "every baked brief is well-formed", `${broken} baked brief(s) are malformed`);
  } catch (e) {
    fail.push(`BRIEFS does not parse as JSON: ${e.message}`);
  }
}

const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(0);
check(Buffer.byteLength(html, "utf8") < 20 * 1048576, `file size ${kb} KB`, `file is ${kb} KB — too large to share comfortably`);

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of fail) console.log(`  FAIL  ${line}`);

if (fail.length) {
  console.log(`\n${fail.length} problem(s). Do not share this build.`);
  process.exit(1);
}
console.log(`\nBuild is good — ${count} matchups, ${kb} KB. Safe to send.`);
