/**
 * One-off maintenance helper: cut everything after the last `module.exports`
 * line of a file (stray duplicated blocks left over from chunked writes).
 *
 * Usage: node scripts/trim-after-exports.js <file>
 */

const fs = require("fs");

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/trim-after-exports.js <file>");

const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
let last = -1;
lines.forEach((line, index) => { if (/^module\.exports/.test(line)) last = index; });
if (last === -1) throw new Error(`No top-level module.exports found in ${file}`);

const removed = lines.slice(last + 1).filter(line => /\S/.test(line)).length;
fs.writeFileSync(file, `${lines.slice(0, last + 1).join("\n")}\n`);
console.log(`${file}: kept ${last + 1} lines, removed ${removed} trailing non-empty lines`);
