import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "/configurator/",
  plugins: [preact()],
  build: { outDir: "../../dist/configurator", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/data": "http://localhost:8000",
    },
  },
  test: { environment: "jsdom", include: ["tests/**/*.test.{ts,tsx}"] },
});
