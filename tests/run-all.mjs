// Runs every browser test suite against a local server of www/.
//
// These suites exist because almost every bug in this app has been a runtime
// one - a null coordinate thrown at Leaflet, a share arriving before the page
// loaded, a model name that stopped existing - none of which a syntax check
// would catch. Running them in CI means a regression fails the build instead
// of reaching the phone.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import http from "node:http";
import fs from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const wwwDir = join(here, "..", "www");
const PORT = 8946;

const SUITES = [
  "test_share2.mjs",
  "test_profile.mjs",
  "test_planner.mjs",
  "test_gemini.mjs",
  "test_diag.mjs",
  "test_backup.mjs",
  "test_quickadd.mjs",
  "test_model.mjs",
  "test_explore_ai.mjs",
  "test_boards.mjs",
  "test_map.mjs",
  "test_alltabs.mjs",
  "test_categories.mjs",
  "test_prompts.mjs",
  "test_search.mjs",
  "test_weather.mjs",
  "test_mappick.mjs",
  "test_suggest.mjs",
  "test_back.mjs",
  "test_range.mjs",
  "test_places.mjs",
  "test_security.mjs",
  "test_major.mjs",
  "test_heuristics.mjs",
  "test_addcity.mjs",
  "test_ambiguous.mjs",
  "test_offline.mjs",
  "test_friction.mjs",
];

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  const path = join(wwwDir, rel === "/" ? "index.html" : rel);
  if (!path.startsWith(wwwDir)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(path, (err, buf) => {
    if (err) {
      res.writeHead(404).end("not found");
      return;
    }
    const ext = path.slice(path.lastIndexOf("."));
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
});

function run(suite) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, suite)], { stdio: "inherit" });
    child.on("exit", (code) => resolve({ suite, code: code ?? 1 }));
  });
}

server.listen(PORT, async () => {
  const results = [];
  for (const suite of SUITES) {
    console.log(`\n=== ${suite} ===`);
    results.push(await run(suite));
  }
  server.close();

  const failed = results.filter((r) => r.code !== 0);
  console.log("\n──────── summary ────────");
  results.forEach((r) => console.log(`${r.code === 0 ? "PASS" : "FAIL"}  ${r.suite}`));
  if (failed.length) {
    console.log(`\n${failed.length} suite(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll suites passed.");
});
