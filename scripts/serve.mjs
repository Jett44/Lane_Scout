/*
 * Serve dist/ over HTTP so the build can be opened in a browser that refuses
 * file:// pages (and so fetch/localStorage behave like they do for a real
 * viewer).
 *
 *   node scripts/serve.mjs        http://localhost:8099
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib.mjs";

const PORT = parseInt(process.env.PORT || "8099", 10);
const DIR = path.join(ROOT, "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  const rel = url === "/" ? "lane-scout.html" : url.replace(/^\/+/, "");
  const file = path.join(DIR, rel);

  if (!file.startsWith(DIR)) { res.writeHead(403).end("no"); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }

  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`serving ${DIR} at http://localhost:${PORT}`);
});
