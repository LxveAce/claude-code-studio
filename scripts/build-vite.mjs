/**
 * Standalone Vite builder for the electron-builder pipeline.
 *
 * Why this exists: @electron-forge/plugin-vite normally orchestrates Vite
 * for us, injecting entry points, output paths, and the
 * MAIN_WINDOW_VITE_DEV_SERVER_URL / MAIN_WINDOW_VITE_NAME globals at build
 * time. electron-builder doesn't do any of that — it just packages whatever
 * we hand it. So we drive Vite directly with the right injections.
 *
 * Critical: src/main/index.ts has BARE references to MAIN_WINDOW_VITE_*
 * (not inside try/catch). Without these defines those become ReferenceErrors
 * at runtime in the packaged build.
 *
 * Output layout (matches what the forge plugin produces):
 *   .vite/build/index.js     — main process bundle
 *   .vite/build/preload.js   — preload bundle
 *   .vite/renderer/main_window/index.html + assets — renderer
 *
 * Usage:
 *   node scripts/build-vite.mjs
 *
 * Dev (`npm start`) still uses electron-forge — this script is only invoked
 * by the electron-builder pipeline (npm run dist / npm run dist:dir).
 */
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const defines = {
  // For prod builds these collapse to safe values matching what forge-plugin-vite
  // emits when MAIN_WINDOW_VITE_DEV_SERVER_URL is unset. The runtime takes the
  // loadFile branch (the `else` arm at index.ts:202) and the renderer dir name
  // gets substituted into the path literal.
  MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
  MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
};

async function buildMain() {
  await build({
    configFile: path.resolve(root, 'vite.main.config.ts'),
    build: {
      lib: {
        entry: path.resolve(root, 'src/main/index.ts'),
        formats: ['cjs'],
        fileName: () => 'index.js',
      },
      outDir: path.resolve(root, '.vite/build'),
      emptyOutDir: false,
      // Electron main is small enough that the readability of unminified
      // stack traces in production logs is worth more than the few KB saved.
      minify: false,
    },
    define: defines,
  });
}

async function buildPreload() {
  await build({
    configFile: path.resolve(root, 'vite.preload.config.ts'),
    build: {
      lib: {
        entry: path.resolve(root, 'src/preload/preload.ts'),
        formats: ['cjs'],
        fileName: () => 'preload.js',
      },
      outDir: path.resolve(root, '.vite/build'),
      emptyOutDir: false,
      minify: false,
      rollupOptions: { external: ['electron'] },
    },
  });
}

async function buildRenderer() {
  // vite.renderer.config.ts already specifies root + outDir + plugins.
  await build({
    configFile: path.resolve(root, 'vite.renderer.config.ts'),
  });
}

const t0 = Date.now();
console.log('[build-vite] building main...');
await buildMain();
console.log('[build-vite] building preload...');
await buildPreload();
console.log('[build-vite] building renderer...');
await buildRenderer();
console.log(`[build-vite] complete in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
