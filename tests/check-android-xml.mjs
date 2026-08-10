// Android resource XML is compiled by Gradle, five minutes into a build, and
// nothing before that point looks at it. A build was lost to a stray "--"
// inside an XML comment, which is illegal and which every other check in this
// repo is blind to - the browser suites never load these files at all.
//
// This is a well-formedness check only. It won't catch a wrong colour or a
// missing drawable; it catches the class of mistake that makes aapt refuse
// the file, in about a second rather than after a full Gradle run.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "android", "app", "src", "main");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".xml")) out.push(p);
  }
  return out;
}

// A deliberately small parser: enough to find the faults that stop aapt,
// without pulling in a dependency for a check this narrow.
//
// The first version of this checked three specific mistakes and pronounced a
// file "well-formed" if it found none - which let a comment written *inside*
// an opening tag through, and that is a build failure. It now walks the file
// as a document: text, comments and tags in sequence, with anything that
// cannot be one of those reported. Narrow beats confident.
function problems(text) {
  const found = [];
  const lineAt = (i) => text.slice(0, i).split("\n").length;

  // "--" inside a comment. Illegal in XML, and the exact thing that broke it.
  const comments = text.matchAll(/<!--([\s\S]*?)-->/g);
  for (const m of comments) {
    if (m[1].includes("--")) {
      const line = text.slice(0, m.index).split("\n").length;
      found.push(`line ${line}: "--" inside an XML comment`);
    }
  }
  // An unterminated comment swallows the rest of the file.
  const opens = (text.match(/<!--/g) || []).length;
  const closes = (text.match(/-->/g) || []).length;
  if (opens !== closes) found.push(`${opens} comment opener(s) but ${closes} closer(s)`);

  // Bare & that isn't an entity - the other common way to fail resource
  // compilation while looking perfectly fine in an editor.
  const stripped = text.replace(/<!--[\s\S]*?-->/g, "");
  const bareAmp = stripped.matchAll(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g);
  for (const m of bareAmp) {
    const line = stripped.slice(0, m.index).split("\n").length;
    found.push(`line ${line}: bare "&" (use &amp;)`);
  }

  // Walk the document. Anything structurally impossible is reported with the
  // line it starts on.
  let i = 0;
  const stack = [];
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt === -1) break;

    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end === -1) {
        found.push(`line ${lineAt(lt)}: comment is never closed`);
        break;
      }
      i = end + 3;
      continue;
    }
    if (text.startsWith("<?", lt) || text.startsWith("<![", lt)) {
      const end = text.indexOf(">", lt);
      i = end === -1 ? text.length : end + 1;
      continue;
    }

    // An ordinary tag: find its end, refusing to swallow a "<" on the way,
    // which is what a comment opened inside a tag looks like.
    let j = lt + 1;
    let quote = null;
    let closed = false;
    for (; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === "<") {
        found.push(`line ${lineAt(j)}: "<" inside a tag — a comment or tag opened before the previous one closed`);
        break;
      }
      if (c === ">") {
        closed = true;
        break;
      }
    }
    if (!closed) {
      if (j >= text.length) found.push(`line ${lineAt(lt)}: tag is never closed`);
      i = j + 1;
      continue;
    }

    const body = text.slice(lt + 1, j).trim();
    const name = (body.match(/^\/?\s*([\w:.-]+)/) || [])[1];
    if (name) {
      if (body.startsWith("/")) {
        const open = stack.pop();
        if (open !== name) {
          found.push(`line ${lineAt(lt)}: </${name}> closes ${open ? `<${open}>` : "nothing"}`);
        }
      } else if (!body.endsWith("/")) {
        stack.push(name);
      }
    }
    i = j + 1;
  }
  if (stack.length) found.push(`unclosed element(s): ${stack.join(", ")}`);

  return found;
}

let failures = 0;
const files = walk(ROOT);
for (const file of files) {
  const rel = relative(join(here, ".."), file);
  const found = problems(readFileSync(file, "utf8"));
  if (found.length) {
    failures += found.length;
    found.forEach((p) => console.log(`FAIL: ${rel} — ${p}`));
  }
}

console.log(`Checked ${files.length} Android XML file(s).`);
if (failures) {
  console.log(`\n${failures} problem(s) — Gradle would reject these.`);
  process.exit(1);
}
console.log("All well-formed.");
