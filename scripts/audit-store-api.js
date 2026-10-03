/**
 * Development check: every store method the services, routes and HTTP layer
 * call must exist on both storage engines, otherwise the API works in demo mode
 * and breaks the moment MySQL is configured.
 *
 * Usage: node scripts/audit-store-api.js
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "server");
const consumers = ["services", "routes", "http"];
const extraFiles = ["app.js", "index.js"];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".js")) yield full;
  }
}

const called = new Map();
const sources = [...consumers.flatMap(folder => [...walk(path.join(root, folder))]), ...extraFiles.map(file => path.join(root, file))];
for (const file of sources) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/(?:^|[^.\w])(?:store|tx|transaction)\.([a-zA-Z_][\w]*)\s*\(/g)) {
      const key = `${path.relative(root, file)}:${index + 1}`;
      if (!called.has(match[1])) called.set(match[1], []);
      called.get(match[1]).push(key);
    }
  });
}

function methodsOf(file) {
  const source = fs.readFileSync(path.join(root, "store", file), "utf8");
  const names = new Set();
  for (const match of source.matchAll(/^\s{2}(?:async\s+)?([a-zA-Z_][\w]*)\s*\([^)]*\)\s*\{/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^\s{4}(?:async\s+)?([a-zA-Z_][\w]*)\s*\([^)]*\)\s*\{/gm)) names.add(match[1]);
  for (const match of source.matchAll(/([a-zA-Z_][\w]*)\s*:\s*(?:async\s*)?(?:\(|function)/g)) names.add(match[1]);
  return names;
}

const engines = { memoryStore: methodsOf("memoryStore.js"), mysqlStore: methodsOf("mysqlStore.js") };
const lines = [];
for (const [name, where] of [...called.entries()].sort()) {
  const missing = Object.entries(engines).filter(([, set]) => !set.has(name)).map(([engine]) => engine);
  if (missing.length) lines.push(`MISSING ${name} in ${missing.join(", ")} — called at ${where.slice(0, 3).join(", ")}`);
}

for (const [engine, set] of Object.entries(engines)) {
  const unused = [...set].filter(name => !called.has(name) && !["constructor", "close", "query", "execute", "commit", "rollback", "release"].includes(name));
  if (unused.length) lines.push(`UNUSED in ${engine}: ${unused.join(", ")}`);
}

const text = lines.length ? lines.join("\n") : `all ${called.size} store methods exist on both engines`;
fs.writeFileSync(path.join(__dirname, "..", "_store-api.txt"), `${text}\n\nmemoryStore: ${[...engines.memoryStore].sort().join(", ")}\n\nmysqlStore: ${[...engines.mysqlStore].sort().join(", ")}\n`);
console.log(text);
