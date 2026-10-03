/**
 * Vite configuration.
 *
 * The React plugin was already a dependency but had never been wired up, so JSX
 * was relying on Vite's built-in transform. Declaring it explicitly gives the
 * automatic JSX runtime plus Fast Refresh in development, and keeps the build
 * honest about what it uses.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173
  },
  preview: {
    host: true,
    port: 4173
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false
  }
});
