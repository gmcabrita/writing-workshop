import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Single-file build: all JS/CSS is inlined into dist/index.html so the app
// can be opened from disk (file://) in Chrome or Firefox without a server.
export default defineConfig({
  build: {
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    target: "es2022",
  },
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
