/**
 * JSX loader for the test suite.
 *
 * Node cannot parse JSX, and the project has no browser test runner. esbuild is
 * already present as a Vite dependency, so the tests bundle a component into a
 * temporary ES module beside node_modules — where its bare `react` imports still
 * resolve — import it, and render it with `react-dom/server`.
 *
 * React itself is marked external so the component and `react-dom/server` share a
 * single React instance.
 */

import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = join(HERE, "..", ".bundle");

let counter = 0;

/**
 * Bundles a client module and returns its exports.
 *
 * @param entry absolute path to the .jsx/.js module
 */
export async function loadModule(entry) {
  await mkdir(TEMP_DIR, { recursive: true });
  counter += 1;

  const outfile = join(TEMP_DIR, `module-${process.pid}-${counter}.mjs`);

  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    target: "node20",
    external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime", "react/jsx-dev-runtime"],
    logLevel: "silent"
  });

  return import(pathToFileURL(outfile).href);
}

/** Removes the temporary bundles. Call once from the suite's `after` hook. */
export async function removeBundles() {
  await rm(TEMP_DIR, { recursive: true, force: true });
}
