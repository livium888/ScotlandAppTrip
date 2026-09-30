// Two opposite things have to stay true after the rename, and only one of
// them is obvious.
//
// The obvious half: the app is called Wayfare now, so no screen should still
// say Scotland, Edinburgh or Ally. The trip is over and shipping somebody
// else's finished holiday inside a general trip app is the single thing that
// made it read as not-for-you.
//
// The half that matters more: several identifiers MUST keep saying scotland.
// A storage key is not a label, it is an address — every install out there has
// its picks and packing list filed under those exact strings, and every backup
// file ever exported carries the old format name inside it. The Android
// applicationId is how the phone knows a new build is an upgrade rather than a
// second, empty app. Renaming any of them would strand real data to make the
// source read more tidily. This test exists to stop a future tidy-up doing
// exactly that, because it is the sort of change that looks like an
// improvement right up until somebody loses their trip.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

let failures = 0;
const check = (label, ok, extra) => {
  if (ok) console.log(`PASS: ${label}`);
  else {
    console.log(`FAIL: ${label}${extra ? " :: " + extra : ""}`);
    failures++;
  }
};

// ---------- The name people see ----------

const APP_NAME = "Wayfare";
check("the launcher says Wayfare", read("android/app/src/main/res/values/strings.xml").includes(
  `<string name="app_name">${APP_NAME}</string>`));
check("so does the window title", read("www/index.html").includes(`<title>${APP_NAME}</title>`));
check("and the bar at the top of the screen", read("www/index.html").includes(`>${APP_NAME}<`));
check("and Capacitor agrees", JSON.parse(read("capacitor.config.json")).appName === APP_NAME);

// ---------- Nothing on screen is about one finished holiday ----------

// Comments are the app explaining itself to whoever reads it next, and several
// of them are specifically about why the old names survive. Only what a user
// could actually read counts here.
function withoutComments(js) {
  return js
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const OLD_TRIP = /\b(edinburgh|stirling|glasgow|ally)\b/i;
for (const file of ["www/js/data.js", "www/index.html"]) {
  const text = file.endsWith(".js") ? withoutComments(read(file)) : read(file);
  const hit = OLD_TRIP.exec(text);
  check(`${file} is not about the old trip`, !hit, hit ? `found "${hit[0]}"` : "");
}

// app.js may say "scotland" only inside the identifiers below, never in prose.
const appJs = withoutComments(read("www/js/app.js"));
const KEEP = [
  "scotland-trip-packing-v1",
  "scotland-trip-picks-v1",
  "scotland-trip-folders-v1",
  "scotland-trip-backup",
  "b-scotland",
  "^scotland-trip-",
];
let stripped = appJs;
KEEP.forEach((k) => {
  stripped = stripped.split(k).join("«kept»");
});
const strayScotland = /scotland/i.exec(stripped);
check("app.js says Scotland only in the identifiers that must keep it",
  !strayScotland, strayScotland ? stripped.slice(Math.max(0, strayScotland.index - 60), strayScotland.index + 60) : "");
const strayTrip = OLD_TRIP.exec(stripped);
check("and never names the old trip's cities on screen",
  !strayTrip, strayTrip ? stripped.slice(Math.max(0, strayTrip.index - 60), strayTrip.index + 60) : "");

// ---------- The addresses that must NOT change ----------

const PACKAGE_ID = "com.livium888.scotlandtrip";
check("the Android applicationId is unchanged, so a new build upgrades in place",
  read("android/app/build.gradle").includes(`applicationId "${PACKAGE_ID}"`),
  "changing this installs a second, empty app and strands every saved trip");
check("and the namespace with it", read("android/app/build.gradle").includes(`namespace = "${PACKAGE_ID}"`));
check("and Capacitor's appId", JSON.parse(read("capacitor.config.json")).appId === PACKAGE_ID);
check("and the custom URL scheme shares it",
  read("android/app/src/main/res/values/strings.xml").includes(
    `<string name="custom_url_scheme">${PACKAGE_ID}</string>`));

for (const key of [
  "scotland-trip-packing-v1",
  "scotland-trip-picks-v1",
  "scotland-trip-folders-v1",
]) {
  check(`the storage key ${key} is unchanged, so existing installs keep their data`,
    appJs.includes(`"${key}"`), "renaming a storage key orphans everything filed under it");
}
check("the backup format string is unchanged, so old backup files still restore",
  appJs.includes('"scotland-trip-backup"'),
  "renaming it makes every file already exported unreadable");
check("and the first board's id, which every existing install's data is filed under",
  appJs.includes('"b-scotland"'));

console.log(`\n${failures ? `${failures} problem(s).` : "Identity is intact."}`);
process.exit(failures ? 1 : 0);
