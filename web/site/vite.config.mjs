// The build of the map, stats and region map pages (index.html, stats.html, region-map.html in the
// repository root) into dist/site: every script, style, font and image under /assets/ with its
// content hash in the name, so browsers keep them for a year and a repeat visit asks for the page
// only. The pages stay loadable as they are, file by file, when dist/site is absent (development).
// The configurator has its own build (web/configurator/vite.config.ts); `npm run build` runs both.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { sitePages } from "./site-pages.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const PAGES = ["index.html", "stats.html", "region-map.html"];

export default defineConfig({
  root,
  base: "/",
  publicDir: false,
  envDir: false,
  plugins: [sitePages({ root, pages: PAGES })],
  build: {
    outDir: "dist/site",
    emptyOutDir: true,
    // Nothing as a data: URL: the page policy allows fonts from this site only
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    // The styles go out as written: the CSS minifier rewrites values (colours, light-dark(),
    // rounded line heights), and these pages must look exactly as they do file by file
    cssMinify: false,
    chunkSizeWarningLimit: 1200, // MapLibre is one file of that size, loaded on its own
    rolldownOptions: {
      input: PAGES.map((page) => root + page),
      output: {
        codeSplitting: {
          // What the map and the region map share is one small file, not four
          groups: [{ name: "map-engine", test: /\/src\/map-engine\/(index|geo|motion|basemaps)\.js$|preload-helper/ }],
        },
      },
    },
  },
  // The coverage worker is a module worker (it shares its model with the page)
  worker: { format: "es" },
});
