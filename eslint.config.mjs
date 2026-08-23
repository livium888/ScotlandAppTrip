// The app is one 14,000-line file of plain browser JavaScript with no build
// step, so nothing was ever checking it but the tests and a person reading.
// Three real bugs in recent work were exactly what `no-undef` catches for
// nothing: a call to a helper that did not exist, a field invented out of
// thin air, and dead references left behind by a deletion.
//
// Deliberately narrow. This is not here to have opinions about style - the
// file has a voice and a linter should not argue with it. It is here to catch
// the things that are simply wrong.
import js from "@eslint/js";
import globals from "globals";

// Names this app publishes or consumes across its own script tags, in load
// order: icons.js, then data.js, then app.js.
const ownGlobals = {
  icon: "readonly",
  ICON_NAMES: "readonly",
  TRIP: "readonly",
  PACKING: "readonly",
  DEFAULT_DESTINATION: "readonly",
};

// Vendored libraries, each loaded by a plain script tag before app.js.
const vendorGlobals = {
  L: "readonly",
  Fuse: "readonly",
  idb: "readonly",
  SunCalc: "readonly",
  opening_hours: "readonly",
};

export default [
  { ignores: ["www/vendor/**", "android/**", "node_modules/**"] },

  // data.js and icons.js define the names above, so they cannot also be told
  // those names already exist.
  {
    files: ["www/js/data.js", "www/js/icons.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      // These are read by app.js, which this file knows nothing about.
      "no-unused-vars": "off",
    },
  },

  {
    files: ["www/js/app.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, ...ownGlobals, ...vendorGlobals },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-implicit-globals": "error",
      // A caught error deliberately ignored is a pattern used throughout this
      // file, always with a comment saying why it is safe.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // `let x = null;` before a try/catch that assigns it is clearer than the
      // alternatives, and this rule dislikes it.
      "no-useless-assignment": "off",
      // The file's own voice on regular expressions and strings.
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-misleading-character-class": "off",
    },
  },

  {
    files: ["tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, ...vendorGlobals },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { args: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "off",
      // A test setting a flag it then re-sets before reading is how these
      // capture what a route handler saw; not worth rewriting to please a rule.
      "no-useless-assignment": "off",
      // Emoji in an assertion's character class. The tests check real strings
      // the app prints, and those strings have emoji in them.
      "no-misleading-character-class": "off",
    },
  },
];
