import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  base: '/TC2-FilterTool/',
  plugins: [svelte()],
  resolve: {
    // Keep wasm-bindgen output single-sourced in the Rust crate while making
    // it part of Vite's module graph (including ES module workers).
    alias: {
      '@filter-engine': fileURLToPath(
        new URL('../crates/filter-engine/pkg', import.meta.url),
      ),
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    fs: {
      // The wasm-bindgen output lives in ../crates/filter-engine/pkg (outside
      // the web/ root), so allow the repo root to be served in dev.
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
