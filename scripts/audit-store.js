/**
 * Compares the public surface of the two storage engines so the MySQL path
 * cannot drift from the in-memory one that the test suite runs against.
 * Usage: node scripts/audit-store.js
 */
const MemoryStore = require("../server/store/memoryStore.js");
const MySqlStore = require("../server/store/mysqlStore.js");

const names = cls => Object.getOwnPropertyNames(cls.prototype)
  .filter(name => name !== "constructor" && !name.startsWith("_"));

const memory = new Set(names(MemoryStore));
const mysql = new Set(names(MySqlStore));

// Deliberate asymmetries, documented so a real gap still stands out:
//  - memoryStore: seed()/nextId() exist because the in-memory engine has to be
//    filled from fixtures in tests; the MySQL engine is filled by schema.sql
//    and scripts/seed.js and derives ids from AUTO_INCREMENT.
//  - mysqlStore: executor/query/one are connection plumbing, not store API.
const helpers = new Set(["assertZoneNameFree", "seed", "nextId", "executor", "query", "one"]);

const onlyMemory = [...memory].filter(name => !mysql.has(name) && !helpers.has(name));
const onlyMysql = [...mysql].filter(name => !memory.has(name) && !helpers.has(name));

console.log(`memoryStore methods: ${memory.size}`);
console.log(`mysqlStore  methods: ${mysql.size}`);
console.log(`missing in mysqlStore : ${onlyMemory.join(", ") || "none"}`);
console.log(`missing in memoryStore: ${onlyMysql.join(", ") || "none"}`);
process.exit(onlyMemory.length + onlyMysql.length === 0 ? 0 : 1);

