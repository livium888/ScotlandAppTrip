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
import { cpus } from "node:os";

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
  "test_pickcity.mjs",
  "test_ontheday.mjs",
  "test_review.mjs",
  "test_tripidea.mjs",
  "test_anchor.mjs",
  "test_searchflow.mjs",
  "test_mapslink.mjs",
  "test_planpicker.mjs",
  "test_kids.mjs",
  "test_pastday.mjs",
  "test_design.mjs",
  "test_ordering.mjs",
  "test_budget.mjs",
  "test_gestures.mjs",
  "test_welcome.mjs",
  "test_location.mjs",
  "test_nearby.mjs",
  "test_anchorstrict.mjs",
  "test_anchorone.mjs",
  "test_nosignal.mjs",
  "test_notify.mjs",
  "test_people.mjs",
  "test_storage.mjs",
  "test_libs.mjs",
  "test_whatson.mjs",
  "test_recall.mjs",
  "test_more.mjs",
  "test_doable.mjs",
  "test_stream.mjs",
  "test_smallstuff.mjs",
  "test_usage.mjs",
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

// Suites ran one at a time, which made a full run about fifteen minutes -
// and roughly seven of those were `waitForTimeout` calls sitting there doing
// nothing while one core of the machine idled. They share only the read-only
// server below; each drives its own browser and its own localStorage, so
// there is nothing for them to collide over.
//
// Deliberately modest. Each suite is a whole Chromium, and running fifty of
// those at once would trade a slow suite for a thrashing one.
const LANES = Math.max(2, Math.min(6, (cpus().length || 4) - 1));

function run(suite) {
  return new Promise((resolve) => {
    const started = Date.now();
    // Output is captured rather than inherited: with several running at once,
    // interleaved output is unreadable, so each suite's is held and printed
    // whole when it finishes.
    const child = spawn(process.execPath, [join(here, suite)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`\n=== ${suite} (${secs}s) ===`);
      process.stdout.write(out);
      resolve({ suite, code: code ?? 1, secs: Number(secs) });
    });
  });
}

server.listen(PORT, async () => {
  const queue = SUITES.slice();
  const results = [];
  const wallStart = Date.now();

  // A lane takes the next suite off the queue whenever it is free, so one slow
  // suite does not hold up a whole batch behind it.
  const lane = async () => {
    while (queue.length) {
      const suite = queue.shift();
      results.push(await run(suite));
    }
  };
  await Promise.all(Array.from({ length: LANES }, lane));
  server.close();

  const failed = results.filter((r) => r.code !== 0);
  const wall = ((Date.now() - wallStart) / 1000 / 60).toFixed(1);
  const cpu = (results.reduce((a, r) => a + r.secs, 0) / 60).toFixed(1);
  console.log("\n──────── summary ────────");
  // Slowest last, so the thing worth fixing is the thing you are looking at.
  results
    .slice()
    .sort((a, b) => a.secs - b.secs)
    .forEach((r) => console.log(`${r.code === 0 ? "PASS" : "FAIL"}  ${r.suite}  ${r.secs}s`));
  console.log(`\n${results.length} suites in ${wall} min wall clock (${cpu} min of work, ${LANES} at a time).`);
  if (failed.length) {
    console.log(`\n${failed.length} suite(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll suites passed.");
});
