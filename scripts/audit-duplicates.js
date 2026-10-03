/**
 * Development audit: reports duplicated top-level/nested function declarations
 * and stray content after module.exports, which is easy to introduce when a
 * large file is written in chunks. Not part of the runtime.
 *
 * Usage: node scripts/audit-duplicates.js [dir]
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", process.argv[2] || "server");
const skip = /node_modules|_archive|dist|\.test\.js$/;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (skip.test(full)) continue;
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".js")) yield full;
  }
}

const report = [];
for (const file of walk(root)) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const declarations = new Map();
  const exportsLines = [];
  lines.forEach((line, index) => {
    const declaration = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/.exec(line);
    if (declaration) {
      const name = declaration[1];
      if (!declarations.has(name)) declarations.set(name, []);
      declarations.get(name).push(index + 1);
    }
    if (/^module\.exports/.test(line)) {
      const opened = (line.match(/[{[(]/g) || []).length - (line.match(/[}\])]/g) || []).length;
      // Only a self-contained export can have stray content after it: a factory
      // (module.exports = function ...) or a literal legitimately continues.
      if (opened === 0) exportsLines.push(index + 1);
    }
  });

  const duplicates = [...declarations.entries()].filter(([, at]) => at.length > 1);
  const lastExport = exportsLines.length ? Math.max(...exportsLines) : 0;
  const trailing = lastExport ? lines.slice(lastExport).filter(line => /\S/.test(line) && !/^\s*\/?\*/.test(line)).length : 0;

  if (duplicates.length || trailing > 4) {
    report.push(`${path.relative(root, file)} (${lines.length} lines, exports at ${exportsLines.join("/")})`);
    for (const [name, at] of duplicates) report.push(`  duplicate function ${name} at lines ${at.join(", ")}`);
    if (trailing > 4) report.push(`  ${trailing} significant lines after module.exports`);
  }
}

const text = report.length ? report.join("\n") : "no duplicates or trailing blocks found";
console.log(text);

