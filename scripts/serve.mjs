/*
 * Your own copy of Lane Scout, with generation switched on.
 *
 *   node scripts/serve.mjs        http://localhost:8099
 *
 * Serves dist/ and adds a small local API. When the page is loaded from here
 * it notices the API and offers to write any matchup it does not yet have —
 * so looking something up is also how the database gets built. The same HTML
 * opened as a plain file, or sent to a friend, finds no API and stays
 * read-only.
 *
 * Localhost only. Nothing here is exposed to the network.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, POOL, stats } from "./lib.mjs";
import { generateOne } from "./generate.mjs";
import { readState } from "./patch.mjs";
import { publish } from "./publish.mjs";

const PORT = parseInt(process.env.PORT || "8099", 10);
const DIR = path.join(ROOT, "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
};

const readBody = (req) => new Promise((resolve, reject) => {
  let data = "";
  req.on("data", (c) => {
    data += c;
    if (data.length > 64 * 1024) { reject(new Error("body too large")); req.destroy(); }
  });
  req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch (e) { reject(e); } });
  req.on("error", reject);
});

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);

  /* ---- local API ---- */

  if (url === "/api/status") {
    const s = stats("Top");
    return send(res, 200, {
      ok: true,
      canGenerate: true,
      patch: readState().patch,
      coverage: { done: s.done, total: s.total },
      lanes: Object.keys(POOL)
    });
  }

  if (url === "/api/generate") {
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "POST only" });

    let body;
    try { body = await readBody(req); }
    catch { return send(res, 400, { ok: false, error: "could not read request" }); }

    const you = String(body.you || "").trim();
    const them = String(body.them || "").trim();
    const lane = String(body.lane || "Top").trim();

    if (!you || !them) return send(res, 400, { ok: false, error: "need both champions" });
    if (you.toLowerCase() === them.toLowerCase()) {
      return send(res, 400, { ok: false, error: "that is the same champion on both sides" });
    }
    if (you.length > 40 || them.length > 40 || lane.length > 20) {
      return send(res, 400, { ok: false, error: "champion name looks wrong" });
    }

    console.log(`generate: ${you} into ${them} (${lane})`);
    const t0 = Date.now();
    const r = generateOne(you, them, lane, readState().patch);

    if (!r.ok) {
      console.log(`  failed: ${r.error}`);
      return send(res, r.fatal ? 503 : 502, { ok: false, fatal: !!r.fatal, error: r.error });
    }

    console.log(`  ${r.cached ? "already had it" : `done in ${((Date.now() - t0) / 1000).toFixed(0)}s`}`);
    send(res, 200, { ok: true, cached: !!r.cached, record: r.record });

    /* Rebuild and push after answering, so the reader is not kept waiting on
       git. This is what puts a matchup you just looked up into your friends'
       copies — they pick it up on their next launch. A push failure is logged
       and ignored: the brief is already safely on disk either way. */
    if (!r.cached) {
      setImmediate(() => {
        try {
          const out = publish({ quiet: true });
          console.log(out.pushed ? `  published (${out.count} total)` : `  not published: ${out.reason}`);
        } catch (e) {
          console.warn(`  publish failed: ${e.message}`);
        }
      });
    }
    return;
  }

  /* ---- static ---- */

  const rel = url === "/" ? "lane-scout.html" : url.replace(/^\/+/, "");
  const file = path.join(DIR, rel);

  if (!file.startsWith(DIR)) return send(res, 403, { ok: false, error: "nope" });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("not found");
  }

  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  fs.createReadStream(file).pipe(res);
});

/* bind to loopback explicitly — this drives your Claude account, so it should
   never be reachable from the network */
server.listen(PORT, "127.0.0.1", () => {
  const s = stats("Top");
  console.log(`Lane Scout — http://localhost:${PORT}`);
  console.log(`generation is ON; ${s.done}/${s.total} briefs written so far`);
  console.log(`look up any matchup and it will be written on the spot.`);
});
